import { Router } from 'express';
import { CoverLetterController } from './coverLetter.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { createCoverLetterSchema, updateCoverLetterSchema } from './coverLetter.validator.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate); // Protect all cover letter routes

router.post('/', validate(createCoverLetterSchema), asyncHandler(CoverLetterController.create));
router.get('/', asyncHandler(CoverLetterController.list));
router.get('/:id', asyncHandler(CoverLetterController.getById));
router.patch('/:id', validate(updateCoverLetterSchema), asyncHandler(CoverLetterController.update));
router.delete('/:id', asyncHandler(CoverLetterController.delete));

export default router;
