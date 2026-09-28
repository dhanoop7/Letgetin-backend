import { Router } from 'express';
import { ResumeImportController } from './import.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Require authentication for resume import
router.use(authenticate);

router.post('/import-resume', asyncHandler(ResumeImportController.importResume));

export default router;
