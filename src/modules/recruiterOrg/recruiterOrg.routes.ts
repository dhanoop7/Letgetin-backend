import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RecruiterOrgController } from './recruiterOrg.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { getOrgFormMetaSchema, saveOrgProfileSchema, autofillOrgProfileSchema } from './recruiterOrg.validator.js';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/appError.js';

const router = Router();

router.use(authenticate);

// Autofill fetches an external URL and calls the AI provider per request — keep this tightly
// capped per user (registration is a one-time flow, a handful of tries is plenty).
const autofillLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip || ''),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(AppError.tooManyRequests('Too many autofill attempts. Please try again in 15 minutes.'));
  },
});

router.get('/org-meta', validate(getOrgFormMetaSchema), asyncHandler(RecruiterOrgController.getOrgFormMeta));
router.get('/org', requireRole('recruiter'), asyncHandler(RecruiterOrgController.getOrgProfile));
router.put(
  '/org',
  requireRole('recruiter'),
  validate(saveOrgProfileSchema),
  asyncHandler(RecruiterOrgController.saveOrgProfile)
);
router.get('/overview', requireRole('recruiter'), asyncHandler(RecruiterOrgController.getOverview));
router.post(
  '/org/autofill',
  autofillLimiter,
  requireRole('recruiter'),
  validate(autofillOrgProfileSchema),
  asyncHandler(RecruiterOrgController.autofillOrgProfile)
);

export default router;
