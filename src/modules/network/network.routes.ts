import { Router } from 'express';
import { NetworkController } from './network.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate);

router.get('/summary', asyncHandler(NetworkController.getSummary));
router.get('/contacts', asyncHandler(NetworkController.getContacts));
router.get('/recommended', asyncHandler(NetworkController.getRecommended));
router.get('/connections', asyncHandler(NetworkController.getConnections));
router.get('/following', asyncHandler(NetworkController.getFollowingAndFollowers));
router.get('/activity', asyncHandler(NetworkController.getActivityFeed));

router.post('/contacts', asyncHandler(NetworkController.createContact));
router.patch('/contacts/:id', asyncHandler(NetworkController.updateContact));
router.delete('/contacts/:id', asyncHandler(NetworkController.deleteContact));

router.post('/contacts/:id/connect', asyncHandler(NetworkController.toggleConnect));
router.post('/contacts/:id/follow', asyncHandler(NetworkController.toggleFollow));
router.post('/contacts/:id/interactions', asyncHandler(NetworkController.addInteraction));

export default router;
