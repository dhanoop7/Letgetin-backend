import { Router } from 'express';
import { resumeScreeningController } from './resumeScreening.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  getScreeningCandidatesSchema,
  recordDecisionSchema,
  recordBulkDecisionSchema,
  applicationParamSchema,
  jobParamSchema,
} from './resumeScreening.validator.js';

const router = Router();

// All resume screening routes require recruiter authentication
router.use(authenticate, requireRole('recruiter'));

// 1. Get candidate list for job's resume screening view
router.get(
  '/jobs/:jobId/candidates',
  validate(getScreeningCandidatesSchema),
  (req, res, next) => resumeScreeningController.getCandidates(req, res, next)
);

// 2. Get screening header stats
router.get(
  '/jobs/:jobId/stats',
  validate(jobParamSchema),
  (req, res, next) => resumeScreeningController.getStats(req, res, next)
);

// 3. Get single application detail & full scorecard for drawer
router.get(
  '/applications/:id',
  validate(applicationParamSchema),
  (req, res, next) => resumeScreeningController.getApplicationDetail(req, res, next)
);

// 4. Record single recruiter decision (shortlist / reject / needs_review)
router.post(
  '/applications/:id/decision',
  validate(recordDecisionSchema),
  (req, res, next) => resumeScreeningController.recordDecision(req, res, next)
);

// 5. Bulk recruiter decision
router.post(
  '/jobs/:jobId/bulk-decision',
  validate(recordBulkDecisionSchema),
  (req, res, next) => resumeScreeningController.recordBulkDecision(req, res, next)
);

// 6. Trigger / retry AI evaluation on demand
router.post(
  '/applications/:id/evaluate',
  validate(applicationParamSchema),
  (req, res, next) => resumeScreeningController.evaluateApplication(req, res, next)
);

export default router;
