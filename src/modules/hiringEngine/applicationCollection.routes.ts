import { Router } from 'express';
import { HiringEngineController } from './hiringEngine.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';

const router = Router({ mergeParams: true });

// All application collection management requires authenticated recruiter
router.use(authenticate);
router.use(requireRole('recruiter'));

// GET /api/recruiter/jobs/:jobId/application-collection
router.get('/', HiringEngineController.getApplicationCollection);

// POST /api/recruiter/jobs/:jobId/application-collection/start
router.post('/start', HiringEngineController.startApplicationCollection);

// POST /api/recruiter/jobs/:jobId/application-collection/extend
router.post('/extend', HiringEngineController.extendApplicationCollection);

export default router;
