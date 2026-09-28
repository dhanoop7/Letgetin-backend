import { Request, Response } from 'express';
import { aiApplyService } from './aiApply.service.js';

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
