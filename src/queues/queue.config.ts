import { Queue, ConnectionOptions } from 'bullmq';
import { env } from '../config/env.js';

export const getRedisConnectionOptions = (): ConnectionOptions => {
  try {
    const url = new URL(env.REDIS_URL);
    return {
      host: url.hostname || 'localhost',
      port: url.port ? parseInt(url.port, 10) : 6379,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  } catch {
    return {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  }
};

const redisOptions = getRedisConnectionOptions();

// Queue names
export const QUEUE_NAMES = {
  JOB_EMBEDDING: 'job-embedding-queue',
  CANDIDATE_EMBEDDING: 'candidate-embedding-queue',
  AI_APPLY_BATCH: 'ai-apply-batch-queue',
} as const;

export interface JobEmbeddingPayload {
  jobId: string;
  source?: string;
  forceRecompute?: boolean;
}

export interface CandidateEmbeddingPayload {
  userId: string;
  resumeId?: string;
  forceRecompute?: boolean;
}

export interface AiApplyBatchPayload {
  sessionId: string;
  userId: string;
  batchIndex: number;
  totalBatches: number;
  jobIds: string[];
  resumeId: string;
  coverLetterId?: string;
  preferencesId: string;
}

export const jobEmbeddingQueue = new Queue<JobEmbeddingPayload>(QUEUE_NAMES.JOB_EMBEDDING, {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const candidateEmbeddingQueue = new Queue<CandidateEmbeddingPayload>(QUEUE_NAMES.CANDIDATE_EMBEDDING, {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1500,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const aiApplyBatchQueue = new Queue<AiApplyBatchPayload>(QUEUE_NAMES.AI_APPLY_BATCH, {
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

jobEmbeddingQueue.on('error', () => {});
candidateEmbeddingQueue.on('error', () => {});
aiApplyBatchQueue.on('error', () => {});

/**
 * Enqueue a single job for background embedding generation
 */
export const enqueueJobEmbedding = async (jobId: string, forceRecompute = false): Promise<string | null> => {
  try {
    const job = await jobEmbeddingQueue.add(
      `embed-job-${jobId}`,
      { jobId, forceRecompute },
      { jobId: forceRecompute ? `job-${jobId}-${Date.now()}` : `job-${jobId}` }
    );
    return job.id || null;
  } catch (error) {
    console.warn(`⚠️ Failed to enqueue job embedding for jobId ${jobId}:`, (error as Error).message);
    return null;
  }
};

/**
 * Enqueue a batch of jobs for background embedding generation
 */
export const enqueueBatchJobEmbeddings = async (jobIds: string[]): Promise<number> => {
  try {
    const jobs = jobIds.map((jobId) => ({
      name: `embed-job-${jobId}`,
      data: { jobId },
      opts: { jobId: `job-${jobId}` },
    }));

    const result = await jobEmbeddingQueue.addBulk(jobs);
    return result.length;
  } catch (error) {
    console.warn(`⚠️ Failed to enqueue batch job embeddings:`, (error as Error).message);
    return 0;
  }
};

/**
 * Enqueue a candidate / user profile for background embedding generation.
 * Implements deterministic deduplication, delayed execution for coalescing rapid updates,
 * and safe handling of in-flight active jobs.
 */
export const enqueueCandidateEmbedding = async (
  userId: string,
  resumeId?: string,
  forceRecompute = false
): Promise<string | null> => {
  try {
    const primaryJobId = `candidate-embed-${userId}`;
    const nextJobId = `candidate-embed-next-${userId}`;

    // Inspect both primary and follow-up slots
    const [primaryJob, nextJob] = await Promise.all([
      candidateEmbeddingQueue.getJob(primaryJobId),
      candidateEmbeddingQueue.getJob(nextJobId),
    ]);

    const primaryState = primaryJob ? await primaryJob.getState() : null;
    const nextState = nextJob ? await nextJob.getState() : null;

    // 1. If not forcing recompute, check if a job is already queued (delayed or waiting)
    if (!forceRecompute) {
      if (primaryState === 'delayed' || primaryState === 'waiting') {
        // Primary job is already queued and will fetch latest state from MongoDB when it runs. Coalesced!
        return primaryJob?.id || primaryJobId;
      }
      if (nextState === 'delayed' || nextState === 'waiting') {
        // Follow-up job is already queued and will fetch latest state from MongoDB when it runs. Coalesced!
        return nextJob?.id || nextJobId;
      }
    }

    // 2. Decide which slot to target
    let targetJobId = primaryJobId;

    if (primaryState === 'active') {
      // Primary job is currently executing. Target the follow-up slot so the latest profile version is processed
      targetJobId = nextJobId;
      if (nextJob && (nextState === 'completed' || nextState === 'failed')) {
        try {
          await nextJob.remove();
        } catch {
          // Ignored if already removed
        }
      }
    } else {
      // Primary job is not active (null, completed, or failed)
      targetJobId = primaryJobId;
      if (primaryJob && (primaryState === 'completed' || primaryState === 'failed')) {
        try {
          await primaryJob.remove();
        } catch {
          // Ignored if already removed
        }
      }
      // Clean up finished nextJob if any
      if (nextJob && (nextState === 'completed' || nextState === 'failed')) {
        try {
          await nextJob.remove();
        } catch {
          // Ignored if already removed
        }
      }
    }

    const job = await candidateEmbeddingQueue.add(
      `embed-candidate-${userId}`,
      { userId, resumeId, forceRecompute },
      {
        jobId: targetJobId,
        delay: forceRecompute ? 0 : 1500, // 1.5s debounce delay to coalesce rapid profile updates
        removeOnComplete: 100,
        removeOnFail: 500,
      }
    );

    return job.id || targetJobId;
  } catch (error) {
    console.warn(`⚠️ Failed to enqueue candidate embedding for userId ${userId}:`, (error as Error).message);
    return null;
  }
};

/**
 * Enqueue AI Apply batches (10 jobs per batch)
 */
export const enqueueAiApplyBatches = async (
  sessionId: string,
  userId: string,
  resumeId: string,
  preferencesId: string,
  coverLetterId: string | undefined,
  jobBatches: string[][]
): Promise<string[]> => {
  const totalBatches = jobBatches.length;
  const jobs = jobBatches.map((batchJobIds, idx) => {
    const batchIndex = idx + 1;
    return {
      name: `ai-apply-${sessionId}-b${batchIndex}`,
      data: {
        sessionId,
        userId,
        batchIndex,
        totalBatches,
        jobIds: batchJobIds,
        resumeId,
        coverLetterId,
        preferencesId,
      },
      opts: {
        jobId: `apply-${sessionId}-b${batchIndex}`,
        delay: (batchIndex - 1) * 800, // Stagger batches slightly to pace execution smoothly
      },
    };
  });

  const queued = await aiApplyBatchQueue.addBulk(jobs);
  return queued.map((j) => j.id || '');
};

