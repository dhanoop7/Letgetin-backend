import mongoose, { Types } from 'mongoose';
import { ApplicationModel, IApplicationDocument, IResumeEvaluation, ResumeDecision } from '../application/application.model.js';
import { JobModel } from '../job/job.model.js';
import { ResumeModel } from '../resume/resume.model.js';
import { UserModel } from '../user/user.model.js';
import { CandidateProfileModel } from '../job/candidateProfile.model.js';
import { UserProfileModel } from '../profile/profile.model.js';
import { CandidateDataResolver } from '../profile/candidateDataResolver.js';
import { candidateJobMatchingService } from '../matching/candidateJobMatching.service.js';
import { embeddingService } from '../embedding/embedding.service.js';
import { AtsService } from '../ai/services/ats.service.js';
import { AppError } from '../../utils/appError.js';
import {
  BulkDecisionInput,
  RecordDecisionInput,
  ResumeScreeningCandidateItem,
  ResumeScreeningFilters,
  ResumeScreeningStats,
} from './resumeScreening.types.js';

export class ResumeScreeningService {
  private atsService: AtsService;

  constructor() {
    this.atsService = new AtsService();
  }

  /**
   * Helper: verify job ownership for recruiter
   */
  private async verifyJobOwnership(jobId: string | Types.ObjectId, recruiterUserId?: string) {
    const job = await JobModel.findById(jobId);
    if (!job) {
      throw AppError.notFound(`Job not found for ID: ${jobId}`);
    }
    if (recruiterUserId && String(job.postedBy) !== String(recruiterUserId)) {
      throw AppError.forbidden('You do not have permission to manage this job screening.');
    }
    return job;
  }

  /**
   * Evaluates an application's resume against the job description using existing AtsService and EmbeddingService.
   * Produces a structured, explainable IResumeEvaluation scorecard without fabricating data.
   */
  public async evaluateApplicationResume(
    applicationId: string | Types.ObjectId
  ): Promise<IApplicationDocument> {
    const application = await ApplicationModel.findById(applicationId);
    if (!application) {
      throw AppError.notFound(`Application not found for ID: ${applicationId}`);
    }

    const job = await JobModel.findById(application.jobId);
    if (!job) {
      throw AppError.notFound(`Job not found for application: ${applicationId}`);
    }

    // 1. Mark as in-review
    application.resumeScreeningStatus = 'ai_reviewing';
    await application.save();

    // 2. Fetch candidate resume, candidate profile, user profile, and user
    const [resume, candidateProfile, user, userProfile] = await Promise.all([
      application.resumeId ? ResumeModel.findById(application.resumeId).lean() : null,
      CandidateProfileModel.findOne({ userId: application.userId }).lean(),
      UserModel.findById(application.userId).select('fullName email').lean(),
      UserProfileModel.findOne({ userId: application.userId }).lean(),
    ]);

    // Resolve unified candidate data across profile and resume
    const resolved = CandidateDataResolver.resolve({
      userId: application.userId?.toString(),
      user,
      userProfile,
      resume,
      candidateProfile,
    });

    // 3. Match candidate against job using the canonical Phase 3 matching engine
    const matchResult = candidateJobMatchingService.matchCandidateToJob(
      resolved,
      job,
      {
        candidateEmbedding: candidateProfile?.embedding,
        jobEmbedding: job.embedding,
      }
    );

    const overallScore = matchResult.overallScore;
    const skillsMatchScore = matchResult.breakdown.requiredSkillsScore;
    const experienceMatchScore = matchResult.breakdown.experienceScore;
    const matchedSkills = matchResult.requiredSkills.matched;
    const missingSkills = matchResult.requiredSkills.missing;

    // 4. Extract strengths, weaknesses, and recommendation from canonical match result
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    if (matchedSkills.length > 0) {
      strengths.push(`Matches ${matchedSkills.length} key required skill${matchedSkills.length > 1 ? 's' : ''}: ${matchedSkills.slice(0, 4).join(', ')}`);
    }
    if (matchResult.preferredSkills.matched.length > 0) {
      strengths.push(`Matches ${matchResult.preferredSkills.matched.length} preferred skill${matchResult.preferredSkills.matched.length > 1 ? 's' : ''}: ${matchResult.preferredSkills.matched.slice(0, 3).join(', ')}`);
    }
    if (matchResult.experience.status === 'within_range' || matchResult.experience.status === 'above_range' || matchResult.experience.status === 'no_requirement') {
      const expText = matchResult.experience.minimumRequired !== undefined
        ? ` (${matchResult.experience.candidateYears} yrs vs ${matchResult.experience.minimumRequired} yrs required)`
        : ` (${matchResult.experience.candidateYears} yrs)`;
      strengths.push(`Meets experience requirement${expText}`);
    }
    if (matchResult.breakdown.semanticScore >= 75) {
      strengths.push('High semantic relevance to job description responsibilities');
    }
    if (matchResult.breakdown.roleRelevanceScore >= 80) {
      strengths.push('Strong role and title alignment');
    }
    if (matchResult.education.status === 'meets_requirement') {
      strengths.push('Meets education qualification requirements');
    }

    if (missingSkills.length > 0) {
      weaknesses.push(`Missing core skills: ${missingSkills.slice(0, 4).join(', ')}`);
    }
    if (matchResult.experience.status === 'below_minimum') {
      weaknesses.push(`Below target minimum experience (${matchResult.experience.candidateYears} yrs vs ${matchResult.experience.minimumRequired} yrs required)`);
    }
    if (matchResult.education.status === 'below_requirement') {
      weaknesses.push('Education level is below target requirement');
    }
    if (matchResult.breakdown.semanticScore < 50 && (candidateProfile?.embedding || job.embedding)) {
      weaknesses.push('Low semantic overlap with core responsibilities');
    }

    if (strengths.length === 0) {
      strengths.push('Candidate submitted a complete application profile for evaluation');
    }
    if (weaknesses.length === 0) {
      weaknesses.push('No critical profile gaps identified against initial requirements');
    }

    let recommendation: 'strong_match' | 'potential_match' | 'not_recommended' = 'potential_match';
    if (matchResult.recommendation === 'strong_match') {
      recommendation = 'strong_match';
    } else if (matchResult.recommendation === 'weak_match') {
      recommendation = 'not_recommended';
    }

    const evaluation: IResumeEvaluation = {
      overallScore,
      skillsMatchScore,
      experienceMatchScore,
      matchedSkills,
      missingSkills,
      strengths,
      weaknesses,
      recommendation,
      evaluatedAt: new Date(),
      isAiEvaluated: true,
      breakdown: matchResult.breakdown,
      matchedPreferredSkills: matchResult.preferredSkills.matched,
      missingRequiredSkills: matchResult.requiredSkills.missing,
      explanations: matchResult.explanations,
      canonicalMatch: matchResult,
    };

    // 8. Update application state
    application.resumeScreeningStatus = 'ai_reviewed';
    application.resumeEvaluation = evaluation;
    application.matchScore = overallScore;
    application.compositeRank = overallScore;

    // Check automatic screening threshold:
    // If recruiter specified eligibilityMinPercent and auto-advance is enabled
    const minPercent = typeof job.eligibilityMinPercent === 'number' ? job.eligibilityMinPercent : null;
    if (minPercent !== null && minPercent > 0 && overallScore >= minPercent) {
      // Auto-shortlisted at resume screening stage
      application.resumeDecision = 'shortlisted';
      application.resumeDecidedAt = new Date();
      application.resumeDecisionNotes = `Automatically shortlisted: score ${overallScore}% meets eligibility threshold of ${minPercent}%`;
    } else if (minPercent !== null && minPercent > 0 && overallScore < 30) {
      application.resumeDecision = 'rejected';
      application.resumeDecidedAt = new Date();
      application.resumeDecisionNotes = `Automatically rejected: score ${overallScore}% below minimum threshold of ${minPercent}%`;
      application.status = 'rejected';
      application.poolType = 'disqualified';
    } else if (application.resumeDecision === 'pending') {
      // Remains pending for recruiter review
      application.resumeDecision = 'pending';
    }

    await application.save();
    return application;
  }

  /**
   * Recruiter records an authoritative decision on a candidate's resume screening:
   * 'shortlisted' | 'rejected' | 'needs_review'
   * Note: This strictly controls the qualification boundary into the Hiring Engine.
   */
  public async recordRecruiterDecision(
    applicationId: string | Types.ObjectId,
    recruiterUserId: string,
    input: RecordDecisionInput
  ): Promise<IApplicationDocument> {
    const application = await ApplicationModel.findById(applicationId);
    if (!application) {
      throw AppError.notFound(`Application not found for ID: ${applicationId}`);
    }

    // Verify job ownership
    await this.verifyJobOwnership(application.jobId, recruiterUserId);

    const prevDecision = application.resumeDecision;
    application.resumeDecision = input.decision;
    application.resumeDecidedAt = new Date();
    application.resumeDecidedBy = new Types.ObjectId(recruiterUserId);
    application.resumeDecisionNotes = input.notes || '';

    if (input.decision === 'rejected') {
      application.status = 'rejected';
      application.poolType = 'disqualified';
    } else if (input.decision === 'shortlisted') {
      if (application.status === 'rejected' || application.status === 'failed') {
        application.status = 'submitted';
      }
      if (application.poolType === 'disqualified') {
        application.poolType = undefined;
      }
    }

    await application.save();

    // Re-evaluate collection readiness if decision changed to/from shortlisted
    if (prevDecision !== input.decision) {
      try {
        const { ApplicationCollectionService } = await import('../hiringEngine/services/applicationCollection.service.js');
        await ApplicationCollectionService.evaluateCollectionReadiness(application.jobId);
      } catch (err) {
        console.warn('[ResumeScreeningService] evaluateCollectionReadiness notification error:', err);
      }
    }

    return application;
  }

  /**
   * Bulk decisions for recruiter convenience (e.g. shortlist top 5 selected)
   */
  public async recordBulkRecruiterDecisions(
    jobId: string,
    recruiterUserId: string,
    input: BulkDecisionInput
  ): Promise<{ updatedCount: number }> {
    await this.verifyJobOwnership(jobId, recruiterUserId);

    if (!Array.isArray(input.applicationIds) || input.applicationIds.length === 0) {
      throw AppError.badRequest('No application IDs provided for bulk decision.');
    }

    let updatedCount = 0;
    for (const appId of input.applicationIds) {
      try {
        await this.recordRecruiterDecision(appId, recruiterUserId, {
          decision: input.decision,
          notes: input.notes,
        });
        updatedCount++;
      } catch (err) {
        console.warn(`[ResumeScreeningService] Failed to record decision for ${appId}:`, err);
      }
    }

    // Single idempotent trigger for collection readiness
    try {
      const { ApplicationCollectionService } = await import('../hiringEngine/services/applicationCollection.service.js');
      await ApplicationCollectionService.evaluateCollectionReadiness(jobId);
    } catch (err) {
      console.warn('[ResumeScreeningService] Bulk evaluateCollectionReadiness error:', err);
    }

    return { updatedCount };
  }

  /**
   * Lists candidate applications for a job in the Resume Shortlisting view with complete scorecard.
   */
  public async getJobScreeningCandidates(
    jobId: string,
    recruiterUserId: string,
    filters: ResumeScreeningFilters = {}
  ): Promise<{
    candidates: ResumeScreeningCandidateItem[];
    total: number;
    stats: ResumeScreeningStats;
    page: number;
    limit: number;
  }> {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);

    const query: any = { jobId: job._id };

    if (filters.decision && filters.decision !== 'all') {
      query.resumeDecision = filters.decision;
    }

    if (filters.screeningStatus && filters.screeningStatus !== 'all') {
      query.resumeScreeningStatus = filters.screeningStatus;
    }

    if (typeof filters.minScore === 'number' && filters.minScore > 0) {
      query.$or = [
        { 'resumeEvaluation.overallScore': { $gte: filters.minScore } },
        { matchScore: { $gte: filters.minScore } },
      ];
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 20));
    const skip = (page - 1) * limit;

    let sortOption: any = { 'resumeEvaluation.overallScore': -1, appliedAt: -1 };
    if (filters.sortBy === 'appliedAt') {
      sortOption = { appliedAt: filters.sortOrder === 'asc' ? 1 : -1 };
    } else if (filters.sortBy === 'score') {
      sortOption = { 'resumeEvaluation.overallScore': filters.sortOrder === 'asc' ? 1 : -1, appliedAt: -1 };
    }

    const [applications, total, stats] = await Promise.all([
      ApplicationModel.find(query)
        .populate({ path: 'userId', select: 'fullName username email phone avatarUrl' })
        .populate({ path: 'resumeId', select: 'title atsScore createdAt updatedAt' })
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .lean(),
      ApplicationModel.countDocuments(query),
      this.getScreeningStats(jobId, recruiterUserId),
    ]);

    const candidates: ResumeScreeningCandidateItem[] = applications.map((app: any) => ({
      applicationId: String(app._id),
      jobId: String(app.jobId),
      jobTitle: job.title,
      candidate: {
        _id: String(app.userId?._id || app.userId),
        fullName: app.userId?.fullName || 'Candidate',
        username: app.userId?.username,
        email: app.userId?.email,
        phone: app.userId?.phone,
        avatarUrl: app.userId?.avatarUrl,
      },
      resume: app.resumeId
        ? {
            _id: String(app.resumeId._id),
            title: app.resumeId.title,
            atsScore: app.resumeId.atsScore,
            createdAt: app.resumeId.createdAt,
            updatedAt: app.resumeId.updatedAt,
          }
        : null,
      appliedAt: app.appliedAt,
      source: app.source || 'manual',
      screeningStatus: app.resumeScreeningStatus || 'pending',
      decision: app.resumeDecision || 'pending',
      decidedAt: app.resumeDecidedAt,
      decisionNotes: app.resumeDecisionNotes,
      evaluation: app.resumeEvaluation,
      matchScore: app.resumeEvaluation?.overallScore ?? app.matchScore ?? 0,
    }));

    return {
      candidates,
      total,
      stats,
      page,
      limit,
    };
  }

  /**
   * Retrieves summary statistics for the recruiter Resume Shortlisting header.
   */
  public async getScreeningStats(
    jobId: string,
    recruiterUserId: string
  ): Promise<ResumeScreeningStats> {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);
    const jobObjectId = new Types.ObjectId(jobId);

    const [totalApplications, pendingReview, aiReviewed, shortlisted, needsReview, rejected] =
      await Promise.all([
        ApplicationModel.countDocuments({ jobId: jobObjectId }),
        ApplicationModel.countDocuments({ jobId: jobObjectId, resumeDecision: 'pending' }),
        ApplicationModel.countDocuments({ jobId: jobObjectId, resumeScreeningStatus: 'ai_reviewed' }),
        ApplicationModel.countDocuments({ jobId: jobObjectId, resumeDecision: 'shortlisted' }),
        ApplicationModel.countDocuments({ jobId: jobObjectId, resumeDecision: 'needs_review' }),
        ApplicationModel.countDocuments({ jobId: jobObjectId, resumeDecision: 'rejected' }),
      ]);

    const minIntake = job.applicationCollection?.minimumIntake || Math.ceil((job.finalShortlistTarget || 5) * 1.5);
    const idealIntake = job.applicationCollection?.idealIntake || (job.finalShortlistTarget || 5) * 2;

    const { ApplicationCollectionService } = await import('../hiringEngine/services/applicationCollection.service.js');
    const actualQualifiedCount = await ApplicationCollectionService.getQualifiedCandidateCount(jobObjectId);
    const collectionStatus = job.applicationCollection?.status || 'idle';
    const isFunnelStarted = collectionStatus === 'started';

    return {
      totalApplications,
      pendingReview,
      aiReviewed,
      shortlisted,
      needsReview,
      rejected,
      minimumIntakeRequired: minIntake,
      idealIntakeTarget: idealIntake,
      isReadyForFunnel: actualQualifiedCount >= minIntake,
      actualQualifiedCount,
      collectionStatus,
      isFunnelStarted,
    };
  }

  /**
   * Retrieves complete candidate detail including full resume content and AI scorecard for drawer review.
   */
  public async getApplicationEvaluationDetail(
    applicationId: string,
    recruiterUserId: string
  ): Promise<any> {
    const application = await ApplicationModel.findById(applicationId)
      .populate({ path: 'userId', select: 'fullName username email phone avatarUrl' })
      .populate({ path: 'resumeId' })
      .lean();

    if (!application) {
      throw AppError.notFound(`Application not found for ID: ${applicationId}`);
    }

    await this.verifyJobOwnership(application.jobId, recruiterUserId);
    const job = await JobModel.findById(application.jobId).lean();

    return {
      applicationId: String(application._id),
      job: {
        _id: String(job?._id),
        title: job?.title,
        skills: job?.skills || [],
        experienceLevel: job?.experienceLevel,
        minimumExperience: job?.minimumExperience,
        description: job?.description,
      },
      candidate: application.userId,
      resume: application.resumeId,
      evaluation: (application as any).resumeEvaluation || null,
      screeningStatus: (application as any).resumeScreeningStatus || 'pending',
      decision: (application as any).resumeDecision || 'pending',
      decidedAt: (application as any).resumeDecidedAt,
      decisionNotes: (application as any).resumeDecisionNotes,
      appliedAt: application.appliedAt,
    };
  }
}

export const resumeScreeningService = new ResumeScreeningService();
