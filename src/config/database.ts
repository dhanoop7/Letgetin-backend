import mongoose from 'mongoose';
import { env } from './env.js';

export const connectDatabase = async (): Promise<void> => {
  try {
    mongoose.set('strictQuery', true);

    const conn = await mongoose.connect(env.MONGODB_URI);
    console.log(`🍃 MongoDB Connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err: Error) => {
      console.error(`❌ MongoDB Connection Error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB Disconnected. Attempting to reconnect...');
    });
  } catch (error) {
    console.error(`💥 Failed to connect to MongoDB: ${error}`);
    if (env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
};
