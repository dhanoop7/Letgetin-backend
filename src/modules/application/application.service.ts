import mongoose from 'mongoose';
import { ApplicationModel, ApplicationStatus } from './application.model.js';
import { AiApplyBatchJobModel } from '../aiApply/aiApplyBatch.model.js';
import { ResumeModel } from '../resume/resume.model.js';
import { JobModel } from '../job/job.model.js';
import { UserProfileModel } from '../profile/profile.model.js';
import { AppError } from '../../utils/appError.js';
import { HiringFunnelConfigModel } from '../hiringEngine/hiringFunnelConfig.model.js';
import { HiringEngineService } from '../hiringEngine/services/hiringEngine.service.js';
import { HiringPoolManager } from '../hiringEngine/services/hiringPoolManager.js';
import { scheduleCandidateDeadlineCheck } from '../hiringEngine/queues/hiringEngine.queue.js';
import { HiringNotificationHook } from '../hiringEngine/notifications/hiringNotification.hook.js';
import { ApplicationCollectionService } from '../hiringEngine/services/applicationCollection.service.js';
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
}

export const applicationService = new ApplicationService();
