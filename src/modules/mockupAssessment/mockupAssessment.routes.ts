import { Router } from 'express';
import { MockupAssessmentController } from './mockupAssessment.controller.js';
import { optionalAuthenticate } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  generateAssessmentSchema,
  evaluateAssessmentAnswerSchema,
} from './mockupAssessment.validator.js';

const router = Router();

router.use(optionalAuthenticate);

// Generate tailored AI Mockup Assessment questions via Gemini
router.post(
  '/generate',
  validate(generateAssessmentSchema),
  asyncHandler(MockupAssessmentController.generateAssessment)
);

// Backward compatible aliases
router.post(
  '/generate-assessment',
  validate(generateAssessmentSchema),
  asyncHandler(MockupAssessmentController.generateAssessment)
);

// Evaluate candidate's answer for Mockup Assessment using Gemini
router.post(
  '/evaluate-answer',
  validate(evaluateAssessmentAnswerSchema),
  asyncHandler(MockupAssessmentController.evaluateAssessmentAnswer)
);

// Backward compatible aliases
router.post(
  '/evaluate-assessment-answer',
  validate(evaluateAssessmentAnswerSchema),
  asyncHandler(MockupAssessmentController.evaluateAssessmentAnswer)
);

export default router;
