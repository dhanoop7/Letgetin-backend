import { createApp } from './app.js';
import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { createJobEmbeddingWorker, createCandidateEmbeddingWorker } from './workers/embedding.worker.js';
import { createAiApplyBatchWorker } from './workers/aiApply.worker.js';

const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDatabase();

    // 2. Initialize BullMQ Workers (Embedded for high availability)
    const jobWorker = createJobEmbeddingWorker();
    const candidateWorker = createCandidateEmbeddingWorker();
    const aiApplyWorker = createAiApplyBatchWorker();

    console.log('⚡ BullMQ Background Workers initialized (Job Embedding, Candidate Profile Embedding, AI Apply 10x10 Batch Worker)');

    // 3. Initialize Express application
    const app = createApp();

    // 4. Start listening
    const server = app.listen(env.PORT, () => {
      console.log(`🚀 Server running in [${env.NODE_ENV}] mode on port ${env.PORT}`);
    });

    // Graceful Shutdown Handler
    const handleShutdown = async (signal: string) => {
      console.log(`\n⚠️ Received ${signal}. Shutting down gracefully...`);
      try {
        await Promise.all([jobWorker.close(), candidateWorker.close(), aiApplyWorker.close()]);
      } catch (err) {
        console.warn('Worker shutdown warning:', err);
      }
      server.close(() => {
        console.log('🔒 HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));

    process.on('unhandledRejection', (reason: any) => {
      console.warn('⚠️ [Process] Unhandled promise rejection captured:', reason?.message || reason);
    });

    process.on('uncaughtException', (error: Error) => {
      console.error('💥 [Process] Uncaught exception captured:', error?.message || error);
    });
  } catch (error) {
    console.error('💥 Fatal error during server startup:', error);
    process.exit(1);
  }
};

startServer();
