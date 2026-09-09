import { Request, Response } from 'express';
import { CoverLetterService } from './coverLetter.service.js';

const coverLetterService = new CoverLetterService();

export class CoverLetterController {
  static create = async (req: Request, res: Response): Promise<void> => {
    const coverLetter = await coverLetterService.createCoverLetter(req.user!.userId, req.body);
    res.status(201).json({
      success: true,
      data: { coverLetter },
      message: 'Cover letter created successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static list = async (req: Request, res: Response): Promise<void> => {
    const coverLetters = await coverLetterService.getCoverLettersForUser(req.user!.userId);
    res.status(200).json({
      success: true,
      data: { coverLetters },
      timestamp: new Date().toISOString(),
    });
  };

  static getById = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const coverLetter = await coverLetterService.getCoverLetterById(id, req.user!.userId);
    res.status(200).json({
      success: true,
      data: { coverLetter },
      timestamp: new Date().toISOString(),
    });
  };

  static update = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const coverLetter = await coverLetterService.updateCoverLetter(id, req.user!.userId, req.body);
    res.status(200).json({
      success: true,
      data: { coverLetter },
      message: 'Cover letter updated successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static delete = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    await coverLetterService.deleteCoverLetter(id, req.user!.userId);
    res.status(200).json({
      success: true,
      data: null,
      message: 'Cover letter deleted successfully',
      timestamp: new Date().toISOString(),
    });
  };
}
