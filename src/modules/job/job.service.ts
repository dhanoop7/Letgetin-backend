import mongoose from 'mongoose';
import crypto from 'crypto';
import { JobModel, WorkplaceType, EmploymentType, ExperienceLevel, IJobRequirements, IJobSkillRequirement, formatEducationRequirements, IJobAssessmentConfig } from './job.model.js';
import { normalizeJobRequirements } from './jobRequirements.utils.js';
import { normalizeAssessmentConfiguration, DEFAULT_ASSESSMENT_NAMES } from './assessmentConfig.utils.js';
import { CandidateProfileModel, ICandidateProfileDocument } from './candidateProfile.model.js';
import { RecruiterOrgRepository } from '../recruiterOrg/recruiterOrg.repository.js';
import { ResumeModel } from '../resume/resume.model.js';
import { UserModel } from '../user/user.model.js';
import { UserProfileModel } from '../profile/profile.model.js';
import { CandidateDataResolver } from '../profile/candidateDataResolver.js';
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

    const resolved = CandidateDataResolver.resolve({
      userId,
      user,
      userProfile,
      resume: latestResume,
    });

    const embeddingPayload = CandidateDataResolver.toEmbeddingPayload(resolved);
    const rawText = embeddingService.buildCandidateEmbeddingText(embeddingPayload, user || undefined);
    const education = CandidateDataResolver.getPrimaryEducationString(resolved);

    let profile = await CandidateProfileModel.findOne({ userId: userObjectId });

    const textChanged = !profile || profile.rawText !== rawText;
    const needsEmbedding = !profile || !profile.embedding || profile.embedding.length === 0 || profile.embeddingStatus !== 'completed';

    const currentVersion = userProfile?.version || 1;

    if (!profile) {
      profile = await CandidateProfileModel.create({
        userId: userObjectId,
        resumeId: latestResume?._id,
        headline: resolved.headline,
        summary: resolved.summary,
        skills: resolved.skills,
        yearsOfExperience: resolved.totalExperienceYears,
        location: resolved.location,
        education,
        rawText,
        profileVersion: currentVersion,
        embeddingStatus: 'pending',
        lastSyncedAt: new Date(),
      });
      await enqueueCandidateEmbedding(userId, latestResume?._id?.toString());
    } else if (textChanged || needsEmbedding) {
      profile.resumeId = latestResume?._id as any;
      profile.headline = resolved.headline;
      profile.summary = resolved.summary;
      profile.skills = resolved.skills;
      profile.yearsOfExperience = resolved.totalExperienceYears;
      profile.location = resolved.location;
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

    // Normalize assessment configuration
    const normalizedAssessment = data.assessment
      ? normalizeAssessmentConfiguration(data.assessment)
      : (data.pipelineOptions?.assessment && Array.isArray(data.pipelineOptions.assessmentTypes) && data.pipelineOptions.assessmentTypes.length > 0)
      ? normalizeAssessmentConfiguration({
          enabled: true,
          rounds: data.pipelineOptions.assessmentTypes.map((t, idx) => ({
            id: `round_${t}`,
            type: t as any,
            order: idx + 1,
            name: DEFAULT_ASSESSMENT_NAMES[t as keyof typeof DEFAULT_ASSESSMENT_NAMES] || `${t} Assessment`,
            enabled: true,
          })),
        })
      : undefined;

    // Selection is persisted regardless of draft/publish so a draft can be resumed later —
    // only the credit charge itself is gated on actually publishing.
    const pipelineSelection = { ...data.pipelineOptions };
    if (normalizedAssessment && normalizedAssessment.enabled && normalizedAssessment.rounds.length > 0) {
      pipelineSelection.assessment = true;
      pipelineSelection.assessmentTypes = normalizedAssessment.rounds.map((r) => r.type);
    }

    const sanitizedPipeline = sanitizePipelineSelection(pipelineSelection);
    const creditsCost = isDraft ? 0 : computePipelineCreditsCost(pipelineSelection);

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
    } else if (data.collectionDurationDays && data.collectionDurationDays > 0) {
      deadlineDate = new Date(Date.now() + data.collectionDurationDays * 24 * 3600 * 1000);
    } else if (sanitizedPipeline?.resumeMatch || sanitizedPipeline?.assessment || sanitizedPipeline?.aiInterview) {
      // Default collection window for Hiring Engine jobs: 7 days
      deadlineDate = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    }

    const structuredRequirements = normalizeJobRequirements({
      requiredSkills: data.structuredRequirements?.requiredSkills,
      preferredSkills: data.structuredRequirements?.preferredSkills,
      minimumExperienceYears: data.structuredRequirements?.minimumExperienceYears,
      maximumExperienceYears: data.structuredRequirements?.maximumExperienceYears,
      education: data.structuredRequirements?.education,
      skills: data.skills,
      minimumExperience: data.minimumExperience,
      maximumExperience: data.maximumExperience,
    });

    const combinedSkills = Array.from(
      new Set([
        ...structuredRequirements.requiredSkills.map((s: any) => (typeof s === 'string' ? s : s.name)),
        ...structuredRequirements.preferredSkills.map((s: any) => (typeof s === 'string' ? s : s.name)),
      ])
    );
    const educationRequirementsText = formatEducationRequirements(structuredRequirements.education);

    let locationDoc = { city: '', state: '', country: 'India', remote: data.workplaceType === 'remote' };
    if (data.location && typeof data.location === 'string') {
      const parts = data.location.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length === 1) {
        locationDoc.city = parts[0];
      } else if (parts.length >= 2) {
        locationDoc.city = parts[0];
        locationDoc.country = parts[parts.length - 1];
        if (parts.length > 2) locationDoc.state = parts[1];
      }
    }

    const fallbackSkills = Array.isArray(data.skills)
      ? data.skills.map((s: any) => (typeof s === 'string' ? s : s.name)).filter(Boolean)
      : [];

    const job = await JobModel.create({
      title: data.title?.trim() || 'Untitled role',
      company: { name: data.companyName?.trim() || org?.name || 'My Organization', website: org?.website },
      description: data.description?.trim() || 'No description provided yet.',
      responsibilities: Array.isArray(data.responsibilities) ? data.responsibilities : [],
      requirements: Array.isArray(data.requirements) ? data.requirements : [],
      preferredQualifications: Array.isArray(data.preferredQualifications) ? data.preferredQualifications : [],
      skills: combinedSkills.length > 0 ? combinedSkills : fallbackSkills,
      experienceLevel: 'mid',
      minimumExperience: structuredRequirements.minimumExperienceYears !== undefined ? structuredRequirements.minimumExperienceYears : 0,
      maximumExperience: structuredRequirements.maximumExperienceYears,
      educationRequirements: educationRequirementsText,
      structuredRequirements,
      employmentType: data.employmentType || 'full-time',
      workplaceType: data.workplaceType || 'remote',
      location: locationDoc,
      salaryText: data.salaryText?.trim() || undefined,
      eligibilityMinPercent: data.eligibilityMinPercent,
      finalShortlistTarget: data.finalShortlistTarget,
      pipelineOptions: sanitizedPipeline,
      assessment: normalizedAssessment,
      recruiterStage: 'open',
      creditsCost,
      status: isDraft ? 'draft' : 'active',
      expiresAt: deadlineDate,
      source: 'recruiter_direct',
      postedBy: new mongoose.Types.ObjectId(userId),
      orgId: org?._id,
      publishedAt: new Date(),
    });

    if (!isDraft && creditsCost > 0 && org) {
      await recruiterCreditsService.chargeForJobPublish(org._id.toString(), job._id.toString(), creditsCost);
    }

    // Auto-enqueue job embedding so candidate-matching recommendations stay fresh
    enqueueJobEmbedding(job._id.toString()).catch(() => {});

    // Phase 4: Dynamic Candidate Collection & Adaptive Hiring Funnel Setup
    const hasPipelineActive = !isDraft && Boolean(
      sanitizedPipeline?.resumeMatch ||
      sanitizedPipeline?.assessment ||
      sanitizedPipeline?.aiInterview ||
      sanitizedPipeline?.humanInterview ||
      (normalizedAssessment?.enabled && normalizedAssessment.rounds.length > 0) ||
      (Array.isArray(data.rounds) && data.rounds.length > 0) ||
      (Array.isArray(data.stages) && data.stages.length > 0)
    );

    if (hasPipelineActive) {
      try {
        const { HiringFunnelCalculator } = await import('../hiringEngine/services/hiringFunnelCalculator.js');
        const { HiringFunnelConfigModel } = await import('../hiringEngine/hiringFunnelConfig.model.js');
        const { scheduleApplicationCollectionDeadlineCheck } = await import('../hiringEngine/queues/hiringEngine.queue.js');
        const { ApplicationCollectionService } = await import('../hiringEngine/services/applicationCollection.service.js');

        type FunnelStageItem = {
          stageId: string;
          stageName: string;
          stageType: 'resume_match' | 'assessment' | 'ai_interview' | 'manual_review' | 'human_interview';
          assessmentType?: 'general' | 'coding';
          order: number;
          expectedAttendanceRate: number;
          expectedPassRate: number;
          deadlineHours: number;
          autoAdvanceScoreThreshold?: number;
          autoRefillEnabled?: boolean;
        };

        const stages: FunnelStageItem[] = [];

        const buildStageFromKey = (key: string, order: number): FunnelStageItem | null => {
          const k = String(key).toLowerCase().trim().replace(/[-\s]/g, '_');
          if (k === 'general' || k === 'stage_assessment_general') {
            return {
              stageId: 'stage_assessment_general',
              stageName: 'General Assessment',
              stageType: 'assessment',
              assessmentType: 'general',
              order,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.6,
              deadlineHours: 48,
              autoAdvanceScoreThreshold: 75,
              autoRefillEnabled: true,
            };
          }
          if (k === 'coding' || k === 'stage_assessment_coding') {
            return {
              stageId: 'stage_assessment_coding',
              stageName: 'Coding Assessment',
              stageType: 'assessment',
              assessmentType: 'coding',
              order,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.6,
              deadlineHours: 48,
              autoAdvanceScoreThreshold: 75,
              autoRefillEnabled: true,
            };
          }
          // Legacy assessment type keys mapped to General Assessment
          if (
            k === 'mcq' ||
            k === 'stage_assessment_mcq' ||
            k === 'short_answer' ||
            k === 'stage_assessment_short_answer' ||
            k === 'scenario' ||
            k === 'stage_assessment_scenario'
          ) {
            return {
              stageId: 'stage_assessment_general',
              stageName: 'General Assessment',
              stageType: 'assessment',
              assessmentType: 'general',
              order,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.6,
              deadlineHours: 48,
              autoAdvanceScoreThreshold: 75,
              autoRefillEnabled: true,
            };
          }
          if (k.includes('assess') || k === 'technical_assessment') {
            return {
              stageId: 'stage_assessment',
              stageName: 'Technical Assessment',
              stageType: 'assessment',
              order,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.6,
              deadlineHours: 48,
              autoAdvanceScoreThreshold: 75,
              autoRefillEnabled: true,
            };
          }
          if (k.includes('ai_interview') || k === 'aiinterview' || k === 'video_interview') {
            return {
              stageId: 'stage_ai_interview',
              stageName: 'AI Comprehensive Interview',
              stageType: 'ai_interview',
              order,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.5,
              deadlineHours: 48,
              autoAdvanceScoreThreshold: 80,
              autoRefillEnabled: true,
            };
          }
          if (k.includes('human') || k.includes('manual') || k === 'live_interview' || k === 'hiring_manager') {
            return {
              stageId: 'stage_human_interview',
              stageName: 'Human Interview',
              stageType: 'human_interview',
              order,
              expectedAttendanceRate: 0.9,
              expectedPassRate: 0.5,
              deadlineHours: 72,
              autoAdvanceScoreThreshold: 70,
              autoRefillEnabled: true,
            };
          }
          if (k.includes('resume') || k.includes('screen') || k.includes('ats')) {
            return {
              stageId: 'stage_resume_screen',
              stageName: 'Resume Screening',
              stageType: 'resume_match',
              order,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.6,
              deadlineHours: 24,
              autoAdvanceScoreThreshold: 70,
              autoRefillEnabled: true,
            };
          }
          return {
            stageId: `stage_${k}`,
            stageName: key,
            stageType: 'manual_review',
            order,
            expectedAttendanceRate: 1.0,
            expectedPassRate: 0.6,
            deadlineHours: 48,
            autoAdvanceScoreThreshold: 70,
            autoRefillEnabled: true,
          };
        };

        const buildAssessmentStages = (): FunnelStageItem[] => {
          if (!normalizedAssessment?.enabled || normalizedAssessment.rounds.length === 0) {
            return [{
              stageId: 'stage_assessment',
              stageName: 'Technical Assessment',
              stageType: 'assessment',
              order: currentOrder++,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.6,
              deadlineHours: 48,
              autoAdvanceScoreThreshold: 75,
              autoRefillEnabled: true,
            }];
          }
          return normalizedAssessment.rounds.map((round) => ({
            stageId: `stage_assessment_${round.type}`,
            stageName: round.name || DEFAULT_ASSESSMENT_NAMES[round.type] || 'Assessment',
            stageType: 'assessment' as const,
            assessmentType: round.type,
            order: currentOrder++,
            expectedAttendanceRate: 1.0,
            expectedPassRate: 0.6,
            deadlineHours: 48,
            autoAdvanceScoreThreshold: 75,
            autoRefillEnabled: true,
          }));
        };

        let currentOrder = 1;
        if (Array.isArray(data.stages) && data.stages.length > 0) {
          for (const st of data.stages) {
            stages.push({
              ...st,
              order: currentOrder++,
            });
          }
        } else if (Array.isArray(data.rounds) && data.rounds.length > 0) {
          for (const round of data.rounds) {
            const item = buildStageFromKey(round, currentOrder++);
            if (item) stages.push(item);
          }
        } else if (Array.isArray(sanitizedPipeline?.roundOrder) && sanitizedPipeline.roundOrder.length > 0) {
          for (const round of sanitizedPipeline.roundOrder) {
            const k = String(round).toLowerCase().trim().replace(/[-\s]/g, '_');
            if (k.includes('assess') && normalizedAssessment?.enabled && normalizedAssessment.rounds.length > 0) {
              for (const ast of buildAssessmentStages()) {
                stages.push(ast);
              }
            } else {
              const item = buildStageFromKey(round, currentOrder++);
              if (item) stages.push(item);
            }
          }
        } else {
          if (sanitizedPipeline?.resumeMatch && !sanitizedPipeline?.assessment && !sanitizedPipeline?.aiInterview && !sanitizedPipeline?.humanInterview) {
            stages.push(buildStageFromKey('resume_match', currentOrder++)!);
          }
          if (sanitizedPipeline?.assessment) {
            if (normalizedAssessment?.enabled && normalizedAssessment.rounds.length > 0) {
              for (const ast of buildAssessmentStages()) {
                stages.push(ast);
              }
            } else {
              stages.push(buildStageFromKey('assessment', currentOrder++)!);
            }
          }
          if (sanitizedPipeline?.aiInterview) {
            stages.push(buildStageFromKey('ai_interview', currentOrder++)!);
          }
          if (sanitizedPipeline?.humanInterview) {
            stages.push(buildStageFromKey('human_interview', currentOrder++)!);
          }
        }

        job.rounds = stages.map((s) => s.stageId);

        const targetCount =
          typeof data.finalShortlistTarget === 'number' && data.finalShortlistTarget > 0
            ? data.finalShortlistTarget
            : 5;

        // 1. Calculate ideal planned funnel
        const idealCalculation = HiringFunnelCalculator.calculateFunnel(targetCount, stages);
        const idealIntake =
          typeof data.idealIntake === 'number' && data.idealIntake >= targetCount
            ? data.idealIntake
            : idealCalculation.totalFunnelIntakeTarget;

        const minimumIntake =
          typeof data.minimumIntake === 'number' && data.minimumIntake > 0
            ? data.minimumIntake
            : Math.max(1, Math.ceil(idealIntake * 0.6));

        // 2. Configure candidate collection state on JobModel
        job.applicationCollection = {
          idealIntake,
          minimumIntake,
          actualQualifiedCount: 0,
          initialDeadline: deadlineDate,
          currentDeadline: deadlineDate,
          autoExtensionEnabled: data.autoExtensionEnabled !== false,
          extensionDurationDays: data.extensionDurationDays || 3,
          maxExtensions: typeof data.maxExtensions === 'number' ? data.maxExtensions : 2,
          extensionsUsed: 0,
          autoStartEnabled: !!data.autoStartEnabled,
          status: 'collecting',
        };

        // 3. Upsert HiringFunnelConfigModel with planned/ideal stages and draft status
        let config = await HiringFunnelConfigModel.findOne({ jobId: job._id });
        if (!config) {
          config = new HiringFunnelConfigModel({
            jobId: job._id,
            orgId: job.orgId,
            finalShortlistTarget: targetCount,
            stages: idealCalculation.stages,
            idealStages: idealCalculation.stages,
            idealFunnelIntakeTarget: idealIntake,
            totalFunnelIntakeTarget: idealIntake,
            currentShortlistedCount: 0,
            status: 'draft',
            funnelHealth: 'healthy',
            lastCalculatedAt: new Date(),
          });
        } else {
          config.finalShortlistTarget = targetCount;
          config.stages = idealCalculation.stages;
          config.idealStages = idealCalculation.stages;
          config.idealFunnelIntakeTarget = idealIntake;
          config.totalFunnelIntakeTarget = idealIntake;
          config.status = 'draft';
          config.funnelHealth = 'healthy';
          config.lastCalculatedAt = new Date();
        }
        await config.save();

        job.hiringEngineEnabled = true;
        job.hiringEngineConfigId = config._id as any;
        await job.save();

        // 4. Schedule BullMQ candidate collection deadline check
        if (deadlineDate) {
          await scheduleApplicationCollectionDeadlineCheck(String(job._id), deadlineDate);
        }

        // 5. Evaluate collection readiness if candidates already applied
        await ApplicationCollectionService.evaluateCollectionReadiness(job._id);
      } catch (pipelineErr: any) {
        console.warn('[JobService] Candidate collection initialization failed:', pipelineErr?.message || pipelineErr);
      }
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
  skills?: (IJobSkillRequirement | string)[];
  description?: string;
  responsibilities?: string[];
  requirements?: string[];
  preferredQualifications?: string[];
  minimumExperience?: number;
  maximumExperience?: number;
  structuredRequirements?: {
    requiredSkills?: (IJobSkillRequirement | string)[];
    preferredSkills?: (IJobSkillRequirement | string)[];
    minimumExperienceYears?: number;
    maximumExperienceYears?: number;
    education?: {
      minimumLevel?: any;
      fields?: string[];
    };
  };
  eligibilityMinPercent?: number;
  deadline?: string;
  saveAsDraft?: boolean;
  finalShortlistTarget?: number;
  idealIntake?: number;
  minimumIntake?: number;
  collectionDurationDays?: number;
  autoExtensionEnabled?: boolean;
  extensionDurationDays?: number;
  maxExtensions?: number;
  autoStartEnabled?: boolean;
  rounds?: string[];
  stages?: any[];
  assessment?: IJobAssessmentConfig;
  pipelineOptions?: {
    matchVolume?: string | null;
    resumeMatch?: boolean;
    resumeMatchTypes?: string[];
    assessment?: boolean;
    assessmentTypes?: string[];
    aiInterview?: boolean;
    aiInterviewTypes?: string[];
    humanInterview?: boolean;
    humanInterviewTypes?: string[];
    roundOrder?: string[];
  };
}

export const jobService = new JobService();
