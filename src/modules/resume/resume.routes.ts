import { Router } from 'express';
import { ResumeController } from './resume.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { createResumeSchema, updateResumeSchema } from './resume.validator.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate); // Protect all resume routes

router.post('/', validate(createResumeSchema), asyncHandler(ResumeController.create));
router.get('/', asyncHandler(ResumeController.list));
router.get('/:id', asyncHandler(ResumeController.getById));
router.patch('/:id/active', asyncHandler(ResumeController.setActive));
router.patch('/:id', validate(updateResumeSchema), asyncHandler(ResumeController.update));
router.delete('/:id', asyncHandler(ResumeController.delete));

export default router;
