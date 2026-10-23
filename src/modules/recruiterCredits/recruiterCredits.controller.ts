import { Request, Response } from 'express';
import { recruiterCreditsService } from './recruiterCredits.service.js';

export class RecruiterCreditsController {
  static getCredits = async (req: Request, res: Response): Promise<void> => {
    const result = await recruiterCreditsService.getBalance(req.user!.userId);
    res.status(200).json({ success: true, data: result, timestamp: new Date().toISOString() });
  };

  static getUserWallet = async (req: Request, res: Response): Promise<void> => {
    const result = await recruiterCreditsService.getUserWallet(req.user!.userId, req.user?.role);
    res.status(200).json({ success: true, data: result, timestamp: new Date().toISOString() });
  };

  static createPaymentOrder = async (req: Request, res: Response): Promise<void> => {
    const { purchaseType, itemKey, billingCycle, customCredits } = req.body;
    const result = await recruiterCreditsService.createPaymentOrder(
      req.user!.userId,
      {
        purchaseType: purchaseType || 'credits',
        itemKey,
        billingCycle,
        customCredits,
      },
      req.user?.role
    );
    res.status(201).json({
      success: true,
      data: result,
      message: 'Payment order created successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static verifyPayment = async (req: Request, res: Response): Promise<void> => {
    const { orderId, paymentId, signature } = req.body;
    const result = await recruiterCreditsService.verifyPayment(req.user!.userId, {
      orderId,
      paymentId,
      signature,
    });
    res.status(200).json({
      success: true,
      data: result,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
  };

  static claimReferral = async (req: Request, res: Response): Promise<void> => {
    const { referralCode } = req.body;
    const result = await recruiterCreditsService.claimReferral(req.user!.userId, referralCode);
    res.status(200).json({
      success: true,
      data: result,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
  };

  static activatePackage = async (req: Request, res: Response): Promise<void> => {
    const { packageKey } = req.body;
    const result = await recruiterCreditsService.activateCandidatePackage(
      req.user!.userId,
      packageKey,
      req.user?.role
    );
    res.status(200).json({
      success: true,
      data: result,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
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

  static activatePromotion = async (req: Request, res: Response): Promise<void> => {
    const { promoKey, jobId, notes } = req.body;
    const result = await recruiterCreditsService.activateCompanyPromotion(
      req.user!.userId,
      promoKey,
      req.user?.role,
      jobId,
      notes
    );
    res.status(200).json({
      success: true,
      data: result,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
  };

  static chargeFeature = async (req: Request, res: Response): Promise<void> => {
    const { featureKey, customCredits, count, quantity, refId, reasonOverride } = req.body;
    let result;
    if (featureKey && featureKey.startsWith('inst_')) {
      result = await recruiterCreditsService.chargeInstitutionFeature(
        req.user!.userId,
        featureKey as any,
        { count: quantity ?? count, quantity: quantity ?? count, customCredits, refId, reasonOverride }
      );
    } else {
      result = await recruiterCreditsService.chargeForFeature(
        req.user!.userId,
        featureKey,
        { customCredits, refId, reasonOverride }
      );
    }
    res.status(200).json({
      success: true,
      data: result,
      message: `Successfully charged ${result.cost} credits for ${result.feature}`,
      timestamp: new Date().toISOString(),
    });
  };
}
