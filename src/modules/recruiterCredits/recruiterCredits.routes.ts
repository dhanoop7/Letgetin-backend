import { Router } from 'express';
import { RecruiterCreditsController } from './recruiterCredits.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { purchaseCreditsSchema, revealContactSchema, searchCandidatesSchema } from './recruiterCredits.validator.js';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use(authenticate, requireRole('recruiter'));

router.get('/credits', asyncHandler(RecruiterCreditsController.getCredits));
router.post('/credits/purchase', validate(purchaseCreditsSchema), asyncHandler(RecruiterCreditsController.purchaseCredits));
router.post(
  '/candidates/:userId/reveal-contact',
  validate(revealContactSchema),
  asyncHandler(RecruiterCreditsController.revealContact)
);
router.get(
  '/candidates/search',
  validate(searchCandidatesSchema),
  asyncHandler(RecruiterCreditsController.searchCandidates)
);

export default router;
