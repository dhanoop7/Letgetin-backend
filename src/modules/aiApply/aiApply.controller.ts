import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { aiApplyService } from './aiApply.service.js';
import { recruiterCreditsService } from '../recruiterCredits/recruiterCredits.service.js';
import { UserSubscriptionModel } from '../recruiterCredits/recruiterCredits.model.js';
import { FEATURE_PRICING } from '../../config/pricing.config.js';
import { AppError } from '../../utils/appError.js';

export class AiApplyController {
  static getPreferences = async (req: Request, res: Response): Promise<void> => {
    const { preferences, aiSuggestions } = await aiApplyService.getPreferences(req.user!.userId);
    res.status(200).json({
      success: true,
      data: { preferences, aiSuggestions },
      timestamp: new Date().toISOString(),
    });
  };

  static savePreferences = async (req: Request, res: Response): Promise<void> => {
    const preferences = await aiApplyService.savePreferences(req.user!.userId, req.body);
    res.status(200).json({
      success: true,
      data: { preferences },
      message: 'AI Apply preferences saved',
      timestamp: new Date().toISOString(),
    });
  };

  static getMatchedJobs = async (req: Request, res: Response): Promise<void> => {
    const minScore = req.query.minScore ? parseInt(req.query.minScore as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const search = req.query.search ? (req.query.search as string) : undefined;

    const result = await aiApplyService.getMatchedJobs(req.user!.userId, {
      minScore,
      limit,
      page,
      search,
    });

    res.status(200).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  };

  static startBatchApply = async (req: Request, res: Response): Promise<void> => {
    const { jobIds, limit, batchSize } = req.body || {};
    const totalCount = Array.isArray(jobIds) && jobIds.length > 0 ? jobIds.length : (limit || 10);
    const userId = req.user!.userId;
    const now = new Date();

    // Check for an active, non-expired AI Apply package with remaining quota
    const activePackage = await UserSubscriptionModel.findOne({
      userId,
      packageType: 'ai_apply',
      status: 'active',
      expiresAt: { $gt: now },
      quotaRemaining: { $gt: 0 },
    }).sort({ expiresAt: 1 });

    if (activePackage) {
      if (totalCount > (activePackage.quotaRemaining || 0)) {
        throw AppError.badRequest(
          `Your active package has ${activePackage.quotaRemaining} applications remaining, but ${totalCount} jobs were requested. Please select up to ${activePackage.quotaRemaining} jobs or activate an additional package.`
        );
      }
      activePackage.quotaUsed = (activePackage.quotaUsed || 0) + totalCount;
      activePackage.quotaRemaining = (activePackage.quotaRemaining || 0) - totalCount;
      await activePackage.save();
    } else {
      // Determine required package tier
      let creditCost = 20;
      let featureKey = 'ai_apply_10jobs_1day';
      let packageQuota = 10;
      let durationDays = 1;

      if (totalCount > 20) {
        creditCost = 50;
        featureKey = 'ai_apply_50jobs_10days';
        packageQuota = 50;
        durationDays = 10;
      } else if (totalCount > 10) {
        creditCost = 40;
        featureKey = 'ai_apply_20jobs_7days';
        packageQuota = 20;
        durationDays = 7;
      }

      // Server-side credit enforcement
      await recruiterCreditsService.chargeForFeature(
        userId,
        featureKey,
        creditCost,
        undefined,
        `AI Auto-Apply package (${packageQuota} jobs / ${durationDays} days)`
      );

      // Record active package with remaining quota
      const startDate = new Date();
      const expiresAt = new Date(startDate.getTime() + durationDays * 24 * 3600 * 1000);
      await UserSubscriptionModel.create({
        userId: new mongoose.Types.ObjectId(userId),
        planId: featureKey,
        planName: FEATURE_PRICING[featureKey]?.name || `AI Apply — ${packageQuota} jobs`,
        billingCycle: `${durationDays}_days`,
        creditsIncluded: creditCost,
        priceInr: creditCost * 10,
        quotaTotal: packageQuota,
        quotaUsed: totalCount,
        quotaRemaining: Math.max(0, packageQuota - totalCount),
        packageType: 'ai_apply',
        startDate,
        expiresAt,
        status: 'active',
      });
    }

    const result = await aiApplyService.startBatchApply(req.user!.userId, {
      jobIds,
      limit,
      batchSize: batchSize || 10,
    });

    res.status(200).json({
      success: true,
      data: result,
      message: `AI Auto-Apply initialized for ${result.totalJobs} jobs in ${result.totalBatches} batches (10 jobs per batch)`,
      timestamp: new Date().toISOString(),
    });
  };

  static getBatchStatus = async (req: Request, res: Response): Promise<void> => {
    const sessionId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
    const status = await aiApplyService.getBatchStatus(req.user!.userId, String(sessionId));

    res.status(200).json({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    });
  };

  static getActiveBatchSession = async (req: Request, res: Response): Promise<void> => {
    const session = await aiApplyService.getActiveBatchSession(req.user!.userId);

    res.status(200).json({
      success: true,
      data: session,
      timestamp: new Date().toISOString(),
    });
  };

  static pauseBatchApply = async (req: Request, res: Response): Promise<void> => {
    const sessionId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
    const session = await aiApplyService.pauseBatchApply(req.user!.userId, String(sessionId));

    res.status(200).json({
      success: true,
      data: session,
      message: 'Batch apply paused',
      timestamp: new Date().toISOString(),
    });
  };

  static resumeBatchApply = async (req: Request, res: Response): Promise<void> => {
    const sessionId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
    const session = await aiApplyService.resumeBatchApply(req.user!.userId, String(sessionId));

    res.status(200).json({
      success: true,
      data: session,
      message: 'Batch apply resumed',
      timestamp: new Date().toISOString(),
    });
  };

  static cancelBatchApply = async (req: Request, res: Response): Promise<void> => {
    const sessionId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
    const session = await aiApplyService.cancelBatchApply(req.user!.userId, String(sessionId));

    res.status(200).json({
      success: true,
      data: session,
      message: 'Batch apply cancelled',
      timestamp: new Date().toISOString(),
    });
  };

  static applyForJobs = async (req: Request, res: Response): Promise<void> => {
    const result = await aiApplyService.applyForJobs(req.user!.userId);
    res.status(200).json({
      success: true,
      data: result,
      message: `AI Apply activated - applied to ${result.appliedCount} matching job${result.appliedCount === 1 ? '' : 's'}`,
      timestamp: new Date().toISOString(),
    });
  };
}
