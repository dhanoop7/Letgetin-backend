import { Router } from 'express';
import { HuremasoController } from './huremaso.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Token verification for Huremaso cross-origin entry
router.get('/verify-token', asyncHandler(HuremasoController.verifyToken));

// Recruiter authenticated endpoints
router.get('/status', authenticate, requireRole('recruiter'), asyncHandler(HuremasoController.getStatus));
router.post('/start-trial', authenticate, requireRole('recruiter'), asyncHandler(HuremasoController.startTrial));
router.post('/launch', authenticate, requireRole('recruiter'), asyncHandler(HuremasoController.launch));
router.post('/subscribe', authenticate, requireRole('recruiter'), asyncHandler(HuremasoController.subscribe));

export default router;
