import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/appError.js';
import { UserModel } from '../user/user.model.js';
import { RecruiterOrganizationModel, IRecruiterOrganizationDocument } from '../recruiterOrg/recruiterOrg.model.js';
import { HuremasoSubscriptionModel, IHuremasoSubscriptionDocument, HuremasoAccessStatus } from './huremaso.model.js';
import { TRIAL_DURATION_DAYS, TRIAL_DURATION_MS, HUREMASO_PLANS, HuremasoPlanDefinition } from './huremaso.constants.js';

export interface HuremasoStatusResponse {
  status: HuremasoAccessStatus;
  canLaunch: boolean;
  serverTimestamp: string;
  org: {
    id: string;
    name: string;
  };
  trial: {
    startedAt: string | null;
    expiresAt: string | null;
    daysRemaining: number;
    hoursRemaining: number;
    secondsRemaining: number;
    trialUsed: boolean;
    durationDays: number;
  };
  subscription: {
    planId: string | null;
    planName: string | null;
    billingCycle: string | null;
    amountPaid: number | null;
    currency: string;
    startedAt: string | null;
    expiresAt: string | null;
    paymentId: string | null;
  } | null;
  plans: Record<'starter' | 'pro', HuremasoPlanDefinition>;
}

export interface LaunchTokenPayload {
  type: 'huremaso_launch';
  userId: string;
  orgId: string;
  orgName: string;
  email: string;
  name: string;
  status: HuremasoAccessStatus;
  trialExpiresAt: string | null;
  subscriptionExpiresAt: string | null;
}

export class HuremasoService {
  /**
   * Resolves or provisions a recruiter organization for the user.
   */
  private async resolveOrg(userId: string): Promise<IRecruiterOrganizationDocument> {
    let org = await RecruiterOrganizationModel.findOne({ ownerUserId: new Types.ObjectId(userId) });
    if (!org) {
      const user = await UserModel.findById(userId);
      const orgName = (user?.fullName || user?.username) ? `${user?.fullName || user?.username}'s Organization` : 'Recruiter Organization';
      org = await RecruiterOrganizationModel.create({
        ownerUserId: new Types.ObjectId(userId),
        entity: 'company',
        name: orgName,
      });
    }
    return org;
  }

  /**
   * Resolves or provisions a Huremaso subscription record for the recruiter organization.
   */
  private async getSubscriptionDoc(userId: string): Promise<{
    sub: IHuremasoSubscriptionDocument;
    org: IRecruiterOrganizationDocument;
  }> {
    const org = await this.resolveOrg(userId);
    let sub = await HuremasoSubscriptionModel.findOne({ ownerUserId: new Types.ObjectId(userId) });
    if (!sub) {
      sub = await HuremasoSubscriptionModel.create({
        ownerUserId: new Types.ObjectId(userId),
        orgId: org._id,
        status: 'trial_not_started',
        trialUsed: false,
      });
    } else if (!sub.orgId.equals(org._id)) {
      sub.orgId = org._id;
      await sub.save();
    }
    return { sub, org };
  }

  /**
   * Evaluates authoritative status based on current server-side timestamp.
   */
  private evaluateStatus(sub: IHuremasoSubscriptionDocument): {
    status: HuremasoAccessStatus;
    needsSave: boolean;
  } {
    const now = new Date();

    // Check active paid subscription first
    if (sub.subscriptionStartedAt && sub.paymentStatus === 'paid') {
      if (sub.subscriptionExpiresAt && sub.subscriptionExpiresAt <= now) {
        return { status: 'subscription_cancelled', needsSave: sub.status !== 'subscription_cancelled' };
      }
      return { status: 'subscription_active', needsSave: sub.status !== 'subscription_active' };
    }

    // Check 7-day trial status
    if (sub.trialStartedAt && sub.trialExpiresAt) {
      if (now < sub.trialExpiresAt) {
        return { status: 'trial_active', needsSave: sub.status !== 'trial_active' };
      } else {
        return { status: 'trial_expired', needsSave: sub.status !== 'trial_expired' };
      }
    }

    return { status: 'trial_not_started', needsSave: sub.status !== 'trial_not_started' };
  }

  /**
   * Retrieves full trial and subscription status for a recruiter.
   */
  async getStatus(userId: string): Promise<HuremasoStatusResponse> {
    const { sub, org } = await this.getSubscriptionDoc(userId);
    const { status, needsSave } = this.evaluateStatus(sub);

    if (needsSave) {
      sub.status = status;
      await sub.save();
    }

    const now = Date.now();
    let daysRemaining = 0;
    let hoursRemaining = 0;
    let secondsRemaining = 0;

    if (status === 'trial_active' && sub.trialExpiresAt) {
      const diffMs = Math.max(0, sub.trialExpiresAt.getTime() - now);
      secondsRemaining = Math.floor(diffMs / 1000);
      hoursRemaining = Math.floor(diffMs / (1000 * 60 * 60));
      daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }

    const canLaunch = status === 'trial_active' || status === 'subscription_active';

    return {
      status,
      canLaunch,
      serverTimestamp: new Date().toISOString(),
      org: {
        id: org._id.toString(),
        name: org.name,
      },
      trial: {
        startedAt: sub.trialStartedAt ? sub.trialStartedAt.toISOString() : null,
        expiresAt: sub.trialExpiresAt ? sub.trialExpiresAt.toISOString() : null,
        daysRemaining,
        hoursRemaining,
        secondsRemaining,
        trialUsed: !!sub.trialUsed,
        durationDays: TRIAL_DURATION_DAYS,
      },
      subscription:
        sub.subscriptionPlanId && sub.paymentStatus === 'paid'
          ? {
              planId: sub.subscriptionPlanId,
              planName: sub.subscriptionPlanName || null,
              billingCycle: sub.billingCycle || null,
              amountPaid: sub.amountPaid || null,
              currency: sub.currency || 'USD',
              startedAt: sub.subscriptionStartedAt ? sub.subscriptionStartedAt.toISOString() : null,
              expiresAt: sub.subscriptionExpiresAt ? sub.subscriptionExpiresAt.toISOString() : null,
              paymentId: sub.paymentId || null,
            }
          : null,
      plans: HUREMASO_PLANS,
    };
  }

  /**
   * Starts the 7-day free trial. Enforces single-use trial per organization.
   */
  async startTrial(userId: string): Promise<HuremasoStatusResponse> {
    const { sub, org } = await this.getSubscriptionDoc(userId);

    if (sub.trialUsed || sub.trialStartedAt) {
      throw AppError.badRequest(
        'The 7-day free trial has already been initiated or used for this organization.'
      );
    }

    if (sub.status === 'subscription_active') {
      throw AppError.badRequest('Your organization already has an active paid subscription.');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TRIAL_DURATION_MS);

    sub.status = 'trial_active';
    sub.trialStartedAt = now;
    sub.trialExpiresAt = expiresAt;
    sub.trialUsed = true;
    await sub.save();

    return await this.getStatus(userId);
  }

  /**
   * Issues a short-lived cryptographically signed launch token for opening Huremaso in a new tab.
   */
  async createLaunchSession(userId: string): Promise<{
    launchUrl: string;
    token: string;
    expiresAt: string;
    status: HuremasoAccessStatus;
  }> {
    const { sub, org } = await this.getSubscriptionDoc(userId);
    const { status, needsSave } = this.evaluateStatus(sub);

    if (needsSave) {
      sub.status = status;
      await sub.save();
    }

    if (status === 'trial_expired') {
      throw AppError.forbidden(
        'Your 7-day free trial has expired. Please subscribe to continue accessing Huremaso HRMS.'
      );
    }

    if (status === 'trial_not_started') {
      throw AppError.forbidden(
        'Free trial has not been started yet. Please activate your 7-day free trial first.'
      );
    }

    if (status !== 'trial_active' && status !== 'subscription_active') {
      throw AppError.forbidden('An active trial or paid subscription is required to access Huremaso.');
    }

    const user = await UserModel.findById(userId);

    // Short-lived launch session (max 1 hour or trial expiry, whichever is earlier)
    let tokenExpirySeconds = 3600;
    if (status === 'trial_active' && sub.trialExpiresAt) {
      const secondsLeftInTrial = Math.floor((sub.trialExpiresAt.getTime() - Date.now()) / 1000);
      if (secondsLeftInTrial > 0 && secondsLeftInTrial < tokenExpirySeconds) {
        tokenExpirySeconds = secondsLeftInTrial;
      }
    }

    const payload: LaunchTokenPayload = {
      type: 'huremaso_launch',
      userId,
      orgId: org._id.toString(),
      orgName: org.name,
      email: user?.email || '',
      name: user?.fullName || user?.username || org.name,
      status,
      trialExpiresAt: sub.trialExpiresAt ? sub.trialExpiresAt.toISOString() : null,
      subscriptionExpiresAt: sub.subscriptionExpiresAt ? sub.subscriptionExpiresAt.toISOString() : null,
    };

    const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: tokenExpirySeconds,
    });

    const tokenExpiryDate = new Date(Date.now() + tokenExpirySeconds * 1000).toISOString();
    const huremasoBaseUrl = (env.HUREMASO_URL || 'http://localhost:5173').replace(/\/$/, '');
    const launchUrl = `${huremasoBaseUrl}/login?token=${encodeURIComponent(token)}`;

    return {
      launchUrl,
      token,
      expiresAt: tokenExpiryDate,
      status,
    };
  }

  /**
   * Verifies a launch token received by Huremaso from LetGetIn.
   */
  async verifyLaunchToken(token: string): Promise<{
    valid: boolean;
    reason?: string;
    message?: string;
    data?: {
      userId: string;
      orgId: string;
      orgName: string;
      email: string;
      name: string;
      status: HuremasoAccessStatus;
      trialExpiresAt: string | null;
      subscriptionExpiresAt: string | null;
    };
  }> {
    if (!token) {
      return { valid: false, reason: 'missing_token', message: 'Launch token is required' };
    }

    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as LaunchTokenPayload;
      if (decoded.type !== 'huremaso_launch' || !decoded.userId) {
        return { valid: false, reason: 'invalid_token_type', message: 'Token format invalid' };
      }

      // Re-verify against authoritative database state
      const sub = await HuremasoSubscriptionModel.findOne({ ownerUserId: new Types.ObjectId(decoded.userId) });
      if (!sub) {
        return { valid: false, reason: 'subscription_not_found', message: 'Subscription record not found' };
      }

      const { status, needsSave } = this.evaluateStatus(sub);
      if (needsSave) {
        sub.status = status;
        await sub.save();
      }

      if (status !== 'trial_active' && status !== 'subscription_active') {
        return {
          valid: false,
          reason: status === 'trial_expired' ? 'trial_expired' : 'access_revoked',
          message:
            status === 'trial_expired'
              ? 'Your 7-day free trial has expired. Please subscribe to restore access.'
              : 'Your access to Huremaso has expired or is inactive.',
        };
      }

      return {
        valid: true,
        data: {
          userId: decoded.userId,
          orgId: decoded.orgId,
          orgName: decoded.orgName,
          email: decoded.email,
          name: decoded.name,
          status,
          trialExpiresAt: sub.trialExpiresAt ? sub.trialExpiresAt.toISOString() : null,
          subscriptionExpiresAt: sub.subscriptionExpiresAt ? sub.subscriptionExpiresAt.toISOString() : null,
        },
      };
    } catch (err: any) {
      return {
        valid: false,
        reason: 'token_verification_failed',
        message: err.message || 'Launch token is invalid or expired',
      };
    }
  }

  /**
   * Activates or renews a paid Huremaso subscription.
   */
  async purchaseSubscription(
    userId: string,
    params: { planId: 'starter' | 'pro'; billingCycle: 'monthly' | 'annual' }
  ): Promise<HuremasoStatusResponse> {
    const plan = HUREMASO_PLANS[params.planId];
    if (!plan) {
      throw AppError.badRequest('Invalid subscription plan specified.');
    }

    if (params.billingCycle !== 'monthly' && params.billingCycle !== 'annual') {
      throw AppError.badRequest('Billing cycle must be either "monthly" or "annual".');
    }

    const { sub } = await this.getSubscriptionDoc(userId);

    const price = params.billingCycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
    const durationDays = params.billingCycle === 'annual' ? 365 : 30;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const txnId = `txn_hms_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    sub.status = 'subscription_active';
    sub.subscriptionPlanId = params.planId;
    sub.subscriptionPlanName = plan.name;
    sub.billingCycle = params.billingCycle;
    sub.amountPaid = price;
    sub.currency = 'USD';
    sub.paymentId = txnId;
    sub.paymentStatus = 'paid';
    sub.subscriptionStartedAt = now;
    sub.subscriptionExpiresAt = expiresAt;

    await sub.save();

    return await this.getStatus(userId);
  }
}

export const huremasoService = new HuremasoService();
