import mongoose from 'mongoose';
import crypto from 'crypto';
import { JobModel, WorkplaceType, EmploymentType, ExperienceLevel } from './job.model.js';
import { CandidateProfileModel, ICandidateProfileDocument } from './candidateProfile.model.js';
import { RecruiterOrgRepository } from '../recruiterOrg/recruiterOrg.repository.js';
import { ResumeModel } from '../resume/resume.model.js';
import { UserModel } from '../user/user.model.js';
import { UserProfileModel } from '../profile/profile.model.js';
import { embeddingService } from '../embedding/embedding.service.js';
import { enqueueCandidateEmbedding,enqueueJobEmbedding } from '../../queues/queue.config.js';

import { redisService } from '../../services/redis.service.js';
import { AppError } from '../../utils/appError.js';
import { recruiterCreditsService } from '../recruiterCredits/recruiterCredits.service.js';
import { computePipelineCreditsCost, sanitizePipelineSelection } from '../recruiterCredits/pipelineCreditCosts.constants.js';
import { ApplicationModel } from '../application/application.model.js';

export interface JobQueryFilters {
  search?: string;
  workplaceType?: WorkplaceType | 'all';
  employmentType?: EmploymentType | 'all';
  experienceLevel?: ExperienceLevel | 'all';
  country?: string;
  skills?: string[];
  minScore?: number;
  page?: number;
  limit?: number;
  sort?: 'recommended' | 'recent' | 'salary';
}

export interface IJobData {
  _id: any;
  title: string;
  company: {
    name: string;
    logo?: string;
    website?: string;
  };
  description: string;
  responsibilities: string[];
  requirements: string[];
  preferredQualifications: string[];
  skills: string[];
  experienceLevel: ExperienceLevel;
  minimumExperience: number;
  maximumExperience?: number;
  employmentType: EmploymentType;
  workplaceType: WorkplaceType;
  location: {
    city?: string;
    state?: string;
    country: string;
    remote: boolean;
  };
  salary: {
    min: number;
    max: number;
    currency: string;
    period: 'yearly' | 'monthly' | 'hourly';
  };
  educationRequirements?: string;
  benefits: string[];
  applicationUrl: string;
  source: string;
  status: string;
  publishedAt: Date | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface JobWithMatchData extends IJobData {
  matchScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  matchReasons: string[];
  vectorScore?: number;
  isAlreadyApplied?: boolean;
}

export class JobService {
  /**
   * Syncs candidate profile from user's profile data and latest active resume and triggers background embedding if updated.
   * Executed asynchronously during resume/profile mutation events or manual sync.
   */
  public async syncCandidateProfile(userId: string): Promise<ICandidateProfileDocument | null> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return null;
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const [user, latestResume, userProfile] = await Promise.all([
      UserModel.findById(userObjectId).lean(),
      ResumeModel.findOne({ userId: userObjectId }).sort({ updatedAt: -1 }).lean(),
      UserProfileModel.findOne({ userId: userObjectId }).lean(),
    ]);

    let skills: string[] = [];
    let headline = '';
    let summary = '';
    let yearsOfExperience = 0;
    let location = '';
    let education = '';
    let resumeContent: any = {};

    if (latestResume && latestResume.content) {
      resumeContent = { ...(latestResume.content as any) };
      headline = resumeContent.personalInfo?.headline || '';
      summary = resumeContent.summary || '';
      location = resumeContent.personalInfo?.location || '';

      if (Array.isArray(resumeContent.skills)) {
        skills = resumeContent.skills
          .map((s: any) => (typeof s === 'string' ? s : s.name))
          .filter(Boolean);
      }

      if (Array.isArray(resumeContent.experiences)) {
        yearsOfExperience = Math.min(25, Math.max(1, resumeContent.experiences.length * 2));
      }

      if (Array.isArray(resumeContent.educations) && resumeContent.educations.length > 0) {
        const edu = resumeContent.educations[0];
        education = `${edu.degree || ''} ${edu.fieldOfStudy || ''} - ${edu.institution || ''}`.trim();
      }
    } else if (user) {
      headline = user.fullName ? `${user.fullName}'s Profile` : 'Software Professional';
      skills = ['React', 'TypeScript', 'Node.js', 'JavaScript'];
    }

    // Override/augment with UserProfile data from /profile route if present
    if (userProfile) {
      if (Array.isArray(userProfile.skills) && userProfile.skills.length > 0) {
        // Merge or prioritize profile skills
        const combinedSkills = Array.from(new Set([...userProfile.skills, ...skills]));
        skills = combinedSkills;
      }
      if (userProfile.personal?.headline) {
        headline = userProfile.personal.headline;
      } else if (userProfile.experience?.title && !headline) {
        headline = userProfile.experience.title;
      }
      if (userProfile.personal?.bio) {
        summary = userProfile.personal.bio;
      }
      if (userProfile.contact?.city || userProfile.contact?.country) {
        const parts = [userProfile.contact.city, userProfile.contact.country].filter(Boolean);
        if (parts.length > 0) {
          location = parts.join(', ');
        }
      }
      if (userProfile.track === 'fresher') {
        yearsOfExperience = 0;
      } else if (userProfile.experiencesList && userProfile.experiencesList.length > 0) {
        yearsOfExperience = Math.min(25, Math.max(1, userProfile.experiencesList.length * 2));
      }
      if (userProfile.educationsList && userProfile.educationsList.length > 0) {
        const topEdu = userProfile.educationsList[0];
        education = `${topEdu.degree || ''} - ${topEdu.institution || ''}`.trim();
      } else if (userProfile.education?.institution) {
        education = `${userProfile.education.degree || ''} - ${userProfile.education.institution || ''}`.trim();
      }

      // Build composite resumeContent for rich semantic embedding representation
      resumeContent = {
        ...resumeContent,
        personalInfo: {
          ...resumeContent.personalInfo,
          fullName: userProfile.contact?.fullName || user?.fullName,
          headline: headline,
          location: location,
        },
        summary: summary,
        skills: skills,
        experiences: userProfile.experiencesList && userProfile.experiencesList.length > 0
          ? userProfile.experiencesList.map((e) => ({
              company: e.company,
              position: e.title,
              startDate: e.start,
              endDate: e.end,
              highlights: e.highlights ? [e.highlights] : [],
            }))
          : resumeContent.experiences,
        educations: userProfile.educationsList && userProfile.educationsList.length > 0
          ? userProfile.educationsList.map((e) => ({
              institution: e.institution,
              degree: e.degree,
              startDate: e.startYear,
              endDate: e.endYear,
            }))
          : resumeContent.educations,
      };
    }

    const rawText = embeddingService.buildCandidateEmbeddingText(resumeContent, user || undefined);

    let profile = await CandidateProfileModel.findOne({ userId: userObjectId });

    const textChanged = !profile || profile.rawText !== rawText;
    const needsEmbedding = !profile || !profile.embedding || profile.embedding.length === 0 || profile.embeddingStatus !== 'completed';

    const currentVersion = userProfile?.version || 1;

    if (!profile) {
      profile = await CandidateProfileModel.create({
        userId: userObjectId,
        resumeId: latestResume?._id,
        headline,
        summary,
        skills,
        yearsOfExperience,
        location,
        education,
        rawText,
        profileVersion: currentVersion,
        embeddingStatus: 'pending',
        lastSyncedAt: new Date(),
      });
      await enqueueCandidateEmbedding(userId, latestResume?._id?.toString());
    } else if (textChanged || needsEmbedding) {
      profile.resumeId = latestResume?._id as any;
      profile.headline = headline;
      profile.summary = summary;
      profile.skills = skills;
      profile.yearsOfExperience = yearsOfExperience;
      profile.location = location;
      profile.education = education;
      profile.rawText = rawText;
      profile.profileVersion = currentVersion;
      profile.embeddingStatus = 'pending';
      profile.lastSyncedAt = new Date();
      await profile.save();
      await enqueueCandidateEmbedding(userId, latestResume?._id?.toString(), textChanged || needsEmbedding);
    }

    return profile;
  }

  /**
   * Retrieves AI-powered personalized job recommendations for an authenticated user.
   * High-performance 2-stage pipeline: Vector Search -> Deterministic Ranking + Redis Caching.
   */
  public async getRecommendedJobs(
    userId: string,
    filters: JobQueryFilters = {}
  ): Promise<{
    jobs: JobWithMatchData[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    candidateProfile: {
      headline?: string;
      skillsCount: number;
      skills: string[];
      hasEmbedding: boolean;
      embeddingStatus: string;
    };
  }> {
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.unauthorized('User authentication required for job recommendations');
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Fast read-only query of candidate profile (never block or write synchronously in read path)
    let candidateProfile = await CandidateProfileModel.findOne({ userId: userObjectId }).lean();

    // If candidate profile does not exist yet, trigger background sync and do immediate lightweight fallback
    if (!candidateProfile) {
      this.syncCandidateProfile(userId).catch((err) =>
        console.warn(`[JobService] Background candidate profile sync warning for ${userId}:`, err?.message)
      );

      const latestResume = await ResumeModel.findOne({ userId: userObjectId }).sort({ updatedAt: -1 }).lean();
      let extractedSkills: string[] = [];
      let headline = 'Professional Profile';
      if (latestResume && latestResume.content) {
        const content = latestResume.content as any;
        headline = content.personalInfo?.headline || headline;
        if (Array.isArray(content.skills)) {
          extractedSkills = content.skills.map((s: any) => (typeof s === 'string' ? s : s.name)).filter(Boolean);
        }
      }

      candidateProfile = {
        userId: userObjectId,
        headline,
        skills: extractedSkills,
        yearsOfExperience: 2,
        embeddingStatus: 'pending',
        lastSyncedAt: new Date(),
      } as any;
    }

    const candidateSkills = candidateProfile?.skills || [];
    const candidateEmbedding = candidateProfile?.embedding;

    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 20));
    const skip = (page - 1) * limit;

    // Check Redis Recommendation Cache
    const profileVersion = candidateProfile?.updatedAt ? new Date(candidateProfile.updatedAt).getTime() : '1';
    const filterHash = crypto.createHash('md5').update(JSON.stringify(filters)).digest('hex');
    const cacheKey = `rec:${userId}:v${profileVersion}:${filterHash}:p${page}:l${limit}`;

    try {
      const cached = await redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Redis get failure should not break the request
    }

    // Build pushed metadata filter
    const matchFilter: any = { status: 'active' };

    if (filters.workplaceType && filters.workplaceType !== 'all') {
      matchFilter.workplaceType = filters.workplaceType;
    }
    if (filters.employmentType && filters.employmentType !== 'all') {
      matchFilter.employmentType = filters.employmentType;
    }
    if (filters.experienceLevel && filters.experienceLevel !== 'all') {
      matchFilter.experienceLevel = filters.experienceLevel;
    }
    if (filters.country) {
      matchFilter['location.country'] = { $regex: new RegExp(`^${filters.country}$`, 'i') };
    }

    let candidateJobs: JobWithMatchData[] = [];
    let vectorSearchSuccess = false;

    // Stage 1: Attempt Atlas Vector Search if candidate vector is ready
    if (candidateEmbedding && candidateEmbedding.length > 0) {
      try {
        const vectorMatchPipeline: any[] = [
          {
            $vectorSearch: {
              index: 'job_vector_index',
              path: 'embedding',
              queryVector: candidateEmbedding,
              numCandidates: 150,
              limit: 100,
            },
          },
          {
            $match: matchFilter,
          },
          {
            $project: {
              title: 1,
              company: 1,
              description: 1,
              responsibilities: 1,
              requirements: 1,
              preferredQualifications: 1,
              skills: 1,
              experienceLevel: 1,
              minimumExperience: 1,
              maximumExperience: 1,
              employmentType: 1,
              workplaceType: 1,
              location: 1,
              salary: 1,
              educationRequirements: 1,
              benefits: 1,
              applicationUrl: 1,
              publishedAt: 1,
              status: 1,
              vectorScore: { $meta: 'vectorSearchScore' },
            },
          },
        ];

        const vectorResults = await JobModel.aggregate(vectorMatchPipeline).exec();
        if (vectorResults && vectorResults.length > 0) {
          candidateJobs = vectorResults.map((job: any) => {
            const skillAnalysis = embeddingService.calculateSkillsMatch(job.skills, candidateSkills);
            const vectorScore = job.vectorScore || 0.7;
            const normalizedVectorScore = Math.round(vectorScore * 100);
            const hybridScore = Math.min(99, Math.round(normalizedVectorScore * 0.65 + skillAnalysis.score * 0.35));

            const matchReasons = this.generateMatchReasons(job, candidateProfile as any, skillAnalysis.matched);
            const { embedding, rawText, ...cleanJob } = job;

            return {
              ...cleanJob,
              matchScore: Math.max(45, hybridScore),
              matchedSkills: skillAnalysis.matched,
              missingSkills: skillAnalysis.missing,
              matchReasons,
              vectorScore,
            };
          });
          vectorSearchSuccess = true;
        }
      } catch (err: any) {
        vectorSearchSuccess = false;
      }
    }

    // Fallback: Projected MongoDB Query without embedding payload (avoids multi-MB WAN latency)
    if (!vectorSearchSuccess) {
      const activeJobs = await JobModel.find(matchFilter)
        .select('title company description responsibilities requirements preferredQualifications skills experienceLevel minimumExperience maximumExperience employmentType workplaceType location salary educationRequirements benefits applicationUrl publishedAt status eligibilityMinPercent expiresAt')
        .sort({ publishedAt: -1 })
        .limit(150)
        .lean()
        .exec();

      candidateJobs = (activeJobs as any[]).map((job) => {
        const skillAnalysis = embeddingService.calculateSkillsMatch(job.skills, candidateSkills);
        let matchScore = skillAnalysis.score;

        if (candidateSkills.length > 0) {
          matchScore = Math.min(
            98,
            Math.max(50, 45 + Math.round((skillAnalysis.matched.length / Math.max(1, job.skills?.length || 1)) * 50))
          );
        } else {
          matchScore = 65;
        }

        const matchReasons = this.generateMatchReasons(job, candidateProfile as any, skillAnalysis.matched);
        const { embedding, rawText, ...cleanJob } = job;

        return {
          ...cleanJob,
          matchScore: Math.min(99, Math.max(40, matchScore)),
          matchedSkills: skillAnalysis.matched,
          missingSkills: skillAnalysis.missing,
          matchReasons,
          vectorScore: 0,
        };
      });
    }

    // Stage 2: In-Memory Search & Dynamic Filtering
    let filteredJobs = candidateJobs;

    if (filters.search && filters.search.trim().length > 0) {
      const q = filters.search.trim().toLowerCase();
      filteredJobs = filteredJobs.filter(
        (j) =>
          j.title?.toLowerCase().includes(q) ||
          j.company?.name?.toLowerCase().includes(q) ||
          j.skills?.some((s) => s.toLowerCase().includes(q)) ||
          j.location?.city?.toLowerCase().includes(q) ||
          j.location?.country?.toLowerCase().includes(q)
      );
    }

    if (filters.minScore) {
      filteredJobs = filteredJobs.filter((j) => j.matchScore >= (filters.minScore || 0));
    }

    // Deterministic Sorting
    if (filters.sort === 'recent') {
      filteredJobs.sort(
        (a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()
      );
    } else if (filters.sort === 'salary') {
      filteredJobs.sort((a, b) => (b.salary?.max || 0) - (a.salary?.max || 0));
    } else {
      // Default: Recommended (highest matchScore, tie-break by publishedAt)
      filteredJobs.sort((a, b) => {
        if (b.matchScore !== a.matchScore) {
          return b.matchScore - a.matchScore;
        }
        return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
      });
    }

    const total = filteredJobs.length;
    const paginatedJobs = filteredJobs.slice(skip, skip + limit);

    const result = {
      jobs: paginatedJobs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      candidateProfile: {
        headline: candidateProfile?.headline || 'Professional Profile',
        skillsCount: candidateSkills.length,
        skills: candidateSkills,
        hasEmbedding: !!(candidateEmbedding && candidateEmbedding.length > 0),
        embeddingStatus: candidateProfile?.embeddingStatus || 'pending',
      },
    };

    // Cache in Redis for 5 minutes (300s)
    try {
      await redisService.setEx(cacheKey, 300, JSON.stringify(result));
    } catch {
      // Redis write failure should not affect response
    }

    return result;
  }

  /**
   * Retrieves all jobs with optional filters, search, and pagination.
   */
  public async getJobs(
    filters: JobQueryFilters = {},
    userId?: string
  ): Promise<{
    jobs: JobWithMatchData[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 20));
    const skip = (page - 1) * limit;

    const query: any = { status: 'active' };

    if (filters.search && filters.search.trim().length > 0) {
      const q = filters.search.trim();
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { 'company.name': { $regex: q, $options: 'i' } },
        { skills: { $in: [new RegExp(q, 'i')] } },
        { 'location.city': { $regex: q, $options: 'i' } },
      ];
    }

    if (filters.workplaceType && filters.workplaceType !== 'all') {
      query.workplaceType = filters.workplaceType;
    }

    if (filters.employmentType && filters.employmentType !== 'all') {
      query.employmentType = filters.employmentType;
    }

    if (filters.experienceLevel && filters.experienceLevel !== 'all') {
      query.experienceLevel = filters.experienceLevel;
    }

    if (filters.country) {
      query['location.country'] = { $regex: new RegExp(`^${filters.country}$`, 'i') };
    }

    const [jobs, total] = await Promise.all([
      JobModel.find(query)
        .select('title company description responsibilities requirements preferredQualifications skills experienceLevel minimumExperience maximumExperience employmentType workplaceType location salary educationRequirements benefits applicationUrl publishedAt status eligibilityMinPercent expiresAt')
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      JobModel.countDocuments(query),
    ]);

    let candidateSkills: string[] = [];
    let candidateProfile: any = null;

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      candidateProfile = await CandidateProfileModel.findOne({ userId }).lean();
      candidateSkills = candidateProfile?.skills || [];
    }

    const jobsWithScores: JobWithMatchData[] = (jobs as any[]).map((job) => {
      const skillAnalysis = embeddingService.calculateSkillsMatch(job.skills, candidateSkills);
      let matchScore = 60;
      if (candidateSkills.length > 0) {
        matchScore = Math.min(
          98,
          Math.max(45, 45 + Math.round((skillAnalysis.matched.length / Math.max(1, job.skills?.length || 1)) * 50))
        );
      }
      const matchReasons = this.generateMatchReasons(job, candidateProfile, skillAnalysis.matched);
      const { embedding, rawText, ...cleanJob } = job;

      return {
        ...cleanJob,
        matchScore,
        matchedSkills: skillAnalysis.matched,
        missingSkills: skillAnalysis.missing,
        matchReasons,
      };
    });

    return {
      jobs: jobsWithScores,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves single job details with personalized candidate matching analysis.
   */
  public async getJobById(jobId: string, userId?: string): Promise<JobWithMatchData | null> {
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return null;
    }

    const job = await JobModel.findById(jobId)
      .select('-rawText')
      .lean()
      .exec();
    if (!job) return null;

    let candidateSkills: string[] = [];
    let candidateProfile: any = null;

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      candidateProfile = await CandidateProfileModel.findOne({ userId }).lean();
      candidateSkills = candidateProfile?.skills || [];
    }

    const skillAnalysis = embeddingService.calculateSkillsMatch(job.skills, candidateSkills);
    let matchScore = 65;

    if (candidateProfile?.embedding && job.embedding && job.embedding.length > 0) {
      const vectorSim = embeddingService.cosineSimilarity(candidateProfile.embedding, job.embedding);
      matchScore = Math.round(Math.round(vectorSim * 100) * 0.7 + skillAnalysis.score * 0.3);
    } else if (candidateSkills.length > 0) {
      matchScore = Math.min(
        98,
        Math.max(50, 45 + Math.round((skillAnalysis.matched.length / Math.max(1, job.skills?.length || 1)) * 50))
      );
    }

    const matchReasons = this.generateMatchReasons(job, candidateProfile, skillAnalysis.matched);
    const { embedding, ...cleanJob } = job as any;

    return {
      ...cleanJob,
      matchScore,
      matchedSkills: skillAnalysis.matched,
      missingSkills: skillAnalysis.missing,
      matchReasons,
    };
  }

  private generateMatchReasons(
    job: any,
    candidateProfile: any,
    matchedSkills: string[]
  ): string[] {
    const reasons: string[] = [];

    if (matchedSkills && matchedSkills.length > 0) {
      const topSkills = matchedSkills.slice(0, 3).join(', ');
      reasons.push(`Direct skill alignment with ${topSkills}`);
    }

    if (candidateProfile?.yearsOfExperience !== undefined && job.minimumExperience !== undefined) {
      if (candidateProfile.yearsOfExperience >= job.minimumExperience) {
        reasons.push(`Meets experience requirement (${job.minimumExperience}+ years)`);
      }
    }

    if (job.workplaceType === 'remote') {
      reasons.push('Remote flexibility available');
    }

    if (reasons.length === 0) {
      reasons.push('Matches technical domain and role profile');
    }

    return reasons;
  }

  // --- Recruiter-facing job management ---

  async createRecruiterJob(userId: string, data: RecruiterJobInput): Promise<any> {
    const org = await new RecruiterOrgRepository().findByOwnerUserId(userId);
    const isDraft = !!data.saveAsDraft;
    // Selection is persisted regardless of draft/publish so a draft can be resumed later —
    // only the credit charge itself is gated on actually publishing.
    const sanitizedPipeline = sanitizePipelineSelection(data.pipelineOptions);
    const creditsCost = isDraft ? 0 : computePipelineCreditsCost(data.pipelineOptions);

    if (!isDraft && creditsCost > 0 && org) {
      const balance = await recruiterCreditsService.getBalanceForOrg(org._id.toString());
      if (balance < creditsCost) {
        throw AppError.badRequest('Insufficient credits. Please buy more credits.');
      }
    }

    let deadlineDate: Date | undefined;
    if (data.deadline) {
      deadlineDate = new Date(data.deadline);
      if (isNaN(deadlineDate.getTime())) {
        throw AppError.badRequest('Invalid deadline date.');
      }
    }

    const job = await JobModel.create({
      title: data.title?.trim() || 'Untitled role',
      company: { name: data.companyName?.trim() || org?.name || 'My Organization', website: org?.website },
      description: data.description?.trim() || 'No description provided yet.',
      skills: data.skills || [],
      experienceLevel: 'mid',
      minimumExperience: 0,
      employmentType: data.employmentType || 'full-time',
      workplaceType: data.workplaceType || 'remote',
      location: { country: data.location?.trim() || 'Remote', remote: true },
      salary: { min: 0, max: 0, currency: 'INR', period: 'yearly' },
      salaryText: data.salaryText?.trim() || 'Competitive',
      applicationUrl: '',
      source: 'recruiter',
      status: isDraft ? 'draft' : 'active',
      postedBy: userId,
      orgId: org?._id,
      pipelineOptions: sanitizedPipeline,
      recruiterStage: isDraft ? undefined : 'open',
      creditsCost: creditsCost || undefined,
      eligibilityMinPercent: data.eligibilityMinPercent,
      expiresAt: deadlineDate,
    });

    if (!isDraft && creditsCost > 0 && org) {
      await recruiterCreditsService.chargeForJobPublish(org._id.toString(), job._id.toString(), creditsCost);
    }

    return job;
  }

  async getJobsForRecruiter(userId: string): Promise<any[]> {
    const jobs = await JobModel.find({ postedBy: userId }).sort({ createdAt: -1 }).lean();
    if (jobs.length === 0) return [];

    // Single aggregation for all jobs' applicant counts — avoids an N+1 query per card.
    const jobIds = jobs.map((j) => j._id);
    const counts = await ApplicationModel.aggregate([
      { $match: { jobId: { $in: jobIds } } },
      { $group: { _id: '$jobId', count: { $sum: 1 } } },
    ]);
    const countByJobId = new Map(counts.map((c: any) => [String(c._id), c.count]));

    return jobs.map((job) => ({ ...job, applicantCount: countByJobId.get(String(job._id)) || 0 }));
  }

  async getRecruiterJobById(userId: string, jobId: string): Promise<any> {
    const job = await JobModel.findOne({ _id: jobId, postedBy: userId }).lean();
    if (!job) {
      throw AppError.notFound('Job not found or access denied');
    }
    return job;
  }

  async deleteRecruiterJob(userId: string, jobId: string): Promise<void> {
    const result = await JobModel.deleteOne({ _id: jobId, postedBy: userId });
    if (result.deletedCount === 0) {
      throw AppError.notFound('Job not found or access denied');
    }
  }

  async updateJobStage(userId: string, jobId: string, stage: string): Promise<any> {
    const job = await JobModel.findOne({ _id: jobId, postedBy: userId });
    if (!job) {
      throw AppError.notFound('Job not found or access denied');
    }
    job.recruiterStage = stage as any;
    if (stage === 'completed' && !job.completedAt) {
      job.completedAt = new Date();
    }
    await job.save();
    return job;
  }
}

export interface RecruiterJobInput {
  title: string;
  companyName?: string;
  location?: string;
  employmentType?: EmploymentType;
  workplaceType?: WorkplaceType;
  salaryText?: string;
  skills?: string[];
  description?: string;
  eligibilityMinPercent?: number;
  deadline?: string;
  saveAsDraft?: boolean;
  pipelineOptions?: {
    matchVolume?: string | null;
    resumeMatch?: boolean;
    resumeMatchTypes?: string[];
    assessment?: boolean;
    assessmentTypes?: string[];
    aiInterview?: boolean;
    aiInterviewTypes?: string[];
  };
}

export const jobService = new JobService();
