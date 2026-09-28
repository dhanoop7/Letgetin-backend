import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { UserProfileModel } from './profile.model.js';
import { UserModel } from '../user/user.model.js';
import { ResumeModel } from '../resume/resume.model.js';
import { jobService } from '../job/job.service.js';
import { enqueueCandidateEmbedding } from '../../queues/queue.config.js';
import { AppError } from '../../utils/appError.js';

export class ProfileController {
  /**
   * GET /api/profile
   * Get authenticated user's profile data
   */
  static async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw AppError.unauthorized('User authentication required');
      }

      const userObjectId = new mongoose.Types.ObjectId(userId);
      let profile = await UserProfileModel.findOne({ userId: userObjectId });

      const user = await UserModel.findById(userObjectId).lean();

      if (!profile) {
        // Prepopulate from user or latest resume if available
        const latestResume = await ResumeModel.findOne({ userId: userObjectId }).sort({ updatedAt: -1 }).lean();
        const resumeContent = (latestResume?.content || {}) as any;

        const defaultFullName = user?.fullName || user?.username || '';
        const nameParts = defaultFullName.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        const skills: string[] = Array.isArray(resumeContent.skills)
          ? resumeContent.skills.map((s: any) => (typeof s === 'string' ? s : s.name)).filter(Boolean)
          : [];

        const educationsList = Array.isArray(resumeContent.educations)
          ? resumeContent.educations.map((edu: any, idx: number) => ({
              id: `edu-${idx + 1}`,
              institution: edu.institution || '',
              degree: edu.degree || '',
              startYear: edu.startDate || '',
              endYear: edu.endDate || '',
              certificateUrl: '',
            }))
          : [];

        const experiencesList = Array.isArray(resumeContent.experiences)
          ? resumeContent.experiences.map((exp: any, idx: number) => ({
              id: `exp-${idx + 1}`,
              company: exp.company || '',
              title: exp.position || '',
              start: exp.startDate || '',
              end: exp.endDate || 'Present',
              highlights: Array.isArray(exp.highlights) ? exp.highlights.join('\n') : (exp.highlights || ''),
            }))
          : [];

        const defaultData = {
          userId: userObjectId,
          track: 'experienced',
          mode: 'manual',
          resumeName: latestResume?.title || null,
          videoName: null,
          personal: {
            firstName,
            lastName,
            headline: resumeContent.personalInfo?.headline || '',
            dob: '',
            bio: resumeContent.summary || '',
          },
          contact: {
            fullName: defaultFullName,
            phone: user?.phone || resumeContent.personalInfo?.phone || '',
            city: resumeContent.personalInfo?.location || '',
            country: 'India',
            linkedin: resumeContent.personalInfo?.linkedin || '',
            email: user?.email || '',
            alternateEmail:
              resumeContent.personalInfo?.email && resumeContent.personalInfo?.email !== user?.email
                ? resumeContent.personalInfo?.email
                : '',
            resumeEmail:
              resumeContent.personalInfo?.email && resumeContent.personalInfo?.email !== user?.email
                ? resumeContent.personalInfo?.email
                : '',
            streetAddress: '',
            state: '',
            postalCode: '',
          },
          education: educationsList[0] || {
            institution: '',
            degree: '',
            startYear: '',
            endYear: '',
            certificateUrl: '',
          },
          educationsList,
          experience: experiencesList[0] || {
            company: '',
            title: '',
            start: '',
            end: '',
            highlights: '',
          },
          experiencesList,
          skills,
        };

        profile = await UserProfileModel.create(defaultData);
      } else if (user?.email && profile.contact?.email !== user.email) {
        // Ensure account email is in sync with registered user email
        profile.contact.email = user.email;
        await profile.save();
      }

      res.status(200).json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/profile
   * Create or update user's profile data
   */
  static async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw AppError.unauthorized('User authentication required');
      }

      const userObjectId = new mongoose.Types.ObjectId(userId);
      const user = await UserModel.findById(userObjectId).lean();
      const payload = req.body;

      // Clean payload
      const updateData: Record<string, any> = {};

      if (payload.track !== undefined) updateData.track = payload.track;
      if (payload.mode !== undefined) updateData.mode = payload.mode;
      if (payload.resumeName !== undefined) updateData.resumeName = payload.resumeName;
      if (payload.videoName !== undefined) updateData.videoName = payload.videoName;
      if (payload.personal) updateData.personal = payload.personal;
      if (payload.contact) {
        // Preserve immutable registered login email
        updateData.contact = {
          ...payload.contact,
          email: user?.email || payload.contact.email || '',
        };
      }
      if (payload.education) updateData.education = payload.education;
      if (Array.isArray(payload.educationsList)) updateData.educationsList = payload.educationsList;
      if (payload.experience) updateData.experience = payload.experience;
      if (Array.isArray(payload.experiencesList)) updateData.experiencesList = payload.experiencesList;
      if (Array.isArray(payload.skills)) {
        updateData.skills = payload.skills.map((s: any) => String(s).trim()).filter(Boolean);
      }
      if (payload.academicPercentage !== undefined) {
        const pct = Number(payload.academicPercentage);
        if (!isNaN(pct) && pct >= 0 && pct <= 100) {
          updateData.academicPercentage = pct;
        }
      }

      delete updateData.userId;

      // Atomically persist profile changes and increment version for concurrency control
      const updatedProfile = await UserProfileModel.findOneAndUpdate(
        { userId: userObjectId },
        {
          $set: updateData,
          $inc: { version: 1 },
          $setOnInsert: { userId: userObjectId },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      // Sync user model fields if provided
      if (payload.contact?.fullName || payload.contact?.phone) {
        const userUpdates: Record<string, any> = {};
        if (payload.contact?.fullName) userUpdates.fullName = payload.contact.fullName.trim();
        if (payload.contact?.phone) userUpdates.phone = payload.contact.phone.trim();
        await UserModel.findByIdAndUpdate(userObjectId, { $set: userUpdates });
      }

      // Bi-directional binding: Synchronize profile changes into user's latest resume in database
      try {
        const fullName =
          `${updatedProfile.personal?.firstName || ''} ${updatedProfile.personal?.lastName || ''}`.trim() ||
          updatedProfile.contact?.fullName ||
          '';
        const email = updatedProfile.contact?.email || '';
        const phone = updatedProfile.contact?.phone || '';
        const location = [updatedProfile.contact?.city, updatedProfile.contact?.country].filter(Boolean).join(', ');
        const headline = updatedProfile.personal?.headline || '';
        const summary = updatedProfile.personal?.bio || '';

        const skills = Array.isArray(updatedProfile.skills)
          ? updatedProfile.skills.map((s: string, idx: number) => ({ id: `skill-${idx + 1}`, name: s, level: 4 }))
          : [];

        const educations = Array.isArray(updatedProfile.educationsList)
          ? updatedProfile.educationsList.map((edu: any, idx: number) => ({
              id: edu.id || `edu-${idx + 1}`,
              institution: edu.institution || '',
              degree: edu.degree || '',
              fieldOfStudy: edu.degree || '',
              startDate: edu.startYear || '',
              endDate: edu.endYear || '',
              isCurrent: edu.endYear?.toLowerCase() === 'present',
            }))
          : [];

        const experiences = Array.isArray(updatedProfile.experiencesList)
          ? updatedProfile.experiencesList.map((exp: any, idx: number) => ({
              id: exp.id || `exp-${idx + 1}`,
              company: exp.company || '',
              position: exp.title || '',
              startDate: exp.start || '',
              endDate: exp.end || 'Present',
              isCurrent: exp.end?.toLowerCase() === 'present',
              highlights:
                typeof exp.highlights === 'string'
                  ? exp.highlights.split('\n').filter(Boolean)
                  : Array.isArray(exp.highlights)
                  ? exp.highlights
                  : [],
            }))
          : [];

        const latestResume = await ResumeModel.findOne({ userId: userObjectId }).sort({ updatedAt: -1 });

        if (latestResume) {
          const currentContent = (latestResume.content || {}) as any;
          latestResume.content = {
            ...currentContent,
            personalInfo: {
              ...(currentContent.personalInfo || {}),
              fullName: fullName || currentContent.personalInfo?.fullName || '',
              headline: headline || currentContent.personalInfo?.headline || '',
              email: email || currentContent.personalInfo?.email || '',
              phone: phone || currentContent.personalInfo?.phone || '',
              location: location || currentContent.personalInfo?.location || '',
              websiteUrl: updatedProfile.contact?.linkedin || currentContent.personalInfo?.websiteUrl || '',
            },
            summary: summary || currentContent.summary || '',
            skills: skills.length > 0 ? skills : currentContent.skills || [],
            educations: educations.length > 0 ? educations : currentContent.educations || [],
            experiences: experiences.length > 0 ? experiences : currentContent.experiences || [],
          };
          latestResume.markModified('content');
          await latestResume.save();
        }
      } catch (syncErr) {
        console.warn('[ProfileController] Non-fatal error syncing profile to resume:', syncErr);
      }

      // Schedule background candidate profile vector embedding sync via BullMQ (coalesced & debounced)
      enqueueCandidateEmbedding(userId).catch((err) => {
        console.warn('[ProfileController] Error scheduling background candidate embedding:', err);
      });

      res.status(200).json({
        success: true,
        data: updatedProfile,
        message: 'Profile updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}
