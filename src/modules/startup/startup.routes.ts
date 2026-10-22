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

// Ecosystem & Startup Services (6 Startup Feature Actions)
router.get('/services/applications', StartupController.listEcosystemApplications);
router.post('/services/request', StartupController.requestStartupService);
router.post('/incubations/apply', StartupController.applyIncubation);
router.post('/accelerators/apply', StartupController.applyAccelerator);
router.post('/documentations/request', StartupController.requestDocumentation);
router.post('/funding-support/request', StartupController.requestFundingSupport);
router.post('/business-plus/request', StartupController.requestBusinessPlus);

export default router;
