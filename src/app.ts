import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error.middleware.js';
import authRoutes from './modules/auth/auth.routes.js';
import resumeRoutes from './modules/resume/resume.routes.js';
import aiRoutes from './modules/ai/ai.routes.js';
import importRoutes from './modules/import/import.routes.js';
import pdfRoutes from './modules/pdf/pdf.routes.js';
import profileVerificationRoutes from './modules/profile/verification.routes.js';
import driveRoutes from './modules/drive/drive.routes.js';
import jobRoutes from './modules/job/job.routes.js';
import coverLetterRoutes from './modules/coverLetter/coverLetter.routes.js';
import aiApplyRoutes from './modules/aiApply/aiApply.routes.js';
import applicationRoutes from './modules/application/application.routes.js';
import videoProfileRoutes from './modules/videoProfile/videoProfile.routes.js';
import tailoringRoutes from './modules/tailoring/tailoring.routes.js';
import recruiterOrgRoutes from './modules/recruiterOrg/recruiterOrg.routes.js';
import recruiterCreditsRoutes from './modules/recruiterCredits/recruiterCredits.routes.js';
import institutionRoutes from './modules/institution/institution.routes.js';
import taskRoutes from './modules/task/task.routes.js';
import noteRoutes from './modules/note/note.routes.js';
import networkRoutes from './modules/network/network.routes.js';
import interviewRoutes from './modules/interview/interview.routes.js';
import startupRoutes from './modules/startup/startup.routes.js';

export const createApp = (): Express => {
  const app = express();

  // Trust proxy for secure cookies and accurate client IP extraction behind reverse proxies (Nginx, Render, Vercel, Fly.io, Cloudflare)
  app.set('trust proxy', 1);

  // Security headers
  app.use(helmet());

  // CORS configuration
  const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:5173',
    'https://let-get-in-frontend.vercel.app',
    'https://letgetin-frontend-beta.vercel.app',
  ];
  if (env.CLIENT_URL) {
    allowedOrigins.push(env.CLIENT_URL.trim().replace(/\/$/, ''));
  }

  const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      const isAllowed =
        allowedOrigins.includes(origin) ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.endsWith('.vercel.app') ||
        origin.includes('vercel.app');

      if (isAllowed) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    optionsSuccessStatus: 200,
  };

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));

  // Body Parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // Health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: 'ResumeBuildai API Server is healthy',
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  // Module Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/resumes', resumeRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/ai', importRoutes);
  app.use('/api/import', importRoutes);
  app.use('/api/pdf', pdfRoutes);
  app.use('/api/profile', profileVerificationRoutes);
  app.use('/api/drive', driveRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api/cover-letters', coverLetterRoutes);
  app.use('/api/ai-apply', aiApplyRoutes);
  app.use('/api/applications', applicationRoutes);
  app.use('/api/video-profile', videoProfileRoutes);
  app.use('/api/tailoring', tailoringRoutes);
  app.use('/api/recruiter', recruiterOrgRoutes);
  app.use('/api/recruiter', recruiterCreditsRoutes);
  app.use('/api/institution', institutionRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/notes', noteRoutes);
  app.use('/api/network', networkRoutes);
  app.use('/api/interviews', interviewRoutes);
  app.use('/api/startup', startupRoutes);

  // Centralized error handler
  app.use(errorHandler);

  return app;
};
