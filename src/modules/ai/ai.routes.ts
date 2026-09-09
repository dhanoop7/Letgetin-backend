import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AIController } from './ai.controller.js';
import { AssistantController } from './assistant.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  improveSummarySchema,
  rewriteExperienceSchema,
  generateSkillsSchema,
  atsAnalyzeSchema,
  optimizeSectionSchema,
  chatSchema,
  assistantChatSchema,
  aiApplyAssistSchema,
  parseResumeSchema,
  matchJobSchema,
  aiWritingSchema,
} from './ai.validator.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/appError.js';

const router = Router();

// Protect ALL AI endpoints - Authentication strictly required
router.use(authenticate);

// Per-user rate limiter for the assistant endpoint. Expert mode is materially more expensive
// (heavier model, larger token budget), so it gets a tighter cap than instant mode.
const assistantLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: (req) => (req.body?.mode === 'expert' ? 10 : 30),
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip || ''),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(AppError.tooManyRequests('Too many assistant requests. Please try again in 15 minutes.'));
  },
});

// Shared AI Writing Assistant — used across Company/Startup/Institution profile fields, Job
// Description, Resume sections, and Cover Letter. Generous limit since it's reused across many
// fields/flows rather than a single page.
const writingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip || ''),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(AppError.tooManyRequests('Too many AI writing requests. Please try again in 15 minutes.'));
  },
});
router.post('/writing', writingLimiter, validate(aiWritingSchema), asyncHandler(AIController.generateWriting));

router.post('/parse-resume', validate(parseResumeSchema), asyncHandler(AIController.parseResume));
router.post('/job-match', validate(matchJobSchema), asyncHandler(AIController.matchJob));
router.post('/improve-summary', validate(improveSummarySchema), asyncHandler(AIController.improveSummary));
router.post('/rewrite-experience', validate(rewriteExperienceSchema), asyncHandler(AIController.rewriteExperience));
router.post('/generate-skills', validate(generateSkillsSchema), asyncHandler(AIController.generateSkills));
router.post('/ats-analyze', validate(atsAnalyzeSchema), asyncHandler(AIController.analyzeAts));
router.post('/optimize-section', validate(optimizeSectionSchema), asyncHandler(AIController.optimizeSection));
router.post('/chat', validate(chatSchema), asyncHandler(AIController.chat));
router.post('/assistant', assistantLimiter, validate(assistantChatSchema), asyncHandler(AssistantController.chat));
router.post('/ai-apply-assist', assistantLimiter, validate(aiApplyAssistSchema), asyncHandler(AIController.aiApplyAssist));

export default router;
