import { Router } from 'express';
import multer from 'multer';
import { VideoProfileController } from './videoProfile.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { uploadVideoSchema } from './videoProfile.validator.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { VIDEO_SIZE_LIMITS } from './videoProfile.service.js';

// Multer's own ceiling is a single shared cap sized to the larger of the two video types (Long
// Video, 50MB) - the precise, per-type limit (10MB for Short Video) is enforced server-side in
// videoProfile.service.ts, since multer only supports one static limit per instance.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_SIZE_LIMITS.long },
});

const router = Router();

router.use(authenticate);

router.post('/upload', upload.single('file'), validate(uploadVideoSchema), asyncHandler(VideoProfileController.upload));
router.get('/', asyncHandler(VideoProfileController.list));
router.patch('/:id/archive', asyncHandler(VideoProfileController.archive));
router.delete('/:id', asyncHandler(VideoProfileController.delete));

export default router;
