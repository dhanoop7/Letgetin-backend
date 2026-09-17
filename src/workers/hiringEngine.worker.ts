import { Worker, Job } from 'bullmq';
import {
  HIRING_ENGINE_QUEUE_NAME,
  HiringEnginePayload,
} from '../modules/hiringEngine/queues/hiringEngine.queue.js';
import { getRedisConnectionOptions } from '../queues/queue.config.js';
import { HiringEngineService } from '../modules/hiringEngine/services/hiringEngine.service.js';

const redisOptions = getRedisConnectionOptions();

/**
 * Worker for processing asynchronous Hiring Engine automation jobs:
 * 1. check-candidate-deadline: Evaluates whether a candidate passed their response deadline without action.
 * 2. auto-refill-stage: Evaluates stage deficit and atomically promotes reserve candidates.
 * 3. process-stage-evaluation: Evaluates assessment or AI interview scores against stage thresholds.
 */
export const createHiringEngineWorker = (): Worker<HiringEnginePayload> => {
  const worker = new Worker<HiringEnginePayload>(
    HIRING_ENGINE_QUEUE_NAME,
    async (job: Job<HiringEnginePayload>) => {
      const data = job.data;
      console.log(`[HiringEngineWorker] Processing job "${job.name}" (Type: ${data.type}) ID: ${job.id}`);

      try {
        switch (data.type) {
          case 'check-candidate-deadline': {
            const result = await HiringEngineService.processCandidateDeadlineJob(data);
            console.log(
              `[HiringEngineWorker] Deadline check completed for App ${data.applicationId}: markedNoShow=${result.markedNoShow}`
            );
            return { success: true, ...result };
          }

          case 'auto-refill-stage': {
            const promoted = await HiringEngineService.processAutoRefillJob(data);
            console.log(
              `[HiringEngineWorker] Auto-refill completed for Stage ${data.stageId}: promoted ${promoted.length} candidates`
            );
            return { success: true, promotedCount: promoted.length };
          }

          case 'process-stage-evaluation': {
            const evalResult = await HiringEngineService.processStageEvaluationJob(data);
            console.log(
              `[HiringEngineWorker] Evaluation processed for App ${data.applicationId}: status=${evalResult.status}`
            );
            return { success: true, ...evalResult };
          }

          default: {
            console.warn(`[HiringEngineWorker] Unknown job type: ${(data as any)?.type}`);
            return { success: false, reason: 'Unknown job type' };
          }
        }
      } catch (error: any) {
        console.error(
          `❌ [HiringEngineWorker] Job "${job.name}" failed for JobID=${(data as any).jobId} (StageID=${(data as any).stageId}):`,
          error?.message || error
        );
        throw error;
      }
    },
    {
      connection: redisOptions,
      concurrency: 5,
    }
  );

  worker.on('error', () => {
    // Graceful no-op when Redis is running in local degraded mode
  });

  worker.on('failed', (job, err) => {
    console.error(`[HiringEngineWorker] Task ${job?.id} failed with error:`, err.message);
  });

  worker.on('completed', (job) => {
    // Optional debug log
  });

  return worker;
};
