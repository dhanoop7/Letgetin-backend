import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform((val: string) => parseInt(val, 10)).default('5001'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required').default('mongodb://localhost:27017/resumebuildai'),
  JWT_ACCESS_SECRET: z.string().min(10, 'JWT_ACCESS_SECRET must be at least 10 chars').default('super-secret-access-token-key-change-in-prod'),
  JWT_REFRESH_SECRET: z.string().min(10, 'JWT_REFRESH_SECRET must be at least 10 chars').default('super-secret-refresh-token-key-change-in-prod'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  CLIENT_URL: z.string().default('http://localhost:3000'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  AI_TIMEOUT: z.string().transform((val: string) => parseInt(val, 10)).default('60000'),
  AI_MAX_TOKENS: z.string().transform((val: string) => parseInt(val, 10)).default('8192'),
  AI_TEMPERATURE: z.string().transform((val: string) => parseFloat(val)).default('0.2'),
  AI_RETRY_ATTEMPTS: z.string().transform((val: string) => parseInt(val, 10)).default('3'),
  GEMINI_INSTANT_MODEL: z.string().default('gemini-3.6-flash'),
  GEMINI_EXPERT_MODEL: z.string().default('gemini-3.6-pro'),
  AI_INSTANT_MAX_TOKENS: z.string().transform((val: string) => parseInt(val, 10)).default('2048'),
  AI_EXPERT_MAX_TOKENS: z.string().transform((val: string) => parseInt(val, 10)).default('6144'),
  AI_INSTANT_TEMPERATURE: z.string().transform((val: string) => parseFloat(val)).default('0.2'),
  AI_EXPERT_TEMPERATURE: z.string().transform((val: string) => parseFloat(val)).default('0.3'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.string().transform((val: string) => parseInt(val, 10)).default('587'),
  SMTP_SECURE: z.string().transform((val: string) => val === 'true').default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SERVICE: z.string().optional(),
  EMAIL_FROM: z.string().default('LetGetIn <c2gupt@gmail.com>'),
  RESEND_API_KEY: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_PHONE_NUMBER_ID: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  EMBEDDING_PROVIDER: z.string().default('google'),
  EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  EMBEDDING_VERSION: z.string().default('v1'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  throw new Error('Invalid environment configuration');
}

export const env = _env.data;
