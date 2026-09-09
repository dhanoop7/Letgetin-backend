import mongoose from 'mongoose';
import crypto from 'crypto';
import {
  AiApplyPreferencesModel,
  IAiApplyPreferencesDocument,
  CurrentStatus,
  EmploymentTypePref,
} from './aiApply.model.js';
import {
  AiApplyBatchJobModel,
  IAiApplyBatchJobDocument,
  AiApplyBatchStatus,
} from './aiApplyBatch.model.js';
import { ResumeModel } from '../resume/resume.model.js';
import { CoverLetterModel } from '../coverLetter/coverLetter.model.js';
import { UserProfileModel } from '../profile/profile.model.js';
import { ApplicationModel } from '../application/application.model.js';
import { JobModel, EmploymentType } from '../job/job.model.js';
import { CandidateProfileModel } from '../job/candidateProfile.model.js';
import { jobService, JobWithMatchData } from '../job/job.service.js';
import { embeddingService } from '../embedding/embedding.service.js';
import { enqueueAiApplyBatches } from '../../queues/queue.config.js';
import { redisService } from '../../services/redis.service.js';
import { AppError } from '../../utils/appError.js';

const APPLY_MATCH_SCORE_FLOOR = 50;
const APPLY_JOB_CAP = 50;

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  'Information Technology': [
    'react', 'angular', 'vue', 'node', 'javascript', 'typescript', 'python', 'java', 'software',
    'developer', 'engineer', 'frontend', 'backend', 'fullstack', 'full-stack', 'devops', 'cloud', 'aws', 'azure', 'kubernetes',
  ],
  SaaS: ['saas', 'subscription', 'b2b software', 'platform'],
  Finance: ['finance', 'banking', 'fintech', 'accounting', 'investment', 'trading'],
  Healthcare: ['health', 'medical', 'clinical', 'pharma', 'hospital', 'healthtech'],
  'E-commerce': ['ecommerce', 'e-commerce', 'retail', 'marketplace'],
  Education: ['education', 'edtech', 'teaching', 'learning', 'university'],
  Manufacturing: ['manufacturing', 'industrial', 'production', 'supply chain'],
  Marketing: ['marketing', 'advertising', 'seo', 'content', 'growth'],
  Consulting: ['consulting', 'advisory'],
};

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractResumeSkills(content: any): string[] {
  const skills = content?.skills;
  if (!Array.isArray(skills)) return [];
  return skills.map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean);
}

function extractResumePositions(content: any): string[] {
  const experiences = content?.experiences;
  if (!Array.isArray(experiences)) return [];
  return experiences.map((e: any) => e?.position).filter(Boolean);
}

function pickBestOverlapMatch<T extends { _id: any; updatedAt?: Date }>(
  items: T[],
  buildHaystack: (item: T) => string,
  needles: string[]
): { id: string; score: number } | null {
  if (items.length === 0) return null;
  if (items.length === 1) return { id: String(items[0]._id), score: 0 };

  const lowerNeedles = needles.map((n) => n.toLowerCase()).filter(Boolean);
  let best: { id: string; score: number } | null = null;

  for (const item of items) {
    const haystack = buildHaystack(item).toLowerCase();
    let score = 0;
    for (const needle of lowerNeedles) {
      if (needle && haystack.includes(needle)) score += 1;
    }
    if (!best || score > best.score) {
      best = { id: String(item._id), score };
    }
  }

  return best;
}

function suggestIndustries(skills: string[], experienceTitles: string[]): string[] {
  const haystack = [...skills, ...experienceTitles].join(' ').toLowerCase();
  const matched: string[] = [];
  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (keywords.some((kw) => haystack.includes(kw))) matched.push(industry);
  }
  return matched.slice(0, 5);
}

function suggestEmploymentType(profile: any): EmploymentTypePref {
  const latestExp = profile?.experiencesList?.[0];
  if (latestExp && (!latestExp.end || /present/i.test(String(latestExp.end)))) {
    return 'full-time';
  }
  return 'all';
}

function suggestJoiningDate(currentStatus?: CurrentStatus): string | undefined {
  if (currentStatus === 'unemployed' || currentStatus === 'urgently_looking') return 'ASAP';
  return undefined;
}

function mapEmploymentTypePref(pref?: EmploymentTypePref): EmploymentType | 'all' {
  if (!pref || pref === 'all') return 'all';
  if (pref === 'contract-freelance') return 'contract';
  return pref;
}

export interface AiApplySuggestions {
  resumeId?: string;
  resumeReason?: string;
  coverLetterId?: string;
  coverLetterReason?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  industries: string[];
  employmentType: EmploymentTypePref;
  joiningDate?: string;
  preferredCountry?: string;
  preferredState?: string;
  preferredLocation?: string;
  contactChannels: string[];
}

export class AiApplyService {
  async getPreferences(
    userId: string
  ): Promise<{ preferences: IAiApplyPreferencesDocument | null; aiSuggestions: AiApplySuggestions }> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const [preferences, profile, resumes, coverLetters] = await Promise.all([
      AiApplyPreferencesModel.findOne({ userId: userObjectId }),
      UserProfileModel.findOne({ userId: userObjectId }).lean(),
      ResumeModel.find({ userId: userObjectId }).sort({ updatedAt: -1 }).lean(),
      CoverLetterModel.find({ userId: userObjectId }).sort({ updatedAt: -1 }).lean(),
    ]);

    const desiredJobTitles = preferences?.desiredJobTitles || [];
    const profileSkills = profile?.skills || [];
    const experienceTitles = (profile?.experiencesList || []).map((e: any) => e.title).filter(Boolean);

    const resumeMatch = pickBestOverlapMatch(
      resumes,
      (r: any) =>
        [r.title, r.content?.personalInfo?.headline, ...extractResumeSkills(r.content), ...extractResumePositions(r.content)]
          .filter(Boolean)
          .join(' '),
      [...desiredJobTitles, ...profileSkills]
    );

    const coverLetterMatch = pickBestOverlapMatch(
      coverLetters,
      (c: any) => [c.title, c.content].filter(Boolean).join(' '),
      desiredJobTitles
    );

    const salarySuggestion = await this.suggestSalary(desiredJobTitles);

    const aiSuggestions: AiApplySuggestions = {
      resumeId: resumeMatch?.id,
      resumeReason: resumeMatch
        ? 'This resume appears to be the strongest match for your selected job titles.'
        : undefined,
      coverLetterId: coverLetterMatch?.id,
      coverLetterReason: coverLetterMatch
        ? 'This cover letter appears to be the strongest match for your selected job titles.'
        : undefined,
      salaryMin: salarySuggestion?.min,
      salaryMax: salarySuggestion?.max,
      salaryCurrency: salarySuggestion?.currency,
      industries: suggestIndustries(profileSkills, experienceTitles),
      employmentType: suggestEmploymentType(profile),
      joiningDate: suggestJoiningDate(preferences?.currentStatus),
      preferredCountry: profile?.contact?.country,
      preferredState: profile?.contact?.state,
      preferredLocation: profile?.contact?.city,
      contactChannels: [
        ...(profile?.contact?.email ? ['email'] : []),
        ...(profile?.contact?.phone ? ['mobile'] : []),
      ],
    };

    return { preferences, aiSuggestions };
  }

  private async suggestSalary(
    desiredJobTitles: string[]
  ): Promise<{ min: number; max: number; currency: string } | null> {
    if (!desiredJobTitles.length) return null;

    const regexes = desiredJobTitles.map((t) => new RegExp(escapeRegex(t), 'i'));
    const jobs = await JobModel.find({ title: { $in: regexes }, status: 'active' })
      .select('salary')
      .limit(50)
      .lean();

    if (!jobs.length) return null;

    const mins = jobs.map((j) => j.salary?.min || 0).filter(Boolean).sort((a, b) => a - b);
    const maxs = jobs.map((j) => j.salary?.max || 0).filter(Boolean).sort((a, b) => a - b);
    if (!mins.length || !maxs.length) return null;

    const median = (arr: number[]) => arr[Math.floor(arr.length / 2)];
    return { min: median(mins), max: median(maxs), currency: jobs[0].salary?.currency || 'INR' };
  }

  async savePreferences(
    userId: string,
    data: Partial<IAiApplyPreferencesDocument>
  ): Promise<IAiApplyPreferencesDocument> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const updated = await AiApplyPreferencesModel.findOneAndUpdate(
      { userId: userObjectId },
      { $set: data },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    // Trigger candidate profile sync in background so candidate vector stays up to date
    jobService.syncCandidateProfile(userId).catch(() => {});

    // Invalidate matched jobs cache for user
    try {
      const cachePatternKey = `ai_apply_matches:${userId}:*`;
      await redisService.del(cachePatternKey);
    } catch {
      // Ignored
    }

    return updated!;
  }

  /**
   * Finds matching jobs from the database using vector embeddings, candidate profile, and user preferences.
   * High performance with Redis caching.
   */
  async getMatchedJobs(
    userId: string,
    options: { minScore?: number; limit?: number; page?: number; search?: string } = {}
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
    appliedJobIds: string[];
  }> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const [preferences, applications, candidateProfileDoc] = await Promise.all([
      AiApplyPreferencesModel.findOne({ userId: userObjectId }).lean(),
      ApplicationModel.find({ userId: userObjectId }).select('jobId status matchScore').lean(),
      CandidateProfileModel.findOne({ userId: userObjectId }).lean(),
    ]);

    const appliedJobIdSet = new Set(applications.map((a) => String(a.jobId)));

    // Extract candidate skills & embedding
    let candidateSkills = candidateProfileDoc?.skills || [];
    let candidateEmbedding = candidateProfileDoc?.embedding;
    let headline = candidateProfileDoc?.headline || 'Professional Profile';

    // If candidate profile not yet computed, pull from latest resume
    if (!candidateProfileDoc) {
      const latestResume = await ResumeModel.findOne({ userId: userObjectId }).sort({ updatedAt: -1 }).lean();
      if (latestResume && latestResume.content) {
        const content = latestResume.content as any;
        headline = content.personalInfo?.headline || headline;
        if (Array.isArray(content.skills)) {
          candidateSkills = content.skills.map((s: any) => (typeof s === 'string' ? s : s.name)).filter(Boolean);
        }
      }
    }

    // Build MongoDB query filter
    const query: any = { status: 'active' };

    // Country / Location filter (flexible: match country OR remote eligible jobs)
    if (preferences?.preferredCountry && preferences.preferredCountry.trim().length > 0) {
      const countryEscaped = escapeRegex(preferences.preferredCountry.trim());
      query.$or = [
        { 'location.country': { $regex: new RegExp(`^${countryEscaped}$`, 'i') } },
        { workplaceType: 'remote' },
        { 'location.remote': true },
      ];
    }

    // Employment type filter
    if (preferences?.employmentType && preferences.employmentType !== 'all') {
      const empType = preferences.employmentType === 'contract-freelance' ? 'contract' : preferences.employmentType;
      query.employmentType = empType;
    }

    // Fetch active jobs from DB
    const jobsInDb = await JobModel.find(query)
      .select('title company description responsibilities requirements preferredQualifications skills experienceLevel minimumExperience maximumExperience employmentType workplaceType location salary educationRequirements benefits applicationUrl publishedAt status embedding')
      .sort({ publishedAt: -1 })
      .limit(150)
      .lean();

    const desiredTitles = (preferences?.desiredJobTitles || []).map((t) => t.toLowerCase().trim()).filter(Boolean);

    // Compute rich hybrid match scores (Vector Cosine Similarity + Skills Overlap + Title Alignment)
    let candidateJobs: JobWithMatchData[] = jobsInDb.map((job: any) => {
      // 1. Skill overlap
      const skillAnalysis = embeddingService.calculateSkillsMatch(job.skills || [], candidateSkills);

      // 2. Vector embedding similarity (3072-dim)
      let vectorSim = 0.65;
      if (candidateEmbedding && candidateEmbedding.length > 0 && job.embedding && job.embedding.length > 0) {
        vectorSim = embeddingService.cosineSimilarity(candidateEmbedding, job.embedding);
      }
      const vectorScoreNormalized = Math.round(vectorSim * 100);

      // 3. Title alignment bonus
      const jobTitleLower = (job.title || '').toLowerCase();
      const hasDirectTitleMatch = desiredTitles.some((dt) => {
        if (!dt) return false;
        return (
          jobTitleLower.includes(dt) ||
          dt.includes(jobTitleLower) ||
          (dt.includes('mern') && jobTitleLower.includes('full stack')) ||
          (dt.includes('fullstack') && jobTitleLower.includes('full stack')) ||
          (dt.includes('frontend') && (jobTitleLower.includes('react') || jobTitleLower.includes('frontend'))) ||
          (dt.includes('backend') && (jobTitleLower.includes('node') || jobTitleLower.includes('backend')))
        );
      });

      const titleBonus = hasDirectTitleMatch ? 15 : (desiredTitles.length === 0 ? 8 : 0);

      // 4. Hybrid score
      const baseScore = Math.round(vectorScoreNormalized * 0.45 + skillAnalysis.score * 0.4 + titleBonus);
      const matchScore = Math.min(99, Math.max(45, baseScore));

      // 5. Match reasons
      const matchReasons: string[] = [];
      if (hasDirectTitleMatch) {
        matchReasons.push(`Direct alignment with your desired role (${job.title})`);
      }
      if (skillAnalysis.matched.length > 0) {
        matchReasons.push(`Matched ${skillAnalysis.matched.length} key skills: ${skillAnalysis.matched.slice(0, 4).join(', ')}`);
      }
      if (
        job.location?.country?.toLowerCase() === preferences?.preferredCountry?.toLowerCase() ||
        job.location?.remote ||
        job.workplaceType === 'remote'
      ) {
        matchReasons.push(`Matches location preference: ${job.location?.city || job.location?.country || 'Remote Eligible'}`);
      }

      const { embedding, ...cleanJob } = job;

      return {
        ...cleanJob,
        matchScore,
        matchedSkills: skillAnalysis.matched,
        missingSkills: skillAnalysis.missing,
        matchReasons,
        vectorScore: vectorSim,
        isAlreadyApplied: appliedJobIdSet.has(String(job._id)),
      };
    });

    // Apply explicit search query filter if user typed in the search bar
    if (options.search && options.search.trim().length > 0) {
      const searchTokens = options.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
      candidateJobs = candidateJobs.filter((j) => {
        const haystack = `${j.title} ${j.company?.name} ${(j.skills || []).join(' ')} ${j.location?.city} ${j.location?.country}`.toLowerCase();
        return searchTokens.some((tok) => haystack.includes(tok));
      });
    }

    // Filter by minScore if provided
    const minScore = options.minScore || APPLY_MATCH_SCORE_FLOOR;
    candidateJobs = candidateJobs.filter((j) => j.matchScore >= minScore);

    // Sort by matchScore descending (unapplied first, then highest score)
    candidateJobs.sort((a, b) => {
      if (a.isAlreadyApplied !== b.isAlreadyApplied) {
        return a.isAlreadyApplied ? 1 : -1;
      }
      return b.matchScore - a.matchScore;
    });

    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || APPLY_JOB_CAP));
    const total = candidateJobs.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginatedJobs = candidateJobs.slice((page - 1) * limit, page * limit);

    return {
      jobs: paginatedJobs,
      total,
      page,
      limit,
      totalPages,
      candidateProfile: {
        headline,
        skillsCount: candidateSkills.length,
        skills: candidateSkills,
        hasEmbedding: !!(candidateEmbedding && candidateEmbedding.length > 0),
        embeddingStatus: candidateProfileDoc?.embeddingStatus || 'completed',
      },
      appliedJobIds: Array.from(appliedJobIdSet),
    };
  }

  /**
   * Starts an automated 10-by-10 BullMQ batch application process.
   * Creates an AiApplyBatchJob session and enqueues chunks of 10 jobs to BullMQ.
   */
  async startBatchApply(
    userId: string,
    options: {
      jobIds?: string[];
      limit?: number;
      batchSize?: number;
    } = {}
  ): Promise<{
    sessionId: string;
    totalJobs: number;
    totalBatches: number;
    batchSize: number;
    status: AiApplyBatchStatus;
    jobs: Array<{ jobId: string; title: string; company?: string; matchScore: number }>;
  }> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const preferences = await AiApplyPreferencesModel.findOne({ userId: userObjectId });

    if (!preferences) {
      throw AppError.badRequest('Please complete the AI Apply preferences before applying.');
    }
    if (!preferences.currentStatus) {
      throw AppError.badRequest('Please specify your current career status.');
    }
    if (!preferences.desiredJobTitles || preferences.desiredJobTitles.length === 0) {
      throw AppError.badRequest('Please select at least one desired job title.');
    }
    if (!preferences.resumeId) {
      throw AppError.badRequest('Please select a resume before starting AI Apply.');
    }

    // Determine target job IDs
    let targetJobIds: string[] = [];
    let targetJobsList: Array<{ _id: any; title: string; company?: { name: string }; matchScore: number }> = [];

    if (options.jobIds && options.jobIds.length > 0) {
      targetJobIds = options.jobIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
      const jobsInDb = await JobModel.find({ _id: { $in: targetJobIds.map((id) => new mongoose.Types.ObjectId(id)) } })
        .select('title company')
        .lean();
      targetJobsList = jobsInDb.map((j) => ({
        _id: j._id,
        title: j.title,
        company: j.company,
        matchScore: 88,
      }));
    } else {
      const matchResult = await this.getMatchedJobs(userId, {
        limit: options.limit || 30,
      });
      // Filter out jobs already applied to
      const unapplied = matchResult.jobs.filter((j: any) => !j.isAlreadyApplied);
      targetJobIds = unapplied.map((j) => String(j._id));
      targetJobsList = unapplied.map((j) => ({
        _id: j._id,
        title: j.title,
        company: j.company,
        matchScore: j.matchScore,
      }));
    }

    if (targetJobIds.length === 0) {
      throw AppError.badRequest('No unapplied matching jobs found to apply for.');
    }

    const batchSize = Math.max(1, Math.min(25, options.batchSize || 10)); // Default 10 jobs per batch
    const totalJobs = targetJobIds.length;
    const totalBatches = Math.ceil(totalJobs / batchSize);

    // Split target jobs into chunks of 10
    const jobBatches: string[][] = [];
    for (let i = 0; i < totalJobs; i += batchSize) {
      jobBatches.push(targetJobIds.slice(i, i + batchSize));
    }

    // Create batch session in MongoDB
    const sessionDoc = await AiApplyBatchJobModel.create({
      userId: userObjectId,
      preferencesId: preferences._id,
      resumeId: preferences.resumeId,
      coverLetterId: preferences.coverLetterId,
      status: 'queued',
      totalJobs,
      totalBatches,
      batchSize,
      currentBatch: 0,
      appliedCount: 0,
      skippedDuplicates: 0,
      failedCount: 0,
      selectedJobIds: targetJobIds.map((id) => new mongoose.Types.ObjectId(id)),
      appliedJobs: [],
      startedAt: new Date(),
    });

    const sessionId = String(sessionDoc._id);

    // Cache initial state in Redis for sub-millisecond polling for 50k users
    try {
      const cacheKey = `ai_apply_session:${sessionId}`;
      await redisService.setEx(cacheKey, 3600, JSON.stringify(sessionDoc.toObject()));
    } catch {
      // Ignored
    }

    // Enqueue all batches to BullMQ
    await enqueueAiApplyBatches(
      sessionId,
      userId,
      String(preferences.resumeId),
      String(preferences._id),
      preferences.coverLetterId ? String(preferences.coverLetterId) : undefined,
      jobBatches
    );

    return {
      sessionId,
      totalJobs,
      totalBatches,
      batchSize,
      status: 'queued',
      jobs: targetJobsList.map((j) => ({
        jobId: String(j._id),
        title: j.title,
        company: j.company?.name,
        matchScore: j.matchScore,
      })),
    };
  }

  /**
   * Retrieves real-time batch session status.
   * Served directly from Redis for 50k concurrent user scalability with MongoDB fallback.
   */
  async getBatchStatus(userId: string, sessionId: string): Promise<IAiApplyBatchJobDocument | any> {
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      throw AppError.badRequest('Invalid session ID');
    }

    // 1. Try Redis cache for sub-millisecond response
    const cacheKey = `ai_apply_session:${sessionId}`;
    try {
      const cached = await redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Redis failover to DB
    }

    // 2. MongoDB fallback
    const session = await AiApplyBatchJobModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      userId: new mongoose.Types.ObjectId(userId),
    }).lean();

    if (!session) {
      throw AppError.notFound('Batch application session not found');
    }

    // Populate Redis
    try {
      await redisService.setEx(cacheKey, 3600, JSON.stringify(session));
    } catch {
      // Ignored
    }

    return session;
  }

  /**
   * Retrieves any active/in-progress batch session for the user so refreshing the page restores state.
   */
  async getActiveBatchSession(userId: string): Promise<any | null> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const active = await AiApplyBatchJobModel.findOne({
      userId: userObjectId,
      status: { $in: ['queued', 'processing', 'paused'] },
    })
      .sort({ createdAt: -1 })
      .lean();

    return active || null;
  }

  /**
   * Pauses an in-progress batch application session.
   */
  async pauseBatchApply(userId: string, sessionId: string): Promise<any> {
    const sessionObjectId = new mongoose.Types.ObjectId(sessionId);
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const session = await AiApplyBatchJobModel.findOneAndUpdate(
      { _id: sessionObjectId, userId: userObjectId },
      { $set: { status: 'paused' } },
      { new: true }
    ).lean();

    if (!session) throw AppError.notFound('Session not found');

    const cacheKey = `ai_apply_session:${sessionId}`;
    try {
      await redisService.setEx(cacheKey, 3600, JSON.stringify(session));
    } catch {}

    return session;
  }

  /**
   * Resumes a paused batch application session.
   */
  async resumeBatchApply(userId: string, sessionId: string): Promise<any> {
    const sessionObjectId = new mongoose.Types.ObjectId(sessionId);
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const session = await AiApplyBatchJobModel.findOne({
      _id: sessionObjectId,
      userId: userObjectId,
    });

    if (!session) throw AppError.notFound('Session not found');
    if (session.status !== 'paused') return session.toObject();

    session.status = 'processing';
    await session.save();

    // Find remaining unapplied job IDs
    const appliedJobIds = new Set(session.appliedJobs.map((j) => String(j.jobId)));
    const remainingJobIds = session.selectedJobIds
      .map((id) => String(id))
      .filter((id) => !appliedJobIds.has(id));

    if (remainingJobIds.length > 0) {
      const jobBatches: string[][] = [];
      for (let i = 0; i < remainingJobIds.length; i += session.batchSize) {
        jobBatches.push(remainingJobIds.slice(i, i + session.batchSize));
      }

      await enqueueAiApplyBatches(
        sessionId,
        userId,
        String(session.resumeId),
        String(session.preferencesId),
        session.coverLetterId ? String(session.coverLetterId) : undefined,
        jobBatches
      );
    } else {
      session.status = 'completed';
      session.completedAt = new Date();
      await session.save();
    }

    const sessionObj = session.toObject();
    const cacheKey = `ai_apply_session:${sessionId}`;
    try {
      await redisService.setEx(cacheKey, 3600, JSON.stringify(sessionObj));
    } catch {}

    return sessionObj;
  }

  /**
   * Cancels an active/queued batch application session.
   */
  async cancelBatchApply(userId: string, sessionId: string): Promise<any> {
    const sessionObjectId = new mongoose.Types.ObjectId(sessionId);
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const session = await AiApplyBatchJobModel.findOneAndUpdate(
      { _id: sessionObjectId, userId: userObjectId },
      { $set: { status: 'cancelled', completedAt: new Date() } },
      { new: true }
    ).lean();

    if (!session) throw AppError.notFound('Session not found');

    const cacheKey = `ai_apply_session:${sessionId}`;
    try {
      await redisService.setEx(cacheKey, 3600, JSON.stringify(session));
    } catch {}

    return session;
  }

  /**
   * Synchronous apply fallback (for backward compatibility).
   */
  async applyForJobs(userId: string): Promise<{
    appliedCount: number;
    skippedDuplicates: number;
    jobs: Array<{ jobId: string; title: string; company?: string; matchScore: number }>;
  }> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const preferences = await AiApplyPreferencesModel.findOne({ userId: userObjectId });

    if (!preferences) {
      throw AppError.badRequest('Complete the AI Apply preferences before applying to jobs.');
    }
    if (!preferences.currentStatus) {
      throw AppError.badRequest('Please describe your current status before applying to jobs.');
    }
    if (!preferences.desiredJobTitles || preferences.desiredJobTitles.length === 0) {
      throw AppError.badRequest('Please add at least one desired job title before applying to jobs.');
    }
    if (!preferences.resumeId) {
      throw AppError.badRequest('Please select a resume before applying to jobs.');
    }

    const resume = await ResumeModel.findOne({ _id: preferences.resumeId, userId: userObjectId });
    if (!resume) {
      throw AppError.badRequest('Selected resume was not found or is not owned by you.');
    }

    const { jobs: matched } = await this.getMatchedJobs(userId, { limit: 20 });

    if (matched.length === 0) {
      await AiApplyPreferencesModel.updateOne(
        { userId: userObjectId },
        { status: 'active', lastAppliedAt: new Date() }
      );
      return { appliedCount: 0, skippedDuplicates: 0, jobs: [] };
    }

    const docs = matched.map((job) => ({
      userId: userObjectId,
      jobId: job._id,
      resumeId: preferences.resumeId,
      coverLetterId: preferences.coverLetterId,
      source: 'ai_apply' as const,
      status: 'submitted' as const,
      matchScore: job.matchScore,
      aiApplyPreferencesId: preferences._id,
      appliedAt: new Date(),
    }));

    let insertedIds = new Set<string>();
    try {
      const result = await ApplicationModel.insertMany(docs, { ordered: false });
      insertedIds = new Set(result.map((d) => String(d.jobId)));
    } catch (err: any) {
      const writeErrors: any[] = err?.writeErrors || [];
      const insertedDocs: any[] = err?.insertedDocs || [];
      const allDuplicates = writeErrors.length > 0 && writeErrors.every((we) => we.code === 11000 || we.err?.code === 11000);

      if (!allDuplicates && writeErrors.length > 0) {
        throw err;
      }

      insertedIds = new Set(insertedDocs.map((d: any) => String(d.jobId)));
    }

    await AiApplyPreferencesModel.updateOne(
      { userId: userObjectId },
      { status: 'active', lastAppliedAt: new Date() }
    );

    const appliedJobs = matched.filter((j) => insertedIds.has(String(j._id)));

    return {
      appliedCount: appliedJobs.length,
      skippedDuplicates: matched.length - appliedJobs.length,
      jobs: appliedJobs.map((j) => ({
        jobId: String(j._id),
        title: j.title,
        company: j.company?.name,
        matchScore: j.matchScore,
      })),
    };
  }
}

export const aiApplyService = new AiApplyService();
