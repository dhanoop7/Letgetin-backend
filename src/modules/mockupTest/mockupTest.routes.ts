import { Router } from 'express';
import { MockupTestController } from './mockupTest.controller.js';
import { MockupAssessmentController } from '../mockupAssessment/mockupAssessment.controller.js';
import { optionalAuthenticate, authenticate } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  generateTestSchema,
  createSessionSchema,
  submitSessionSchema,
  evaluateDescriptiveSchema,
} from './mockupTest.validator.js';
import {
  generateAssessmentSchema,
  evaluateAssessmentAnswerSchema,
} from '../mockupAssessment/mockupAssessment.validator.js';

const router = Router();

// Apply optional authentication across mockup tests (allows both logged-in candidates and guest test takers)
router.use(optionalAuthenticate);

// Generate questions / analyze JD
router.post(
  '/generate',
  validate(generateTestSchema),
  asyncHandler(MockupTestController.generateTest)
);

// Create / initialize a new test session
router.post(
  '/session',
  validate(createSessionSchema),
  asyncHandler(MockupTestController.createSession)
);

// Get session details
router.get(
  '/session/:sessionId',
  asyncHandler(MockupTestController.getSession)
);

// Submit session answers for deterministic & AI scoring
router.post(
  '/session/:sessionId/submit',
  validate(submitSessionSchema),
  asyncHandler(MockupTestController.submitSession)
);

// On-the-fly single descriptive question evaluation via Gemini
router.post(
  '/evaluate-descriptive',
  validate(evaluateDescriptiveSchema),
  asyncHandler(MockupTestController.evaluateDescriptive)
);

// Generate tailored AI Mockup Assessment questions via Gemini (Route compatibility)
router.post(
  '/generate-assessment',
  validate(generateAssessmentSchema),
  asyncHandler(MockupAssessmentController.generateAssessment)
);

// Evaluate candidate's answer for Mockup Assessment using Gemini (Route compatibility)
router.post(
  '/evaluate-assessment-answer',
  validate(evaluateAssessmentAnswerSchema),
  asyncHandler(MockupAssessmentController.evaluateAssessmentAnswer)
);

// List past completed sessions for logged-in user
router.get(
  '/sessions',
  authenticate,
  asyncHandler(MockupTestController.getUserSessions)
);

export default router;
