import { Request, Response } from 'express';
import { TailoringService } from './tailoring.service.js';

const tailoringService = new TailoringService();

export class TailoringController {
  static create = async (req: Request, res: Response): Promise<void> => {
    const { resumeId, jobDescription } = req.body;
    const session = await tailoringService.createSession(req.user!.userId, resumeId, jobDescription);
    res.status(201).json({
      success: true,
      data: { session },
      message: 'Tailoring session created',
      timestamp: new Date().toISOString(),
    });
  };

  static getById = async (req: Request, res: Response): Promise<void> => {
    const session = await tailoringService.getSession(req.params.id as string, req.user!.userId);
    res.status(200).json({
      success: true,
      data: { session },
      timestamp: new Date().toISOString(),
    });
  };

  static getActiveForResume = async (req: Request, res: Response): Promise<void> => {
    const resumeId = req.query.resumeId as string;
    const session = await tailoringService.getActiveSessionForResume(resumeId, req.user!.userId);
    res.status(200).json({
      success: true,
      data: { session },
      timestamp: new Date().toISOString(),
    });
  };

  static updateSuggestions = async (req: Request, res: Response): Promise<void> => {
    const session = await tailoringService.updateSuggestions(req.params.id as string, req.user!.userId, req.body.suggestions);
    res.status(200).json({
      success: true,
      data: { session },
      timestamp: new Date().toISOString(),
    });
  };

  static finalize = async (req: Request, res: Response): Promise<void> => {
    const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
    const result = await tailoringService.finalizeSession(req.params.id as string, req.user!.userId, title);
    res.status(200).json({
      success: true,
      data: result,
      message: result.isNew ? 'Saved as a new resume' : 'Tailored resume saved',
      timestamp: new Date().toISOString(),
    });
  };

  static discard = async (req: Request, res: Response): Promise<void> => {
    await tailoringService.discardSession(req.params.id as string, req.user!.userId);
    res.status(200).json({
      success: true,
      data: null,
      message: 'Tailoring session discarded',
      timestamp: new Date().toISOString(),
    });
  };
}
