import { Worker, Job } from 'bullmq';
import {
  HIRING_ENGINE_QUEUE_NAME,
  HiringEnginePayload,
} from '../modules/hiringEngine/queues/hiringEngine.queue.js';
import { getRedisConnectionOptions } from '../queues/queue.config.js';
import { HiringEngineService } from '../modules/hiringEngine/services/hiringEngine.service.js';
import { ApplicationCollectionService } from '../modules/hiringEngine/services/applicationCollection.service.js';
import { createChildLogger } from '../infrastructure/logging/logger.js';

const workerLogger = createChildLogger({ component: 'BullMQ', queue: HIRING_ENGINE_QUEUE_NAME });
const redisOptions = getRedisConnectionOptions();

/**
 * Worker for processing asynchronous Hiring Engine automation jobs:
 * 1. check-candidate-deadline: Evaluates whether a candidate passed their response deadline without action.
 * 2. auto-refill-stage: Evaluates stage deficit and atomically promotes reserve candidates.
 * 3. process-stage-evaluation: Evaluates assessment or AI interview scores against stage thresholds.
 * 4. check-application-collection-deadline: Checks candidate collection deadlines and handles auto-extension.
 */
export const createHiringEngineWorker = (): Worker<HiringEnginePayload> => {
  const worker = new Worker<HiringEnginePayload>(
    HIRING_ENGINE_QUEUE_NAME,
    async (job: Job<HiringEnginePayload>) => {
      const data = job.data;
      workerLogger.info(
        {
          jobId: job.id,
          jobName: job.name,
          jobType: data.type,
          event: 'started',
          attemptsMade: job.attemptsMade,
        },
        `[BullMQ:hiring-engine] Job started: ${job.name} (${data.type})`
      );

      try {
        switch (data.type) {
          case 'check-candidate-deadline': {
            const result = await HiringEngineService.processCandidateDeadlineJob(data);
            workerLogger.info(
              {
                jobId: job.id,
                jobType: data.type,
                applicationId: data.applicationId,
                markedNoShow: result.markedNoShow,
                event: 'completed',
              },
              `[BullMQ:hiring-engine] Deadline check completed for App ${data.applicationId}: markedNoShow=${result.markedNoShow}`
            );
            return { success: true, ...result };
          }

          case 'auto-refill-stage': {
            const promoted = await HiringEngineService.processAutoRefillJob(data);
            workerLogger.info(
              {
                jobId: job.id,
                jobType: data.type,
                stageId: data.stageId,
                promotedCount: promoted.length,
                event: 'completed',
              },
              `[BullMQ:hiring-engine] Auto-refill completed for Stage ${data.stageId}: promoted ${promoted.length} candidates`
            );
            return { success: true, promotedCount: promoted.length };
          }

          case 'process-stage-evaluation': {
            const evalResult = await HiringEngineService.processStageEvaluationJob(data);
            workerLogger.info(
              {
                jobId: job.id,
                jobType: data.type,
                applicationId: data.applicationId,
                status: evalResult.status,
                event: 'completed',
              },
              `[BullMQ:hiring-engine] Evaluation processed for App ${data.applicationId}: status=${evalResult.status}`
            );
            return { success: true, ...evalResult };
          }

          case 'check-application-collection-deadline': {
            const collResult = await ApplicationCollectionService.processCollectionDeadlineJob(data.jobId);
            workerLogger.info(
              {
                jobId: job.id,
                jobType: data.type,
                targetJobId: data.jobId,
                action: collResult.action,
                event: 'completed',
              },
              `[BullMQ:hiring-engine] Collection deadline processed for Job ${data.jobId}: action=${collResult.action}`
            );
            return { success: true, ...collResult };
          }

          default: {
            workerLogger.warn(
              { jobId: job.id, jobType: (data as any)?.type, event: 'unknown_type' },
              `[BullMQ:hiring-engine] Unknown job type: ${(data as any)?.type}`
            );
            return { success: false, reason: 'Unknown job type' };
          }
        }
      } catch (error: any) {
        workerLogger.error(
          {
            jobId: job.id,
            jobName: job.name,
            jobType: data.type,
            targetJobId: (data as any)?.jobId,
            stageId: (data as any)?.stageId,
            errName: error?.name,
            errMessage: error?.message || String(error),
            stack: error?.stack,
            event: 'failed',
          },
          `❌ [BullMQ:hiring-engine] Job failed: ${error?.message || error}`
        );
        throw error;
      }
    },
    {
      connection: redisOptions,
      concurrency: 5,
    }
  );

  worker.on('error', (err) => {
    workerLogger.warn({ errMessage: err.message }, `[BullMQ:hiring-engine] Worker connection notice: ${err.message}`);
  });

  worker.on('failed', (job, err) => {
    workerLogger.error(
      {
        jobId: job?.id,
        event: 'failed',
        errName: err.name,
        errMessage: err.message,
        stack: err.stack,
      },
      `[BullMQ:hiring-engine] Task ${job?.id} failed: ${err.message}`
    );
  });

  worker.on('completed', (job) => {
    workerLogger.debug({ jobId: job?.id, event: 'completed' }, `[BullMQ:hiring-engine] Task ${job?.id} completed`);
  });

  return worker;
};
