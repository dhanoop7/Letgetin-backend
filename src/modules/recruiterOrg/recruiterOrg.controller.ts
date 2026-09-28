import { Request, Response } from 'express';
import { RecruiterOrgService } from './recruiterOrg.service.js';
import { AppError } from '../../utils/appError.js';
import { EntityType } from './recruiterOrg.model.js';

const recruiterOrgService = new RecruiterOrgService();

export class RecruiterOrgController {
  static getOrgFormMeta = async (req: Request, res: Response): Promise<void> => {
    const entity = req.query.entity as EntityType;
    const meta = recruiterOrgService.getOrgFormMeta(entity);
    res.status(200).json({ success: true, data: { meta }, timestamp: new Date().toISOString() });
  };

  static getOrgProfile = async (req: Request, res: Response): Promise<void> => {
    const profile = await recruiterOrgService.getOrgProfile(req.user!.userId);
    res.status(200).json({ success: true, data: { profile }, timestamp: new Date().toISOString() });
  };

  static getOverview = async (req: Request, res: Response): Promise<void> => {
    const overview = await recruiterOrgService.getOverview(req.user!.userId);
    res.status(200).json({ success: true, data: overview, timestamp: new Date().toISOString() });
  };

  static autofillOrgProfile = async (req: Request, res: Response): Promise<void> => {
    const { url, entity } = req.body as { url: string; entity: EntityType };
    const fields = await recruiterOrgService.autofillOrgProfile(entity, url);
    res.status(200).json({
      success: true,
      data: { fields, sourceUrl: url },
      message: 'Autofill complete',
      timestamp: new Date().toISOString(),
    });
  };

  static saveOrgProfile = async (req: Request, res: Response): Promise<void> => {
    if (req.user!.role !== 'recruiter') {
      throw AppError.forbidden('Only recruiter accounts can manage an organization profile');
    }
    const profile = await recruiterOrgService.saveOrgProfile(req.user!.userId, req.body);
    res.status(200).json({
      success: true,
      data: { profile },
      message: 'Organization profile saved successfully',
      timestamp: new Date().toISOString(),
    });
  };
}
