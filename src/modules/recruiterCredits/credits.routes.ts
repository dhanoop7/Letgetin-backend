import { Router } from 'express';
import { RecruiterCreditsController } from './recruiterCredits.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Universal credit and billing endpoints accessible to all authenticated users (Candidates, Recruiters, Institutions, Startups)
router.use(authenticate);

router.get('/wallet', asyncHandler(RecruiterCreditsController.getUserWallet));
router.get('/balance', asyncHandler(RecruiterCreditsController.getUserWallet));
router.post('/order', asyncHandler(RecruiterCreditsController.createPaymentOrder));
router.post('/verify', asyncHandler(RecruiterCreditsController.verifyPayment));
router.post('/referral', asyncHandler(RecruiterCreditsController.claimReferral));
router.post('/activate-package', asyncHandler(RecruiterCreditsController.activatePackage));
router.post('/activate-promotion', asyncHandler(RecruiterCreditsController.activatePromotion));
router.post('/charge', asyncHandler(RecruiterCreditsController.chargeFeature));
router.post('/purchase', asyncHandler(RecruiterCreditsController.purchaseCredits));

export default router;
