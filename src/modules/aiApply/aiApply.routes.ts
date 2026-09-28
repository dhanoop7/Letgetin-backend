import { Router } from 'express';
import { AiApplyController } from './aiApply.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { upsertAiApplyPreferencesSchema } from './aiApply.validator.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);

// Preferences
router.get('/preferences', asyncHandler(AiApplyController.getPreferences));
router.put('/preferences', validate(upsertAiApplyPreferencesSchema), asyncHandler(AiApplyController.savePreferences));

// Matched jobs finding based on candidate profile & preferences embeddings
router.get('/matches', asyncHandler(AiApplyController.getMatchedJobs));

// BullMQ 10-by-10 Batch Apply Endpoints
router.post('/batch/start', asyncHandler(AiApplyController.startBatchApply));
router.get('/batch/active', asyncHandler(AiApplyController.getActiveBatchSession));
router.get('/batch/status/:sessionId', asyncHandler(AiApplyController.getBatchStatus));
router.post('/batch/pause/:sessionId', asyncHandler(AiApplyController.pauseBatchApply));
router.post('/batch/resume/:sessionId', asyncHandler(AiApplyController.resumeBatchApply));
router.post('/batch/cancel/:sessionId', asyncHandler(AiApplyController.cancelBatchApply));

// Legacy synchronous apply
router.post('/apply', asyncHandler(AiApplyController.applyForJobs));

export default router;
