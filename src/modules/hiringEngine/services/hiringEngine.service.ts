import { Types } from 'mongoose';
import { AppError } from '../../../utils/appError.js';
import { JobModel } from '../../job/job.model.js';
import { ApplicationModel, IApplicationDocument } from '../../application/application.model.js';
import { UserModel } from '../../user/user.model.js';
import { ResumeModel } from '../../resume/resume.model.js';
import { UserProfileModel } from '../../profile/profile.model.js';
import {
  HiringFunnelConfigModel,
  IHiringFunnelConfigDocument,
  IFunnelStage,
} from '../hiringFunnelConfig.model.js';
import { CandidateStageHistoryModel } from '../candidateStageHistory.model.js';
import { HiringFunnelCalculator, StageCalculationInput } from './hiringFunnelCalculator.js';
import { HiringPoolManager } from './hiringPoolManager.js';
import { Interview } from '../../interview/interview.model.js';
import {
  scheduleCandidateDeadlineCheck,
  CheckCandidateDeadlinePayload,
  AutoRefillStagePayload,
  ProcessStageEvaluationPayload,
} from '../queues/hiringEngine.queue.js';
import { HiringNotificationHook } from '../notifications/hiringNotification.hook.js';

export type FunnelHealthState = 'healthy' | 'starved' | 'paused' | 'completed';

export interface StageMetrics {
  stageId: string;
  stageName: string;
  stageType: string;
  assessmentType?: string;
  order: number;
  targetCount: number;
  activeCount: number; // invited + started + passed
  invitedCount: number;
  startedCount: number;
  passedCount: number;
  failedCount: number;
  noShowCount: number;
  deficit: number;
  reserveAvailable: number;
  durationMinutes?: number;
  passingScore?: number;
  questionCount?: number;
  isConfigured?: boolean;
  schedule?: any;
  config?: Record<string, unknown>;
}

export interface FunnelMetricsReport {
  jobId: string;
  jobTitle: string;
  finalShortlistTarget: number;
  currentShortlistedCount: number;
  totalFunnelIntakeTarget: number;
  totalApplicants: number;
  actualQualifiedCount?: number;
  primaryPoolSize: number;
  reservePoolSize: number;
  health: FunnelHealthState;
  healthReason?: string;
  stages: StageMetrics[];
}

export class HiringEngineService {
  /**
   * Prevents duplicate history records for the same candidate and stage transition within a 5-minute window.
   */
  public static async recordStageHistory(entry: {
    applicationId: Types.ObjectId | string;
    jobId: Types.ObjectId | string;
    candidateId: Types.ObjectId | string;
    stageId: string;
    stageName: string;
    stageIndex: number;
    status: 'invited' | 'started' | 'completed' | 'passed' | 'failed' | 'no_show';
    score?: number;
    evaluationDetails?: Record<string, any>;
    promotedFromReserve?: boolean;
    notes?: string;
    enteredAt?: Date;
    completedAt?: Date;
  }) {
    const existing = await CandidateStageHistoryModel.findOne({
      applicationId: entry.applicationId,
      stageId: entry.stageId,
      status: entry.status,
    }).sort({ enteredAt: -1 });

    if (existing && Date.now() - new Date(existing.enteredAt).getTime() < 300000) {
      return existing;
    }

    return CandidateStageHistoryModel.create({
      ...entry,
      promotedFromReserve: entry.promotedFromReserve ?? false,
      enteredAt: entry.enteredAt || new Date(),
    });
  }

  /**
   * Safety guard for automated actions: checks that job exists, is not closed,
   * and funnel is not paused.
   */
  public static async checkAutomationSafety(
    jobId: string | Types.ObjectId
  ): Promise<{ safe: boolean; reason?: string; job?: any; config?: IHiringFunnelConfigDocument | null }> {
    const job = await JobModel.findById(jobId).lean();
    if (!job) {
      return { safe: false, reason: 'Job not found' };
    }

    if (job.status === 'closed') {
      return { safe: false, reason: 'Job is closed' };
    }

    const config = await HiringFunnelConfigModel.findOne({ jobId });
    if (config && config.status === 'paused') {
      return { safe: false, reason: 'Hiring pipeline is paused' };
    }

    return { safe: true, job, config: config || null };
  }

  /**
   * Authorizes that the requesting recruiter owns the specified job.
   */
  private static async verifyJobOwnership(jobId: string | Types.ObjectId, recruiterUserId: string) {
    const job = await JobModel.findOne({ _id: jobId, postedBy: recruiterUserId });
    if (!job) {
      throw AppError.notFound('Job not found or recruiter access denied.');
    }
    return job;
  }

  /**
   * Initializes or reconfigures the hiring engine pipeline for a job.
   */
  public static async initializePipeline(
    jobId: string,
    recruiterUserId: string,
    input: {
      finalShortlistTarget: number;
      stages: StageCalculationInput[];
      status?: 'draft' | 'active' | 'paused';
    }
  ): Promise<{ config: IHiringFunnelConfigDocument; initialMetrics: FunnelMetricsReport }> {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);

    if (job.status === 'closed') {
      throw AppError.badRequest('Cannot configure a hiring pipeline on a closed job.');
    }

    // 1. Calculate stages and reverse pass targets
    const calculation = HiringFunnelCalculator.calculateFunnel(input.finalShortlistTarget, input.stages);

    // 2. Upsert HiringFunnelConfig
    let config = await HiringFunnelConfigModel.findOne({ jobId });
    if (!config) {
      config = new HiringFunnelConfigModel({
        jobId: job._id,
        orgId: job.orgId,
        finalShortlistTarget: calculation.finalShortlistTarget,
        stages: calculation.stages,
        totalFunnelIntakeTarget: calculation.totalFunnelIntakeTarget,
        currentShortlistedCount: 0,
        status: input.status || 'active',
        lastCalculatedAt: new Date(),
      });
    } else {
      config.finalShortlistTarget = calculation.finalShortlistTarget;
      config.stages = calculation.stages;
      config.totalFunnelIntakeTarget = calculation.totalFunnelIntakeTarget;
      if (input.status) config.status = input.status;
      config.lastCalculatedAt = new Date();
    }
    await config.save();

    // 3. Link back to JobModel and enable Hiring Engine
    job.hiringEngineConfigId = config._id as Types.ObjectId;
    job.hiringEngineEnabled = true;
    await job.save();

    // 4. Partition candidate pools for Stage 1
    const firstStage = calculation.stages[0];
    const partition = await HiringPoolManager.partitionInitialPool(
      job._id,
      firstStage.stageId,
      firstStage.targetCount,
      firstStage.deadlineHours
    );

    // 5. Create immutable stage history entries for newly invited primary candidates (idempotent)
    const now = new Date();
    for (const cand of partition.primaryCandidates) {
      await this.recordStageHistory({
        applicationId: cand._id,
        jobId: job._id,
        candidateId: cand.userId,
        stageId: firstStage.stageId,
        stageName: firstStage.stageName,
        stageIndex: 1,
        status: 'invited',
        score: cand.compositeRank,
        promotedFromReserve: false,
        notes: `Initial funnel intake invitation for stage '${firstStage.stageName}'`,
        enteredAt: now,
      });
    }

    const metrics = await this.getFunnelMetrics(jobId, recruiterUserId);

    return {
      config,
      initialMetrics: metrics,
    };
  }

  /**
   * Retrieves the current HiringFunnelConfig for a job.
   */
  public static async getFunnelConfig(jobId: string, recruiterUserId: string): Promise<IHiringFunnelConfigDocument> {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);
    let config: any = await HiringFunnelConfigModel.findOne({ jobId }).lean();
    if (!config) {
      const { ApplicationCollectionService } = await import('./applicationCollection.service.js');
      const stages = ApplicationCollectionService.deriveStagesFromJob(job);
      const targetCount = job.finalShortlistTarget || 5;
      const calculation = HiringFunnelCalculator.calculateFunnel(targetCount, stages);

      const created = await HiringFunnelConfigModel.create({
        jobId: job._id,
        orgId: job.orgId,
        finalShortlistTarget: targetCount,
        stages: calculation.stages,
        idealStages: calculation.stages,
        idealFunnelIntakeTarget: calculation.totalFunnelIntakeTarget,
        totalFunnelIntakeTarget: calculation.totalFunnelIntakeTarget,
        currentShortlistedCount: 0,
        status: job.status === 'active' ? 'active' : 'draft',
        funnelHealth: 'healthy',
        lastCalculatedAt: new Date(),
      });

      job.hiringEngineEnabled = true;
      job.hiringEngineConfigId = created._id as Types.ObjectId;
      await job.save();

      config = created.toObject();
    }
    return config as unknown as IHiringFunnelConfigDocument;
  }

  /**
   * Aggregates real-time candidate statistics across each stage to produce the funnel metrics report.
   */
  public static async getFunnelMetrics(jobId: string, recruiterUserId: string): Promise<FunnelMetricsReport> {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);
    let config: any = await HiringFunnelConfigModel.findOne({ jobId }).lean();

    if (!config) {
      const { ApplicationCollectionService } = await import('./applicationCollection.service.js');
      const stages = ApplicationCollectionService.deriveStagesFromJob(job);
      const targetCount = job.finalShortlistTarget || 5;
      const calculation = HiringFunnelCalculator.calculateFunnel(targetCount, stages);

      const created = await HiringFunnelConfigModel.create({
        jobId: job._id,
        orgId: job.orgId,
        finalShortlistTarget: targetCount,
        stages: calculation.stages,
        idealStages: calculation.stages,
        idealFunnelIntakeTarget: calculation.totalFunnelIntakeTarget,
        totalFunnelIntakeTarget: calculation.totalFunnelIntakeTarget,
        currentShortlistedCount: 0,
        status: job.status === 'active' ? 'active' : 'draft',
        funnelHealth: 'healthy',
        lastCalculatedAt: new Date(),
      });

      job.hiringEngineEnabled = true;
      job.hiringEngineConfigId = created._id as Types.ObjectId;
      await job.save();

      config = created.toObject();
    }

    const allApplications = await ApplicationModel.find({ jobId }).lean();
    const reservePoolSize = allApplications.filter((a) => a.poolType === 'reserve').length;
    const primaryPoolSize = allApplications.filter((a) => a.poolType === 'primary').length;

    let totalDeficitAcrossStages = 0;

    const stagesMetrics: StageMetrics[] = config.stages.map((stage: IFunnelStage) => {
      const stageApps = allApplications.filter(
        (a) => a.currentStageId === stage.stageId && a.poolType === 'primary'
      );

      const invitedCount = stageApps.filter((a) => a.stageStatus === 'invited').length;
      const startedCount = stageApps.filter((a) => a.stageStatus === 'started').length;
      const passedCount = stageApps.filter((a) => a.stageStatus === 'passed').length;
      const failedCount = stageApps.filter((a) => a.stageStatus === 'failed').length;
      const noShowCount = stageApps.filter((a) => a.stageStatus === 'no_show').length;

      // Active candidates are those who haven't dropped out (invited, started, or passed)
      const activeCount = invitedCount + startedCount + passedCount;
      const deficit = Math.max(0, stage.targetCount - activeCount);
      totalDeficitAcrossStages += deficit;

      const customQ = (stage.config as any)?.customQuestions;
      const isConfigured = Boolean(
        (stage.config as any)?.isConfigured || (Array.isArray(customQ) && customQ.length > 0)
      );
      const questionCount = Array.isArray(customQ) ? customQ.length : (stage.questionCount || 0);

      return {
        stageId: stage.stageId,
        stageName: stage.stageName,
        stageType: stage.stageType,
        assessmentType: stage.assessmentType,
        order: stage.order,
        targetCount: stage.targetCount,
        activeCount,
        invitedCount,
        startedCount,
        passedCount,
        failedCount,
        noShowCount,
        deficit,
        reserveAvailable: reservePoolSize,
        durationMinutes: stage.durationMinutes,
        passingScore: stage.passingScore,
        questionCount,
        isConfigured,
        schedule: stage.schedule,
        config: stage.config,
      };
    });

    // Determine overall Funnel Health State
    let health: FunnelHealthState = 'healthy';
    let healthReason: string | undefined;

    if (config.status === 'paused') {
      health = 'paused';
      healthReason = 'Pipeline paused by recruiter.';
    } else if (config.currentShortlistedCount >= config.finalShortlistTarget) {
      health = 'completed';
      healthReason = `Target achieved: ${config.currentShortlistedCount}/${config.finalShortlistTarget} candidates shortlisted.`;
    } else if (allApplications.length === 0) {
      health = 'starved';
      healthReason = 'Zero candidates have applied for this position.';
    } else if (totalDeficitAcrossStages > 0 && reservePoolSize === 0) {
      health = 'starved';
      healthReason = `Stage deficit detected (${totalDeficitAcrossStages} slots open) but reserve candidate pool is exhausted.`;
    }

    const { ApplicationCollectionService } = await import('./applicationCollection.service.js');
    const actualQualifiedCount = await ApplicationCollectionService.getQualifiedCandidateCount(job._id);

    return {
      jobId: String(job._id),
      jobTitle: job.title,
      finalShortlistTarget: config.finalShortlistTarget,
      currentShortlistedCount: config.currentShortlistedCount,
      totalFunnelIntakeTarget: config.totalFunnelIntakeTarget,
      totalApplicants: allApplications.length,
      actualQualifiedCount,
      primaryPoolSize,
      reservePoolSize,
      health,
      healthReason,
      stages: stagesMetrics,
    };
  }

  /**
   * Retrieves candidates currently in a stage, partitioned by primary and reserve pools.
   */
  public static async getStageCandidates(jobId: string, stageId: string, recruiterUserId: string) {
    await this.verifyJobOwnership(jobId, recruiterUserId);

    const primary = await ApplicationModel.find({
      jobId,
      currentStageId: stageId,
      poolType: 'primary',
    })
      .populate({ path: 'userId', model: UserModel, select: 'fullName username email phone avatarUrl' })
      .populate({ path: 'resumeId', model: ResumeModel, select: 'title atsScore createdAt' })
      .sort({ compositeRank: -1, appliedAt: 1 })
      .lean();

    const reserve = await ApplicationModel.find({
      jobId,
      $or: [
        { poolType: 'reserve' },
        { poolType: { $exists: false } },
        { poolType: null },
      ],
      status: { $nin: ['rejected', 'failed'] },
    })
      .populate({ path: 'userId', model: UserModel, select: 'fullName username email phone avatarUrl' })
      .populate({ path: 'resumeId', model: ResumeModel, select: 'title atsScore createdAt' })
      .sort({ compositeRank: -1, appliedAt: 1 })
      .lean();

    return {
      stageId,
      primary,
      reserve,
    };
  }

  /**
   * Advances a candidate who passed their current stage to the next stage (or final shortlist).
   * Supports both recruiter-invoked and automated system invocations.
   */
  public static async advanceCandidate(
    jobId: string,
    applicationId: string,
    recruiterUserId: string = 'system',
    evaluation?: {
      score?: number;
      notes?: string;
      evaluationDetails?: Record<string, any>;
    }
  ): Promise<{ application: IApplicationDocument; nextStageId: string | null; isFinalShortlist: boolean }> {
    if (recruiterUserId !== 'system') {
      await this.verifyJobOwnership(jobId, recruiterUserId);
    } else {
      const safety = await this.checkAutomationSafety(jobId);
      if (!safety.safe) {
        throw AppError.badRequest(`Cannot advance candidate: ${safety.reason}`);
      }
    }

    const config = await HiringFunnelConfigModel.findOne({ jobId });
    if (!config) {
      throw AppError.notFound('Hiring funnel configuration not found.');
    }

    if (config.status === 'paused') {
      throw AppError.badRequest('Hiring pipeline is paused. Cannot advance candidate.');
    }

    const application = await ApplicationModel.findOne({ _id: applicationId, jobId });
    if (!application) {
      throw AppError.notFound('Application not found.');
    }

    if (application.stageStatus === 'failed' || application.stageStatus === 'no_show') {
      throw AppError.badRequest(`Cannot advance candidate who is in '${application.stageStatus}' status.`);
    }

    // Idempotency: if candidate is already in final shortlist, return safely
    if (application.status === 'shortlisted' || (application.stageStatus === 'passed' && (application.currentStageIndex || 1) >= config.stages.length)) {
      return {
        application,
        nextStageId: null,
        isFinalShortlist: true,
      };
    }

    const currentStageIndex = application.currentStageIndex || 1;
    const currentStage = config.stages.find((s) => s.order === currentStageIndex);
    const now = new Date();

    // Complete current stage in audit history (idempotent)
    await this.recordStageHistory({
      applicationId: application._id,
      jobId: application.jobId,
      candidateId: application.userId,
      stageId: currentStage?.stageId || 'unknown',
      stageName: currentStage?.stageName || 'Current Stage',
      stageIndex: currentStageIndex,
      status: 'passed',
      score: evaluation?.score ?? application.compositeRank,
      evaluationDetails: evaluation?.evaluationDetails || {},
      promotedFromReserve: false,
      notes: evaluation?.notes || 'Candidate passed evaluation criteria.',
      enteredAt: application.stageStartedAt || application.invitedAt || now,
      completedAt: now,
    });

    const isLastStage = currentStageIndex >= config.stages.length;

    if (isLastStage) {
      // Candidate reached final shortlist!
      application.stageStatus = 'passed';
      application.status = 'shortlisted'; // Sync with existing ATS status
      application.finalShortlistDecision = application.finalShortlistDecision || 'pending';
      application.stageCompletedAt = now;
      await application.save();

      config.currentShortlistedCount += 1;
      if (config.currentShortlistedCount >= config.finalShortlistTarget) {
        config.status = 'completed';
      }
      await config.save();

      const jobDoc = await JobModel.findById(jobId).select('title').lean();
      HiringNotificationHook.notifyCandidateShortlisted({
        candidateId: String(application.userId),
        jobId: String(jobId),
        jobTitle: jobDoc?.title || 'Job Role',
        totalShortlisted: config.currentShortlistedCount,
        targetCount: config.finalShortlistTarget,
      });

      return {
        application,
        nextStageId: null,
        isFinalShortlist: true,
      };
    }

    // Move to next sequential stage
    const nextStage = config.stages.find((s) => s.order === currentStageIndex + 1)!;
    application.currentStageIndex = currentStageIndex + 1;
    application.currentStageId = nextStage.stageId;
    application.stageStatus = 'invited';
    // Sync ATS status with pipeline stage type
    if (nextStage.stageType === 'ai_interview' || nextStage.stageType === 'human_interview') {
      application.status = 'interviewing';
    } else if (nextStage.stageType === 'assessment') {
      application.status = 'reviewing';
    }
    application.invitedAt = now;
    application.stageStartedAt = undefined;
    application.stageCompletedAt = undefined;
    application.stageDeadline = new Date(now.getTime() + nextStage.deadlineHours * 3600 * 1000);
    await application.save();

    // Create entry for entering next stage (idempotent)
    await this.recordStageHistory({
      applicationId: application._id,
      jobId: application.jobId,
      candidateId: application.userId,
      stageId: nextStage.stageId,
      stageName: nextStage.stageName,
      stageIndex: nextStage.order,
      status: 'invited',
      score: application.compositeRank,
      promotedFromReserve: false,
      notes: `Advanced to stage '${nextStage.stageName}'`,
      enteredAt: now,
    });

    // Schedule delayed BullMQ candidate deadline check
    await scheduleCandidateDeadlineCheck(
      jobId,
      String(application._id),
      nextStage.stageId,
      nextStage.deadlineHours
    );

    const jobDoc = await JobModel.findById(jobId).select('title').lean();
    HiringNotificationHook.notifyCandidatePassed({
      candidateId: String(application.userId),
      jobId: String(jobId),
      jobTitle: jobDoc?.title || 'Job Role',
      stageId: currentStage?.stageId || '',
      stageName: currentStage?.stageName || '',
      nextStageId: nextStage.stageId,
      nextStageName: nextStage.stageName,
      score: evaluation?.score,
    });

    HiringNotificationHook.notifyCandidateInvited({
      candidateId: String(application.userId),
      applicationId: String(application._id),
      jobId: String(jobId),
      jobTitle: jobDoc?.title || 'Job Role',
      stageId: nextStage.stageId,
      stageName: nextStage.stageName,
      deadlineHours: nextStage.deadlineHours,
      stageDeadline: application.stageDeadline,
    });

    return {
      application,
      nextStageId: nextStage.stageId,
      isFinalShortlist: false,
    };
  }

  /**
   * Marks candidate as failed, records history, and triggers automatic dynamic refill from the reserve pool.
   */
  public static async failCandidate(
    jobId: string,
    applicationId: string,
    recruiterUserId: string = 'system',
    reason?: string
  ): Promise<{ application: IApplicationDocument; promotedCandidates: IApplicationDocument[] }> {
    if (recruiterUserId !== 'system') {
      await this.verifyJobOwnership(jobId, recruiterUserId);
    } else {
      const safety = await this.checkAutomationSafety(jobId);
      if (!safety.safe) {
        throw AppError.badRequest(`Cannot fail candidate: ${safety.reason}`);
      }
    }

    const config = await HiringFunnelConfigModel.findOne({ jobId });
    if (!config) {
      throw AppError.notFound('Hiring funnel configuration not found.');
    }

    const application = await ApplicationModel.findOne({ _id: applicationId, jobId });
    if (!application) {
      throw AppError.notFound('Application not found.');
    }

    // Idempotency: if already failed, do not process again
    if (application.stageStatus === 'failed') {
      return { application, promotedCandidates: [] };
    }

    const currentStageIndex = application.currentStageIndex || 1;
    const currentStage = config.stages.find((s) => s.order === currentStageIndex);
    const now = new Date();

    application.stageStatus = 'failed';
    application.status = 'rejected'; // Sync with existing ATS
    application.poolType = 'disqualified';
    application.stageCompletedAt = now;
    await application.save();

    // Record failure in immutable history (idempotent)
    await this.recordStageHistory({
      applicationId: application._id,
      jobId: application.jobId,
      candidateId: application.userId,
      stageId: currentStage?.stageId || 'unknown',
      stageName: currentStage?.stageName || 'Current Stage',
      stageIndex: currentStageIndex,
      status: 'failed',
      score: application.compositeRank,
      promotedFromReserve: false,
      notes: reason || 'Candidate failed stage evaluation criteria.',
      enteredAt: application.stageStartedAt || application.invitedAt || now,
      completedAt: now,
    });

    const jobDoc = await JobModel.findById(jobId).select('title').lean();
    HiringNotificationHook.notifyCandidateFailed({
      candidateId: String(application.userId),
      jobId: String(jobId),
      jobTitle: jobDoc?.title || 'Job Role',
      stageId: currentStage?.stageId || '',
      stageName: currentStage?.stageName || '',
      reason,
    });

    // Dynamic Refill: evaluate deficit and replenish from reserve pool
    let promotedCandidates: IApplicationDocument[] = [];
    if (currentStage && currentStage.autoRefillEnabled && config.status === 'active') {
      promotedCandidates = await this.evaluateAndRefillStage(
        jobId,
        currentStage.stageId,
        currentStageIndex,
        currentStage.stageName,
        currentStage.targetCount,
        currentStage.deadlineHours
      );
    }

    return {
      application,
      promotedCandidates,
    };
  }

  /**
   * Handles candidate withdrawal, freeing their seat and replenishing from the reserve pool.
   */
  public static async handleCandidateWithdrawal(
    jobId: string,
    applicationId: string,
    reason?: string
  ): Promise<{ application: IApplicationDocument; promotedCandidates: IApplicationDocument[] }> {
    const safety = await this.checkAutomationSafety(jobId);
    if (!safety.safe) {
      throw AppError.badRequest(`Cannot withdraw candidate: ${safety.reason}`);
    }

    const config = safety.config;
    const application = await ApplicationModel.findOne({ _id: applicationId, jobId });
    if (!application) {
      throw AppError.notFound('Application not found.');
    }

    // Idempotency: if already disqualified, skip
    if (application.poolType === 'disqualified') {
      return { application, promotedCandidates: [] };
    }

    const currentStageIndex = application.currentStageIndex || 1;
    const currentStage = config?.stages?.find((s) => s.order === currentStageIndex);
    const now = new Date();

    application.stageStatus = 'failed';
    application.status = 'rejected';
    application.poolType = 'disqualified';
    application.stageCompletedAt = now;
    await application.save();

    await this.recordStageHistory({
      applicationId: application._id,
      jobId: application.jobId,
      candidateId: application.userId,
      stageId: currentStage?.stageId || 'unknown',
      stageName: currentStage?.stageName || 'Current Stage',
      stageIndex: currentStageIndex,
      status: 'failed',
      score: application.compositeRank,
      promotedFromReserve: false,
      notes: `Candidate withdrew application: ${reason || 'No reason provided'}`,
      enteredAt: application.stageStartedAt || application.invitedAt || now,
      completedAt: now,
    });

    const jobDoc = await JobModel.findById(jobId).select('title').lean();
    HiringNotificationHook.notifyCandidateFailed({
      candidateId: String(application.userId),
      jobId: String(jobId),
      jobTitle: jobDoc?.title || 'Job Role',
      stageId: currentStage?.stageId || '',
      stageName: currentStage?.stageName || '',
      reason: `Withdrawn: ${reason || 'No reason provided'}`,
    });

    let promotedCandidates: IApplicationDocument[] = [];
    if (currentStage && currentStage.autoRefillEnabled && config?.status === 'active') {
      promotedCandidates = await this.evaluateAndRefillStage(
        jobId,
        currentStage.stageId,
        currentStageIndex,
        currentStage.stageName,
        currentStage.targetCount,
        currentStage.deadlineHours
      );
    }

    return {
      application,
      promotedCandidates,
    };
  }

  /**
   * Handles candidate no-show when their stage response deadline expires.
   * NOTE: Does NOT prematurely refill if the deadline has not elapsed yet.
   */
  public static async handleNoShow(
    jobId: string,
    applicationId: string,
    forceCheck = false
  ): Promise<{ markedNoShow: boolean; promotedCandidates: IApplicationDocument[]; reason?: string }> {
    const safety = await this.checkAutomationSafety(jobId);
    if (!safety.safe) {
      return { markedNoShow: false, promotedCandidates: [], reason: safety.reason };
    }

    const application = await ApplicationModel.findOne({ _id: applicationId, jobId });
    if (!application) {
      return { markedNoShow: false, promotedCandidates: [], reason: 'Application not found' };
    }

    // Idempotency: If candidate already completed/passed/failed/started/withdrew, DO NOTHING
    if (application.stageStatus !== 'invited') {
      return { markedNoShow: false, promotedCandidates: [], reason: `Candidate state is '${application.stageStatus}'` };
    }

    const now = new Date();

    // Check if deadline has actually passed (unless forceCheck is requested)
    if (!forceCheck && application.stageDeadline && application.stageDeadline > now) {
      // Candidate deadline has not expired yet — do NOT mark no-show or refill
      return { markedNoShow: false, promotedCandidates: [], reason: 'Deadline has not passed yet' };
    }

    // CAS atomic update to guarantee idempotency under concurrent deadline checks
    const updated = await ApplicationModel.findOneAndUpdate(
      {
        _id: applicationId,
        jobId,
        stageStatus: 'invited',
      },
      {
        $set: {
          stageStatus: 'no_show',
          poolType: 'disqualified',
          stageCompletedAt: now,
        },
      },
      { new: true }
    );

    if (!updated) {
      return { markedNoShow: false, promotedCandidates: [], reason: 'State transitioned concurrently' };
    }

    const config = safety.config;
    const currentStageIndex = updated.currentStageIndex || 1;
    const currentStage = config?.stages?.find((s) => s.order === currentStageIndex);

    await this.recordStageHistory({
      applicationId: updated._id,
      jobId: updated.jobId,
      candidateId: updated.userId,
      stageId: currentStage?.stageId || 'unknown',
      stageName: currentStage?.stageName || 'Current Stage',
      stageIndex: currentStageIndex,
      status: 'no_show',
      score: updated.compositeRank,
      promotedFromReserve: false,
      notes: `Stage deadline expired at ${updated.stageDeadline?.toISOString() || now.toISOString()} without candidate starting.`,
      enteredAt: updated.invitedAt || now,
      completedAt: now,
    });

    const jobDoc = await JobModel.findById(jobId).select('title').lean();
    HiringNotificationHook.notifyCandidateNoShow({
      candidateId: String(updated.userId),
      jobId: String(jobId),
      jobTitle: jobDoc?.title || 'Job Role',
      stageId: currentStage?.stageId || '',
      stageName: currentStage?.stageName || '',
      deadline: updated.stageDeadline,
    });

    let promotedCandidates: IApplicationDocument[] = [];
    if (currentStage && currentStage.autoRefillEnabled && config?.status === 'active') {
      promotedCandidates = await this.evaluateAndRefillStage(
        jobId,
        currentStage.stageId,
        currentStageIndex,
        currentStage.stageName,
        currentStage.targetCount,
        currentStage.deadlineHours
      );
    }

    return {
      markedNoShow: true,
      promotedCandidates,
    };
  }

  /**
   * BullMQ job processor for 'check-candidate-deadline'
   */
  public static async processCandidateDeadlineJob(
    data: CheckCandidateDeadlinePayload
  ): Promise<{ markedNoShow: boolean; promotedCandidates: IApplicationDocument[]; reason?: string }> {
    return this.handleNoShow(data.jobId, data.applicationId, false);
  }

  /**
   * BullMQ job processor for 'auto-refill-stage'
   */
  public static async processAutoRefillJob(
    data: AutoRefillStagePayload
  ): Promise<IApplicationDocument[]> {
    const safety = await this.checkAutomationSafety(data.jobId);
    if (!safety.safe || !safety.config) {
      return [];
    }

    const stage = safety.config.stages.find((s) => s.stageId === data.stageId);
    if (!stage || !stage.autoRefillEnabled) {
      return [];
    }

    return this.evaluateAndRefillStage(
      data.jobId,
      stage.stageId,
      stage.order,
      stage.stageName,
      data.targetCount,
      stage.deadlineHours
    );
  }

  /**
   * BullMQ job processor for 'process-stage-evaluation'
   */
  public static async processStageEvaluationJob(
    data: ProcessStageEvaluationPayload
  ): Promise<{ status: 'passed' | 'failed' | 'skipped'; score: number; reason?: string }> {
    const safety = await this.checkAutomationSafety(data.jobId);
    if (!safety.safe || !safety.config) {
      return { status: 'skipped', score: data.score, reason: safety.reason };
    }

    const stage = safety.config.stages.find((s) => s.stageId === data.stageId);
    if (!stage) {
      return { status: 'skipped', score: data.score, reason: 'Stage not found in config' };
    }

    const threshold = stage.autoAdvanceScoreThreshold ?? 70;
    if (data.score >= threshold) {
      await this.advanceCandidate(data.jobId, data.applicationId, 'system', {
        score: data.score,
        evaluationDetails: data.evaluationDetails,
        notes: `Automated pass: Score ${data.score} >= threshold ${threshold}`,
      });
      return { status: 'passed', score: data.score };
    } else {
      await this.failCandidate(
        data.jobId,
        data.applicationId,
        'system',
        `Automated fail: Score ${data.score} < threshold ${threshold}`
      );
      return { status: 'failed', score: data.score };
    }
  }

  /**
   * Direct integration hook when an assessment is completed.
   */
  public static async handleAssessmentCompleted(
    jobId: string,
    applicationId: string,
    score: number,
    assessmentDetails?: Record<string, any>
  ): Promise<{ processed: boolean; status?: 'passed' | 'failed'; reason?: string }> {
    const safety = await this.checkAutomationSafety(jobId);
    if (!safety.safe || !safety.config) {
      return { processed: false, reason: safety.reason };
    }

    const application = await ApplicationModel.findOne({ _id: applicationId, jobId });
    if (!application) {
      return { processed: false, reason: 'Application not found' };
    }

    const currentStage = safety.config.stages.find((s) => s.order === (application.currentStageIndex || 1));
    if (!currentStage) {
      return { processed: false, reason: 'Stage not found' };
    }

    // Idempotency: if candidate already passed this stage, ignore duplicate assessment
    if (application.stageStatus === 'passed') {
      return {
        processed: false,
        status: 'passed',
        reason: 'Candidate has already completed and passed this stage.',
      };
    }

    application.assessmentScore = score;
    await application.save();

    if (currentStage.stageType === 'assessment' || currentStage.stageId.includes('assessment')) {
      const evalResult = await this.processStageEvaluationJob({
        type: 'process-stage-evaluation',
        jobId,
        applicationId,
        stageId: currentStage.stageId,
        score,
        evaluationDetails: assessmentDetails,
      });

      return {
        processed: true,
        status: evalResult.status === 'passed' ? 'passed' : 'failed',
      };
    }

    return { processed: true, reason: 'Updated score on application; current stage is not assessment' };
  }

  /**
   * Direct integration hook when an AI interview is completed.
   */
  public static async handleAiInterviewCompleted(
    interviewIdOrApplicationId: string,
    options?: {
      jobId?: string;
      applicationId?: string;
      score?: number;
      feedbackNotes?: string;
      scorecard?: any;
    }
  ): Promise<{ processed: boolean; status?: 'passed' | 'failed'; reason?: string }> {
    let jobId = options?.jobId;
    let applicationId = options?.applicationId;
    let score = options?.score;
    let details = options?.scorecard;

    // Check if passed an Interview document ID
    if (Types.ObjectId.isValid(interviewIdOrApplicationId)) {
      const interview = await Interview.findById(interviewIdOrApplicationId).lean();
      if (interview) {
        jobId = jobId || (interview.jobId ? String(interview.jobId) : undefined);
        const overall =
          interview.aiScorecard?.overallScore ??
          (typeof interview.score === 'number' ? interview.score * 20 : undefined);
        if (typeof overall === 'number') {
          score = score ?? overall;
        }
        details = details || interview.aiScorecard;

        if (!applicationId && jobId && (interview.candidateId || interview.userId)) {
          const candUser = interview.candidateId || interview.userId;
          const app = await ApplicationModel.findOne({ jobId, userId: candUser });
          if (app) applicationId = String(app._id);
        }
      } else if (!applicationId) {
        applicationId = interviewIdOrApplicationId;
      }
    }

    if (!jobId || !applicationId) {
      return { processed: false, reason: 'Missing jobId or applicationId' };
    }

    const safety = await this.checkAutomationSafety(jobId);
    if (!safety.safe || !safety.config) {
      return { processed: false, reason: safety.reason };
    }

    const application = await ApplicationModel.findOne({ _id: applicationId, jobId });
    if (!application) {
      return { processed: false, reason: 'Application not found' };
    }

    // Idempotency: if candidate already shortlisted or passed final stage
    if (
      application.status === 'shortlisted' ||
      (application.stageStatus === 'passed' && (application.currentStageIndex || 1) >= safety.config.stages.length)
    ) {
      return {
        processed: true,
        status: 'passed',
        reason: 'Candidate has already passed evaluation and reached final shortlist.',
      };
    }

    const finalScore = score ?? 75;
    application.aiScore = finalScore;
    await application.save();

    const currentStage = safety.config.stages.find((s) => s.order === (application.currentStageIndex || 1));
    if (!currentStage) {
      return { processed: false, reason: 'Stage not found' };
    }

    if (currentStage.stageType === 'ai_interview' || currentStage.stageId.includes('interview')) {
      const evalResult = await this.processStageEvaluationJob({
        type: 'process-stage-evaluation',
        jobId,
        applicationId,
        stageId: currentStage.stageId,
        score: finalScore,
        evaluationDetails: details,
      });

      return {
        processed: true,
        status: evalResult.status === 'passed' ? 'passed' : 'failed',
      };
    }

    return { processed: true, reason: 'Updated score on application; current stage is not AI interview' };
  }

  /**
   * Evaluates the current active seats vs target count for a stage and promotes reserves if deficit > 0.
   */
  public static async evaluateAndRefillStage(
    jobId: string | Types.ObjectId,
    stageId: string,
    stageIndex: number,
    stageName: string,
    targetCount: number,
    deadlineHours: number
  ): Promise<IApplicationDocument[]> {
    const safety = await this.checkAutomationSafety(jobId);
    if (!safety.safe) {
      return [];
    }

    // Active candidates are currently invited, started, or passed
    const activeCandidatesCount = await ApplicationModel.countDocuments({
      jobId,
      currentStageId: stageId,
      poolType: 'primary',
      stageStatus: { $in: ['invited', 'started', 'passed'] },
    });

    const deficit = targetCount - activeCandidatesCount;

    if (deficit <= 0) {
      return [];
    }

    return HiringPoolManager.promoteReserveCandidates(
      jobId,
      stageId,
      stageIndex,
      stageName,
      deficit,
      deadlineHours
    );
  }

  /**
   * Manually triggers a stage refill from the reserve pool.
   */
  public static async manualRefill(
    jobId: string,
    stageId: string,
    recruiterUserId: string,
    requestedCount?: number
  ): Promise<IApplicationDocument[]> {
    await this.verifyJobOwnership(jobId, recruiterUserId);
    const config = await HiringFunnelConfigModel.findOne({ jobId });
    if (!config) throw AppError.notFound('Hiring funnel configuration not found.');

    const stage = config.stages.find((s) => s.stageId === stageId);
    if (!stage) throw AppError.notFound(`Stage '${stageId}' not found in funnel config.`);

    const countToPromote =
      typeof requestedCount === 'number' && requestedCount > 0
        ? requestedCount
        : Math.max(
            0,
            stage.targetCount -
              (await ApplicationModel.countDocuments({
                jobId,
                currentStageId: stageId,
                poolType: 'primary',
                stageStatus: { $in: ['invited', 'started', 'passed'] },
              }))
          );

    return HiringPoolManager.promoteReserveCandidates(
      jobId,
      stage.stageId,
      stage.order,
      stage.stageName,
      countToPromote,
      stage.deadlineHours
    );
  }

  /**
   * Retrieves candidates who have reached the Final Shortlist phase for a job,
   * with scorecard metrics, stage-by-stage audit history, status tabs, and search filtering.
   */
  public static async getFinalShortlistCandidates(
    jobId: string,
    recruiterUserId: string,
    queryOptions?: { status?: string; search?: string }
  ) {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);
    const config = await this.getFunnelConfig(jobId, recruiterUserId);

    const totalStages = config?.stages?.length || 5;
    const finalStageThreshold = Math.min(4, totalStages);

    // Candidates who reached final shortlist phase
    const finalists = await ApplicationModel.find({
      jobId,
      $or: [
        { currentStageIndex: { $gte: finalStageThreshold } },
        { status: { $in: ['shortlisted', 'offered', 'hired', 'rejected'] }, finalShortlistDecision: { $exists: true } },
        { finalShortlistDecision: { $in: ['pending', 'offered', 'on_hold', 'rejected', 'hired'] } },
        { stageStatus: 'passed', currentStageIndex: { $gte: Math.max(1, totalStages - 1) } },
      ],
    })
      .populate({ path: 'userId', model: UserModel, select: 'fullName username email phone avatarUrl avatar' })
      .populate({ path: 'resumeId', model: ResumeModel, select: 'title atsScore content settings createdAt updatedAt' })
      .sort({ updatedAt: -1 })
      .lean();

    // Batch query candidate user profiles and stage histories (prevents N+1)
    const userIds = finalists.map((a) => (a.userId as any)?._id || a.userId).filter(Boolean);
    const appIds = finalists.map((a) => a._id);

    const [userProfiles, allHistoryDocs] = await Promise.all([
      UserProfileModel.find({ userId: { $in: userIds } }).lean(),
      CandidateStageHistoryModel.find({ applicationId: { $in: appIds } }).sort({ stageIndex: 1, enteredAt: 1 }).lean(),
    ]);

    const profileMap = new Map<string, any>();
    for (const p of userProfiles) {
      profileMap.set(String(p.userId), p);
    }

    const historyByApp = new Map<string, any[]>();
    for (const h of allHistoryDocs) {
      const key = String(h.applicationId);
      if (!historyByApp.has(key)) historyByApp.set(key, []);
      historyByApp.get(key)!.push(h);
    }

    // Transform finalists into enriched scorecard objects
    const allFinalistItems = finalists.map((app: any, idx: number) => {
      const user = (app.userId && typeof app.userId === 'object' ? app.userId : {}) as any;
      const resume = (app.resumeId && typeof app.resumeId === 'object' ? app.resumeId : null) as any;
      const uId = String(user._id || app.userId);
      const profile = profileMap.get(uId) || {};
      const historyDocs = historyByApp.get(String(app._id)) || [];

      const completedStages = historyDocs
        .filter((h) => h.status === 'passed' || h.status === 'completed')
        .map((h) => ({
          stageId: h.stageId,
          stageName: h.stageName,
          stageIndex: h.stageIndex,
          status: h.status,
          score: h.score,
          completedAt: h.completedAt || h.enteredAt,
          notes: h.notes,
        }));

      const name =
        user.fullName ||
        `${profile?.personal?.firstName || ''} ${profile?.personal?.lastName || ''}`.trim() ||
        user.username ||
        'Finalist Candidate';

      const email = user.email || profile?.contact?.email || profile?.contact?.alternateEmail || '';
      const phone = user.phone || profile?.contact?.phone || '';
      const appliedRole =
        profile?.personal?.headline ||
        job.title ||
        (resume?.content as any)?.personalInfo?.headline ||
        (resume?.content as any)?.title ||
        'Developer';

      let experience = '1-3 Years';
      if (Array.isArray(profile?.experiencesList) && profile.experiencesList.length > 0) {
        experience = `${profile.experiencesList.length}+ Years`;
      } else if (profile?.track === 'fresher') {
        experience = 'Fresher';
      } else if (app.matchScore && app.matchScore > 85) {
        experience = '3+ Years';
      }

      const overallScore =
        app.evaluationScores?.overall ??
        app.matchScore ??
        (resume?.atsScore ? resume.atsScore : 85);
      const technicalScore =
        app.evaluationScores?.technical ??
        app.assessmentScore ??
        Math.min(100, Math.round(overallScore * 0.95));
      const aptitudeScore =
        app.evaluationScores?.aptitude ??
        overallScore;
      const interviewScore =
        app.evaluationScores?.interview ??
        app.aiScore ??
        Math.min(100, Math.round(overallScore * 0.92));

      // Resolve explicit finalist decision state
      let finalShortlistDecision: 'pending' | 'offered' | 'on_hold' | 'rejected' | 'hired' = 'pending';
      if (app.finalShortlistDecision) {
        finalShortlistDecision = app.finalShortlistDecision;
      } else if (app.status === 'offered') {
        finalShortlistDecision = 'offered';
      } else if (app.status === 'hired') {
        finalShortlistDecision = 'hired';
      } else if (app.status === 'rejected') {
        finalShortlistDecision = 'rejected';
      } else {
        finalShortlistDecision = 'pending';
      }

      return {
        _id: String(app._id),
        applicationId: String(app._id),
        jobId: String(app.jobId),
        appliedRole,
        experience,
        compositeRank: idx + 1,
        overallScore,
        technicalScore,
        aptitudeScore,
        interviewScore,
        stageScores: {
          matchScore: overallScore,
          assessmentScore: technicalScore,
          aiScore: interviewScore,
        },
        candidate: {
          _id: uId,
          fullName: name,
          username: user.username || '',
          email,
          phone,
          avatarUrl: user.avatarUrl || user.avatar || '',
        },
        resume: resume
          ? {
              _id: String(resume._id),
              title: resume.title,
              atsScore: resume.atsScore,
              content: resume.content,
              settings: resume.settings,
            }
          : null,
        resumeScore: overallScore,
        completedStages,
        relevantStageHistory: historyDocs,
        resumeEvaluation: app.resumeEvaluation,
        finalShortlistDate: app.stageCompletedAt || app.offeredAt || app.updatedAt || app.appliedAt,
        finalShortlistDecision,
        status: app.status,
        offeredAt: app.offeredAt,
        hiredAt: app.hiredAt,
        notes: app.notes || '',
        appliedAt: app.appliedAt || app.createdAt,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt,
      };
    });

    // Sort all finalists by overall score descending and assign composite rank
    allFinalistItems.sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));
    allFinalistItems.forEach((c, idx) => {
      c.compositeRank = idx + 1;
    });

    // Compute comprehensive stats before status/search filters
    const stats = {
      totalFinalists: allFinalistItems.length,
      pendingReview: allFinalistItems.filter((c) => c.finalShortlistDecision === 'pending').length,
      offersSent: allFinalistItems.filter((c) => c.finalShortlistDecision === 'offered').length,
      onHold: allFinalistItems.filter((c) => c.finalShortlistDecision === 'on_hold').length,
      rejected: allFinalistItems.filter((c) => c.finalShortlistDecision === 'rejected').length,
      hired: allFinalistItems.filter((c) => c.finalShortlistDecision === 'hired').length,
    };

    // Apply status/decision tab filter strictly
    let filteredList = allFinalistItems;
    if (queryOptions?.status && queryOptions.status !== 'all') {
      const normalizedStatus = queryOptions.status.toLowerCase().replace('-', '_');
      filteredList = filteredList.filter((c) => c.finalShortlistDecision === normalizedStatus);
    }

    // Apply search query filter
    if (queryOptions?.search) {
      const q = queryOptions.search.toLowerCase().trim();
      filteredList = filteredList.filter(
        (c) =>
          c.candidate.fullName?.toLowerCase().includes(q) ||
          c.candidate.email?.toLowerCase().includes(q) ||
          c.appliedRole?.toLowerCase().includes(q) ||
          job.title?.toLowerCase().includes(q) ||
          c.candidate.username?.toLowerCase().includes(q)
      );
    }

    return {
      jobId: String(job._id),
      jobTitle: job.title,
      finalShortlistTarget: config.finalShortlistTarget,
      currentShortlistedCount: config.currentShortlistedCount,
      stats,
      candidates: filteredList,
    };
  }

  /**
   * Retrieves single candidate finalist details, scorecards, and evaluation history.
   */
  public static async getFinalistDetail(
    jobId: string,
    applicationId: string,
    recruiterUserId: string
  ) {
    const listRes = await this.getFinalShortlistCandidates(jobId, recruiterUserId);
    const matched = listRes.candidates.find((c) => c.applicationId === applicationId || c._id === applicationId);

    if (!matched) {
      // Direct application fallback if not in current filter list
      const candidateDetail = await this.getCandidateDetail(jobId, applicationId, recruiterUserId);
      return candidateDetail;
    }

    return matched;
  }

  /**
   * Recruiter records a final shortlist decision on a finalist:
   * 'offered' | 'on_hold' | 'rejected'
   * Note: 'hired' is triggered only upon candidate acceptance.
   */
  public static async recordFinalDecision(
    jobId: string,
    applicationId: string,
    recruiterUserId: string,
    decision: 'offered' | 'on_hold' | 'rejected' | string,
    notes?: string
  ) {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);

    const normalizedDecision = decision.replace('-', '_');
    if (!['offered', 'on_hold', 'rejected'].includes(normalizedDecision)) {
      throw AppError.badRequest("Invalid decision. Supported decisions are 'offered', 'on_hold', 'rejected'.");
    }

    const config = await this.getFunnelConfig(jobId, recruiterUserId);
    const application = await ApplicationModel.findOne({ _id: applicationId, jobId });
    if (!application) {
      throw AppError.notFound('Application not found.');
    }

    const jobStages = (job as any).stages;
    const totalStages = config?.stages?.length || (Array.isArray(jobStages) && jobStages.length > 0 ? jobStages.length : 5);
    const finalStageThreshold = Math.max(1, totalStages - 1);
    const isFinalStage =
      (application.currentStageIndex || 1) >= finalStageThreshold ||
      application.stageStatus === 'passed' ||
      application.finalShortlistDecision !== undefined;

    if (!isFinalStage) {
      throw AppError.badRequest('Candidate has not completed all dynamic funnel stages for this job.');
    }

    application.finalShortlistDecision = normalizedDecision as any;

    if (normalizedDecision === 'offered') {
      application.status = 'offered';
      application.offeredAt = new Date();
    } else if (normalizedDecision === 'on_hold') {
      application.status = 'shortlisted';
    } else if (normalizedDecision === 'rejected') {
      application.status = 'rejected';
    }

    if (notes !== undefined) {
      application.notes = notes;
    }

    await application.save();

    // Record stage history audit entry
    await this.recordStageHistory({
      applicationId: application._id,
      jobId: application.jobId,
      candidateId: application.userId,
      stageId: 'stage_final_shortlist',
      stageName: 'Final Shortlist Review',
      stageIndex: totalStages,
      status: normalizedDecision === 'rejected' ? 'failed' : 'passed',
      score: application.compositeRank || application.matchScore,
      notes: notes || `Recruiter decision: ${normalizedDecision}`,
      promotedFromReserve: false,
      enteredAt: new Date(),
      completedAt: new Date(),
    });

    const jobDoc = await JobModel.findById(jobId).select('title').lean();
    if (normalizedDecision === 'offered') {
      HiringNotificationHook.notifyCandidateShortlisted({
        candidateId: String(application.userId),
        jobId: String(jobId),
        jobTitle: jobDoc?.title || 'Job Role',
        totalShortlisted: config?.currentShortlistedCount || 1,
        targetCount: config?.finalShortlistTarget || 1,
      });
    }

    return {
      applicationId: String(application._id),
      decision: application.finalShortlistDecision,
      status: application.status,
      offeredAt: application.offeredAt,
      hiredAt: application.hiredAt,
      notes: application.notes,
      updatedAt: application.updatedAt,
    };
  }

  /**
   * Generates exportable finalist scorecard data in CSV or JSON format.
   */
  public static async exportFinalShortlistScorecards(
    jobId: string,
    recruiterUserId: string,
    formatOrStatus: 'csv' | 'json' | string = 'csv',
    queryOptionsOrFormat?: { status?: string; search?: string } | string
  ): Promise<{ data: string | any[]; format: string; filename: string; contentType: string }> {
    let format: 'csv' | 'json' = 'csv';
    let options: { status?: string; search?: string } | undefined = undefined;

    if (formatOrStatus === 'csv' || formatOrStatus === 'json') {
      format = formatOrStatus as 'csv' | 'json';
      if (typeof queryOptionsOrFormat === 'object') {
        options = queryOptionsOrFormat;
      }
    } else {
      options = { status: formatOrStatus };
      if (typeof queryOptionsOrFormat === 'string' && (queryOptionsOrFormat === 'csv' || queryOptionsOrFormat === 'json')) {
        format = queryOptionsOrFormat as 'csv' | 'json';
      }
    }

    const listRes = await this.getFinalShortlistCandidates(jobId, recruiterUserId, options);
    const candidates = listRes.candidates || [];
    const jobTitleSlug = (listRes.jobTitle || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const timestamp = new Date().toISOString().split('T')[0];

    if (format === 'json') {
      return {
        data: candidates,
        format: 'json',
        filename: `${jobTitleSlug}_finalist_scorecards_${timestamp}.json`,
        contentType: 'application/json',
      };
    }

    // CSV formatting
    const headers = [
      'Rank',
      'Candidate Name',
      'Email',
      'Phone',
      'Applied Role',
      'Experience',
      'Overall Score (%)',
      'Technical Score (%)',
      'Aptitude Score (%)',
      'Interview Score (%)',
      'Finalist Status',
      'Shortlisted Date',
      'Decision Notes',
    ];

    const escapeCsv = (val: any): string => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = candidates.map((c, i) => [
      c.compositeRank || i + 1,
      escapeCsv(c.candidate.fullName),
      escapeCsv(c.candidate.email),
      escapeCsv(c.candidate.phone),
      escapeCsv(c.appliedRole),
      escapeCsv(c.experience),
      c.overallScore || c.stageScores?.matchScore || 0,
      c.technicalScore || c.stageScores?.assessmentScore || 0,
      c.aptitudeScore || c.stageScores?.matchScore || 0,
      c.interviewScore || c.stageScores?.aiScore || 0,
      escapeCsv(c.finalShortlistDecision),
      escapeCsv(c.finalShortlistDate ? new Date(c.finalShortlistDate).toISOString().split('T')[0] : ''),
      escapeCsv(c.notes),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    return {
      data: csvContent,
      format: 'csv',
      filename: `${jobTitleSlug}_finalist_scorecards_${timestamp}.csv`,
      contentType: 'text/csv',
    };
  }

  /**
   * Retrieves the full immutable audit history for an application.
   */
  public static async getCandidateStageHistory(
    jobId: string,
    applicationId: string,
    recruiterUserId: string
  ) {
    await this.verifyJobOwnership(jobId, recruiterUserId);
    return CandidateStageHistoryModel.find({ applicationId, jobId }).sort({ enteredAt: 1 }).lean();
  }

  /**
   * Retrieves full stage details with fallback to job assessment rounds.
   */
  public static async getStageDetails(jobId: string, stageId: string, recruiterUserId: string): Promise<IFunnelStage> {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);
    const config = await HiringFunnelConfigModel.findOne({ jobId }).lean();

    let stage = config?.stages?.find((s) => s.stageId === stageId);
    if (!stage) {
      // Check in job.assessment.rounds
      const round = job.assessment?.rounds?.find(
        (r: any) => r.id === stageId || r.roundId === stageId || r.type === stageId
      );
      if (round) {
        stage = {
          stageId: round.id || stageId,
          stageName: round.name || 'Assessment Stage',
          stageType: 'assessment',
          assessmentType: round.type,
          order: round.order || 1,
          targetCount: 10,
          expectedAttendanceRate: 1,
          expectedPassRate: 0.6,
          deadlineHours: 48,
          autoAdvanceScoreThreshold: (round.config as any)?.passingScore || 70,
          autoRefillEnabled: true,
          durationMinutes: (round.config as any)?.durationMinutes || 30,
          passingScore: (round.config as any)?.passingScore || 70,
          questionCount: (round.config as any)?.customQuestions?.length || 0,
          schedule: (round.config as any)?.schedule || (round.date ? {
            date: round.date,
            startTime: round.startTime,
            endTime: round.endTime,
            durationHours: round.durationHours,
          } : undefined),
          config: (round.config || {}) as any,
        } as any;
      }
    }

    if (!stage) {
      throw AppError.notFound(`Stage '${stageId}' not found.`);
    }

    // Merge job customQuestions if stage has none
    const roundMatch = job.assessment?.rounds?.find(
      (r: any) => r.id === stageId || r.roundId === stageId || r.type === stage?.assessmentType || r.roundType === stage?.assessmentType
    );
    if (roundMatch && (roundMatch.config as any)?.customQuestions?.length > 0) {
      stage.config = stage.config || {};
      if (!(stage.config as any).customQuestions || (stage.config as any).customQuestions.length === 0) {
        (stage.config as any).customQuestions = (roundMatch.config as any).customQuestions;
        stage.questionCount = (roundMatch.config as any).customQuestions.length;
        (stage.config as any).isConfigured = true;
      }
    }

    return stage;
  }

  /**
   * Updates configuration, questions, pass threshold, and schedule for a pipeline stage.
   */
  public static async updateStageConfig(
    jobId: string,
    stageId: string,
    recruiterUserId: string,
    updateData: {
      stageName?: string;
      durationMinutes?: number;
      passingScore?: number;
      questionCount?: number;
      deadlineHours?: number;
      autoAdvanceScoreThreshold?: number;
      schedule?: {
        date?: string;
        startTime?: string;
        endTime?: string;
        durationHours?: number | string;
        durationFormatted?: string;
      };
      customQuestions?: any[];
      config?: Record<string, unknown>;
    }
  ): Promise<{ success: boolean; stage: IFunnelStage }> {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);
    let config = await HiringFunnelConfigModel.findOne({ jobId });

    if (!config) {
      // Auto-initialize HiringFunnelConfig for this job
      const round = job.assessment?.rounds?.find(
        (r: any) => r.id === stageId || r.roundId === stageId || r.type === stageId
      );
      const stageName = updateData.stageName || round?.name || 'Assessment Stage';
      const initialStage: IFunnelStage = {
        stageId,
        stageName,
        stageType: 'assessment',
        assessmentType: round?.type || 'general',
        order: 1,
        targetCount: 10,
        expectedAttendanceRate: 1,
        expectedPassRate: 0.6,
        deadlineHours: updateData.deadlineHours || 48,
        autoAdvanceScoreThreshold: updateData.autoAdvanceScoreThreshold ?? updateData.passingScore ?? 70,
        autoRefillEnabled: true,
        durationMinutes: updateData.durationMinutes || 30,
        passingScore: updateData.passingScore || 70,
        questionCount: updateData.customQuestions?.length || 0,
        schedule: updateData.schedule,
        config: {
          isConfigured: true,
          configuredAt: new Date().toISOString(),
          customQuestions: updateData.customQuestions || [],
          ...(updateData.config || {}),
        },
      };

      config = new HiringFunnelConfigModel({
        jobId: job._id,
        orgId: job.orgId,
        finalShortlistTarget: job.finalShortlistTarget || 10,
        stages: [initialStage],
        totalFunnelIntakeTarget: 10,
        currentShortlistedCount: 0,
        status: 'active',
        lastCalculatedAt: new Date(),
      });
      await config.save();

      job.hiringEngineConfigId = config._id as any;
      job.hiringEngineEnabled = true;
      await job.save();

      return { success: true, stage: initialStage };
    }

    let stageIndex = config.stages.findIndex((s) => s.stageId === stageId);
    let stage: IFunnelStage;

    if (stageIndex === -1) {
      const round = job.assessment?.rounds?.find(
        (r: any) => r.id === stageId || r.roundId === stageId || r.type === stageId
      );
      stage = {
        stageId,
        stageName: updateData.stageName || round?.name || 'Assessment Stage',
        stageType: 'assessment',
        assessmentType: round?.type || 'general',
        order: config.stages.length + 1,
        targetCount: 10,
        expectedAttendanceRate: 1,
        expectedPassRate: 0.6,
        deadlineHours: updateData.deadlineHours || 48,
        autoAdvanceScoreThreshold: updateData.autoAdvanceScoreThreshold ?? updateData.passingScore ?? 70,
        autoRefillEnabled: true,
        durationMinutes: updateData.durationMinutes || 30,
        passingScore: updateData.passingScore || 70,
        questionCount: updateData.customQuestions?.length || 0,
        schedule: updateData.schedule,
        config: {
          isConfigured: true,
          configuredAt: new Date().toISOString(),
          customQuestions: updateData.customQuestions || [],
          ...(updateData.config || {}),
        },
      };
      config.stages.push(stage);
    } else {
      stage = config.stages[stageIndex];
      if (updateData.stageName) stage.stageName = updateData.stageName;
      if (typeof updateData.durationMinutes === 'number') stage.durationMinutes = updateData.durationMinutes;
      if (typeof updateData.passingScore === 'number') stage.passingScore = updateData.passingScore;
      if (typeof updateData.questionCount === 'number') stage.questionCount = updateData.questionCount;
      if (typeof updateData.deadlineHours === 'number') stage.deadlineHours = updateData.deadlineHours;
      if (typeof updateData.autoAdvanceScoreThreshold === 'number') {
        stage.autoAdvanceScoreThreshold = updateData.autoAdvanceScoreThreshold;
      }
      if (updateData.schedule) stage.schedule = updateData.schedule;

      stage.config = stage.config || {};
      if (updateData.customQuestions) {
        stage.config.customQuestions = updateData.customQuestions;
        stage.questionCount = updateData.customQuestions.length;
      }
      if (updateData.config) {
        stage.config = { ...stage.config, ...updateData.config };
      }
      stage.config.isConfigured = true;
      stage.config.configuredAt = new Date().toISOString();
    }

    config.markModified('stages');
    await config.save();

    // Also synchronize into JobModel.assessment.rounds if present
    if (job.assessment?.rounds) {
      const roundIdx = job.assessment.rounds.findIndex(
        (r: any) =>
          r.id === stageId ||
          r.roundId === stageId ||
          r.type === stage.assessmentType ||
          r.roundType === stage.assessmentType
      );
      if (roundIdx !== -1) {
        const round = job.assessment.rounds[roundIdx];
        round.config = round.config || {};
        if (typeof updateData.durationMinutes === 'number') {
          (round.config as any).durationMinutes = updateData.durationMinutes;
        }
        if (typeof updateData.passingScore === 'number') {
          (round.config as any).passingScore = updateData.passingScore;
        }
        if (updateData.customQuestions) {
          (round.config as any).customQuestions = updateData.customQuestions;
          (round.config as any).totalQuestions = updateData.customQuestions.length;
          (round.config as any).isConfigured = true;
        }
        if (updateData.schedule) {
          (round.config as any).schedule = updateData.schedule;
        }
        if (updateData.config) {
          round.config = { ...(round.config as any), ...(updateData.config as any) };
        }
        (round.config as any).isConfigured = true;
        job.markModified('assessment.rounds');
        await job.save();
      }
    }

    return { success: true, stage };
  }

  // ==========================================
  // SHORTLIST ENGINE & 5-STAGE PIPELINE LOGIC
  // ==========================================

  public static readonly CANONICAL_SHORTLIST_STAGES = [
    {
      stageId: 'stage_resume_screen',
      stageName: 'Resume Screening',
      slug: 'resume-screening',
      order: 1,
      stageType: 'resume_match',
      passingScore: 70,
      targetCount: 20,
    },
    {
      stageId: 'stage_assessment',
      stageName: 'Assessment',
      slug: 'assessment',
      order: 2,
      stageType: 'assessment',
      passingScore: 75,
      targetCount: 15,
    },
    {
      stageId: 'stage_ai_interview',
      stageName: 'Interview',
      slug: 'interview',
      order: 3,
      stageType: 'ai_interview',
      passingScore: 75,
      targetCount: 10,
    },
    {
      stageId: 'stage_final_shortlist',
      stageName: 'Final Shortlist',
      slug: 'final-shortlist',
      order: 4,
      stageType: 'manual_review',
      passingScore: 80,
      targetCount: 5,
    },
    {
      stageId: 'stage_bgc',
      stageName: 'Background Verification (BGC)',
      slug: 'bgc',
      order: 5,
      stageType: 'manual_review',
      passingScore: 80,
      targetCount: 5,
    },
  ];

  /**
   * Resolves any stage identifier (slug, ID, or order) to its corresponding 5-stage definition.
   */
  public static resolveShortlistStage(
    identifier: string,
    configStages?: IFunnelStage[]
  ) {
    const norm = String(identifier || '').toLowerCase().trim().replace(/[\s_]+/g, '-');

    if (configStages && configStages.length > 0) {
      const matched = configStages.find((s) => {
        const sId = s.stageId.toLowerCase().replace(/[\s_]+/g, '-');
        const sName = s.stageName.toLowerCase().replace(/[\s_]+/g, '-');
        return sId === norm || sName === norm || String(s.order) === norm || sId.includes(norm) || norm.includes(sId);
      });
      if (matched) {
        const canonical = this.CANONICAL_SHORTLIST_STAGES.find(
          (c) => c.order === matched.order || c.stageId === matched.stageId
        );
        return {
          stageId: matched.stageId,
          stageName: matched.stageName,
          slug: canonical?.slug || matched.stageId.replace(/_/g, '-'),
          order: matched.order,
          stageType: matched.stageType,
          passingScore: matched.passingScore || (matched.config as any)?.passingScore || 70,
          targetCount: matched.targetCount || 10,
        };
      }
    }

    if (norm === '1' || norm.includes('resume') || norm.includes('screen')) {
      return this.CANONICAL_SHORTLIST_STAGES[0];
    }
    if (norm === '2' || norm.includes('assessment') || norm.includes('test') || norm.includes('quiz')) {
      return this.CANONICAL_SHORTLIST_STAGES[1];
    }
    if (norm === '3' || norm.includes('interview') || norm.includes('ai-interview') || norm.includes('human')) {
      return this.CANONICAL_SHORTLIST_STAGES[2];
    }
    if (norm === '4' || norm.includes('final') || norm.includes('shortlist')) {
      return this.CANONICAL_SHORTLIST_STAGES[3];
    }
    if (norm === '5' || norm.includes('bgc') || norm.includes('background') || norm.includes('verification')) {
      return this.CANONICAL_SHORTLIST_STAGES[4];
    }

    const parsedOrder = parseInt(norm, 10);
    if (!isNaN(parsedOrder) && parsedOrder >= 1 && parsedOrder <= 5) {
      return this.CANONICAL_SHORTLIST_STAGES[parsedOrder - 1];
    }

    return this.CANONICAL_SHORTLIST_STAGES[0];
  }

  /**
   * Strictly evaluates whether a candidate has passed/been shortlisted for the requested stage.
   */
  private static isCandidatePassedStage(
    app: any,
    stageOrder: number,
    stageId: string,
    histories: any[]
  ): boolean {
    const candHistories = histories.filter(
      (h) => String(h.applicationId) === String(app._id) || String(h.candidateId) === String(app.userId?._id || app.userId)
    );

    // Rule 1: Disqualified if failed at any prior stage
    const failedPrior = candHistories.some(
      (h) => h.stageIndex < stageOrder && (h.status === 'failed' || h.status === 'no_show')
    );
    if (failedPrior) return false;

    // Rule 2: Disqualified if currentStageIndex is before this stage and app is failed
    const currentIdx = app.currentStageIndex || 1;
    if (currentIdx < stageOrder && (app.stageStatus === 'failed' || app.stageStatus === 'no_show' || app.status === 'rejected' || app.status === 'failed' || app.poolType === 'disqualified')) {
      return false;
    }

    // Rule 3: Disqualified if failed at this exact stage
    if (currentIdx === stageOrder && (app.stageStatus === 'failed' || app.stageStatus === 'no_show' || app.status === 'rejected' || app.status === 'failed' || app.poolType === 'disqualified')) {
      return false;
    }
    const failedThis = candHistories.some(
      (h) => (h.stageIndex === stageOrder || h.stageId === stageId) && (h.status === 'failed' || h.status === 'no_show')
    );
    if (failedThis) return false;

    // Rule 4: Explicit pass recorded in history for this stage
    const passedThisInHistory = candHistories.some(
      (h) => (h.stageIndex === stageOrder || h.stageId === stageId) && (h.status === 'passed' || h.status === 'completed')
    );
    if (passedThisInHistory) return true;

    // Rule 5: Candidate progressed beyond this stage
    if (currentIdx > stageOrder) return true;

    // Rule 6: Candidate is currently at this stage and has passed status
    if (currentIdx === stageOrder && (app.stageStatus === 'passed' || app.status === 'shortlisted')) {
      return true;
    }

    // Stage 1 (Resume Screening) fallback evaluation:
    if (stageOrder === 1) {
      if (app.resumeDecision === 'shortlisted' || app.resumeScreeningStatus === 'ai_reviewed') {
        return true;
      }
      // If candidate is in active primary pool or has valid match score and not rejected
      if (app.status !== 'rejected' && app.status !== 'failed' && app.poolType !== 'disqualified' && (app.matchScore || 0) >= 60) {
        return true;
      }
    }

    // Stage 4 / 5 final offer sync:
    if (stageOrder === 4 && ['offered', 'hired', 'shortlisted'].includes(app.status)) {
      return true;
    }
    if (stageOrder === 5 && ['offered', 'hired'].includes(app.status)) {
      return true;
    }

    return false;
  }

  /**
   * Strictly evaluates whether a candidate was eliminated at the requested stage.
   */
  private static isCandidateEliminatedAtStage(
    app: any,
    stageOrder: number,
    stageId: string,
    histories: any[]
  ): boolean {
    const candHistories = histories.filter(
      (h) => String(h.applicationId) === String(app._id) || String(h.candidateId) === String(app.userId?._id || app.userId)
    );

    // If history shows failure at this stage
    const failedThisInHistory = candHistories.some(
      (h) => (h.stageIndex === stageOrder || h.stageId === stageId) && (h.status === 'failed' || h.status === 'no_show')
    );
    if (failedThisInHistory) return true;

    const currentIdx = app.currentStageIndex || 1;

    // If candidate's current stage index matches and stageStatus is failed / no_show / rejected
    if (currentIdx === stageOrder && (app.stageStatus === 'failed' || app.stageStatus === 'no_show' || app.status === 'rejected' || app.status === 'failed' || app.poolType === 'disqualified')) {
      return true;
    }

    // Stage 1 resume rejection
    if (stageOrder === 1 && (app.resumeDecision === 'rejected' || (!app.currentStageIndex && (app.status === 'rejected' || app.status === 'failed')))) {
      return true;
    }

    return false;
  }

  /**
   * Formats a candidate application for the Shortlist API responses.
   */
  private static formatShortlistCandidate(
    app: any,
    stageDef: { stageId: string; stageName: string; order: number; stageType: string; slug?: string },
    userProfile?: any,
    isEliminated: boolean = false
  ) {
    const user = app.userId && typeof app.userId === 'object' ? app.userId : {};
    const resume = app.resumeId && typeof app.resumeId === 'object' ? app.resumeId : null;
    const profile = userProfile || {};

    const name =
      user.fullName ||
      `${profile?.personal?.firstName || ''} ${profile?.personal?.lastName || ''}`.trim() ||
      user.username ||
      'Candidate';

    const email = user.email || profile?.contact?.email || profile?.contact?.alternateEmail || '';
    const phone = user.phone || profile?.contact?.phone || '';
    const role =
      profile?.personal?.headline ||
      (resume?.content as any)?.personalInfo?.headline ||
      (resume?.content as any)?.title ||
      'Developer';

    let experience = '1-3 Years';
    if (Array.isArray(profile?.experiencesList) && profile.experiencesList.length > 0) {
      experience = `${profile.experiencesList.length}+ Years`;
    } else if (profile?.track === 'fresher') {
      experience = 'Fresher';
    } else if (app.matchScore && app.matchScore > 85) {
      experience = '3+ Years';
    }

    const matchScore = app.matchScore || (resume?.atsScore ? resume.atsScore : 82);
    const assessmentScore =
      app.assessmentScore ?? (stageDef.order >= 2 ? Math.min(100, Math.round(matchScore * 0.95)) : undefined);
    const interviewScore =
      app.aiScore ?? (stageDef.order >= 3 ? Math.min(100, Math.round(matchScore * 0.92)) : undefined);

    let eliminationReason: string | undefined;
    if (isEliminated) {
      eliminationReason =
        app.notes ||
        (app.stageStatus === 'no_show'
          ? `Stage deadline expired without candidate starting evaluation.`
          : app.resumeDecisionNotes || `Candidate did not meet the required threshold for ${stageDef.stageName}.`);
    }

    return {
      _id: String(app._id),
      applicationId: String(app._id),
      candidateId: String(user._id || app.userId),
      userId: {
        _id: String(user._id || app.userId),
        fullName: name,
        username: user.username || '',
        email,
        phone,
        avatarUrl: user.avatarUrl || user.avatar || '',
        role,
        experience,
      },
      candidate: {
        _id: String(user._id || app.userId),
        fullName: name,
        email,
        phone,
        avatarUrl: user.avatarUrl || user.avatar || '',
      },
      name,
      email,
      phone,
      role,
      experience,
      matchScore,
      assessmentScore,
      aiScore: app.aiScore ?? interviewScore,
      interviewScore,
      currentStage: stageDef.stageName,
      currentStageId: stageDef.stageId,
      currentStageIndex: stageDef.order,
      candidateStatus: isEliminated ? 'eliminated' : (app.status || 'shortlisted'),
      stageStatus: app.stageStatus || (isEliminated ? 'failed' : 'passed'),
      poolType: app.poolType || (isEliminated ? 'disqualified' : 'primary'),
      eliminationStatus: isEliminated ? (app.stageStatus || 'eliminated') : undefined,
      eliminationReason,
      disqualificationReason: eliminationReason,
      notes: app.notes || '',
      resumeId: resume,
      resume: resume || undefined,
      profile: profile || undefined,
      appliedAt: app.appliedAt || app.createdAt,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }

  /**
   * GET /api/recruiter/jobs/:jobId/hiring-engine/shortlist
   * Returns stage-wise Shortlist Pipeline metrics for the selected job across all 5 sequential stages.
   */
  public static async getShortlistSummary(
    jobId: string,
    recruiterUserId: string
  ): Promise<{
    jobId: string;
    jobTitle: string;
    totalApplicants: number;
    totalSelected: number;
    totalEliminated: number;
    stages: Array<{
      id: string;
      stageId: string;
      name: string;
      stageName: string;
      slug: string;
      order: number;
      stageType: string;
      selectedCount: number;
      eliminatedCount: number;
      totalCount: number;
      ratio: string;
      eliminatedRatio: string;
      percentage: string;
      targetCount: number;
      passingScore: number;
    }>;
  }> {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);
    const config = await this.getFunnelConfig(jobId, recruiterUserId);

    // Fetch all applications and histories for this job in single batch queries
    const allApplications = await ApplicationModel.find({ jobId })
      .populate({ path: 'userId', model: UserModel, select: 'fullName username email phone avatarUrl avatar' })
      .populate({ path: 'resumeId', model: ResumeModel, select: 'title atsScore content settings createdAt updatedAt' })
      .lean();

    const allHistories = await CandidateStageHistoryModel.find({ jobId }).lean();

    let totalSelectedAcrossJob = 0;
    let totalEliminatedAcrossJob = 0;

    const stagesSummary = this.CANONICAL_SHORTLIST_STAGES.map((stageDef) => {
      // Find matching stage in config if present to grab custom configured threshold/targets
      const configStage = config?.stages?.find(
        (s) => s.order === stageDef.order || s.stageId === stageDef.stageId
      );

      const targetCount = configStage?.targetCount || stageDef.targetCount;
      const passingScore = configStage?.passingScore || stageDef.passingScore;

      // Calculate stage counts strictly
      let selectedCount = 0;
      let eliminatedCount = 0;

      for (const app of allApplications) {
        if (this.isCandidatePassedStage(app, stageDef.order, stageDef.stageId, allHistories)) {
          selectedCount++;
        } else if (this.isCandidateEliminatedAtStage(app, stageDef.order, stageDef.stageId, allHistories)) {
          eliminatedCount++;
        }
      }

      totalSelectedAcrossJob += selectedCount;
      totalEliminatedAcrossJob += eliminatedCount;

      const totalCount = selectedCount + eliminatedCount;
      const percentageNum = totalCount > 0 ? Math.round((selectedCount / totalCount) * 100) : 0;

      return {
        id: stageDef.stageId,
        stageId: stageDef.stageId,
        name: stageDef.stageName,
        stageName: stageDef.stageName,
        slug: stageDef.slug,
        order: stageDef.order,
        stageType: stageDef.stageType,
        selectedCount,
        eliminatedCount,
        totalCount,
        ratio: `${selectedCount}/${totalCount}`,
        eliminatedRatio: `${eliminatedCount}/${totalCount}`,
        percentage: `${percentageNum}%`,
        targetCount,
        passingScore,
      };
    });

    return {
      jobId: String(job._id),
      jobTitle: job.title,
      totalApplicants: allApplications.length,
      totalSelected: stagesSummary[stagesSummary.length - 2]?.selectedCount || stagesSummary[0]?.selectedCount || 0,
      totalEliminated: totalEliminatedAcrossJob,
      stages: stagesSummary,
    };
  }

  /**
   * GET /api/recruiter/jobs/:jobId/hiring-engine/shortlist/:stageId/:status
   * Returns ONLY the shortlisted OR eliminated candidates for a specific stage.
   */
  public static async getShortlistStageCandidates(
    jobId: string,
    stageIdentifier: string,
    status: string,
    recruiterUserId: string
  ) {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);
    const config = await this.getFunnelConfig(jobId, recruiterUserId);

    const stageDef = this.resolveShortlistStage(stageIdentifier, config?.stages);
    const isShortlisted =
      !status ||
      status.toLowerCase() === 'shortlisted' ||
      status.toLowerCase() === 'selected' ||
      status.toLowerCase() === 'passed';

    // Query applications and histories
    const allApplications = await ApplicationModel.find({ jobId })
      .populate({ path: 'userId', model: UserModel, select: 'fullName username email phone avatarUrl avatar' })
      .populate({ path: 'resumeId', model: ResumeModel, select: 'title atsScore content settings createdAt updatedAt' })
      .sort({ matchScore: -1, appliedAt: 1 })
      .lean();

    const allHistories = await CandidateStageHistoryModel.find({ jobId }).lean();

    // Pre-fetch user profiles in batch for candidate headline / experience resolution
    const userIds = allApplications.map((a) => (a.userId as any)?._id || a.userId).filter(Boolean);
    const userProfiles = await UserProfileModel.find({ userId: { $in: userIds } }).lean();
    const profileMap = new Map<string, any>();
    for (const p of userProfiles) {
      profileMap.set(String(p.userId), p);
    }

    // Filter strictly based on shortlisted vs eliminated
    const matchedApps = allApplications.filter((app) => {
      if (isShortlisted) {
        return this.isCandidatePassedStage(app, stageDef.order, stageDef.stageId, allHistories);
      } else {
        return this.isCandidateEliminatedAtStage(app, stageDef.order, stageDef.stageId, allHistories);
      }
    });

    const candidates = matchedApps.map((app) => {
      const uId = String((app.userId as any)?._id || app.userId);
      const userProfile = profileMap.get(uId);
      return this.formatShortlistCandidate(app, stageDef, userProfile, !isShortlisted);
    });

    return {
      jobId: String(job._id),
      stage: stageDef,
      status: isShortlisted ? 'shortlisted' : 'eliminated',
      count: candidates.length,
      candidates,
    };
  }

  /**
   * GET /api/recruiter/jobs/:jobId/hiring-engine/candidates/:applicationId
   * Retrieves full candidate profile details, stage history, and resume reference.
   */
  public static async getCandidateDetail(
    jobId: string,
    applicationId: string,
    recruiterUserId: string
  ) {
    await this.verifyJobOwnership(jobId, recruiterUserId);

    if (!Types.ObjectId.isValid(applicationId)) {
      throw AppError.badRequest('Invalid application ID.');
    }

    const application = await ApplicationModel.findOne({ _id: applicationId, jobId })
      .populate({ path: 'userId', model: UserModel, select: 'fullName username email phone avatarUrl avatar' })
      .populate({ path: 'resumeId', model: ResumeModel, select: 'title atsScore content settings isPublic createdAt updatedAt' })
      .lean();

    if (!application) {
      throw AppError.notFound('Candidate application not found for this job.');
    }

    const uId = String((application.userId as any)?._id || application.userId);
    const [history, profile] = await Promise.all([
      CandidateStageHistoryModel.find({ applicationId, jobId }).sort({ enteredAt: 1 }).lean(),
      UserProfileModel.findOne({ userId: uId }).lean(),
    ]);

    const stageDef = this.resolveShortlistStage(String(application.currentStageIndex || 1));
    const isEliminated =
      application.stageStatus === 'failed' ||
      application.stageStatus === 'no_show' ||
      application.status === 'rejected' ||
      application.poolType === 'disqualified';

    const formatted = this.formatShortlistCandidate(application, stageDef, profile, isEliminated);

    return {
      ...formatted,
      jobId: String(application.jobId),
      history,
      resumeEvaluation: application.resumeEvaluation,
      finalShortlistDecision: application.finalShortlistDecision,
      offeredAt: application.offeredAt,
      hiredAt: application.hiredAt,
    };
  }

  /**
   * GET /api/recruiter/jobs/:jobId/hiring-engine/candidates/:applicationId/resume
   * Retrieves the candidate's resume for the recruiter.
   */
  public static async getCandidateResume(
    jobId: string,
    applicationId: string,
    recruiterUserId: string
  ) {
    await this.verifyJobOwnership(jobId, recruiterUserId);

    if (!Types.ObjectId.isValid(applicationId)) {
      throw AppError.badRequest('Invalid application ID.');
    }

    const application = await ApplicationModel.findOne({ _id: applicationId, jobId }).lean();
    if (!application) {
      throw AppError.notFound('Candidate application not found.');
    }

    let resume: any = null;
    if (application.resumeId) {
      resume = await ResumeModel.findById(application.resumeId).lean();
    }

    if (!resume && application.userId) {
      resume = await ResumeModel.findOne({ userId: application.userId, isActive: true }).lean();
      if (!resume) {
        resume = await ResumeModel.findOne({ userId: application.userId }).sort({ updatedAt: -1 }).lean();
      }
    }

    if (!resume) {
      throw AppError.notFound('No resume document found for this candidate.');
    }

    return resume;
  }
}
