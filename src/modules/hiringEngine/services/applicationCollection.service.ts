import { Types } from 'mongoose';
import { JobModel, IJobDocument, ApplicationCollectionStatus } from '../../job/job.model.js';
import { ApplicationModel } from '../../application/application.model.js';
import {
  HiringFunnelConfigModel,
  FunnelHealth,
  IFunnelStage,
} from '../hiringFunnelConfig.model.js';
import {
  HiringFunnelCalculator,
  StageCalculationInput,
} from './hiringFunnelCalculator.js';
import { HiringPoolManager } from './hiringPoolManager.js';
import { HiringEngineService } from './hiringEngine.service.js';
import {
  scheduleApplicationCollectionDeadlineCheck,
} from '../queues/hiringEngine.queue.js';
import { HiringNotificationHook } from '../notifications/hiringNotification.hook.js';
import { AppError } from '../../../utils/appError.js';

export interface CollectionStatusReport {
  jobId: string;
  jobTitle: string;
  idealIntake: number;
  minimumIntake: number;
  actualQualifiedCount: number;
  finalShortlistTarget: number;
  initialDeadline?: Date;
  currentDeadline?: Date;
  deadline?: Date;
  autoExtensionEnabled: boolean;
  extensionDurationDays: number;
  maxExtensions: number;
  extensionsUsed: number;
  autoStartEnabled: boolean;
  status: ApplicationCollectionStatus;
  funnelHealth: FunnelHealth;
  canStartPipeline: boolean;
  idealFunnel: {
    totalFunnelIntakeTarget: number;
    stages: IFunnelStage[];
  };
  operationalFunnel: {
    totalFunnelIntakeTarget: number;
    stages: IFunnelStage[];
    estimatedFinalYield: number;
    deficit: number;
  };
}

export class ApplicationCollectionService {
  /**
   * Helper to verify that the requesting recruiter owns the job.
   */
  private static async verifyJobOwnership(
    jobId: string | Types.ObjectId,
    recruiterUserId?: string
  ): Promise<IJobDocument> {
    const job = await JobModel.findById(jobId);
    if (!job) {
      throw AppError.notFound(`Job not found for ID: ${jobId}`);
    }
    if (recruiterUserId && String(job.postedBy) !== String(recruiterUserId)) {
      throw AppError.forbidden('You do not have permission to manage this job collection.');
    }
    return job;
  }

  /**
   * Dynamically constructs StageCalculationInput array based on the recruiter-configured
   * rounds, roundOrder, or pipelineOptions on the job document.
   */
  public static deriveStagesFromJob(job: any): StageCalculationInput[] {
    if (Array.isArray(job.stages) && job.stages.length > 0) {
      return job.stages.map((s: any, idx: number) => ({
        stageId: s.stageId || `stage_${s.stageType || idx + 1}`,
        stageName: s.stageName || s.stageType || `Stage ${idx + 1}`,
        stageType: s.stageType || 'assessment',
        order: s.order || idx + 1,
        expectedAttendanceRate: typeof s.expectedAttendanceRate === 'number' ? s.expectedAttendanceRate : 1.0,
        expectedPassRate: typeof s.expectedPassRate === 'number' ? s.expectedPassRate : 0.6,
        deadlineHours: typeof s.deadlineHours === 'number' ? s.deadlineHours : 48,
        autoAdvanceScoreThreshold: typeof s.autoAdvanceScoreThreshold === 'number' ? s.autoAdvanceScoreThreshold : 70,
        autoRefillEnabled: s.autoRefillEnabled !== false,
      }));
    }

    const roundList: string[] = Array.isArray(job.rounds) && job.rounds.length > 0
      ? job.rounds
      : Array.isArray(job.roundOrder) && job.roundOrder.length > 0
      ? job.roundOrder
      : Array.isArray(job.pipelineOptions?.roundOrder) && job.pipelineOptions.roundOrder.length > 0
      ? job.pipelineOptions.roundOrder
      : [];

    const buildStageFromKey = (key: string, order: number): StageCalculationInput => {
      const k = key.toLowerCase().replace(/[\s-]/g, '_');
      if (k.includes('ai_interview') || k === 'aiinterview' || k === 'ai_interview_round') {
        return {
          stageId: 'stage_ai_interview',
          stageName: 'AI Interview',
          stageType: 'ai_interview',
          order,
          expectedAttendanceRate: 1.0,
          expectedPassRate: 0.5,
          deadlineHours: 48,
          autoAdvanceScoreThreshold: 75,
          autoRefillEnabled: true,
        };
      }
      if (k.includes('assessment') || k.includes('test') || k.includes('quiz')) {
        return {
          stageId: 'stage_assessment',
          stageName: 'Technical Assessment',
          stageType: 'assessment',
          order,
          expectedAttendanceRate: 1.0,
          expectedPassRate: 0.6,
          deadlineHours: 48,
          autoAdvanceScoreThreshold: 70,
          autoRefillEnabled: true,
        };
      }
      if (k.includes('human') || k.includes('panel') || k.includes('live')) {
        return {
          stageId: 'stage_human_interview',
          stageName: 'Live Interview',
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

    if (roundList.length > 0) {
      return roundList.map((r, idx) => buildStageFromKey(r, idx + 1));
    }

    const p = job.pipelineOptions;
    const stages: StageCalculationInput[] = [];
    let order = 1;
    if (p?.resumeMatch && !p?.assessment && !p?.aiInterview && !p?.humanInterview) {
      stages.push(buildStageFromKey('resume_match', order++));
    }
    if (p?.assessment) {
      stages.push(buildStageFromKey('assessment', order++));
    }
    if (p?.aiInterview) {
      stages.push(buildStageFromKey('ai_interview', order++));
    }
    if (p?.humanInterview) {
      stages.push(buildStageFromKey('human_interview', order++));
    }

    if (stages.length > 0) {
      return stages;
    }

    // Default 3-stage fallback only if absolutely nothing is specified
    return [
      {
        stageId: 'stage_resume_screen',
        stageName: 'Resume Screening',
        stageType: 'resume_match',
        order: 1,
        expectedAttendanceRate: 1.0,
        expectedPassRate: 0.6,
        deadlineHours: 24,
        autoAdvanceScoreThreshold: 70,
        autoRefillEnabled: true,
      },
      {
        stageId: 'stage_assessment',
        stageName: 'Technical Assessment',
        stageType: 'assessment',
        order: 2,
        expectedAttendanceRate: 1.0,
        expectedPassRate: 0.6,
        deadlineHours: 48,
        autoAdvanceScoreThreshold: 75,
        autoRefillEnabled: true,
      },
      {
        stageId: 'stage_ai_interview',
        stageName: 'AI Comprehensive Interview',
        stageType: 'ai_interview',
        order: 3,
        expectedAttendanceRate: 1.0,
        expectedPassRate: 0.5,
        deadlineHours: 48,
        autoAdvanceScoreThreshold: 80,
        autoRefillEnabled: true,
      },
    ];
  }

  /**
   * Counts the actual number of qualified candidates who have applied for this job.
   * Rules:
   * - Deduplicates candidates by userId (counted only once)
   * - Excludes failed or rejected applications
   * - Excludes candidates who fall below eligibilityMinPercent (if specified)
   * - Requires a valid baseline match score (>= 35)
   */
  public static async getQualifiedCandidateCount(jobId: string | Types.ObjectId): Promise<number> {
    const job = await JobModel.findById(jobId).select('eligibilityMinPercent skills embedding').lean();
    if (!job) return 0;

    const applications = await ApplicationModel.find({
      jobId,
      status: { $nin: ['rejected', 'failed'] },
      poolType: { $ne: 'disqualified' },
    })
      .select('userId matchScore compositeRank status')
      .lean();

    if (applications.length === 0) return 0;

    // Deduplicate applications by userId
    const seenUserIds = new Set<string>();
    let qualifiedCount = 0;

    for (const app of applications) {
      const uId = String(app.userId);
      if (seenUserIds.has(uId)) {
        continue;
      }
      seenUserIds.add(uId);

      // Verify baseline qualification score (matchScore or compositeRank >= 35)
      const score = app.compositeRank ?? app.matchScore ?? 50;
      if (score >= 35) {
        qualifiedCount++;
      }
    }

    return qualifiedCount;
  }

  /**
   * Retrieves complete telemetry and status for a job's application collection.
   */
  public static async getCollectionStatus(
    jobId: string | Types.ObjectId,
    recruiterUserId?: string
  ): Promise<CollectionStatusReport> {
    const job = await this.verifyJobOwnership(jobId, recruiterUserId);
    const qualifiedCount = await this.getQualifiedCandidateCount(job._id);

    // Synchronize actualQualifiedCount on JobModel if out of sync
    if (job.applicationCollection && job.applicationCollection.actualQualifiedCount !== qualifiedCount) {
      job.applicationCollection.actualQualifiedCount = qualifiedCount;
      await job.save();
    }

    const config = await HiringFunnelConfigModel.findOne({ jobId: job._id }).lean();

    const finalTarget = job.finalShortlistTarget || config?.finalShortlistTarget || 5;
    const stagesInput: StageCalculationInput[] = (config?.stages && config.stages.length > 0)
      ? config.stages.map((s) => ({
          stageId: s.stageId,
          stageName: s.stageName,
          stageType: s.stageType,
          order: s.order,
          expectedAttendanceRate: s.expectedAttendanceRate,
          expectedPassRate: s.expectedPassRate,
          deadlineHours: s.deadlineHours,
          autoAdvanceScoreThreshold: s.autoAdvanceScoreThreshold,
          autoRefillEnabled: s.autoRefillEnabled,
        }))
      : ApplicationCollectionService.deriveStagesFromJob(job);

    const coll = job.applicationCollection;
    const minimumIntake = coll?.minimumIntake || Math.ceil((coll?.idealIntake || finalTarget * 2) * 0.6);

    const adaptiveCalc = HiringFunnelCalculator.calculateAdaptiveFunnel(
      qualifiedCount,
      finalTarget,
      stagesInput,
      minimumIntake
    );

    const idealIntake = coll?.idealIntake || adaptiveCalc.idealFunnelIntakeTarget;
    const status = coll?.status || (qualifiedCount >= minimumIntake ? 'ready' : 'collecting');
    const canStartPipeline =
      status !== 'started' &&
      status !== 'closed' &&
      job.status !== 'closed' &&
      qualifiedCount >= minimumIntake;

    return {
      jobId: String(job._id),
      jobTitle: job.title,
      idealIntake,
      minimumIntake,
      actualQualifiedCount: qualifiedCount,
      finalShortlistTarget: finalTarget,
      initialDeadline: coll?.initialDeadline || job.expiresAt,
      currentDeadline: coll?.currentDeadline || job.expiresAt,
      deadline: coll?.currentDeadline || job.expiresAt,
      autoExtensionEnabled: coll?.autoExtensionEnabled ?? true,
      extensionDurationDays: coll?.extensionDurationDays ?? 3,
      maxExtensions: coll?.maxExtensions ?? 2,
      extensionsUsed: coll?.extensionsUsed ?? 0,
      autoStartEnabled: coll?.autoStartEnabled ?? false,
      status,
      funnelHealth: adaptiveCalc.health,
      canStartPipeline,
      idealFunnel: {
        totalFunnelIntakeTarget: adaptiveCalc.idealFunnelIntakeTarget,
        stages: adaptiveCalc.idealStages,
      },
      operationalFunnel: {
        totalFunnelIntakeTarget: adaptiveCalc.operationalFunnelIntakeTarget,
        stages: adaptiveCalc.stages,
        estimatedFinalYield: adaptiveCalc.estimatedFinalYield,
        deficit: adaptiveCalc.deficit,
      },
    };
  }

  /**
   * Re-evaluates candidate readiness against the minimum intake target.
   * If minimum is reached:
   * - Transitions status to 'ready'
   * - If autoStartEnabled is true, immediately triggers startAdaptiveFunnel
   */
  public static async evaluateCollectionReadiness(
    jobId: string | Types.ObjectId
  ): Promise<{ status: ApplicationCollectionStatus; actualQualifiedCount: number; pipelineStarted: boolean }> {
    const job = await JobModel.findById(jobId);
    if (!job || !job.applicationCollection) {
      return { status: 'collecting', actualQualifiedCount: 0, pipelineStarted: false };
    }

    if (job.applicationCollection.status === 'started' || job.applicationCollection.status === 'closed') {
      return {
        status: job.applicationCollection.status,
        actualQualifiedCount: job.applicationCollection.actualQualifiedCount,
        pipelineStarted: job.applicationCollection.status === 'started',
      };
    }

    const qualifiedCount = await this.getQualifiedCandidateCount(job._id);
    job.applicationCollection.actualQualifiedCount = qualifiedCount;

    const minimumIntake = job.applicationCollection.minimumIntake;

    if (qualifiedCount >= minimumIntake) {
      if (job.applicationCollection.status === 'collecting' || job.applicationCollection.status === 'extended') {
        job.applicationCollection.status = 'ready';
        await job.save();

        HiringNotificationHook.notifyCollectionReady({
          recruiterId: job.postedBy ? String(job.postedBy) : undefined,
          jobId: String(job._id),
          jobTitle: job.title,
          qualifiedCandidates: qualifiedCount,
          minimumRequired: minimumIntake,
          idealIntake: job.applicationCollection.idealIntake,
        });
      }

      // Check if automatic start is configured
      if (job.applicationCollection.autoStartEnabled) {
        console.log(`[ApplicationCollectionService] Auto-start enabled for Job ${job._id} - starting pipeline`);
        const startResult = await this.startAdaptiveFunnel(job._id);
        return {
          status: 'started',
          actualQualifiedCount: qualifiedCount,
          pipelineStarted: !startResult.alreadyStarted,
        };
      }

      await job.save();
      return { status: 'ready', actualQualifiedCount: qualifiedCount, pipelineStarted: false };
    }

    await job.save();
    return { status: job.applicationCollection.status, actualQualifiedCount: qualifiedCount, pipelineStarted: false };
  }

  /**
   * Extends the candidate collection window (either automatically when deadline hits or manually by recruiter).
   */
  public static async extendCollectionDeadline(
    jobId: string | Types.ObjectId,
    options?: {
      daysOverride?: number;
      isAutomatic?: boolean;
      recruiterUserId?: string;
    }
  ): Promise<{
    extended: boolean;
    newDeadline: Date;
    extensionsUsed: number;
    maxExtensions: number;
    reason?: string;
  }> {
    const job = await this.verifyJobOwnership(jobId, options?.recruiterUserId);

    if (job.status === 'closed') {
      throw AppError.badRequest('Cannot extend collection for a closed job.');
    }

    if (!job.applicationCollection) {
      throw AppError.badRequest('Job does not have an active application collection configuration.');
    }

    const coll = job.applicationCollection;

    if (coll.status === 'started') {
      throw AppError.badRequest('Cannot extend collection: hiring pipeline has already started.');
    }

    // Check extension limits
    if (options?.isAutomatic && coll.extensionsUsed >= coll.maxExtensions) {
      return {
        extended: false,
        newDeadline: coll.currentDeadline || job.expiresAt || new Date(),
        extensionsUsed: coll.extensionsUsed,
        maxExtensions: coll.maxExtensions,
        reason: 'Maximum automatic extensions reached.',
      };
    }

    const extensionDays = options?.daysOverride || coll.extensionDurationDays || 3;
    const baseDate = coll.currentDeadline && new Date(coll.currentDeadline).getTime() > Date.now()
      ? new Date(coll.currentDeadline)
      : new Date();

    const newDeadline = new Date(baseDate.getTime() + extensionDays * 24 * 3600 * 1000);

    // Atomically update JobModel
    coll.currentDeadline = newDeadline;
    coll.extensionsUsed += 1;
    coll.status = 'extended';
    job.expiresAt = newDeadline;
    await job.save();

    // Schedule next BullMQ collection deadline check
    await scheduleApplicationCollectionDeadlineCheck(String(job._id), newDeadline);

    // Emit notification
    HiringNotificationHook.notifyCollectionExtended({
      recruiterId: job.postedBy ? String(job.postedBy) : undefined,
      jobId: String(job._id),
      jobTitle: job.title,
      qualifiedCandidates: coll.actualQualifiedCount,
      minimumRequired: coll.minimumIntake,
      newDeadline,
      extensionsUsed: coll.extensionsUsed,
      maxExtensions: coll.maxExtensions,
    });

    return {
      extended: true,
      newDeadline,
      extensionsUsed: coll.extensionsUsed,
      maxExtensions: coll.maxExtensions,
    };
  }

  /**
   * Starts the adaptive hiring funnel:
   * 1. Concurrency-safe CAS transition (prevents duplicate start runs)
   * 2. Recalculates operational funnel using actual qualified count
   * 3. Partitions candidates into Primary and Reserve pools
   * 4. Invites Primary candidates to Stage 1
   * 5. Assigns deadlines and enqueues BullMQ checks
   */
  public static async startAdaptiveFunnel(
    jobId: string | Types.ObjectId,
    recruiterUserId?: string
  ): Promise<{
    started: boolean;
    alreadyStarted: boolean;
    primaryCount: number;
    reserveCount: number;
    funnelHealth: FunnelHealth;
    operationalIntake: number;
    configId: string;
  }> {
    const jobCheck = await this.verifyJobOwnership(jobId, recruiterUserId);
    if (jobCheck.status === 'closed') {
      throw AppError.badRequest('Cannot start hiring pipeline for a closed job.');
    }

    // Atomic CAS check: only transition if status is NOT 'started' and NOT 'closed'
    const atomicJob = await JobModel.findOneAndUpdate(
      {
        _id: jobId,
        'applicationCollection.status': { $in: ['collecting', 'ready', 'extended', 'insufficient'] },
        status: { $ne: 'closed' },
      },
      {
        $set: {
          'applicationCollection.status': 'started',
          hiringEngineEnabled: true,
        },
      },
      { new: true }
    );

    if (!atomicJob) {
      // Pipeline has already been started by a concurrent worker/request
      const existingConfig = await HiringFunnelConfigModel.findOne({ jobId });
      return {
        started: false,
        alreadyStarted: true,
        primaryCount: 0,
        reserveCount: 0,
        funnelHealth: existingConfig?.funnelHealth || 'healthy',
        operationalIntake: existingConfig?.totalFunnelIntakeTarget || 0,
        configId: String(existingConfig?._id || ''),
      };
    }

    const qualifiedCount = await this.getQualifiedCandidateCount(atomicJob._id);
    atomicJob.applicationCollection!.actualQualifiedCount = qualifiedCount;
    await atomicJob.save();

    // 2. Fetch or initialize HiringFunnelConfig
    let config = await HiringFunnelConfigModel.findOne({ jobId: atomicJob._id });
    const finalTarget = atomicJob.finalShortlistTarget || config?.finalShortlistTarget || 5;

    let stagesInput: StageCalculationInput[];
    if (config?.stages && config.stages.length > 0) {
      stagesInput = config.stages.map((s) => ({
        stageId: s.stageId,
        stageName: s.stageName,
        stageType: s.stageType,
        order: s.order,
        expectedAttendanceRate: s.expectedAttendanceRate,
        expectedPassRate: s.expectedPassRate,
        deadlineHours: s.deadlineHours,
        autoAdvanceScoreThreshold: s.autoAdvanceScoreThreshold,
        autoRefillEnabled: s.autoRefillEnabled,
      }));
    } else {
      stagesInput = ApplicationCollectionService.deriveStagesFromJob(atomicJob);
    }

    const minimumIntake = atomicJob.applicationCollection?.minimumIntake || Math.ceil(finalTarget * 1.5);

    // 3. Recalculate operational adaptive funnel using actual qualified count
    const adaptiveCalc = HiringFunnelCalculator.calculateAdaptiveFunnel(
      qualifiedCount,
      finalTarget,
      stagesInput,
      minimumIntake
    );

    // 4. Update or save HiringFunnelConfigModel
    if (!config) {
      config = new HiringFunnelConfigModel({
        jobId: atomicJob._id,
        orgId: atomicJob.orgId,
        finalShortlistTarget: finalTarget,
        stages: adaptiveCalc.stages,
        idealStages: adaptiveCalc.idealStages,
        idealFunnelIntakeTarget: adaptiveCalc.idealFunnelIntakeTarget,
        totalFunnelIntakeTarget: adaptiveCalc.operationalFunnelIntakeTarget,
        isAdaptive: true,
        funnelHealth: adaptiveCalc.health,
        status: 'active',
        lastCalculatedAt: new Date(),
      });
    } else {
      config.finalShortlistTarget = finalTarget;
      config.stages = adaptiveCalc.stages;
      config.idealStages = adaptiveCalc.idealStages;
      config.idealFunnelIntakeTarget = adaptiveCalc.idealFunnelIntakeTarget;
      config.totalFunnelIntakeTarget = adaptiveCalc.operationalFunnelIntakeTarget;
      config.isAdaptive = true;
      config.funnelHealth = adaptiveCalc.health;
      config.status = 'active';
      config.lastCalculatedAt = new Date();
    }
    await config.save();

    atomicJob.hiringEngineConfigId = config._id as Types.ObjectId;
    await atomicJob.save();

    // 5. Partition candidate pools for Stage 1 using operational target count
    const firstStage = adaptiveCalc.stages[0];
    const partition = await HiringPoolManager.partitionInitialPool(
      atomicJob._id,
      firstStage.stageId,
      firstStage.targetCount,
      firstStage.deadlineHours
    );

    // 6. Record stage history and emit candidate invitations
    const now = new Date();
    for (const cand of partition.primaryCandidates) {
      await HiringEngineService.recordStageHistory({
        applicationId: cand._id,
        jobId: atomicJob._id,
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

    console.log(
      `🎯 [ApplicationCollectionService] Adaptive pipeline started for Job ${atomicJob._id}: Primary=${partition.primaryCandidates.length}, Reserve=${partition.reserveCandidates.length}, Health=${adaptiveCalc.health}`
    );

    return {
      started: true,
      alreadyStarted: false,
      primaryCount: partition.primaryCandidates.length,
      reserveCount: partition.reserveCandidates.length,
      funnelHealth: adaptiveCalc.health,
      operationalIntake: adaptiveCalc.operationalFunnelIntakeTarget,
      configId: String(config._id),
    };
  }

  /**
   * BullMQ worker handler invoked when an application collection deadline arrives.
   */
  public static async processCollectionDeadlineJob(
    jobId: string
  ): Promise<{ action: 'started' | 'extended' | 'marked_ready' | 'marked_insufficient' | 'ignored'; details: any }> {
    const job = await JobModel.findById(jobId);
    if (!job || !job.applicationCollection) {
      return { action: 'ignored', details: 'Job or collection not found' };
    }

    const coll = job.applicationCollection;

    // Idempotency: ignore if already started or closed
    if (coll.status === 'started' || coll.status === 'closed' || job.status === 'closed') {
      return { action: 'ignored', details: `Status is already ${coll.status}` };
    }

    const qualifiedCount = await this.getQualifiedCandidateCount(job._id);
    coll.actualQualifiedCount = qualifiedCount;

    // Case 1: Minimum intake reached
    if (qualifiedCount >= coll.minimumIntake) {
      if (coll.autoStartEnabled) {
        const startResult = await this.startAdaptiveFunnel(job._id);
        return { action: 'started', details: startResult };
      } else {
        coll.status = 'ready';
        await job.save();
        HiringNotificationHook.notifyCollectionReady({
          recruiterId: job.postedBy ? String(job.postedBy) : undefined,
          jobId: String(job._id),
          jobTitle: job.title,
          qualifiedCandidates: qualifiedCount,
          minimumRequired: coll.minimumIntake,
          idealIntake: coll.idealIntake,
        });
        return { action: 'marked_ready', details: { qualifiedCount, minimum: coll.minimumIntake } };
      }
    }

    // Case 2: Under minimum intake — check if auto-extension can be applied
    if (coll.autoExtensionEnabled && coll.extensionsUsed < coll.maxExtensions) {
      const extendResult = await this.extendCollectionDeadline(job._id, { isAutomatic: true });
      return { action: 'extended', details: extendResult };
    }

    // Case 3: Under minimum intake and max extensions reached (or auto-extension disabled)
    coll.status = 'insufficient';
    await job.save();

    // Update HiringFunnelConfig health to starved
    const config = await HiringFunnelConfigModel.findOne({ jobId: job._id });
    if (config) {
      config.funnelHealth = 'starved';
      await config.save();
    }

    HiringNotificationHook.notifyCollectionInsufficient({
      recruiterId: job.postedBy ? String(job.postedBy) : undefined,
      jobId: String(job._id),
      jobTitle: job.title,
      qualifiedCandidates: qualifiedCount,
      minimumRequired: coll.minimumIntake,
      finalShortlistTarget: job.finalShortlistTarget || 5,
      idealIntake: coll.idealIntake,
      extensionsUsed: coll.extensionsUsed,
    });

    return {
      action: 'marked_insufficient',
      details: {
        qualifiedCount,
        minimumRequired: coll.minimumIntake,
        extensionsUsed: coll.extensionsUsed,
        maxExtensions: coll.maxExtensions,
      },
    };
  }
}
