import { Queue } from 'bullmq';
import { getRedisConnectionOptions } from '../../../queues/queue.config.js';

export const HIRING_ENGINE_QUEUE_NAME = 'hiring-engine-queue';

export type HiringEngineJobType =
  | 'check-candidate-deadline'
  | 'auto-refill-stage'
  | 'process-stage-evaluation';

export interface CheckCandidateDeadlinePayload {
  type: 'check-candidate-deadline';
  jobId: string;
  applicationId: string;
  stageId: string;
  deadlineHours: number;
}

export interface AutoRefillStagePayload {
  type: 'auto-refill-stage';
  jobId: string;
  stageId: string;
  targetCount: number;
}

export interface ProcessStageEvaluationPayload {
  type: 'process-stage-evaluation';
  jobId: string;
  applicationId: string;
  stageId: string;
  score: number;
  evaluationDetails?: Record<string, any>;
}

export type HiringEnginePayload =
  | CheckCandidateDeadlinePayload
  | AutoRefillStagePayload
  | ProcessStageEvaluationPayload;

const redisOptions = getRedisConnectionOptions();

/**
 * BullMQ Queue for Phase 2 asynchronous stage deadline checks and automated refill jobs.
 */
export const hiringEngineQueue = new Queue<HiringEnginePayload>(HIRING_ENGINE_QUEUE_NAME, {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 200,
    removeOnFail: 1000,
  },
});

hiringEngineQueue.on('error', () => {
  // Graceful no-op when Redis is running in local degraded mode
});

/**
 * Helper to schedule a delayed stage response deadline check.
 * If candidate hasn't started the stage by deadlineHours, transitions to no_show and refills.
 */
export const scheduleCandidateDeadlineCheck = async (
  jobId: string,
  applicationId: string,
  stageId: string,
  deadlineHours: number,
  delayMsOverride?: number
): Promise<string | null> => {
  try {
    const delayMs = typeof delayMsOverride === 'number' ? delayMsOverride : deadlineHours * 3600 * 1000;
    const addPromise = hiringEngineQueue
      .add(
        `deadline-check-${applicationId}`,
        {
          type: 'check-candidate-deadline',
          jobId,
          applicationId,
          stageId,
          deadlineHours,
        },
        {
          jobId: `deadline-${applicationId}-${stageId}-${Date.now()}`,
          delay: delayMs,
        }
      )
      .then((j) => j?.id || null)
      .catch(() => null);

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 300));
    return await Promise.race([addPromise, timeoutPromise]);
  } catch (error) {
    console.warn(
      `⚠️ [HiringEngineQueue] Could not schedule deadline check for application ${applicationId}:`,
      (error as Error).message
    );
    return null;
  }
};

/**
 * Helper to schedule asynchronous stage reserve replenishment.
 */
export const scheduleAutoRefillStage = async (
  jobId: string,
  stageId: string,
  targetCount: number
): Promise<string | null> => {
  try {
    const addPromise = hiringEngineQueue
      .add(
        `auto-refill-${jobId}-${stageId}`,
        {
          type: 'auto-refill-stage',
          jobId,
          stageId,
          targetCount,
        },
        {
          jobId: `refill-${jobId}-${stageId}-${Date.now()}`,
        }
      )
      .then((j) => j?.id || null)
      .catch(() => null);

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 300));
    return await Promise.race([addPromise, timeoutPromise]);
  } catch (error) {
    console.warn(
      `⚠️ [HiringEngineQueue] Could not schedule stage refill for stage ${stageId}:`,
      (error as Error).message
    );
    return null;
  }
};

/**
 * Helper to schedule automated candidate stage evaluation (e.g. from assessments or AI interviews).
 */
export const scheduleProcessStageEvaluation = async (
  jobId: string,
  applicationId: string,
  stageId: string,
  score: number,
  evaluationDetails?: Record<string, any>
): Promise<string | null> => {
  try {
    const addPromise = hiringEngineQueue
      .add(
        `eval-${applicationId}-${stageId}`,
        {
          type: 'process-stage-evaluation',
          jobId,
          applicationId,
          stageId,
          score,
          evaluationDetails,
        },
        {
          jobId: `eval-${applicationId}-${stageId}-${Date.now()}`,
        }
      )
      .then((j) => j?.id || null)
      .catch(() => null);

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 300));
    return await Promise.race([addPromise, timeoutPromise]);
  } catch (error) {
    console.warn(
      `⚠️ [HiringEngineQueue] Could not schedule stage evaluation for application ${applicationId}:`,
      (error as Error).message
    );
    return null;
  }
};

