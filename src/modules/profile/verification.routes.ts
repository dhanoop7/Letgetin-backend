import { Router } from 'express';
import multer from 'multer';
import { VerificationController } from './verification.controller.js';
import { ProfileController } from './profile.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB file size limit
  },
});

const router = Router();

router.use(authenticate);

// Main User Profile endpoints (Data persistence in DB)
router.get('/', ProfileController.getProfile);
router.put('/', ProfileController.updateProfile);
router.patch('/', ProfileController.updateProfile);
router.post('/', ProfileController.updateProfile);

// Verification Document endpoints
router.get('/verifications', VerificationController.getVerifications);
router.get('/verifications/:id', VerificationController.getVerificationById);
router.post('/verifications/upload', upload.single('file'), VerificationController.uploadDocument);
router.delete('/verifications/:id', VerificationController.deleteDocument);
router.patch('/verifications/:id/status', VerificationController.updateStatus);

export default router;
