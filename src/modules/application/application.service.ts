import mongoose from 'mongoose';
import { ApplicationModel, ApplicationStatus } from './application.model.js';
import { AiApplyBatchJobModel } from '../aiApply/aiApplyBatch.model.js';
import { ResumeModel } from '../resume/resume.model.js';
import { JobModel } from '../job/job.model.js';
import { UserProfileModel } from '../profile/profile.model.js';
import { AppError } from '../../utils/appError.js';
import { HiringFunnelConfigModel } from '../hiringEngine/hiringFunnelConfig.model.js';
import { CandidateStageHistoryModel } from '../hiringEngine/candidateStageHistory.model.js';
import { HiringEngineService } from '../hiringEngine/services/hiringEngine.service.js';
import { HiringPoolManager } from '../hiringEngine/services/hiringPoolManager.js';
import { scheduleCandidateDeadlineCheck } from '../hiringEngine/queues/hiringEngine.queue.js';
import { HiringNotificationHook } from '../hiringEngine/notifications/hiringNotification.hook.js';
import { ApplicationCollectionService } from '../hiringEngine/services/applicationCollection.service.js';
import { AssessmentQuestionModel } from '../assessment/assessmentQuestion.model.js';
import { AssessmentAttemptModel } from '../assessment/assessmentAttempt.model.js';
import { GoogleProvider } from '../ai/providers/google.provider.js';
import { createChildLogger } from '../../infrastructure/logging/logger.js';

const appLogger = createChildLogger({ component: 'ApplicationService' });

export interface ApplicationQueryFilters {
  page?: number;
  limit?: number;
  status?: string;
  source?: string;
  search?: string;
  sort?: 'recent' | 'matchScore' | 'company';
}

export class ApplicationService {
  /**
   * Retrieves paginated applications submitted by the user with populated job and resume info.
   */
  async getUserApplications(userId: string, filters: ApplicationQueryFilters = {}) {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 20));
    const skip = (page - 1) * limit;

    const query: any = { userId: userObjectId };

    if (filters.status && filters.status !== 'all') {
      query.status = filters.status;
    }

    if (filters.source && filters.source !== 'all') {
      query.source = filters.source;
    }

    // Determine sorting
    let sortOption: any = { appliedAt: -1 };
    if (filters.sort === 'matchScore') {
      sortOption = { matchScore: -1, appliedAt: -1 };
    }

    // Pipeline or populate
    const [rawApplications, total, stats, recentBatches] = await Promise.all([
      ApplicationModel.find(query)
        .populate({
          path: 'jobId',
          select:
            'title company location salary experienceLevel minimumExperience maximumExperience employmentType workplaceType skills responsibilities requirements preferredQualifications educationRequirements benefits applicationUrl status description publishedAt',
        })
        .populate({
          path: 'resumeId',
          select: 'title templateId content settings atsScore createdAt updatedAt',
        })
        .populate({
          path: 'coverLetterId',
          select: 'title',
        })
        .sort(sortOption)
        .lean(),
      ApplicationModel.countDocuments(query),
      this.getApplicationStats(userId),
      AiApplyBatchJobModel.find({ userId: userObjectId })
        .sort({ createdAt: -1 })
        .limit(3)
        .lean(),
    ]);

    // Apply search filter in memory if job title/company is searched
    let applications = rawApplications;
    if (filters.search && filters.search.trim().length > 0) {
      const q = filters.search.trim().toLowerCase();
      applications = applications.filter((app: any) => {
        const jobTitle = app.jobId?.title?.toLowerCase() || '';
        const companyName = app.jobId?.company?.name?.toLowerCase() || '';
        const location =
          `${app.jobId?.location?.city || ''} ${app.jobId?.location?.country || ''}`.toLowerCase();
        return jobTitle.includes(q) || companyName.includes(q) || location.includes(q);
      });
    }

    const filteredTotal = filters.search ? applications.length : total;
    const paginated = applications.slice(skip, skip + limit);

    return {
      applications: paginated.map((app: any) => ({
        _id: String(app._id),
        job: app.jobId || null,
        resume: app.resumeId || null,
        coverLetter: app.coverLetterId || null,
        source: app.source,
        status: app.status,
        matchScore: app.matchScore || 0,
        notes: app.notes || '',
        appliedAt: app.appliedAt,
        createdAt: app.createdAt,
        // Authoritative Hiring Engine fields for candidate tracking
        resumeScreeningStatus: app.resumeScreeningStatus || 'pending',
        resumeDecision: app.resumeDecision || 'pending',
        poolType: app.poolType,
        currentStageIndex: app.currentStageIndex,
        currentStageId: app.currentStageId,
        stageStatus: app.stageStatus,
        stageDeadline: app.stageDeadline,
        invitedAt: app.invitedAt,
        stageStartedAt: app.stageStartedAt,
        stageCompletedAt: app.stageCompletedAt,
        finalShortlistDecision: app.finalShortlistDecision,
        offeredAt: app.offeredAt,
        hiredAt: app.hiredAt,
      })),
      stats,
      recentBatches,
      pagination: {
        page,
        limit,
        total: filteredTotal,
        totalPages: Math.ceil(filteredTotal / limit) || 1,
      },
    };
  }

  /**
   * Retrieves summary statistics of all applications for dashboard insights.
   */
  async getApplicationStats(userId: string) {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const allApps = await ApplicationModel.find({ userId: userObjectId }).select('status source matchScore appliedAt').lean();

    const total = allApps.length;
    let submitted = 0;
    let reviewing = 0;
    let shortlisted = 0;
    let interviewing = 0;
    let offered = 0;
    let rejected = 0;
    let aiApplied = 0;
    let manualApplied = 0;
    let totalScore = 0;
    let scoreCount = 0;

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    let appliedThisWeek = 0;

    for (const app of allApps) {
      if (app.status === 'submitted') submitted++;
      else if (app.status === 'reviewing') reviewing++;
      else if (app.status === 'shortlisted') shortlisted++;
      else if (app.status === 'interviewing') interviewing++;
      else if (app.status === 'offered') offered++;
      else if (app.status === 'rejected') rejected++;

      if (app.source === 'ai_apply') aiApplied++;
      else manualApplied++;

      if (app.matchScore) {
        totalScore += app.matchScore;
        scoreCount++;
      }

      if (app.appliedAt && new Date(app.appliedAt) >= oneWeekAgo) {
        appliedThisWeek++;
      }
    }

    const avgMatchScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;

    return {
      total,
      submitted,
      reviewing,
      shortlisted,
      interviewing,
      offered,
      rejected,
      aiApplied,
      manualApplied,
      avgMatchScore,
      appliedThisWeek,
    };
  }

  /**
   * Updates an application status or notes.
   */
  async updateApplicationStatus(
    userId: string,
    applicationId: string,
    status: ApplicationStatus,
    notes?: string
  ) {
    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
      throw AppError.badRequest('Invalid application ID');
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const appObjectId = new mongoose.Types.ObjectId(applicationId);

    const update: any = { status };
    if (notes !== undefined) {
      update.notes = notes;
    }

    const updated = await ApplicationModel.findOneAndUpdate(
      { _id: appObjectId, userId: userObjectId },
      { $set: update },
      { new: true }
    )
      .populate({
        path: 'jobId',
        select:
          'title company location salary experienceLevel minimumExperience maximumExperience employmentType workplaceType skills responsibilities requirements preferredQualifications educationRequirements benefits applicationUrl status description publishedAt',
      })
      .populate({
        path: 'resumeId',
        select: 'title',
      })
      .populate({
        path: 'coverLetterId',
        select: 'title',
      })
      .lean();

    if (!updated) {
      throw AppError.notFound('Application not found');
    }

    return {
      _id: String(updated._id),
      job: (updated as any).jobId || null,
      resume: (updated as any).resumeId || null,
      coverLetter: (updated as any).coverLetterId || null,
      source: (updated as any).source,
      status: (updated as any).status,
      matchScore: (updated as any).matchScore || 0,
      notes: (updated as any).notes || '',
      appliedAt: (updated as any).appliedAt,
      createdAt: (updated as any).createdAt,
    };
  }

  /**
   * Creates or updates a manual/direct job application record.
   */
  async createApplication(
    userId: string,
    data: {
      jobId: string;
      resumeId?: string;
      coverLetterId?: string;
      notes?: string;
      source?: 'ai_apply' | 'manual';
      status?: ApplicationStatus;
      matchScore?: number;
    }
  ) {
    if (!mongoose.Types.ObjectId.isValid(data.jobId)) {
      throw AppError.badRequest('Invalid job ID');
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const jobObjectId = new mongoose.Types.ObjectId(data.jobId);

    appLogger.info(
      { userId, jobId: data.jobId, source: data.source || 'manual', event: 'application_attempt' },
      `[ApplicationService] Application attempt: User ${userId} -> Job ${data.jobId}`
    );

    // Resolve resumeId: check specified resume, then active resume, then latest updated resume
    let resumeObjectId: mongoose.Types.ObjectId | undefined;
    if (data.resumeId && mongoose.Types.ObjectId.isValid(data.resumeId)) {
      const specified = await ResumeModel.findOne({ _id: data.resumeId, userId: userObjectId });
      if (specified) {
        resumeObjectId = specified._id as mongoose.Types.ObjectId;
      }
    }

    if (!resumeObjectId) {
      const activeResume = await ResumeModel.findOne({ userId: userObjectId, isActive: true });
      if (activeResume) {
        resumeObjectId = activeResume._id as mongoose.Types.ObjectId;
      } else {
        const latestResume = await ResumeModel.findOne({ userId: userObjectId }).sort({ updatedAt: -1 });
        if (latestResume) {
          resumeObjectId = latestResume._id as mongoose.Types.ObjectId;
        }
      }
    }

    if (!resumeObjectId) {
      throw AppError.badRequest('You must have a resume to apply for this job. Please create or upload a resume first.');
    }

    const existing = await ApplicationModel.findOne({ userId: userObjectId, jobId: jobObjectId });

    // Eligibility/deadline gating only applies to a candidate's FIRST application to a job —
    // once applied, later status-transition calls to this same method (e.g. moving a Kanban
    // card) must not be retroactively blocked by these checks.
    if (!existing) {
      const job = await JobModel.findById(jobObjectId).select('eligibilityMinPercent expiresAt').lean();
      if (job?.expiresAt && new Date(job.expiresAt).getTime() < Date.now()) {
        throw AppError.badRequest('Applications for this job have closed.');
      }
      if (job?.eligibilityMinPercent != null) {
        const profile = await UserProfileModel.findOne({ userId: userObjectId }).select('academicPercentage').lean();
        if (profile?.academicPercentage != null && profile.academicPercentage < job.eligibilityMinPercent) {
          appLogger.warn(
            {
              userId,
              jobId: data.jobId,
              candidateScore: profile.academicPercentage,
              requiredScore: job.eligibilityMinPercent,
              event: 'eligibility_rejected',
            },
            `[ApplicationService] Candidate ${userId} rejected by eligibility: ${profile.academicPercentage}% < ${job.eligibilityMinPercent}%`
          );
          throw AppError.badRequest(
            `You do not meet the minimum eligibility requirement (${job.eligibilityMinPercent}%) for this job.`
          );
        }
      }
    }

    if (existing) {
      if (data.status) existing.status = data.status;
      if (data.notes !== undefined) existing.notes = data.notes;
      if (data.matchScore !== undefined) existing.matchScore = data.matchScore;
      if (resumeObjectId && !existing.resumeId) existing.resumeId = resumeObjectId;
      await existing.save();

      const populatedExisting = await ApplicationModel.findById(existing._id)
        .populate({
          path: 'jobId',
          select:
            'title company location salary experienceLevel minimumExperience maximumExperience employmentType workplaceType skills responsibilities requirements preferredQualifications educationRequirements benefits applicationUrl status description publishedAt',
        })
        .populate({
          path: 'resumeId',
          select: 'title templateId content settings atsScore createdAt updatedAt',
        })
        .populate({
          path: 'coverLetterId',
          select: 'title',
        })
        .lean();

      return {
        _id: String(existing._id),
        job: (populatedExisting as any)?.jobId || null,
        resume: (populatedExisting as any)?.resumeId || null,
        coverLetter: (populatedExisting as any)?.coverLetterId || null,
        source: (populatedExisting as any)?.source || existing.source,
        status: (populatedExisting as any)?.status || existing.status,
        matchScore: (populatedExisting as any)?.matchScore || existing.matchScore || 0,
        poolType: (populatedExisting as any)?.poolType || existing.poolType,
        currentStageId: (populatedExisting as any)?.currentStageId || existing.currentStageId,
        currentStageIndex: (populatedExisting as any)?.currentStageIndex || existing.currentStageIndex,
        stageStatus: (populatedExisting as any)?.stageStatus || existing.stageStatus,
        stageDeadline: (populatedExisting as any)?.stageDeadline || existing.stageDeadline,
        notes: (populatedExisting as any)?.notes || existing.notes || '',
        appliedAt: (populatedExisting as any)?.appliedAt || existing.appliedAt,
        createdAt: (populatedExisting as any)?.createdAt || existing.createdAt,
      };
    }

    // Check if the job has Hiring Engine enabled
    const jobDoc = await JobModel.findById(jobObjectId).lean();
    let initialPoolType: 'primary' | 'reserve' | undefined;
    let initialStageId: string | undefined;
    let initialStageIndex: number | undefined;
    let initialStageStatus: 'invited' | 'pending' | undefined;
    let initialStageDeadline: Date | undefined;
    let computedMatchScore = data.matchScore || 78;

    const isCollectionPhase =
      jobDoc?.applicationCollection &&
      ['collecting', 'ready', 'extended', 'insufficient'].includes(jobDoc.applicationCollection.status);

    if (jobDoc?.hiringEngineEnabled) {
      try {
        // Calculate composite score using candidate profile + job skills
        computedMatchScore = await HiringPoolManager.computeOrGetCompositeScore(
          { userId: userObjectId, matchScore: data.matchScore } as any,
          jobDoc.skills || [],
          jobDoc.embedding
        );

        if (isCollectionPhase) {
          // During candidate collection phase, candidates are not partitioned into primary/reserve yet
          initialPoolType = undefined;
          initialStageStatus = undefined;
          initialStageId = undefined;
          initialStageIndex = undefined;
          initialStageDeadline = undefined;
        } else {
          // Post-pipeline start or direct pipeline:
          const config = await HiringFunnelConfigModel.findOne({ jobId: jobObjectId });
          if (config && config.stages && config.stages.length > 0 && config.status === 'active') {
            const stage1 = config.stages[0];
            initialStageId = stage1.stageId;
            initialStageIndex = stage1.order;

            if (jobDoc.applicationCollection?.status === 'started') {
              // Section 15: Candidates arriving after pipeline start enter Reserve pool directly
              initialPoolType = 'reserve';
              initialStageStatus = undefined;
              initialStageDeadline = undefined;
            } else {
              // Legacy direct-pipeline fallback
              const activePrimaryCount = await ApplicationModel.countDocuments({
                jobId: jobObjectId,
                currentStageId: stage1.stageId,
                poolType: 'primary',
                stageStatus: { $in: ['invited', 'started', 'passed'] },
              });

              if (activePrimaryCount < stage1.targetCount) {
                initialPoolType = 'primary';
                initialStageStatus = 'invited';
                const deadlineHours = stage1.deadlineHours || 48;
                initialStageDeadline = new Date(Date.now() + deadlineHours * 3600 * 1000);
              } else {
                initialPoolType = 'reserve';
                initialStageStatus = undefined;
              }
            }
          }
        }
      } catch (err) {
        console.error('[ApplicationService] Error in post-publish pipeline evaluation:', err);
      }
    }

    const newApp = await ApplicationModel.create({
      userId: userObjectId,
      jobId: jobObjectId,
      resumeId: resumeObjectId,
      coverLetterId: data.coverLetterId && mongoose.Types.ObjectId.isValid(data.coverLetterId)
        ? new mongoose.Types.ObjectId(data.coverLetterId)
        : undefined,
      source: data.source || 'manual',
      status: data.status || 'submitted',
      matchScore: computedMatchScore,
      compositeRank: computedMatchScore,
      poolType: initialPoolType,
      currentStageId: initialStageId,
      currentStageIndex: initialStageIndex,
      stageStatus: initialStageStatus,
      stageDeadline: initialStageDeadline,
      invitedAt: initialPoolType === 'primary' ? new Date() : undefined,
      notes: data.notes || '',
      appliedAt: new Date(),
    });

    appLogger.info(
      {
        applicationId: newApp._id,
        userId,
        jobId: data.jobId,
        matchScore: computedMatchScore,
        poolType: initialPoolType,
        stageId: initialStageId,
        event: 'application_created',
      },
      `[ApplicationService] Application created: App ${newApp._id} for User ${userId} on Job ${data.jobId} (Score: ${computedMatchScore}, Pool: ${initialPoolType || 'collection'})`
    );

    // Trigger AI Resume Evaluation scorecard
    try {
      const { resumeScreeningService } = await import('../resumeScreening/resumeScreening.service.js');
      await resumeScreeningService.evaluateApplicationResume(newApp._id);
    } catch (evalErr) {
      console.warn('[ApplicationService] AI Resume Evaluation error on apply:', evalErr);
    }

    // If job is in collection phase, trigger readiness evaluation (auto-starts if autoStartEnabled & min reached)
    if (isCollectionPhase) {
      try {
        await ApplicationCollectionService.evaluateCollectionReadiness(jobObjectId);
      } catch (err) {
        console.error('[ApplicationService] Error evaluating collection readiness:', err);
      }
    }

    if (initialPoolType === 'primary' && initialStageId) {
      try {
        await HiringEngineService.recordStageHistory({
          applicationId: newApp._id,
          jobId: jobObjectId,
          candidateId: userObjectId,
          stageId: initialStageId,
          stageName: 'Initial Screening',
          stageIndex: initialStageIndex || 1,
          status: 'invited',
          score: computedMatchScore,
          promotedFromReserve: false,
          notes: 'Post-publish application admitted to primary pool',
        });

        const deadlineHours = initialStageDeadline
          ? Math.max(1, Math.round((initialStageDeadline.getTime() - Date.now()) / (3600 * 1000)))
          : 48;

        await scheduleCandidateDeadlineCheck(
          String(jobObjectId),
          String(newApp._id),
          initialStageId,
          deadlineHours
        );

        HiringNotificationHook.notifyCandidateInvited({
          candidateId: String(userObjectId),
          applicationId: String(newApp._id),
          jobId: String(jobObjectId),
          jobTitle: jobDoc?.title || 'Job Role',
          stageId: initialStageId,
          stageName: 'Initial Screening',
          deadlineHours,
          stageDeadline: initialStageDeadline,
        });
      } catch (err) {
        console.error('[ApplicationService] Error scheduling primary applicant workflow:', err);
      }
    } else if (initialPoolType === 'reserve' && initialStageId) {
      try {
        await HiringEngineService.recordStageHistory({
          applicationId: newApp._id,
          jobId: jobObjectId,
          candidateId: userObjectId,
          stageId: initialStageId,
          stageName: 'Initial Screening',
          stageIndex: initialStageIndex || 1,
          status: 'invited',
          score: computedMatchScore,
          promotedFromReserve: false,
          notes: 'Stage 1 primary pool at target capacity; application admitted to reserve pool',
        });
      } catch (err) {
        console.error('[ApplicationService] Error recording reserve stage history:', err);
      }
    }

    const populated = await ApplicationModel.findById(newApp._id)
      .populate({
        path: 'jobId',
        select:
          'title company location salary experienceLevel minimumExperience maximumExperience employmentType workplaceType skills responsibilities requirements preferredQualifications educationRequirements benefits applicationUrl status description publishedAt',
      })
      .populate({
        path: 'resumeId',
        select: 'title templateId content settings atsScore createdAt updatedAt',
      })
      .populate({
        path: 'coverLetterId',
        select: 'title',
      })
      .lean();

    return {
      _id: String((populated || newApp)._id),
      job: (populated as any)?.jobId || null,
      resume: (populated as any)?.resumeId || null,
      coverLetter: (populated as any)?.coverLetterId || null,
      source: (populated as any)?.source || data.source || 'manual',
      status: (populated as any)?.status || data.status || 'submitted',
      matchScore: (populated as any)?.matchScore || data.matchScore || 78,
      poolType: (populated as any)?.poolType || newApp.poolType,
      currentStageId: (populated as any)?.currentStageId || newApp.currentStageId,
      currentStageIndex: (populated as any)?.currentStageIndex || newApp.currentStageIndex,
      stageStatus: (populated as any)?.stageStatus || newApp.stageStatus,
      stageDeadline: (populated as any)?.stageDeadline || newApp.stageDeadline,
      notes: (populated as any)?.notes || data.notes || '',
      appliedAt: (populated as any)?.appliedAt || new Date(),
      createdAt: (populated as any)?.createdAt || new Date(),
    };
  }

  /**
   * Deletes / withdraws an application record.
   */
  async deleteApplication(userId: string, applicationId: string) {
    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
      throw AppError.badRequest('Invalid application ID');
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const appObjectId = new mongoose.Types.ObjectId(applicationId);

    const deleted = await ApplicationModel.findOneAndDelete({
      _id: appObjectId,
      userId: userObjectId,
    });

    if (!deleted) {
      throw AppError.notFound('Application not found');
    }

    return { success: true };
  }

  // --- Recruiter-facing applicant pipeline ---

  /**
   * Lists applicants for a job, ownership-checked against the job's postedBy field.
   */
  async getApplicantsForJob(recruiterUserId: string, jobId: string) {
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw AppError.badRequest('Invalid job ID');
    }

    const job = await JobModel.findOne({ _id: jobId, postedBy: recruiterUserId }).lean();
    if (!job) {
      throw AppError.notFound('Job not found or access denied');
    }

    const applications = await ApplicationModel.find({ jobId })
      .populate({ path: 'userId', select: 'fullName username email phone avatarUrl avatar' })
      .populate({ path: 'resumeId', select: 'title templateId content settings atsScore createdAt updatedAt' })
      .sort({ appliedAt: -1 })
      .lean();

    return applications.map((app: any) => ({
      _id: String(app._id),
      candidate: app.userId || null,
      resume: app.resumeId || null,
      status: app.status,
      matchScore: app.matchScore || 0,
      assessmentScore: app.assessmentScore,
      aiScore: app.aiScore,
      notes: app.notes || '',
      appliedAt: app.appliedAt,
    }));
  }

  /**
   * Lists every applicant across every job posted by the recruiter.
   */
  async getAllApplicantsForRecruiter(recruiterUserId: string) {
    const jobs = await JobModel.find({ postedBy: recruiterUserId }).select('title').lean();
    if (jobs.length === 0) return [];

    const jobIds = jobs.map((j) => j._id);
    const jobTitleById = new Map(jobs.map((j) => [String(j._id), j.title]));

    const applications = await ApplicationModel.find({ jobId: { $in: jobIds } })
      .populate({ path: 'userId', select: 'fullName username email phone avatarUrl avatar' })
      .populate({ path: 'resumeId', select: 'title templateId content settings atsScore createdAt updatedAt' })
      .sort({ appliedAt: -1 })
      .lean();

    return applications.map((app: any) => ({
      _id: String(app._id),
      jobId: String(app.jobId),
      jobTitle: jobTitleById.get(String(app.jobId)) || 'Job',
      candidate: app.userId || null,
      resume: app.resumeId || null,
      status: app.status,
      matchScore: app.matchScore || 0,
      assessmentScore: app.assessmentScore,
      aiScore: app.aiScore,
      appliedAt: app.appliedAt,
    }));
  }

  /**
   * Updates an applicant's pipeline status/notes for a job the recruiter owns.
   */
  async updateApplicantStatus(
    recruiterUserId: string,
    applicationId: string,
    status: ApplicationStatus,
    notes?: string
  ) {
    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
      throw AppError.badRequest('Invalid application ID');
    }

    const application = await ApplicationModel.findById(applicationId);
    if (!application) {
      throw AppError.notFound('Application not found');
    }

    const job = await JobModel.findOne({ _id: application.jobId, postedBy: recruiterUserId }).lean();
    if (!job) {
      throw AppError.forbidden('You do not have access to this application');
    }

    application.status = status;
    if (notes !== undefined) application.notes = notes;
    await application.save();

    // Bidirectional sync: If job has Hiring Engine enabled and applicant is rejected or failed, disqualify & refill
    if (job?.hiringEngineEnabled && (status === 'rejected' || (status as string) === 'failed')) {
      try {
        if (application.poolType === 'primary') {
          await HiringEngineService.failCandidate(
            String(job._id),
            String(application._id),
            recruiterUserId,
            notes || 'Applicant rejected by recruiter in ATS'
          );
        }
      } catch (engineErr) {
        console.warn('[ApplicationService] Hiring engine status sync notice:', engineErr);
      }
    }

    return application;
  }

  /**
   * Retrieves candidate tracking details for a specific application:
   * application status, job's configured dynamic stages, and chronological stage milestones.
   */
  async getApplicationTracking(userId: string, applicationId: string) {
    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
      throw AppError.badRequest('Invalid application ID format');
    }

    const application = await ApplicationModel.findById(applicationId)
      .populate({
        path: 'jobId',
        select:
          'title company location salary experienceLevel minimumExperience maximumExperience employmentType workplaceType skills responsibilities requirements preferredQualifications educationRequirements benefits applicationUrl status publishedAt',
      })
      .populate({
        path: 'resumeId',
        select: 'title atsScore createdAt',
      })
      .lean();

    if (!application) {
      throw AppError.notFound('Application not found');
    }

    if (String(application.userId) !== String(userId)) {
      throw AppError.forbidden('You do not have permission to view this application');
    }

    // Load job's dynamic funnel configuration
    const funnelConfig = await HiringFunnelConfigModel.findOne({
      jobId: (application.jobId as any)?._id || application.jobId,
    }).lean();

    // Map dynamic stages (only candidate-relevant info, excluding recruiter internal formulas)
    const funnelStages = (funnelConfig?.stages || []).map((s: any) => ({
      stageId: s.stageId,
      stageName: s.stageName,
      stageType: s.stageType,
      order: s.order,
      deadlineHours: s.deadlineHours,
    }));

    // Load candidate stage history (sanitized, chronological)
    const historyDocs = await CandidateStageHistoryModel.find({
      applicationId: application._id,
      candidateId: new mongoose.Types.ObjectId(userId),
    })
      .sort({ enteredAt: 1 })
      .lean();

    const stageHistory = historyDocs.map((h: any) => ({
      stageId: h.stageId,
      stageName: h.stageName,
      stageIndex: h.stageIndex,
      status: h.status,
      enteredAt: h.enteredAt,
      completedAt: h.completedAt,
      promotedFromReserve: h.promotedFromReserve,
    }));

    return {
      application: {
        _id: String(application._id),
        job: application.jobId,
        resume: application.resumeId,
        status: application.status,
        appliedAt: application.appliedAt,
        resumeScreeningStatus: application.resumeScreeningStatus || 'pending',
        resumeDecision: application.resumeDecision || 'pending',
        poolType: application.poolType,
        currentStageIndex: application.currentStageIndex,
        currentStageId: application.currentStageId,
        stageStatus: application.stageStatus,
        stageDeadline: application.stageDeadline,
        invitedAt: application.invitedAt,
        stageStartedAt: application.stageStartedAt,
        stageCompletedAt: application.stageCompletedAt,
        finalShortlistDecision: application.finalShortlistDecision,
        offeredAt: application.offeredAt,
        hiredAt: application.hiredAt,
      },
      funnelStages,
      stageHistory,
    };
  }

  /**
   * Retrieves proctored assessment questions and metadata for a specific stage of an application.
   * Strips correct answers and internal rubrics before sending to candidate.
   */
  async getStageTest(userId: string, applicationId: string, stageId?: string) {
    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
      throw AppError.badRequest('Invalid application ID format');
    }

    const application = await ApplicationModel.findById(applicationId)
      .populate('jobId', 'title company location requirements skills assessment')
      .lean();

    if (!application) {
      throw AppError.notFound('Application not found');
    }

    if (String(application.userId) !== String(userId)) {
      throw AppError.forbidden('You do not have permission to access this application stage test');
    }

    const job = application.jobId as any;
    const jobId = job?._id || application.jobId;

    const funnelConfig = await HiringFunnelConfigModel.findOne({ jobId }).lean();
    if (!funnelConfig || !funnelConfig.stages || funnelConfig.stages.length === 0) {
      throw AppError.badRequest('No hiring stages configured for this job.');
    }

    // Determine target stage
    let stage = funnelConfig.stages.find((s: any) => s.stageId === stageId);
    if (!stage) {
      stage = funnelConfig.stages.find((s: any) => s.stageId === application.currentStageId);
    }
    if (!stage) {
      stage = funnelConfig.stages.find((s: any) => s.order === (application.currentStageIndex || 1));
    }
    if (!stage) {
      stage = funnelConfig.stages.find((s: any) => s.stageType === 'assessment') || funnelConfig.stages[0];
    }

    const roundId = stage.stageId;

    // 1. Check for questions in AssessmentQuestionModel
    let questions = await AssessmentQuestionModel.find({
      jobId,
      roundId,
      status: { $ne: 'archived' },
    })
      .sort({ order: 1 })
      .lean();

    // 2. Check stage.config.customQuestions or job.assessment.rounds
    if (!questions || questions.length === 0) {
      let customQuestions =
        (stage.config as any)?.customQuestions ||
        job?.assessment?.rounds?.find((r: any) => r.id === roundId)?.config?.customQuestions;

      if (!customQuestions || customQuestions.length === 0) {
        const topics =
          (stage.config as any)?.topics ||
          job?.assessment?.rounds?.find((r: any) => r.id === roundId)?.config?.topics;
        if (Array.isArray(topics) && topics.length > 0) {
          customQuestions = topics.map((t: string, idx: number) => ({
            id: `topic_${idx + 1}`,
            order: idx + 1,
            type: 'descriptive',
            section: 'ai_interview',
            question: t,
            points: 10,
            instructions: `AI Conversational Interview Question: ${t}`,
            sampleAnswer: `The AI evaluates the candidate's conversational response based on depth, technical accuracy, and role requirements.`,
            evaluationRubric: 'Concept Clarity: 25%, Technical Depth: 35%, Problem Solving: 25%, Communication: 15%',
          }));
        }
      }

      if (Array.isArray(customQuestions) && customQuestions.length > 0) {
        const toInsert = customQuestions.map((cq: any, idx: number) => ({
          jobId,
          roundId,
          type: (cq.type === 'coding' ? 'short_answer' : cq.type || 'mcq') as any,
          section: cq.section,
          timeLimitSeconds: cq.timeLimitSeconds,
          order: idx + 1,
          question: cq.question || cq.text || `Question ${idx + 1}`,
          instructions: cq.instructions || '',
          points: cq.points || 10,
          status: 'published' as const,
          source: 'manual' as const,
          options: cq.options || [],
          correctOptionId: cq.correctOptionId,
          sampleAnswer: cq.sampleAnswer,
          evaluationRubric: cq.evaluationRubric,
          expectedAnswer: cq.expectedAnswer || cq.sampleAnswer,
          evaluationCriteria: cq.evaluationCriteria || [],
        }));

        try {
          const inserted = await AssessmentQuestionModel.insertMany(toInsert);
          questions = inserted.map((q) => q.toObject() as any);
        } catch {
          questions = toInsert as any;
        }
      }
    }

    // 3. Fallback standard questions for this assessment type if still empty
    if (!questions || questions.length === 0) {
      const fallbackQuestions = this.generateFallbackStageQuestions(
        stage.assessmentType || 'general_aptitude',
        job?.title || 'Candidate Role',
        job?.skills || []
      );

      const toInsert = fallbackQuestions.map((fq, idx) => ({
        jobId,
        roundId,
        type: 'mcq' as const,
        order: idx + 1,
        question: fq.question,
        instructions: fq.instructions || 'Select the best option from the choices below.',
        points: fq.points || 1,
        status: 'published' as const,
        source: 'ai_generated' as const,
        options: fq.options,
        correctOptionId: fq.correctOptionId,
      }));

      try {
        const inserted = await AssessmentQuestionModel.insertMany(toInsert);
        questions = inserted.map((q) => q.toObject() as any);
      } catch {
        questions = toInsert as any;
      }
    }

    const targetQuestionCount =
      stage.questionCount ||
      (stage.config as any)?.questionCount ||
      (stage.config as any)?.totalQuestions;

    let testQuestionsPool = questions;
    if (targetQuestionCount && targetQuestionCount > 0 && questions.length > targetQuestionCount) {
      // Seeded deterministic shuffle per candidate: if bank has 100 questions and stage needs 30,
      // candidate gets a unique random 30 questions from the pool. Re-opening/refreshing is stable.
      const seedStr = String(application._id);
      let seed = 0;
      for (let i = 0; i < seedStr.length; i++) {
        seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
      }
      const shuffled = [...questions];
      for (let i = shuffled.length - 1; i > 0; i--) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const j = Math.floor((seed / 4294967296) * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      testQuestionsPool = shuffled.slice(0, targetQuestionCount);
    }

    // Safe questions stripped of answer keys and rubric evaluations
    const candidateQuestions = testQuestionsPool.map((q: any, idx: number) => ({
      id: q._id ? String(q._id) : (q.id || `q_${idx + 1}`),
      order: q.order || idx + 1,
      type: q.type || 'mcq',
      section: q.section,
      timeLimitSeconds: q.timeLimitSeconds,
      question: q.question,
      instructions: q.instructions || '',
      points: q.points || 10,
      options: (q.options || []).map((opt: any) => ({
        id: opt.id,
        text: opt.text,
      })),
      context: q.context || '',
    }));

    const durationMinutes =
      stage.durationMinutes ||
      ((stage.schedule as any)?.durationHours ? Number((stage.schedule as any).durationHours) * 60 : 30);
    const passingScore = stage.passingScore || stage.autoAdvanceScoreThreshold || 70;

    return {
      applicationId: String(application._id),
      job: {
        _id: String(jobId),
        title: job?.title || 'Open Position',
        company: job?.company || { name: 'Recruiting Company' },
      },
      stage: {
        stageId: stage.stageId,
        stageName: stage.stageName,
        stageType: stage.stageType,
        assessmentType: stage.assessmentType,
        durationMinutes,
        passingScore,
        totalQuestions: candidateQuestions.length,
        schedule: stage.schedule,
        config: stage.config,
        instructions:
          'Proctored Assessment: Maintain active fullscreen, do not switch tabs or windows, and submit before the timer expires.',
      },
      questions: candidateQuestions,
    };
  }

  /**
   * Submits a proctored stage attempt, grades the answers, updates stage history,
   * and automatically advances or disqualifies the candidate in the hiring funnel.
   */
  async submitStageAttempt(
    userId: string,
    applicationId: string,
    payload: {
      stageId: string;
      answers: Record<string, string>;
      timeSpentSeconds?: number;
      tabSwitchCount?: number;
    }
  ) {
    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
      throw AppError.badRequest('Invalid application ID format');
    }

    const application = await ApplicationModel.findById(applicationId)
      .populate('userId', 'name email')
      .populate('jobId', 'title company')
      .exec();

    if (!application) {
      throw AppError.notFound('Application not found');
    }

    const appCandidateId = String((application.userId as any)?._id || application.userId);
    if (appCandidateId !== String(userId)) {
      throw AppError.forbidden('You do not have permission to submit this stage attempt');
    }

    const job = application.jobId as any;
    const jobId = String(job?._id || application.jobId);

    const funnelConfig = await HiringFunnelConfigModel.findOne({ jobId }).lean();
    if (!funnelConfig || !funnelConfig.stages) {
      throw AppError.badRequest('Hiring funnel configuration missing for this job.');
    }

    const stage =
      funnelConfig.stages.find((s: any) => s.stageId === payload.stageId) ||
      funnelConfig.stages.find((s: any) => s.order === (application.currentStageIndex || 1)) ||
      funnelConfig.stages[0];

    // Load full questions with answer keys
    let questions = await AssessmentQuestionModel.find({
      jobId,
      roundId: stage.stageId,
    }).lean();

    if (!questions || questions.length === 0) {
      const customQ = (stage.config as any)?.customQuestions;
      if (Array.isArray(customQ) && customQ.length > 0) {
        questions = customQ as any;
      } else {
        const topics = (stage.config as any)?.topics;
        if (Array.isArray(topics) && topics.length > 0) {
          questions = topics.map((t: string, idx: number) => ({
            id: `topic_${idx + 1}`,
            order: idx + 1,
            type: 'descriptive',
            section: 'ai_interview',
            question: t,
            points: 10,
            instructions: `AI Conversational Interview Question: ${t}`,
            sampleAnswer: `Detailed technical response covering architecture, tradeoffs, and edge cases.`,
            evaluationRubric: 'Concept Clarity: 25%, Technical Depth: 35%, Problem Solving: 25%, Communication: 15%',
          })) as any;
        }
      }
    }

    const targetQuestionCount =
      stage.questionCount ||
      (stage.config as any)?.questionCount ||
      (stage.config as any)?.totalQuestions;

    if (targetQuestionCount && targetQuestionCount > 0 && questions.length > targetQuestionCount) {
      const seedStr = String(application._id);
      let seed = 0;
      for (let i = 0; i < seedStr.length; i++) {
        seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
      }
      const shuffled = [...questions];
      for (let i = shuffled.length - 1; i > 0; i--) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const j = Math.floor((seed / 4294967296) * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      questions = shuffled.slice(0, targetQuestionCount);
    }

    let totalScore = 0;
    let maxScore = 0;
    const answerBreakdown: Array<{
      questionId: string;
      question: string;
      candidateAnswer: string;
      correctAnswer?: string;
      isCorrect: boolean;
      points: number;
    }> = [];

    const answers = payload.answers || {};

    if (questions && questions.length > 0) {
      // Evaluate descriptive questions asynchronously in parallel if any exist
      const descriptiveEvaluations = await Promise.all(
        questions.map(async (q: any, idx: number) => {
          const isDesc = q.type === 'descriptive' || q.type === 'short_answer';
          if (!isDesc) return null;

          const qKey = q._id ? String(q._id) : (q.id || `q_${idx + 1}`);
          const candidateAns = (answers[qKey] || answers[q.id] || answers[String(q._id)] || '').trim();
          const pts = Number(q.points) || 10;
          return this.evaluateDescriptiveAnswer(
            q.question,
            candidateAns,
            q.sampleAnswer || q.expectedAnswer,
            q.evaluationRubric || (Array.isArray(q.evaluationCriteria) ? q.evaluationCriteria.join(', ') : ''),
            pts
          );
        })
      );

      questions.forEach((q: any, idx: number) => {
        const qKey = q._id ? String(q._id) : (q.id || `q_${idx + 1}`);
        const candidateAns = (answers[qKey] || answers[q.id] || answers[String(q._id)] || '').trim();
        const pts = Number(q.points) || 1;
        maxScore += pts;

        let isCorrect = false;
        let earnedPoints = 0;
        let evaluatorFeedback = '';

        if (q.type === 'mcq' || q.type === 'rapid' || (Array.isArray(q.options) && q.options.length >= 2 && q.correctOptionId)) {
          isCorrect =
            Boolean(q.correctOptionId) &&
            candidateAns.toLowerCase() === String(q.correctOptionId).trim().toLowerCase();
          earnedPoints = isCorrect ? pts : 0;
          evaluatorFeedback = isCorrect ? 'Correct option selected.' : `Incorrect. Correct option was ${q.correctOptionId}.`;
        } else {
          // Descriptive / short answer evaluation
          const evalRes = descriptiveEvaluations[idx];
          if (evalRes) {
            earnedPoints = evalRes.earnedPoints;
            isCorrect = evalRes.isCorrect;
            evaluatorFeedback = evalRes.feedback;
          } else {
            isCorrect = candidateAns.length >= 20;
            earnedPoints = isCorrect ? pts : 0;
          }
        }

        totalScore += earnedPoints;

        answerBreakdown.push({
          questionId: qKey,
          question: q.question,
          candidateAnswer: candidateAns,
          correctAnswer: q.correctOptionId || q.sampleAnswer || q.expectedAnswer,
          isCorrect,
          points: earnedPoints,
          feedback: evaluatorFeedback,
        } as any);
      });
    } else {
      totalScore = 80;
      maxScore = 100;
    }

    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 100;
    const passingScore = stage.passingScore || stage.autoAdvanceScoreThreshold || 70;
    const tabSwitchInfractions = Number(payload.tabSwitchCount || 0);
    const proctorDisqualified = tabSwitchInfractions >= 4;

    const passed = percentage >= passingScore && !proctorDisqualified;

    let advanceResult: { nextStageId: string | null; isFinalShortlist: boolean } | null = null;

    if (passed) {
      try {
        advanceResult = await HiringEngineService.advanceCandidate(jobId, String(application._id), 'system', {
          score: percentage,
          notes: `Passed ${stage.stageName} with ${percentage}% (Passing mark: ${passingScore}%). Proctoring passed with ${tabSwitchInfractions} tab-switch warnings.`,
          evaluationDetails: {
            totalScore,
            maxScore,
            percentage,
            passingScore,
            tabSwitchCount: tabSwitchInfractions,
            timeSpentSeconds: payload.timeSpentSeconds || 0,
          },
        });
      } catch (err: any) {
        appLogger.warn('HiringEngineService.advanceCandidate note:', err?.message);
      }
    } else {
      try {
        const failReason = proctorDisqualified
          ? `Candidate disqualified due to excessive proctoring tab switches (${tabSwitchInfractions} warnings).`
          : `Candidate scored ${percentage}%, below passing threshold of ${passingScore}% in ${stage.stageName}.`;

        await HiringEngineService.failCandidate(jobId, String(application._id), 'system', failReason);
      } catch (err: any) {
        appLogger.warn('HiringEngineService.failCandidate note:', err?.message);
      }
    }

    // Record assessment attempt audit document
    try {
      await AssessmentAttemptModel.create({
        attemptId: `att_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        assessmentId: new mongoose.Types.ObjectId(),
        candidateId: (application.userId as any)?._id || application.userId,
        candidateName: (application.userId as any)?.name || 'Candidate',
        candidateEmail: (application.userId as any)?.email || 'candidate@example.com',
        status: 'evaluated',
        startedAt: new Date(Date.now() - (payload.timeSpentSeconds || 60) * 1000),
        submittedAt: new Date(),
        timeSpentSeconds: payload.timeSpentSeconds || 0,
        timeLimitMinutes: stage.durationMinutes || 45,
        answers: answerBreakdown.map((ab) => ({
          questionId: ab.questionId,
          answer: ab.candidateAnswer,
          isCorrect: ab.isCorrect,
          score: ab.points,
          autoSavedAt: new Date(),
        })),
        evaluation: {
          totalScore,
          maxScore,
          percentage,
          passed,
          verdict: passed ? (percentage >= 85 ? 'strong_hire' : 'hire') : 'reject',
          summary: passed
            ? `Candidate completed ${stage.stageName} and passed with a score of ${percentage}%.`
            : `Candidate completed ${stage.stageName} but did not achieve the required ${passingScore}%.`,
          skillBreakdown: [],
          modeBreakdown: [],
          strengths: passed ? ['Strong performance in assessment competencies'] : [],
          gaps: !passed ? ['Below passing score threshold'] : [],
          recommendations: passed ? 'Advanced to next stage in pipeline.' : 'Application closed.',
          evaluatedAt: new Date(),
        },
      });
    } catch (attErr: any) {
      appLogger.warn('AssessmentAttemptModel creation note:', attErr?.message);
    }

    return {
      passed,
      totalScore,
      maxScore,
      percentage,
      passingScore,
      tabSwitchCount: tabSwitchInfractions,
      proctorDisqualified,
      verdict: passed ? 'Passed & Advanced' : 'Did Not Qualify',
      message: passed
        ? `Congratulations! You scored ${percentage}% and have qualified for the next stage.`
        : proctorDisqualified
        ? `Assessment disqualified due to multiple proctoring infractions (${tabSwitchInfractions} tab switches).`
        : `You scored ${percentage}%, which did not meet the passing threshold of ${passingScore}%.`,
      nextStageId: advanceResult?.nextStageId || null,
      isFinalShortlist: advanceResult?.isFinalShortlist || false,
    };
  }

  /**
   * Generates curated, high-acuity fallback questions based on round type and job skills.
   */
  private generateFallbackStageQuestions(
    assessmentType: string,
    jobTitle: string,
    skills: string[]
  ): Array<{
    question: string;
    instructions?: string;
    points: number;
    options: Array<{ id: string; text: string }>;
    correctOptionId: string;
  }> {
    const skillList = Array.isArray(skills) && skills.length > 0 ? skills.slice(0, 3).join(', ') : 'Software Engineering';

    if (assessmentType === 'general_aptitude') {
      return [
        {
          question: 'If 6 workers can complete a job in 8 days, how many days will 4 workers take to complete the same job, assuming identical working speed?',
          instructions: 'Quantitative Aptitude — Time & Work',
          points: 10,
          options: [
            { id: 'opt_a', text: '10 days' },
            { id: 'opt_b', text: '12 days' },
            { id: 'opt_c', text: '14 days' },
            { id: 'opt_d', text: '16 days' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'Look at this series: 7, 10, 8, 11, 9, 12, ... What number should come next?',
          instructions: 'Logical Reasoning — Sequence Induction',
          points: 10,
          options: [
            { id: 'opt_a', text: '10' },
            { id: 'opt_b', text: '12' },
            { id: 'opt_c', text: '13' },
            { id: 'opt_d', text: '14' },
          ],
          correctOptionId: 'opt_a',
        },
        {
          question: 'A merchant marks an item 40% above the cost price and gives a discount of 25%. What is the net profit percentage?',
          instructions: 'Quantitative Aptitude — Profit & Loss',
          points: 10,
          options: [
            { id: 'opt_a', text: '5%' },
            { id: 'opt_b', text: '10%' },
            { id: 'opt_c', text: '12%' },
            { id: 'opt_d', text: '15%' },
          ],
          correctOptionId: 'opt_a',
        },
        {
          question: 'Statements: (1) All birds have wings. (2) Some winged creatures can swim. Conclusions: Which deduction is strictly valid?',
          instructions: 'Logical Reasoning — Syllogisms',
          points: 10,
          options: [
            { id: 'opt_a', text: 'All birds can swim' },
            { id: 'opt_b', text: 'Some creatures that can swim have wings' },
            { id: 'opt_c', text: 'No birds can swim' },
            { id: 'opt_d', text: 'All creatures that swim are birds' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'In an election or ranking model, Candidate X scored higher than Candidate Y, but lower than Candidate Z. Candidate W scored higher than Z. Who had the highest score?',
          instructions: 'Logical Ordering & Transitive Relations',
          points: 1,
          options: [
            { id: 'opt_a', text: 'Candidate X' },
            { id: 'opt_b', text: 'Candidate Y' },
            { id: 'opt_c', text: 'Candidate Z' },
            { id: 'opt_d', text: 'Candidate W' },
          ],
          correctOptionId: 'opt_d',
        },
      ];
    }

    if (assessmentType === 'technical_test' || assessmentType === 'technical') {
      return [
        {
          question: `In modern scalable systems employing ${skillList}, what is the time complexity of searching for an item in a balanced binary search tree (AVL / Red-Black Tree)?`,
          instructions: 'Data Structures & Algorithmic Complexity',
          points: 1,
          options: [
            { id: 'opt_a', text: 'O(1)' },
            { id: 'opt_b', text: 'O(log n)' },
            { id: 'opt_c', text: 'O(n)' },
            { id: 'opt_d', text: 'O(n log n)' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'Which design pattern is best suited for decoupling an abstraction from its implementation so that the two can vary independently?',
          instructions: 'Design Patterns & Architecture',
          points: 1,
          options: [
            { id: 'opt_a', text: 'Bridge Pattern' },
            { id: 'opt_b', text: 'Adapter Pattern' },
            { id: 'opt_c', text: 'Decorator Pattern' },
            { id: 'opt_d', text: 'Facade Pattern' },
          ],
          correctOptionId: 'opt_a',
        },
        {
          question: 'What is the primary benefit of using idempotency keys in payment and critical mutation API endpoints?',
          instructions: 'API Design & Fault Tolerance',
          points: 1,
          options: [
            { id: 'opt_a', text: 'To encrypt sensitive request payloads at rest' },
            { id: 'opt_b', text: 'To prevent duplicate state mutations during network retries and transient failures' },
            { id: 'opt_c', text: 'To accelerate client-side DNS resolution' },
            { id: 'opt_d', text: 'To bypass rate-limiting constraints in upstream gateways' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'Under high write concurrency, which database isolation level prevents dirty reads, non-repeatable reads, and phantom reads?',
          instructions: 'Database Concurrency & ACID Guarantees',
          points: 1,
          options: [
            { id: 'opt_a', text: 'Read Committed' },
            { id: 'opt_b', text: 'Read Uncommitted' },
            { id: 'opt_c', text: 'Repeatable Read' },
            { id: 'opt_d', text: 'Serializable' },
          ],
          correctOptionId: 'opt_d',
        },
        {
          question: 'When implementing asynchronous event processing, what is the purpose of a Dead Letter Queue (DLQ)?',
          instructions: 'Event-Driven Architecture',
          points: 1,
          options: [
            { id: 'opt_a', text: 'To buffer high-priority real-time user traffic' },
            { id: 'opt_b', text: 'To isolate and store poison messages that persistently fail execution after maximum retry attempts' },
            { id: 'opt_c', text: 'To optimize garbage collection cycles in message brokers' },
            { id: 'opt_d', text: 'To compress archival audit logs' },
          ],
          correctOptionId: 'opt_b',
        },
      ];
    }

    if (assessmentType === 'rapid_round') {
      return [
        {
          question: 'Rapid Fire: What HTTP status code corresponds to "429"?',
          instructions: '60-second Response Round',
          points: 1,
          options: [
            { id: 'opt_a', text: 'Forbidden' },
            { id: 'opt_b', text: 'Conflict' },
            { id: 'opt_c', text: 'Too Many Requests' },
            { id: 'opt_d', text: 'Unprocessable Entity' },
          ],
          correctOptionId: 'opt_c',
        },
        {
          question: 'Rapid Fire: In JavaScript event loop architecture, where do microtasks (Promises) execute relative to macrotasks (setTimeout)?',
          instructions: '60-second Response Round',
          points: 1,
          options: [
            { id: 'opt_a', text: 'After the entire next event loop tick' },
            { id: 'opt_b', text: 'Immediately after the current execution context before rendering and next macrotask' },
            { id: 'opt_c', text: 'In parallel using Web Worker threads' },
            { id: 'opt_d', text: 'Only when the browser window is idle' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'Rapid Fire: Which sorting algorithm has the best average-case performance with O(n log n) and stability?',
          instructions: '60-second Response Round',
          points: 1,
          options: [
            { id: 'opt_a', text: 'QuickSort' },
            { id: 'opt_b', text: 'MergeSort' },
            { id: 'opt_c', text: 'HeapSort' },
            { id: 'opt_d', text: 'SelectionSort' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'Rapid Fire: What principle states that software entities should be open for extension but closed for modification?',
          instructions: 'SOLID Architecture Check',
          points: 1,
          options: [
            { id: 'opt_a', text: 'Single Responsibility Principle' },
            { id: 'opt_b', text: 'Open/Closed Principle' },
            { id: 'opt_c', text: 'Liskov Substitution Principle' },
            { id: 'opt_d', text: 'Dependency Inversion Principle' },
          ],
          correctOptionId: 'opt_b',
        },
      ];
    }

    if (assessmentType === 'psychometric') {
      return [
        {
          question: 'A critical production bug is detected 30 minutes before your scheduled shift end. How do you respond?',
          instructions: 'Situational Judgment & Accountability',
          points: 1,
          options: [
            { id: 'opt_a', text: 'Log an issue ticket and leave it for the incoming shift team' },
            { id: 'opt_b', text: 'Triage severity immediately, inform stakeholders, coordinate an emergency containment fix, and ensure clean handover' },
            { id: 'opt_c', text: 'Temporarily disable monitoring alerts to avoid escalation' },
            { id: 'opt_d', text: 'Wait for user complaints before initiating an incident response' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'A colleague proposes an architectural approach you believe has scalability flaws. How do you resolve this?',
          instructions: 'Collaboration & Constructive Disagreement',
          points: 1,
          options: [
            { id: 'opt_a', text: 'Reject the proposal publicly in team channels to prevent errors' },
            { id: 'opt_b', text: 'Convene an architectural review, present objective performance benchmarks, listen to their tradeoffs, and align collaboratively' },
            { id: 'opt_c', text: 'Agree to their approach to avoid interpersonal friction' },
            { id: 'opt_d', text: 'Escalate immediately to the executive team without discussing with your peer' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'When faced with ambiguous project requirements and a looming deadline, what is your initial course of action?',
          instructions: 'Ambiguity & Problem Solving',
          points: 1,
          options: [
            { id: 'opt_a', text: 'Halt all progress until explicit complete specifications are delivered' },
            { id: 'opt_b', text: 'Identify critical core assumptions, clarify high-impact uncertainties with product managers, and build an iterative prototype' },
            { id: 'opt_c', text: 'Implement whatever requires the least effort to hit the deadline' },
            { id: 'opt_d', text: 'Delegate the ambiguous portions to junior engineers' },
          ],
          correctOptionId: 'opt_b',
        },
      ];
    }

    if (assessmentType === 'genius') {
      return [
        {
          question: 'Consider a system of 5 nodes. Each node is connected to exactly 3 other nodes. How many total bidirectional communication links exist across the network?',
          instructions: 'Graph Theory & Combinatorial Genius',
          points: 1,
          options: [
            { id: 'opt_a', text: '15 links' },
            { id: 'opt_b', text: '7.5 links (impossible graph topology)' },
            { id: 'opt_c', text: '10 links' },
            { id: 'opt_d', text: '8 links' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'If log₂(x) + log₂(x - 2) = 3, what is the real positive value of x?',
          instructions: 'Advanced Analytical Deduction',
          points: 1,
          options: [
            { id: 'opt_a', text: 'x = 2' },
            { id: 'opt_b', text: 'x = 4' },
            { id: 'opt_c', text: 'x = 6' },
            { id: 'opt_d', text: 'x = 8' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'In a Byzantine fault tolerant consensus network of 3f + 1 nodes, what is the maximum number of malicious nodes (f) the network can tolerate out of 10 total nodes?',
          instructions: 'Distributed Consensus & Fault Tolerance',
          points: 1,
          options: [
            { id: 'opt_a', text: '1 node' },
            { id: 'opt_b', text: '2 nodes' },
            { id: 'opt_c', text: '3 nodes' },
            { id: 'opt_d', text: '4 nodes' },
          ],
          correctOptionId: 'opt_c',
        },
      ];
    }

    if (assessmentType === 'ai_voice' || assessmentType === 'voice_assessment') {
      return [
        {
          question: `System Architecture Walkthrough: Verbally walk through your architectural decisions for designing a globally distributed real-time platform for ${jobTitle} utilizing ${skillList}. Explain trade-offs between WebSockets, SSE, and HTTP polling.`,
          instructions: 'AI Voice Assessment — Verbal Systems Walkthrough & Communication',
          points: 10,
          options: [
            { id: 'opt_a', text: 'Select WebSockets for bidirectional low-latency duplex messaging with heartbeat ping-pong' },
            { id: 'opt_b', text: 'Select Server-Sent Events (SSE) for unidirectional streaming updates over HTTP/2' },
            { id: 'opt_c', text: 'Use aggressive client polling with 500ms intervals' },
            { id: 'opt_d', text: 'Batch all notifications to daily bulk email dispatch' },
          ],
          correctOptionId: 'opt_a',
        },
        {
          question: 'Production Incident Triage: Imagine an active production outage where API latency spikes to 15 seconds and error rates surge to 40%. Verbally articulate your step-by-step triage protocol, containment, and executive communication.',
          instructions: 'AI Voice Assessment — High-Pressure Incident Verbal Response',
          points: 10,
          options: [
            { id: 'opt_a', text: 'Restart all cluster nodes immediately without taking memory dumps or checking metrics' },
            { id: 'opt_b', text: 'Acknowledge incident, check telemetry for bottleneck layer, shed non-critical load via circuit breakers, and communicate transparent status updates' },
            { id: 'opt_c', text: 'Mute alerts and wait for traffic to subside after peak hours' },
            { id: 'opt_d', text: 'Roll forward with untested speculative patches directly on production' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'Technical Leadership & Disagreements: Describe how you resolve a deadlock when two senior engineers strongly advocate for conflicting architectural designs. How do you lead them toward consensus?',
          instructions: 'AI Voice Assessment — Verbal Leadership & Conflict Resolution',
          points: 10,
          options: [
            { id: 'opt_a', text: 'Make an arbitrary unilateral decision to close the discussion quickly' },
            { id: 'opt_b', text: 'Establish shared success criteria, run isolated proof-of-concept benchmarks, and facilitate an objective trade-off evaluation matrix' },
            { id: 'opt_c', text: 'Allow whichever engineer has longer company tenure to make the call' },
            { id: 'opt_d', text: 'Postpone the initiative indefinitely until unanimity occurs naturally' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'Stakeholder Communication: How do you explain the technical debt and necessity of refactoring core legacy infrastructure to non-technical business executives?',
          instructions: 'AI Voice Assessment — Verbal Translation of Tech to Business Value',
          points: 10,
          options: [
            { id: 'opt_a', text: 'Cite complex compile-time metrics and dependency trees that executives cannot understand' },
            { id: 'opt_b', text: 'Translate technical debt into business impact: development velocity, platform stability, security vulnerability, and ROI' },
            { id: 'opt_c', text: 'Threaten team resignations if refactoring budget is not approved' },
            { id: 'opt_d', text: 'Hide the refactoring inside unrelated feature delivery tasks' },
          ],
          correctOptionId: 'opt_b',
        },
      ];
    }

    if (assessmentType === 'ai_chat' || assessmentType === 'chat_assessment') {
      return [
        {
          question: `Design and implement a scalable State Management & Data Flow Architecture for high-concurrency client updates in ${skillList}, handling optimistic UI and race conditions.`,
          instructions: 'AI Chat Assessment — Architecture & Code Design',
          points: 10,
          options: [
            { id: 'opt_a', text: 'Global mutable singleton with unvalidated direct property mutation' },
            { id: 'opt_b', text: 'Normalized immutable state store with optimistic rollback actions and request deduplication' },
            { id: 'opt_c', text: 'Polling localStorage on a 50ms interval loop' },
            { id: 'opt_d', text: 'Reloading the complete page on every state update event' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'API Contract & Query Optimization: How would you structure schema validation, pagination, and database indexing for high-frequency search and filtering endpoints?',
          instructions: 'AI Chat Assessment — API Contracts & Database Performance',
          points: 10,
          options: [
            { id: 'opt_a', text: 'Unindexed full table scans with offset-based pagination on billions of records' },
            { id: 'opt_b', text: 'Strict runtime schema validation (Zod/Joi), keyset/cursor-based pagination, and composite B-tree indexing' },
            { id: 'opt_c', text: 'Client-side filtering of unpaginated multi-gigabyte JSON payloads' },
            { id: 'opt_d', text: 'Disabling schema validation to reduce serialization overhead' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'Asynchronous Concurrency & Error Boundaries: How do you isolate failures in distributed background workers, prevent memory leaks, and guarantee idempotency in message queues?',
          instructions: 'AI Chat Assessment — Distributed Fault Isolation',
          points: 10,
          options: [
            { id: 'opt_a', text: 'Infinite unthrottled retries without backoff or poison-message dead lettering' },
            { id: 'opt_b', text: 'Exponential backoff with jitter, dead-letter queues, idempotent processing tokens, and bounded worker pools' },
            { id: 'opt_c', text: 'Suppressing all runtime exceptions silently' },
            { id: 'opt_d', text: 'Holding open database connections across asynchronous sleeps' },
          ],
          correctOptionId: 'opt_b',
        },
        {
          question: 'Production CI/CD Pipelines & Automated Testing: Outline an automated end-to-end testing matrix and canary deployment strategy to ensure zero-downtime releases.',
          instructions: 'AI Chat Assessment — CI/CD Pipeline & Delivery Engineering',
          points: 10,
          options: [
            { id: 'opt_a', text: 'Direct FTP file uploads to live production servers during peak business hours' },
            { id: 'opt_b', text: 'Unit & integration test suites in CI, ephemeral preview environments, canary traffic shifting with automated metric rollback triggers' },
            { id: 'opt_c', text: 'Manual testing on production after announcing maintenance downtime' },
            { id: 'opt_d', text: 'Skipping test runs for emergency bug hotfixes' },
          ],
          correctOptionId: 'opt_b',
        },
      ];
    }

    // Default domain/role assessment questions
    return [
      {
        question: `For a ${jobTitle} position focusing on ${skillList}, which architectural strategy provides the highest availability and disaster recovery resilience?`,
        instructions: 'Role Competency & Systems Thinking',
        points: 1,
        options: [
          { id: 'opt_a', text: 'Single datacenter active-passive replication' },
          { id: 'opt_b', text: 'Multi-region active-active deployment with geo-routed traffic and automated failover' },
          { id: 'opt_c', text: 'Nightly manual database snapshot backup restore' },
          { id: 'opt_d', text: 'Monolithic single-tier container hosting' },
        ],
        correctOptionId: 'opt_b',
      },
      {
        question: 'When profiling latency bottlenecks in distributed microservices, which observability telemetry tool provides end-to-end request timeline breakdown?',
        instructions: 'Production Observability & Monitoring',
        points: 1,
        options: [
          { id: 'opt_a', text: 'Centralized log aggregation without trace context' },
          { id: 'opt_b', text: 'Distributed tracing with OpenTelemetry and unique trace/span correlation IDs' },
          { id: 'opt_c', text: 'CPU utilization metrics alone' },
          { id: 'opt_d', text: 'Synthetic health-check pings' },
        ],
        correctOptionId: 'opt_b',
      },
      {
        question: 'What is the main advantage of semantic database versioning and backward-compatible schema migrations (Expand-Contract pattern)?',
        instructions: 'Database Reliability & Zero-Downtime Deployments',
        points: 1,
        options: [
          { id: 'opt_a', text: 'Eliminates the need for testing migrations on staging' },
          { id: 'opt_b', text: 'Allows zero-downtime rolling deployments where old and new code versions run concurrently safely' },
          { id: 'opt_c', text: 'Decreases total disk footprint of indexes' },
          { id: 'opt_d', text: 'Bypasses transaction log writes' },
        ],
        correctOptionId: 'opt_b',
      },
    ];
  }

  /**
   * Evaluates a candidate's descriptive analytical answer using Gemini against the reference answer & rubric.
   */
  private async evaluateDescriptiveAnswer(
    question: string,
    candidateAnswer: string,
    sampleAnswer?: string,
    rubric?: string,
    maxPoints: number = 10
  ): Promise<{ earnedPoints: number; isCorrect: boolean; feedback: string }> {
    if (!candidateAnswer || candidateAnswer.trim().length < 10) {
      return {
        earnedPoints: 0,
        isCorrect: false,
        feedback: 'No answer provided or answer is too brief.',
      };
    }

    try {
      const prompt = `You are a fair, precise assessment examiner evaluating a candidate's descriptive analytical answer.
Problem Statement:
"""${question}"""

${sampleAnswer ? `Reference / Sample Solution:\n"""${sampleAnswer}"""\n` : ''}
${rubric ? `Grading Rubric / Criteria:\n"""${rubric}"""\n` : ''}

Candidate's Submitted Response:
"""${candidateAnswer}"""

Maximum Points Possible: ${maxPoints}

Evaluate the candidate's response based on correctness, depth of explanation, and analytical reasoning according to the reference solution and rubric.
Award a fair integer score between 0 and ${maxPoints}.
Provide a brief 1-2 sentence constructive evaluator feedback.

Format strictly as JSON:
{
  "score": ${Math.round(maxPoints * 0.8)},
  "feedback": "Concise 1-2 sentence explanation of awarded score"
}`;

      const res = await GoogleProvider.getInstance().generate({
        prompt,
        promptName: 'evaluate_descriptive_answer',
        jsonMode: true,
        temperature: 0.2,
      });

      const parsed = JSON.parse(res.text.trim());
      const score = Math.min(maxPoints, Math.max(0, Math.round(Number(parsed.score) || 0)));
      const isCorrect = score >= Math.ceil(maxPoints * 0.6);
      return {
        earnedPoints: score,
        isCorrect,
        feedback: parsed.feedback || `Scored ${score}/${maxPoints} points based on analytical accuracy.`,
      };
    } catch {
      // Fallback heuristic if AI call fails
      const wordCount = candidateAnswer.trim().split(/\s+/).length;
      let earnedPoints = 0;
      if (wordCount >= 30) {
        earnedPoints = Math.round(maxPoints * 0.8);
      } else if (wordCount >= 15) {
        earnedPoints = Math.round(maxPoints * 0.5);
      } else {
        earnedPoints = Math.round(maxPoints * 0.3);
      }
      return {
        earnedPoints,
        isCorrect: earnedPoints >= Math.ceil(maxPoints * 0.6),
        feedback: 'Evaluated based on completeness and reasoning length.',
      };
    }
  }
}

export const applicationService = new ApplicationService();
