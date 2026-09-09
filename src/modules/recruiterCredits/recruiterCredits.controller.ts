import { Request, Response } from 'express';
import { recruiterCreditsService } from './recruiterCredits.service.js';

export class RecruiterCreditsController {
  static getCredits = async (req: Request, res: Response): Promise<void> => {
    const result = await recruiterCreditsService.getBalance(req.user!.userId);
    res.status(200).json({ success: true, data: result, timestamp: new Date().toISOString() });
  };

  static purchaseCredits = async (req: Request, res: Response): Promise<void> => {
    const { packId } = req.body;
    const result = await recruiterCreditsService.purchase(req.user!.userId, packId);
    res.status(200).json({
      success: true,
      data: result,
      message: 'Credits purchased successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static revealContact = async (req: Request, res: Response): Promise<void> => {
    const candidateUserId = req.params.userId as string;
    const result = await recruiterCreditsService.revealContact(req.user!.userId, candidateUserId);
    res.status(200).json({
      success: true,
      data: result,
      message: 'Contact revealed successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static searchCandidates = async (req: Request, res: Response): Promise<void> => {
    const { jobId, query, limit } = req.query;
    const results = await recruiterCreditsService.searchCandidates(req.user!.userId, {
      jobId: typeof jobId === 'string' ? jobId : undefined,
      query: typeof query === 'string' ? query : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.status(200).json({ success: true, data: results, timestamp: new Date().toISOString() });
  };
}
