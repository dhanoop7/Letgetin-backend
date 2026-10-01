import { Router } from 'express';
import { InterviewBuddyController } from './interviewBuddy.controller.js';
import { optionalAuthenticate } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  generateBuddyQuestionsSchema,
  evaluateBuddyAnswerSchema,
} from './interviewBuddy.validator.js';

const router = Router();

router.use(optionalAuthenticate);

// Generate tailored Interview Buddy questions
router.post(
  '/generate',
  validate(generateBuddyQuestionsSchema),
  asyncHandler(InterviewBuddyController.generateBuddyQuestions)
);

// Evaluate candidate response for Interview Buddy
router.post(
  '/evaluate',
  validate(evaluateBuddyAnswerSchema),
  asyncHandler(InterviewBuddyController.evaluateBuddyAnswer)
);

export default router;
