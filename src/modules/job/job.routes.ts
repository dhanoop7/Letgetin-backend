import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { jobController } from './job.controller.js';
import { authenticate, optionalAuthenticate, requireRole } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { createJobSchema, generateJobContentSchema, updateJobStageSchema } from './job.validator.js';
import { AppError } from '../../utils/appError.js';

const router = Router();

const aiAssistLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip || ''),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(AppError.tooManyRequests('Too many AI generation requests. Please try again in 15 minutes.'));
  },
});

// AI-Ranked Personalized Recommendations (Authenticated Only)
router.get('/recommendations', authenticate, (req, res, next) => jobController.getRecommendations(req, res, next));

// Sync user candidate profile and trigger embedding generation
router.post('/sync-profile', authenticate, (req, res, next) => jobController.syncProfile(req, res, next));

// --- Recruiter job management ---
router.post(
  '/',
  authenticate,
  requireRole('recruiter'),
  validate(createJobSchema),
  (req, res, next) => jobController.createJob(req, res, next)
);
router.post(
  '/ai-assist/generate',
  authenticate,
  requireRole('recruiter'),
  aiAssistLimiter,
  validate(generateJobContentSchema),
  (req, res, next) => jobController.generateJobContent(req, res, next)
);
router.get('/mine', authenticate, requireRole('recruiter'), (req, res, next) => jobController.getMyJobs(req, res, next));
router.get('/mine/:id', authenticate, requireRole('recruiter'), (req, res, next) => jobController.getMyJobById(req, res, next));
router.delete('/mine/:id', authenticate, requireRole('recruiter'), (req, res, next) => jobController.deleteMyJob(req, res, next));
router.patch(
  '/:id/stage',
  authenticate,
  requireRole('recruiter'),
  validate(updateJobStageSchema),
  (req, res, next) => jobController.updateJobStage(req, res, next)
);

// Browse all jobs (optional authentication to show match percentages if logged in)
router.get('/', optionalAuthenticate, (req, res, next) => jobController.getJobs(req, res, next));

// Specific job details
router.get('/:id', optionalAuthenticate, (req, res, next) => jobController.getJobById(req, res, next));

export default router;
