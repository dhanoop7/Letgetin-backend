import { Request, Response } from 'express';
import { ResumeService } from './resume.service.js';

const resumeService = new ResumeService();

export class ResumeController {
  static create = async (req: Request, res: Response): Promise<void> => {
    const resume = await resumeService.createResume(req.user!.userId, req.body);
    res.status(201).json({
      success: true,
      data: { resume },
      message: 'Resume created successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static list = async (req: Request, res: Response): Promise<void> => {
    const resumes = await resumeService.getResumesForUser(req.user!.userId);
    res.status(200).json({
      success: true,
      data: { resumes },
      timestamp: new Date().toISOString(),
    });
  };

  static getById = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const resume = await resumeService.getResumeById(id, req.user!.userId);
    res.status(200).json({
      success: true,
      data: { resume },
      timestamp: new Date().toISOString(),
    });
  };

  static update = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const resume = await resumeService.updateResume(id, req.user!.userId, req.body);
    res.status(200).json({
      success: true,
      data: { resume },
      message: 'Resume updated successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static delete = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    await resumeService.deleteResume(id, req.user!.userId);
    res.status(200).json({
      success: true,
      data: null,
      message: 'Resume deleted successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static setActive = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const resume = await resumeService.setActiveResume(id, req.user!.userId);
    res.status(200).json({
      success: true,
      data: { resume },
      message: 'Active resume updated successfully',
      timestamp: new Date().toISOString(),
    });
  };
}
