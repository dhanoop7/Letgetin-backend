import { Request, Response } from 'express';
import { huremasoService } from './huremaso.service.js';

export class HuremasoController {
  static getStatus = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const result = await huremasoService.getStatus(userId);
    res.status(200).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  };

  static startTrial = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const result = await huremasoService.startTrial(userId);
    res.status(200).json({
      success: true,
      data: result,
      message: '7-day free trial started successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static launch = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const result = await huremasoService.createLaunchSession(userId);
    res.status(200).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  };

  static verifyToken = async (req: Request, res: Response): Promise<void> => {
    const token = (req.query.token as string) || (req.headers['x-launch-token'] as string) || '';
    const result = await huremasoService.verifyLaunchToken(token);
    res.status(result.valid ? 200 : 401).json({
      success: result.valid,
      data: result,
      timestamp: new Date().toISOString(),
    });
  };

  static subscribe = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { planId, billingCycle } = req.body;
    const result = await huremasoService.purchaseSubscription(userId, {
      planId: planId || 'pro',
      billingCycle: billingCycle || 'monthly',
    });
    res.status(200).json({
      success: true,
      data: result,
      message: 'Huremaso subscription activated successfully',
      timestamp: new Date().toISOString(),
    });
  };
}
