import { connectDatabase } from '../config/database.js';
import { createJobEmbeddingWorker, createCandidateEmbeddingWorker } from './embedding.worker.js';
import { createAiApplyBatchWorker } from './aiApply.worker.js';
import mongoose from 'mongoose';

const startWorkerProcess = async () => {
  console.log('🔄 Initializing Background BullMQ Workers...');

  try {
    // Connect to shared MongoDB instance
    await connectDatabase();

    const jobWorker = createJobEmbeddingWorker();
    const candidateWorker = createCandidateEmbeddingWorker();
    const aiApplyWorker = createAiApplyBatchWorker();

    console.log('⚡ Background Workers active:');
    console.log('   - Job Embedding Worker (Queue: job-embedding-queue)');
    console.log('   - Candidate Embedding Worker (Queue: candidate-embedding-queue)');
    console.log('   - AI Apply Batch Worker (Queue: ai-apply-batch-queue)');

    // Graceful Shutdown
    const handleShutdown = async (signal: string) => {
      console.log(`\n⚠️ Received ${signal}. Shutting down BullMQ workers gracefully...`);
      try {
        await Promise.all([jobWorker.close(), candidateWorker.close(), aiApplyWorker.close()]);
        await mongoose.disconnect();
        console.log('🔒 Workers and Database connections closed successfully.');
        process.exit(0);
      } catch (err) {
        console.error('Error during worker shutdown:', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  } catch (error) {
    console.error('💥 Fatal error starting BullMQ workers:', error);
    process.exit(1);
  }
};

startWorkerProcess();
