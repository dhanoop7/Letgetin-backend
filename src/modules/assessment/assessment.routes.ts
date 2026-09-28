import { Router } from 'express';
import { assessmentController } from './assessment.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  createQuestionRouteSchema,
  updateQuestionRouteSchema,
  reorderQuestionsRouteSchema,
  assessmentParamsRouteSchema,
} from './assessmentQuestion.validator.js';

const router = Router();

// Candidate-safe question view (authenticated candidate or recruiter)
router.get(
  '/jobs/:jobId/rounds/:roundId/candidate-questions',
  authenticate,
  validate(assessmentParamsRouteSchema),
  (req, res, next) => assessmentController.getCandidateQuestions(req, res, next)
);

// Recruiter question management routes (recruiter role required)
router.get(
  '/jobs/:jobId/rounds/:roundId/questions',
  authenticate,
  requireRole('recruiter'),
  validate(assessmentParamsRouteSchema),
  (req, res, next) => assessmentController.getRecruiterQuestions(req, res, next)
);

router.post(
  '/jobs/:jobId/rounds/:roundId/questions',
  authenticate,
  requireRole('recruiter'),
  validate(createQuestionRouteSchema),
  (req, res, next) => assessmentController.createQuestion(req, res, next)
);

router.patch(
  '/jobs/:jobId/rounds/:roundId/questions/reorder',
  authenticate,
  requireRole('recruiter'),
  validate(reorderQuestionsRouteSchema),
  (req, res, next) => assessmentController.reorderQuestions(req, res, next)
);

router.patch(
  '/jobs/:jobId/rounds/:roundId/questions/:questionId',
  authenticate,
  requireRole('recruiter'),
  validate(updateQuestionRouteSchema),
  (req, res, next) => assessmentController.updateQuestion(req, res, next)
);

router.delete(
  '/jobs/:jobId/rounds/:roundId/questions/:questionId',
  authenticate,
  requireRole('recruiter'),
  validate(assessmentParamsRouteSchema),
  (req, res, next) => assessmentController.deleteQuestion(req, res, next)
);

export default router;
