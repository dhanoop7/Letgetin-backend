import { Router } from 'express';
import { InterviewController } from './interview.controller.js';
import { InterviewBuddyController } from '../interviewBuddy/interviewBuddy.controller.js';
import { authenticate, optionalAuthenticate } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createInterviewSchema,
  updateInterviewSchema,
  updateStageSchema,
  submitFeedbackSchema,
  generateAiQuestionsSchema,
  evaluateInterviewSchema,
} from './interview.validator.js';
import {
  generateBuddyQuestionsSchema,
  evaluateBuddyAnswerSchema,
} from '../interviewBuddy/interviewBuddy.validator.js';

const router = Router();

// AI Interview Buddy Endpoints (delegated to interviewBuddy module)
router.post(
  '/buddy/generate',
  optionalAuthenticate,
  validate(generateBuddyQuestionsSchema),
  asyncHandler(InterviewBuddyController.generateBuddyQuestions)
);
router.post(
  '/buddy/evaluate',
  optionalAuthenticate,
  validate(evaluateBuddyAnswerSchema),
  asyncHandler(InterviewBuddyController.evaluateBuddyAnswer)
);

// Base authentication required for recruiter interview management operations
router.use(authenticate);

// Interview CRUD & Stages
router.get('/', asyncHandler(InterviewController.listInterviews));
router.post('/', validate(createInterviewSchema), asyncHandler(InterviewController.createInterview));
router.get('/:id/join-access', asyncHandler(InterviewController.validateJoinAccess));
router.get('/:id/signal/stream', asyncHandler(InterviewController.streamSignaling));
router.post('/:id/signal/message', asyncHandler(InterviewController.postSignalingMessage));
router.get('/:id', asyncHandler(InterviewController.getInterviewById));
router.put('/:id', validate(updateInterviewSchema), asyncHandler(InterviewController.updateInterview));
router.patch('/:id/stage', validate(updateStageSchema), asyncHandler(InterviewController.updateStage));
router.post('/:id/feedback', validate(submitFeedbackSchema), asyncHandler(InterviewController.submitFeedback));
router.delete('/:id', asyncHandler(InterviewController.deleteInterview));

// AI-Powered Operations
router.post('/ai/questions', validate(generateAiQuestionsSchema), asyncHandler(InterviewController.generateQuestions));
router.post('/ai/evaluate', validate(evaluateInterviewSchema), asyncHandler(InterviewController.evaluateSession));

export default router;
