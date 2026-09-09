import mongoose from 'mongoose';
import {
  RecruiterCreditsModel,
  CreditTransactionModel,
  CandidateContactRevealModel,
  IRecruiterCreditsDocument,
} from './recruiterCredits.model.js';
import { RecruiterOrgRepository } from '../recruiterOrg/recruiterOrg.repository.js';
import { CandidateProfileModel } from '../job/candidateProfile.model.js';
import { JobModel } from '../job/job.model.js';
import { UserModel } from '../user/user.model.js';
import { ResumeModel } from '../resume/resume.model.js';
import { UserProfileModel } from '../profile/profile.model.js';
import { embeddingService } from '../embedding/embedding.service.js';
import { AppError } from '../../utils/appError.js';
import { CREDIT_PACKS } from './creditPacks.constants.js';
import { MATCH_VOLUME_OPTIONS, PIPELINE_SUB_OPTIONS, SUB_OPTION_CREDIT_COST } from './pipelineCreditCosts.constants.js';

const CONTACT_REVEAL_COST = 5;

function maskEmail(email?: string): string {
  if (!email) return '';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

function maskPhone(phone?: string): string {
  if (!phone) return '';
  return phone.length <= 4 ? phone : `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}

export class RecruiterCreditsService {
  private orgRepository = new RecruiterOrgRepository();

  private async requireOrgId(userId: string): Promise<string> {
    const org = await this.orgRepository.findByOwnerUserId(userId);
    if (!org) {
      throw AppError.badRequest('Complete your organization profile before using credits');
    }
    return org._id.toString();
  }

  private async getOrCreateCredits(orgId: string): Promise<IRecruiterCreditsDocument> {
    let credits = await RecruiterCreditsModel.findOne({ orgId });
    if (!credits) {
      credits = await RecruiterCreditsModel.create({ orgId });
    }
    return credits;
  }

  async getBalance(userId: string): Promise<{
    balance: number;
    packs: typeof CREDIT_PACKS;
    pipelineSubOptions: typeof PIPELINE_SUB_OPTIONS;
    subOptionCost: number;
    matchVolumeOptions: typeof MATCH_VOLUME_OPTIONS;
  }> {
    const orgId = await this.requireOrgId(userId);
    const credits = await this.getOrCreateCredits(orgId);
    return {
      balance: credits.balance,
      packs: CREDIT_PACKS,
      pipelineSubOptions: PIPELINE_SUB_OPTIONS,
      subOptionCost: SUB_OPTION_CREDIT_COST,
      matchVolumeOptions: MATCH_VOLUME_OPTIONS,
    };
  }

  /** Org-scoped read, for callers (like job creation) that already resolved orgId themselves. */
  async getBalanceForOrg(orgId: string): Promise<number> {
    const credits = await this.getOrCreateCredits(orgId);
    return credits.balance;
  }

  /**
   * Shared deduct primitive: validates sufficient balance, decrements it, and records the
   * transaction. Every credit-spending flow (contact reveal, job pipeline publish, ...) should
   * go through this rather than mutating the balance directly.
   */
  private async deduct(
    orgId: string,
    amount: number,
    reason: string,
    refId?: unknown
  ): Promise<{ balance: number }> {
    const credits = await this.getOrCreateCredits(orgId);
    if (credits.balance < amount) {
      throw AppError.badRequest('Insufficient credits. Please buy more credits.');
    }
    credits.balance -= amount;
    await credits.save();

    await CreditTransactionModel.create({
      orgId,
      type: 'spend',
      amount,
      reason,
      refId,
    });

    return { balance: credits.balance };
  }

  /** Charges an org for a job's published hiring-pipeline selection. No-op (no charge, no error) when amount is 0. */
  async chargeForJobPublish(orgId: string, jobId: string, amount: number): Promise<{ balance: number }> {
    if (amount <= 0) {
      const credits = await this.getOrCreateCredits(orgId);
      return { balance: credits.balance };
    }
    return this.deduct(orgId, amount, 'Job hiring pipeline published', jobId);
  }

  async purchase(userId: string, packId: string): Promise<{ balance: number }> {
    const orgId = await this.requireOrgId(userId);
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    if (!pack) {
      throw AppError.badRequest('Invalid credit pack');
    }

    const credits = await this.getOrCreateCredits(orgId);
    credits.balance += pack.credits;
    await credits.save();

    await CreditTransactionModel.create({
      orgId,
      type: 'purchase',
      amount: pack.credits,
      reason: `Purchased ${pack.credits} credits (${pack.id} pack)`,
    });

    return { balance: credits.balance };
  }

  async revealContact(
    userId: string,
    candidateUserId: string
  ): Promise<{ email?: string; phone?: string; balance: number }> {
    const orgId = await this.requireOrgId(userId);

    const candidate = await UserModel.findById(candidateUserId);
    if (!candidate) {
      throw AppError.notFound('Candidate not found');
    }

    const existingReveal = await CandidateContactRevealModel.findOne({ orgId, candidateUserId });
    if (existingReveal) {
      const credits = await this.getOrCreateCredits(orgId);
      return { email: candidate.email, phone: candidate.phone, balance: credits.balance };
    }

    const { balance } = await this.deduct(orgId, CONTACT_REVEAL_COST, 'Revealed candidate contact', candidate._id);
    await CandidateContactRevealModel.create({ orgId, candidateUserId });

    return { email: candidate.email, phone: candidate.phone, balance };
  }

  async searchCandidates(
    userId: string,
    params: { jobId?: string; query?: string; limit?: number }
  ): Promise<any[]> {
    const orgId = await this.requireOrgId(userId);
    const limit = Math.min(50, params.limit || 20);

    let queryEmbedding: number[] | undefined;
    if (params.jobId) {
      if (!mongoose.Types.ObjectId.isValid(params.jobId)) {
        throw AppError.badRequest('Invalid jobId format');
      }
      const job = await JobModel.findById(params.jobId);
      if (!job) {
        throw AppError.notFound('Job not found');
      }

      if (job.embedding && job.embedding.length > 0) {
        queryEmbedding = job.embedding;
      } else {
        // Generate embedding on-the-fly for this job if missing
        try {
          const normalizedText = embeddingService.buildJobEmbeddingText(job);
          const result = await embeddingService.generateEmbedding(normalizedText);
          queryEmbedding = result.embedding;
          job.embedding = result.embedding;
          job.embeddingModel = result.model;
          job.embeddingVersion = result.version;
          job.embeddingStatus = 'completed';
          await job.save().catch((e) => console.warn('[searchCandidates] Failed saving computed embedding to job:', e));
        } catch (err: any) {
          console.warn('[searchCandidates] Failed generating job embedding on the fly:', err?.message || err);
        }
      }
    } else if (params.query && params.query.trim().length > 0) {
      try {
        const result = await embeddingService.generateEmbedding(params.query.trim());
        queryEmbedding = result.embedding;
      } catch (err: any) {
        console.warn('[searchCandidates] Failed generating query embedding:', err?.message || err);
      }
    } else {
      throw AppError.badRequest('A jobId or query string is required to search candidates');
    }

    if (!queryEmbedding || queryEmbedding.length === 0) {
      throw AppError.internal('Unable to generate search vector for candidate matching');
    }

    // Query completed candidate profiles first
    let profiles = await CandidateProfileModel.find({ embeddingStatus: 'completed' })
      .populate({ path: 'userId', select: 'fullName username email phone avatarUrl avatar role' })
      .lean();

    // Fallback: If no completed profiles, query any available candidate profiles
    if (profiles.length === 0) {
      profiles = await CandidateProfileModel.find({})
        .populate({ path: 'userId', select: 'fullName username email phone avatarUrl avatar role' })
        .lean();
    }

    // Filter out orphan profiles where userId does not exist or user is not a candidate
    const seenUserIds = new Set<string>();
    const validCandidateProfiles = profiles.filter((p: any) => {
      if (!p.userId || !p.userId._id) return false;
      if (p.userId.role === 'recruiter' || p.userId.role === 'admin') return false;
      const uId = String(p.userId._id);
      if (seenUserIds.has(uId)) return false;
      seenUserIds.add(uId);
      return true;
    });

    const revealedSet = new Set(
      (await CandidateContactRevealModel.find({ orgId }).select('candidateUserId').lean()).map((r) =>
        String(r.candidateUserId)
      )
    );

    const userIds = validCandidateProfiles.map((p: any) => p.userId._id);

    const [resumes, userProfiles] = await Promise.all([
      ResumeModel.find({ userId: { $in: userIds } }).sort({ updatedAt: -1 }).lean(),
      UserProfileModel.find({ userId: { $in: userIds } }).lean(),
    ]);

    const resumesByUserId = new Map<string, any[]>();
    for (const r of resumes) {
      const uId = String(r.userId);
      if (!resumesByUserId.has(uId)) {
        resumesByUserId.set(uId, []);
      }
      resumesByUserId.get(uId)!.push(r);
    }

    const userProfilesByUserId = new Map<string, any>();
    for (const up of userProfiles) {
      userProfilesByUserId.set(String(up.userId), up);
    }

    const ranked = validCandidateProfiles
      .map((profile: any) => {
        let score = 0.5;
        if (profile.embedding && profile.embedding.length > 0 && queryEmbedding && queryEmbedding.length > 0) {
          score = embeddingService.cosineSimilarity(queryEmbedding, profile.embedding);
        } else if (profile.skills && profile.skills.length > 0) {
          score = 0.65;
        }

        const candidateUserId = String(profile.userId._id);
        const isRevealed = revealedSet.has(candidateUserId);
        const candidateResumes = resumesByUserId.get(candidateUserId) || [];
        const latestResume = candidateResumes.find((r) => r.isActive) || candidateResumes[0] || null;
        const userProfile = userProfilesByUserId.get(candidateUserId) || null;

        const resumeContent = (latestResume?.content as any) || {};
        const personalInfo = resumeContent.personalInfo || {};

        const name = profile.userId?.fullName || userProfile?.contact?.fullName || profile.userId?.username || 'Candidate';
        const avatarUrl =
          profile.userId?.avatarUrl ||
          profile.userId?.avatar ||
          personalInfo?.avatarUrl ||
          userProfile?.personal?.avatarUrl ||
          '';
        const headline =
          profile.headline ||
          personalInfo?.headline ||
          userProfile?.personal?.headline ||
          'Professional Profile';
        const location =
          profile.location ||
          personalInfo?.location ||
          (userProfile?.contact?.city ? `${userProfile.contact.city}${userProfile.contact.country ? `, ${userProfile.contact.country}` : ''}` : '') ||
          'Remote';
        const summary = resumeContent.summary || userProfile?.personal?.bio || profile.summary || '';

        // Experiences
        let experiences = resumeContent.experiences || [];
        if ((!experiences || experiences.length === 0) && userProfile?.experiencesList && userProfile.experiencesList.length > 0) {
          experiences = userProfile.experiencesList.map((exp: any, idx: number) => ({
            id: exp.id || `exp-${idx}`,
            company: exp.company,
            position: exp.title,
            location: '',
            startDate: exp.start,
            endDate: exp.end,
            isCurrent: !exp.end || exp.end.toLowerCase() === 'present',
            highlights: exp.highlights ? (Array.isArray(exp.highlights) ? exp.highlights : [exp.highlights]) : [],
          }));
        }

        // Educations
        let educations = resumeContent.educations || [];
        if ((!educations || educations.length === 0) && userProfile?.educationsList && userProfile.educationsList.length > 0) {
          educations = userProfile.educationsList.map((edu: any, idx: number) => ({
            id: edu.id || `edu-${idx}`,
            institution: edu.institution,
            degree: edu.degree,
            fieldOfStudy: '',
            startDate: edu.startYear,
            endDate: edu.endYear,
          }));
        }

        // Skills
        const rawSkills =
          profile.skills && profile.skills.length > 0
            ? profile.skills
            : Array.isArray(resumeContent.skills)
              ? resumeContent.skills.map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean)
              : userProfile?.skills || [];
        const skills = Array.from(new Set(rawSkills.filter(Boolean)));

        const projects = resumeContent.projects || [];
        const certificates = resumeContent.certificates || [];
        const languages = resumeContent.languages || [];
        const socialLinks = resumeContent.socialLinks || [];

        // Build composite resume object so PDF preview canvas displays correctly
        const compositeResume = latestResume
          ? {
              ...latestResume,
              content: {
                ...resumeContent,
                personalInfo: {
                  ...personalInfo,
                  fullName: name,
                  headline,
                  location,
                  avatarUrl,
                  email: isRevealed ? profile.userId?.email : undefined,
                  phone: isRevealed ? profile.userId?.phone : undefined,
                },
                summary: summary || resumeContent.summary,
                skills: skills.length > 0 ? skills : resumeContent.skills,
                experiences: experiences.length > 0 ? experiences : resumeContent.experiences,
                educations: educations.length > 0 ? educations : resumeContent.educations,
                projects,
                certificates,
                languages,
                socialLinks,
              },
            }
          : {
              _id: `res-${candidateUserId}`,
              title: `${name}'s Resume`,
              templateId: 'modern-sleek',
              atsScore: 85,
              content: {
                personalInfo: {
                  fullName: name,
                  headline,
                  location,
                  avatarUrl,
                  email: isRevealed ? profile.userId?.email : undefined,
                  phone: isRevealed ? profile.userId?.phone : undefined,
                },
                summary,
                skills,
                experiences,
                educations,
                projects,
                certificates,
                languages,
                socialLinks,
              },
              settings: {
                primaryColor: '#1e293b',
                fontFamily: 'Inter, system-ui, sans-serif',
              },
            };

        return {
          candidateUserId,
          name,
          avatarUrl,
          headline,
          location,
          skills,
          summary,
          experiences,
          educations,
          projects,
          certificates,
          languages,
          socialLinks,
          yearsOfExperience: profile.yearsOfExperience || (experiences.length > 0 ? experiences.length * 2 : 0),
          matchScore: Math.max(10, Math.min(99, Math.round(score * 100))),
          email: isRevealed ? profile.userId?.email : maskEmail(profile.userId?.email),
          phone: isRevealed ? profile.userId?.phone : maskPhone(profile.userId?.phone),
          contactRevealed: isRevealed,
          resume: compositeResume,
          candidate: {
            _id: candidateUserId,
            fullName: name,
            username: profile.userId?.username,
            email: isRevealed ? profile.userId?.email : maskEmail(profile.userId?.email),
            phone: isRevealed ? profile.userId?.phone : maskPhone(profile.userId?.phone),
            avatarUrl,
          },
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);

    return ranked;
  }
}

export const recruiterCreditsService = new RecruiterCreditsService();
