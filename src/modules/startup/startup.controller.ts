import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { StartupService } from './startup.service.js';
import { EcosystemApplicationModel } from './startup.model.js';
import { recruiterCreditsService } from '../recruiterCredits/recruiterCredits.service.js';
import { AppError } from '../../utils/appError.js';

export class StartupController {
  public static async getFundraisingProfile(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const profile = await StartupService.getFundraisingProfile(userId);

    res.status(200).json({
      success: true,
      data: profile,
    });
  }

  public static async updateFundraisingProfile(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const updated = await StartupService.updateFundraisingProfile(userId, req.body);

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Fundraising profile updated successfully',
    });
  }

  public static async getFundraisingSummary(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const summary = await StartupService.getFundraisingSummary(userId);

    res.status(200).json({
      success: true,
      data: summary,
    });
  }

  public static async listInvestors(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { search, type, sector, stage, page, limit } = req.query;

    const result = await StartupService.listInvestors(userId, {
      search: search as string | undefined,
      type: type as string | undefined,
      sector: sector as string | undefined,
      stage: stage as string | undefined,
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 20,
    });

    res.status(200).json({
      success: true,
      data: result.investors,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
    });
  }

  public static async getInvestorById(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const id = req.params.id as string;

    const investor = await StartupService.getInvestorById(id, userId);

    res.status(200).json({
      success: true,
      data: investor,
    });
  }

  public static async listPipelineDeals(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const deals = await StartupService.listPipelineDeals(userId);

    res.status(200).json({
      success: true,
      data: deals,
    });
  }

  public static async createPipelineDeal(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    // Server-side credit enforcement: Networking / Deal creation = 20 credits
    await recruiterCreditsService.chargeStartupFeature(
      userId,
      'startup_networking',
      undefined,
      'Fundraising Pipeline Deal / Investor Networking'
    );

    const deal = await StartupService.createPipelineDeal(userId, req.body);

    res.status(201).json({
      success: true,
      data: deal,
      message: 'Investor added to fundraising pipeline',
    });
  }

  public static async updatePipelineDeal(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const dealId = req.params.id as string;

    const updated = await StartupService.updatePipelineDeal(userId, dealId, req.body);

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Pipeline deal updated successfully',
    });
  }

  public static async deletePipelineDeal(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const dealId = req.params.id as string;

    await StartupService.deletePipelineDeal(userId, dealId);

    res.status(200).json({
      success: true,
      message: 'Deal removed from pipeline',
    });
  }

  public static async addDealActivity(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const dealId = req.params.id as string;

    const updated = await StartupService.addDealActivity(userId, dealId, req.body);

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Activity note added to deal',
    });
  }

  public static async generateAIPersonalizedPitch(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    // Server-side credit enforcement: Startup Business Plus AI Pitch = 50 credits
    await recruiterCreditsService.chargeStartupFeature(
      userId,
      'startup_business_plus',
      undefined,
      'Startup AI Personalized Pitch'
    );

    const pitch = await StartupService.generateAIPersonalizedPitch(userId, req.body);

    res.status(200).json({
      success: true,
      data: pitch,
    });
  }

  public static async listEcosystemApplications(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const org = await StartupService.getOrCreateStartupOrg(userId);
    const applications = await EcosystemApplicationModel.find({
      startupOrgId: org._id,
    }).sort({ createdAt: -1 }).lean();

    res.status(200).json({
      success: true,
      data: applications,
    });
  }

  public static async applyIncubation(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { incubatorName, facilities, city, deadline, link, notes } = req.body;

    const chargeResult = await recruiterCreditsService.chargeStartupFeature(
      userId,
      'startup_incubations',
      undefined,
      `Incubation Application Support: ${incubatorName || 'Incubator Program'}`
    );

    const org = await StartupService.getOrCreateStartupOrg(userId);
    const application = await EcosystemApplicationModel.create({
      startupOrgId: org._id,
      ownerUserId: new Types.ObjectId(userId),
      programType: 'incubator',
      programName: incubatorName || 'Incubation Program',
      status: 'Applied',
      appliedAt: new Date(),
      deadline: deadline || 'Active',
      link: link || '',
      notes: notes || (facilities ? `Requested facilities: ${facilities.join(', ')}` : 'Applied via LetGetIn Startup Hub'),
    });

    res.status(201).json({
      success: true,
      data: application,
      balance: chargeResult.balance,
      creditsDeducted: chargeResult.cost,
      message: 'Incubation support application submitted successfully',
    });
  }

  public static async applyAccelerator(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { acceleratorName, cohort, focus, checkSize, deadline, link, notes } = req.body;

    const chargeResult = await recruiterCreditsService.chargeStartupFeature(
      userId,
      'startup_accelerators',
      undefined,
      `Accelerator Application Support: ${acceleratorName || 'Accelerator Program'}`
    );

    const org = await StartupService.getOrCreateStartupOrg(userId);
    const application = await EcosystemApplicationModel.create({
      startupOrgId: org._id,
      ownerUserId: new Types.ObjectId(userId),
      programType: 'accelerator',
      programName: acceleratorName || 'Venture Accelerator',
      status: 'Applied',
      appliedAt: new Date(),
      deadline: deadline || 'Active',
      link: link || '',
      notes: notes || `Cohort: ${cohort || 'Next Batch'} | Investment: ${checkSize || 'N/A'}`,
    });

    res.status(201).json({
      success: true,
      data: application,
      balance: chargeResult.balance,
      creditsDeducted: chargeResult.cost,
      message: 'Accelerator application support initiated successfully',
    });
  }

  public static async requestDocumentation(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { docType, title, notes } = req.body;

    const chargeResult = await recruiterCreditsService.chargeStartupFeature(
      userId,
      'startup_documentations',
      undefined,
      `Startup Documentation Service: ${title || docType || 'Legal & Pitch Documentation'}`
    );

    res.status(200).json({
      success: true,
      data: {
        docType: docType || 'pitch_deck',
        title: title || 'Executive Investor Documentation',
        status: 'In Review',
        requestedAt: new Date(),
      },
      balance: chargeResult.balance,
      creditsDeducted: chargeResult.cost,
      message: 'Documentation service request processed successfully',
    });
  }

  public static async requestFundingSupport(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { supportType, targetAmount, notes } = req.body;

    const chargeResult = await recruiterCreditsService.chargeStartupFeature(
      userId,
      'startup_funding_support',
      undefined,
      `Funding Support Advisory Service: ${supportType || 'Capital Outreach'}`
    );

    res.status(200).json({
      success: true,
      data: {
        supportType: supportType || 'fundraising_advisory',
        targetAmount: targetAmount || 2000000,
        status: 'Active Advisory',
        requestedAt: new Date(),
      },
      balance: chargeResult.balance,
      creditsDeducted: chargeResult.cost,
      message: 'Funding support service activated successfully',
    });
  }

  public static async requestBusinessPlus(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { packageType, sprintName } = req.body;

    const chargeResult = await recruiterCreditsService.chargeStartupFeature(
      userId,
      'startup_business_plus',
      undefined,
      `Business Plus Listing / Growth Sprint: ${sprintName || packageType || 'Growth Package'}`
    );

    res.status(200).json({
      success: true,
      data: {
        packageType: packageType || 'business_plus_growth',
        sprintName: sprintName || 'Product & Growth Sprint',
        status: 'Activated',
        activatedAt: new Date(),
      },
      balance: chargeResult.balance,
      creditsDeducted: chargeResult.cost,
      message: 'Business Plus package activated successfully',
    });
  }

  public static async requestStartupService(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { serviceKey, details } = req.body;

    const validServices = [
      'startup_business_plus',
      'startup_documentations',
      'startup_funding_support',
      'startup_networking',
      'startup_incubations',
      'startup_accelerators',
    ] as const;

    if (!validServices.includes(serviceKey)) {
      throw AppError.badRequest('Invalid startup service key requested');
    }

    const chargeResult = await recruiterCreditsService.chargeStartupFeature(
      userId,
      serviceKey,
      undefined,
      details?.reasonOverride || `Startup Service: ${serviceKey}`
    );

    res.status(200).json({
      success: true,
      data: {
        serviceKey,
        details: details || {},
        status: 'Completed',
        processedAt: new Date(),
      },
      balance: chargeResult.balance,
      creditsDeducted: chargeResult.cost,
      message: 'Startup service requested and credits deducted successfully',
    });
  }
}
