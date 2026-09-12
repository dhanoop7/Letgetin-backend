import { Request, Response } from 'express';
import { StartupService } from './startup.service.js';

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
    const pitch = await StartupService.generateAIPersonalizedPitch(userId, req.body);

    res.status(200).json({
      success: true,
      data: pitch,
    });
  }
}
