import { Router } from 'express';
import { domainAssessmentController } from './domainAssessment.controller.js';
import { optionalAuthenticate } from '../../middleware/auth.middleware.js';

const router = Router();

// AI Auto-Configuration from Job Description / Role
router.post('/auto-configure', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.autoConfigure(req, res, next)
);

// AI Question Generation
router.post('/generate-questions', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.generateQuestions(req, res, next)
);

router.post('/generate-round-questions', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.generateRoundQuestions(req, res, next)
);

// AI Chat Assessment Live Conversational Engine
router.post('/chat-turn', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.chatTurn(req, res, next)
);

router.post('/evaluate-chat-session', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.evaluateChatSession(req, res, next)
);

// Assessments CRUD
router.post('/', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.createAssessment(req, res, next)
);

router.get('/', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.getAssessments(req, res, next)
);

router.get('/:id', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.getAssessmentById(req, res, next)
);

router.put('/:id', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.updateAssessment(req, res, next)
);

router.delete('/:id', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.deleteAssessment(req, res, next)
);

// Lifecycle actions
router.post('/:id/auto-configure', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.autoConfigure(req, res, next)
);

router.post('/:id/generate-questions', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.generateQuestions(req, res, next)
);

router.post('/:id/publish', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.publishAssessment(req, res, next)
);

router.post('/:id/archive', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.archiveAssessment(req, res, next)
);

// Recruiter: View candidate results for assessment
router.get('/:id/results', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.getAssessmentResults(req, res, next)
);

// Candidate Attempts
router.post('/:id/attempt', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.startAttempt(req, res, next)
);

router.get('/attempts/:id', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.getAttempt(req, res, next)
);

router.post('/attempts/:id/answer', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.saveAnswer(req, res, next)
);

router.post('/attempts/:id/submit', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.submitAttempt(req, res, next)
);

router.get('/attempts/:id/result', optionalAuthenticate, (req, res, next) =>
  domainAssessmentController.getAttemptResult(req, res, next)
);

export default router;
