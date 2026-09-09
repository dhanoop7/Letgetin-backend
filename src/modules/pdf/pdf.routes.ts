import { Router } from 'express';
import { PDFController } from './pdf.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Require authentication for PDF downloads
router.use(authenticate);

router.post('/download', asyncHandler(PDFController.download));

export default router;
