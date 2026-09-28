import { Router } from 'express';
import { TailoringController } from './tailoring.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  createTailoringSessionSchema,
  getActiveTailoringSessionSchema,
  updateTailoringSuggestionsSchema,
  finalizeTailoringSessionSchema,
} from './tailoring.validator.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);

router.post('/sessions', validate(createTailoringSessionSchema), asyncHandler(TailoringController.create));
router.get('/sessions/active', validate(getActiveTailoringSessionSchema), asyncHandler(TailoringController.getActiveForResume));
router.get('/sessions/:id', asyncHandler(TailoringController.getById));
router.patch('/sessions/:id', validate(updateTailoringSuggestionsSchema), asyncHandler(TailoringController.updateSuggestions));
router.post('/sessions/:id/finalize', validate(finalizeTailoringSessionSchema), asyncHandler(TailoringController.finalize));
router.delete('/sessions/:id', asyncHandler(TailoringController.discard));

export default router;
