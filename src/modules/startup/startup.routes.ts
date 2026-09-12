import { Router } from 'express';
import { StartupController } from './startup.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

// All startup endpoints require authenticated founder/recruiter session
router.use(authenticate);

// Startup & Fundraising Profile
router.get('/fundraising', StartupController.getFundraisingProfile);
router.patch('/fundraising', StartupController.updateFundraisingProfile);
router.get('/fundraising/summary', StartupController.getFundraisingSummary);

// Investor Directory & Discovery
router.get('/investors', StartupController.listInvestors);
router.get('/investors/:id', StartupController.getInvestorById);

// Fundraising Pipeline Deals
router.get('/pipeline', StartupController.listPipelineDeals);
router.post('/pipeline', StartupController.createPipelineDeal);
router.patch('/pipeline/:id', StartupController.updatePipelineDeal);
router.delete('/pipeline/:id', StartupController.deletePipelineDeal);
router.post('/pipeline/:id/activity', StartupController.addDealActivity);

// AI Personalized Pitch Generator
router.post('/ai/personalized-pitch', StartupController.generateAIPersonalizedPitch);

export default router;
