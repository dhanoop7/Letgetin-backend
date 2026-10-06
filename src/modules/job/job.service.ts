import mongoose from 'mongoose';
import crypto from 'crypto';
import { JobModel, WorkplaceType, EmploymentType, ExperienceLevel, IJobAssessmentConfig, AssessmentRoundType, ILinguisticTestConfig, IPsychometricGeniusTestConfig } from './job.model.js';
import { normalizeAssessmentConfiguration, DEFAULT_ASSESSMENT_NAMES } from './assessmentConfig.utils.js';
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
    const pipelineSelection = {
      ...data.pipelineOptions,
      listAsJob: data.listAsJob ?? data.pipelineOptions?.listAsJob,
      featuredJob: data.featuredJob ?? data.pipelineOptions?.featuredJob,
      listInLandingPage: data.listInLandingPage ?? data.pipelineOptions?.listInLandingPage,
      listInRecentlyPosted: data.listInRecentlyPosted ?? data.pipelineOptions?.listInRecentlyPosted,
    };
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

    const job = await JobModel.create({
      title: data.title?.trim() || 'Untitled role',
      company: { name: data.companyName?.trim() || org?.name || 'My Organization', website: org?.website },
      description: data.description?.trim() || 'No description provided yet.',
      skills: data.skills || [],
      experienceLevel: 'mid',
      minimumExperience: 0,
      maximumExperience: 5,
      employmentType: data.employmentType || 'full-time',
      workplaceType: data.workplaceType || 'remote',
      location: { country: 'India', remote: data.workplaceType === 'remote' },
      salaryText: data.salaryText?.trim() || undefined,
      eligibilityMinPercent: data.eligibilityMinPercent,
      finalShortlistTarget: data.finalShortlistTarget,
      pipelineOptions: sanitizedPipeline,
      listAsJob: sanitizedPipeline.listAsJob,
      featuredJob: sanitizedPipeline.featuredJob,
      listInLandingPage: sanitizedPipeline.listInLandingPage,
      listInRecentlyPosted: sanitizedPipeline.listInRecentlyPosted,
      linguisticTest: data.linguisticTest,
      psychometricGeniusTest: data.psychometricGeniusTest,
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
          stageType: 'resume_match' | 'assessment' | 'ai_interview' | 'manual_review' | 'human_interview' | 'custom';
          assessmentType?: AssessmentRoundType | string;
          order: number;
          expectedAttendanceRate: number;
          expectedPassRate: number;
          deadlineHours: number;
          autoAdvanceScoreThreshold?: number;
          autoRefillEnabled?: boolean;
          schedule?: {
            date?: string;
            startTime?: string;
            endTime?: string;
            durationHours?: number | string;
            durationFormatted?: string;
          };
          durationMinutes?: number;
          passingScore?: number;
          questionCount?: number;
          interviewMode?: string;
          modalities?: string[];
          config?: Record<string, unknown>;
        };

        const stages: FunnelStageItem[] = [];
        let currentOrder = 1;

        if (Array.isArray(data.stages) && data.stages.length > 0) {
          for (const st of data.stages) {
            stages.push({
              ...st,
              order: currentOrder++,
            });
          }
        } else {
          // 1. Resume Shortlisting & Verification Stage (Qualification boundary)
          if (sanitizedPipeline?.resumeMatch || job.checkResumeVerification || data.checkResumeVerification) {
            stages.push({
              stageId: 'stage_resume_match',
              stageName: (job.checkResumeVerification || data.checkResumeVerification)
                ? 'Resume Shortlisting & Verification'
                : 'Resume Shortlisting',
              stageType: 'resume_match',
              assessmentType: 'general',
              order: currentOrder++,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.6,
              deadlineHours: 24,
              autoAdvanceScoreThreshold: 70,
              autoRefillEnabled: true,
            });
          }

          // 2. Pre-assessment: Linguistic Test (if enabled)
          const lingConfig = job.linguisticTest || data.linguisticTest;
          if (lingConfig?.enabled) {
            stages.push({
              stageId: 'stage_linguistic_test',
              stageName: 'Linguistic Test (Optional)',
              stageType: 'assessment',
              assessmentType: 'linguistic',
              order: currentOrder++,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.7,
              deadlineHours: 48,
              autoAdvanceScoreThreshold: 60,
              autoRefillEnabled: true,
              config: lingConfig as any,
            });
          }

          // 3. Pre-assessment: Psychometric & Genius Test (only if explicitly selected/enabled by recruiter)
          const psychConfig = job.psychometricGeniusTest || data.psychometricGeniusTest;
          const isPsychometricEnabled = psychConfig?.psychometricEnabled === true;
          const isGeniusEnabled = psychConfig?.geniusEnabled === true;

          if (isPsychometricEnabled && (psychConfig?.psychometricDuration || psychConfig?.psychometricSchedule?.date)) {
            stages.push({
              stageId: 'stage_psychometric_test',
              stageName: 'Psychometric Test',
              stageType: 'assessment',
              assessmentType: 'psychometric',
              order: currentOrder++,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.6,
              deadlineHours: 48,
              autoAdvanceScoreThreshold: 65,
              autoRefillEnabled: true,
              durationMinutes: psychConfig.psychometricDuration || 45,
              schedule: psychConfig.psychometricSchedule,
            });
          }
          if (isGeniusEnabled && (psychConfig?.geniusDuration || psychConfig?.geniusSchedule?.date)) {
            stages.push({
              stageId: 'stage_genius_test',
              stageName: 'Genius Test',
              stageType: 'assessment',
              assessmentType: 'genius',
              order: currentOrder++,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.5,
              deadlineHours: 48,
              autoAdvanceScoreThreshold: 70,
              autoRefillEnabled: true,
              durationMinutes: psychConfig.geniusDuration || 45,
              schedule: psychConfig.geniusSchedule,
            });
          }

          // 4. Candidate Assessment Rounds (Online Test, Assessment, Interview, Domain Specific Test, Custom Rounds)
          if (normalizedAssessment?.enabled && normalizedAssessment.rounds.length > 0) {
            for (const round of normalizedAssessment.rounds) {
              let stageType: 'resume_match' | 'assessment' | 'ai_interview' | 'manual_review' | 'human_interview' | 'custom' = 'assessment';
              if (
                round.type === 'ai_assessment' ||
                round.type === 'ai_chat' ||
                round.type === 'ai_voice' ||
                round.type === 'rapid_question' ||
                round.type === 'screening_interview' ||
                round.type === 'technical_interview'
              ) {
                stageType = 'ai_interview';
              } else if (round.type === 'video_interview' || round.type === 'custom_interview') {
                stageType = 'human_interview';
              } else if (round.type === 'custom_test' || round.type === 'custom_domain') {
                stageType = 'assessment';
              }

              const passScore = typeof (round.config as any)?.passingScore === 'number'
                ? (round.config as any).passingScore
                : 70;

              const durationMins = typeof (round.config as any)?.durationMinutes === 'number'
                ? (round.config as any).durationMinutes
                : undefined;

              const roundTiming = (round.config as any)?.schedule || (round.date ? {
                date: round.date,
                startTime: round.startTime,
                endTime: round.endTime,
                durationHours: round.durationHours,
              } : undefined);

              stages.push({
                stageId: round.id || `stage_${round.type}_${currentOrder}`,
                stageName: round.name || DEFAULT_ASSESSMENT_NAMES[round.type] || 'Assessment Stage',
                stageType,
                assessmentType: round.type,
                order: currentOrder++,
                expectedAttendanceRate: stageType === 'human_interview' ? 0.9 : 1.0,
                expectedPassRate: 0.6,
                deadlineHours: 48,
                autoAdvanceScoreThreshold: passScore,
                autoRefillEnabled: true,
                schedule: roundTiming,
                durationMinutes: durationMins,
                passingScore: passScore,
                questionCount: typeof (round.config as any)?.questionCount === 'number' ? (round.config as any).questionCount : undefined,
                interviewMode: typeof (round.config as any)?.interviewMode === 'string' ? (round.config as any).interviewMode : undefined,
                modalities: Array.isArray((round.config as any)?.modalities) ? (round.config as any).modalities : undefined,
                config: round.config,
              });
            }
          } else {
            // Fallback for generic assessment/interview options if no specific assessment rounds were built
            if (sanitizedPipeline?.assessment) {
              stages.push({
                stageId: 'stage_assessment',
                stageName: 'Technical Assessment',
                stageType: 'assessment',
                assessmentType: 'general',
                order: currentOrder++,
                expectedAttendanceRate: 1.0,
                expectedPassRate: 0.6,
                deadlineHours: 48,
                autoAdvanceScoreThreshold: 75,
                autoRefillEnabled: true,
              });
            }
            if (sanitizedPipeline?.aiInterview) {
              stages.push({
                stageId: 'stage_ai_interview',
                stageName: 'AI Comprehensive Interview',
                stageType: 'ai_interview',
                order: currentOrder++,
                expectedAttendanceRate: 1.0,
                expectedPassRate: 0.5,
                deadlineHours: 48,
                autoAdvanceScoreThreshold: 80,
                autoRefillEnabled: true,
              });
            }
            if (sanitizedPipeline?.humanInterview) {
              stages.push({
                stageId: 'stage_human_interview',
                stageName: 'Human Interview',
                stageType: 'human_interview',
                order: currentOrder++,
                expectedAttendanceRate: 0.9,
                expectedPassRate: 0.5,
                deadlineHours: 72,
                autoAdvanceScoreThreshold: 70,
                autoRefillEnabled: true,
              });
            }
          }

          // Fallback if no stage was created at all
          if (stages.length === 0) {
            stages.push({
              stageId: 'stage_resume_match',
              stageName: 'Resume Screening',
              stageType: 'resume_match',
              order: currentOrder++,
              expectedAttendanceRate: 1.0,
              expectedPassRate: 0.6,
              deadlineHours: 24,
              autoAdvanceScoreThreshold: 70,
              autoRefillEnabled: true,
            });
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
  skills?: string[];
  description?: string;
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
    listAsJob?: boolean;
    featuredJob?: boolean;
    listInLandingPage?: boolean;
    listInRecentlyPosted?: boolean;
    checkResumeVerification?: boolean;
    linguisticTest?: ILinguisticTestConfig;
    psychometricGeniusTest?: IPsychometricGeniusTestConfig;
  };
  checkResumeVerification?: boolean;
  listAsJob?: boolean;
  featuredJob?: boolean;
  listInLandingPage?: boolean;
  listInRecentlyPosted?: boolean;
  linguisticTest?: ILinguisticTestConfig;
  psychometricGeniusTest?: IPsychometricGeniusTestConfig;
}

export const jobService = new JobService();
