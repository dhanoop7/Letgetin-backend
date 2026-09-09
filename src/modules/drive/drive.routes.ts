import { Router } from 'express';
import multer from 'multer';
import { DriveController } from './drive.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // Up to 50MB per file
  },
});

const router = Router();

router.use(authenticate);

router.get('/', DriveController.getDriveFiles);
router.get('/stats', DriveController.getStorageStats);
router.post('/upload', upload.single('file'), DriveController.uploadFile);
router.delete('/:id', DriveController.deleteFile);
router.patch('/:id/star', DriveController.toggleStar);
router.patch('/:id', DriveController.updateFile);

export default router;
