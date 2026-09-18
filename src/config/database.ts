import mongoose from 'mongoose';
import { env } from './env.js';
import { createChildLogger } from '../infrastructure/logging/logger.js';

const dbLogger = createChildLogger({ component: 'MongoDB' });

export const logDbError = (
  operation: string,
  error: any,
  context?: { requestId?: string; model?: string; jobId?: string; applicationId?: string; userId?: string }
): void => {
  dbLogger.error(
    {
      operation,
      errName: error?.name || 'MongoError',
      errMessage: error?.message || String(error),
      stack: error?.stack,
      ...context,
    },
    `MongoDB operation "${operation}" failed: ${error?.message || error}`
  );
};

export const connectDatabase = async (): Promise<void> => {
  try {
    mongoose.set('strictQuery', true);

    const conn = await mongoose.connect(env.MONGODB_URI);
    dbLogger.info({ host: conn.connection.host }, `🍃 MongoDB Connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err: Error) => {
      dbLogger.error({ errName: err.name, errMessage: err.message, stack: err.stack }, `❌ MongoDB Connection Error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      dbLogger.warn('⚠️ MongoDB Disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      dbLogger.info('🔄 MongoDB Reconnected successfully.');
    });
  } catch (error: any) {
    dbLogger.error({ errName: error?.name, errMessage: error?.message, stack: error?.stack }, `💥 Failed to connect to MongoDB: ${error?.message || error}`);
    if (env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
};
