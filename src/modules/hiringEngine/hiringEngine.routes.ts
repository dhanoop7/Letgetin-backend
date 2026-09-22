import { Router } from 'express';
import { HiringEngineController } from './hiringEngine.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  configureHiringPipelineSchema,
  advanceCandidateSchema,
  failCandidateSchema,
  refillStageSchema,
  finalDecisionSchema,
} from './hiringEngine.validator.js';

// MergeParams: true allows accessing :jobId from parent route prefix
const router = Router({ mergeParams: true });

// All Hiring Engine endpoints require authenticated recruiter
router.use(authenticate);
router.use(requireRole('recruiter'));

// Funnel Configuration & Real-Time Metrics
router.post('/config', validate(configureHiringPipelineSchema), HiringEngineController.configurePipeline);
router.get('/config', HiringEngineController.getPipelineConfig);
router.get('/funnel-metrics', HiringEngineController.getFunnelMetrics);

// Stage Candidate Inspection
router.get('/stages/:stageId/candidates', HiringEngineController.getStageCandidates);

// Candidate Stage Advancement & Failure (with Auto-Refill)
router.post(
  '/candidates/:applicationId/advance',
  validate(advanceCandidateSchema),
  HiringEngineController.advanceCandidate
);
router.post(
  '/candidates/:applicationId/fail',
  validate(failCandidateSchema),
  HiringEngineController.failCandidate
);
router.post(
  '/candidates/:applicationId/assessment',
  HiringEngineController.submitAssessmentResult
);

// Dynamic Reserve Refill
router.post('/stages/:stageId/refill', validate(refillStageSchema), HiringEngineController.refillStage);

// Candidate Stage Transition Audit History
router.get('/candidates/:applicationId/history', HiringEngineController.getCandidateHistory);

// Final Shortlist & Offer Management Layer
router.get('/final-shortlist', HiringEngineController.getFinalShortlist);
router.post(
  '/final-shortlist/:applicationId/decision',
  validate(finalDecisionSchema),
  HiringEngineController.recordFinalDecision
);

// Application Collection & Adaptive Pipeline
router.get('/application-collection', HiringEngineController.getApplicationCollection);
router.post('/application-collection/start', HiringEngineController.startApplicationCollection);
router.post('/application-collection/extend', HiringEngineController.extendApplicationCollection);
router.post('/start', HiringEngineController.startApplicationCollection);

export default router;

