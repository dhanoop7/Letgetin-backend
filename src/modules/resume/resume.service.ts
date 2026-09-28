import mongoose from 'mongoose';
import { ResumeRepository } from './resume.repository.js';
import { AppError } from '../../utils/appError.js';
import { IResumeDocument } from './resume.model.js';
import { jobService } from '../job/job.service.js';
import { UserProfileModel } from '../profile/profile.model.js';
import { UserModel } from '../user/user.model.js';

export class ResumeService {
  private repository: ResumeRepository;

  constructor() {
    this.repository = new ResumeRepository();
  }

  /**
   * Helper to sync resume content to the user's UserProfileModel document
   */
  private async syncToUserProfile(userId: string, content: any, title?: string): Promise<void> {
    try {
      if (!content) return;
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const personalInfo = content.personalInfo || {};
      const fullName = (personalInfo.fullName || '').trim();
      const nameParts = fullName.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      const skills: string[] = Array.isArray(content.skills)
        ? content.skills.map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean)
        : [];

      const educationsList = Array.isArray(content.educations)
        ? content.educations.map((edu: any, idx: number) => ({
            id: edu.id || `edu-${idx + 1}`,
            institution: edu.institution || '',
            degree: edu.degree || edu.fieldOfStudy || '',
            startYear: edu.startDate || '',
            endYear: edu.endDate || '',
            certificateUrl: '',
          }))
        : [];

      const experiencesList = Array.isArray(content.experiences)
        ? content.experiences.map((exp: any, idx: number) => ({
            id: exp.id || `exp-${idx + 1}`,
            company: exp.company || '',
            title: exp.position || '',
            start: exp.startDate || '',
            end: exp.endDate || 'Present',
            highlights: Array.isArray(exp.highlights) ? exp.highlights.join('\n') : exp.highlights || '',
          }))
        : [];

      const profileUpdates: Record<string, any> = {};

      if (firstName || lastName || personalInfo.headline || content.summary) {
        profileUpdates.personal = {
          firstName,
          lastName,
          headline: personalInfo.headline || '',
          dob: '',
          bio: content.summary || '',
        };
      }

      const existingProfile = await UserProfileModel.findOne({ userId: userObjectId }).lean();
      const primaryEmail = existingProfile?.contact?.email || '';
      const resumeEmail = (personalInfo.email || '').trim();
      const alternateEmail =
        resumeEmail && resumeEmail !== primaryEmail
          ? resumeEmail
          : existingProfile?.contact?.alternateEmail || existingProfile?.contact?.resumeEmail || '';

      if (fullName || personalInfo.phone || resumeEmail || personalInfo.location || personalInfo.websiteUrl) {
        profileUpdates.contact = {
          fullName: fullName || existingProfile?.contact?.fullName || '',
          phone: personalInfo.phone || existingProfile?.contact?.phone || '',
          city: personalInfo.location || existingProfile?.contact?.city || '',
          country: existingProfile?.contact?.country || 'India',
          linkedin: personalInfo.websiteUrl || existingProfile?.contact?.linkedin || '',
          email: primaryEmail || resumeEmail,
          alternateEmail,
          resumeEmail,
          streetAddress: existingProfile?.contact?.streetAddress || '',
          state: existingProfile?.contact?.state || '',
          postalCode: existingProfile?.contact?.postalCode || '',
        };
      }

      if (educationsList.length > 0) {
        profileUpdates.educationsList = educationsList;
        profileUpdates.education = educationsList[0];
      }

      if (experiencesList.length > 0) {
        profileUpdates.experiencesList = experiencesList;
        profileUpdates.experience = experiencesList[0];
      }

      if (skills.length > 0) {
        profileUpdates.skills = skills;
      }

      if (title) {
        profileUpdates.resumeName = title;
      }

      if (Object.keys(profileUpdates).length > 0) {
        await UserProfileModel.findOneAndUpdate(
          { userId: userObjectId },
          {
            $set: profileUpdates,
            $inc: { version: 1 },
            $setOnInsert: { userId: userObjectId, track: 'experienced', mode: 'resume' },
          },
          { upsert: true, new: true }
        );
      }
    } catch (syncErr) {
      console.warn(`[ResumeService] Non-fatal profile sync error for user ${userId}:`, syncErr);
    }
  }

  async createResume(userId: string, data: { title: string; templateId: string; content: unknown; settings?: unknown; isActive?: boolean }): Promise<IResumeDocument> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const existingCount = await (this.repository as any).model.countDocuments({ userId: userObjectId });
    const shouldBeActive = data.isActive || existingCount === 0;

    if (shouldBeActive && existingCount > 0) {
      await (this.repository as any).model.updateMany({ userId: userObjectId }, { $set: { isActive: false } });
    }

    const resume = await this.repository.create({
      userId: userId as any,
      title: data.title,
      templateId: data.templateId,
      content: data.content as Record<string, unknown>,
      settings: (data.settings || {}) as Record<string, unknown>,
      isActive: shouldBeActive,
    });

    // Bi-directional sync: Synchronize resume content back to UserProfile
    this.syncToUserProfile(userId, data.content, data.title).catch((err) =>
      console.warn(`[ResumeService] Background user profile sync warning:`, err?.message)
    );

    // Asynchronously update candidate profile & embedding in background
    jobService.syncCandidateProfile(userId).catch((err) =>
      console.warn(`[ResumeService] Background candidate profile sync warning for ${userId}:`, err?.message)
    );

    // Persist hasBuiltResume flag directly in MongoDB for the candidate user
    UserModel.findByIdAndUpdate(userId, { $set: { hasBuiltResume: true } }).catch((err) =>
      console.warn(`[ResumeService] Failed updating hasBuiltResume for user ${userId}:`, err?.message)
    );

    return resume;
  }

  async getResumesForUser(userId: string): Promise<IResumeDocument[]> {
    const list = await this.repository.findByUserId(userId);
    if (list.length > 0) {
      const hasActive = list.some((r) => r.isActive);
      if (!hasActive) {
        list[0].isActive = true;
        await (this.repository as any).model.findByIdAndUpdate(list[0]._id, { $set: { isActive: true } });
      }
    }
    return list;
  }

  async setActiveResume(id: string, userId: string): Promise<IResumeDocument> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const resume = await this.repository.findByIdAndUserId(id, userId);
    if (!resume) {
      throw AppError.notFound('Resume not found or access denied');
    }

    await (this.repository as any).model.updateMany({ userId: userObjectId }, { $set: { isActive: false } });
    const updated = await this.repository.updateById(id, { isActive: true } as any);
    if (!updated) {
      throw AppError.internal('Failed to set active resume');
    }

    return updated;
  }

  async getResumeById(id: string, userId: string): Promise<IResumeDocument> {
    const resume = await this.repository.findByIdAndUserId(id, userId);
    if (!resume) {
      throw AppError.notFound('Resume not found or access denied');
    }
    return resume;
  }

  async updateResume(id: string, userId: string, updateData: Partial<IResumeDocument>): Promise<IResumeDocument> {
    const existing = await this.repository.findByIdAndUserId(id, userId);
    if (!existing) {
      throw AppError.notFound('Resume not found or access denied');
    }

    if (updateData.isActive) {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      await (this.repository as any).model.updateMany({ userId: userObjectId, _id: { $ne: id } }, { $set: { isActive: false } });
    }

    const updated = await this.repository.updateById(id, updateData);
    if (!updated) {
      throw AppError.internal('Failed to update resume document');
    }

    // Bi-directional sync: Synchronize updated resume content back to UserProfile
    if (updateData.content) {
      this.syncToUserProfile(userId, updateData.content, updateData.title || existing.title).catch((err) =>
        console.warn(`[ResumeService] Background user profile sync warning:`, err?.message)
      );
    }

    // Asynchronously update candidate profile & embedding in background
    jobService.syncCandidateProfile(userId).catch((err) =>
      console.warn(`[ResumeService] Background candidate profile sync warning for ${userId}:`, err?.message)
    );

    return updated;
  }

  async deleteResume(id: string, userId: string): Promise<void> {
    const existing = await this.repository.findByIdAndUserId(id, userId);
    if (!existing) {
      throw AppError.notFound('Resume not found or access denied');
    }
    const wasActive = existing.isActive;
    await this.repository.deleteById(id);

    if (wasActive) {
      const remaining = await this.repository.findByUserId(userId);
      if (remaining.length > 0) {
        await (this.repository as any).model.findByIdAndUpdate(remaining[0]._id, { $set: { isActive: true } });
      }
    }

    // Asynchronously re-sync candidate profile after resume deletion
    jobService.syncCandidateProfile(userId).catch((err) =>
      console.warn(`[ResumeService] Background candidate profile sync warning for ${userId}:`, err?.message)
    );
  }
}
