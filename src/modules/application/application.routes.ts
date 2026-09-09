import { Router } from 'express';
import { ApplicationController } from './application.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(ApplicationController.getApplications));
router.post('/', asyncHandler(ApplicationController.createApplication));
router.patch('/:id/status', asyncHandler(ApplicationController.updateStatus));
router.delete('/:id', asyncHandler(ApplicationController.deleteApplication));

// --- Recruiter applicant pipeline ---
router.get('/recruiter/all', requireRole('recruiter'), asyncHandler(ApplicationController.getAllApplicantsForRecruiter));
router.get('/job/:jobId', requireRole('recruiter'), asyncHandler(ApplicationController.getApplicantsForJob));
router.patch('/:id/recruiter-status', requireRole('recruiter'), asyncHandler(ApplicationController.updateApplicantStatus));

export default router;
