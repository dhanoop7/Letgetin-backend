import { Types } from 'mongoose';
import { AppError } from '../../../utils/appError.js';
import { JobModel } from '../../job/job.model.js';
import { ApplicationModel, IApplicationDocument } from '../../application/application.model.js';
import { UserModel } from '../../user/user.model.js';
import { ResumeModel } from '../../resume/resume.model.js';
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
}

export interface FunnelMetricsReport {
  jobId: string;
  jobTitle: string;
  finalShortlistTarget: number;
  currentShortlistedCount: number;
  totalFunnelIntakeTarget: number;
  totalApplicants: number;
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

      return {
        stageId: stage.stageId,
        stageName: stage.stageName,
        stageType: stage.stageType,
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

    return {
      jobId: String(job._id),
      jobTitle: job.title,
      finalShortlistTarget: config.finalShortlistTarget,
      currentShortlistedCount: config.currentShortlistedCount,
      totalFunnelIntakeTarget: config.totalFunnelIntakeTarget,
      totalApplicants: allApplications.length,
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
}
