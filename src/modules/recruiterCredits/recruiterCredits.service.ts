import mongoose from 'mongoose';
import crypto from 'crypto';
import {
  RecruiterCreditsModel,
  CreditTransactionModel,
  CandidateContactRevealModel,
  UserSubscriptionModel,
  PaymentOrderModel,
  IRecruiterCreditsDocument,
  SubscriptionDuration,
} from './recruiterCredits.model.js';
import { RecruiterOrgRepository } from '../recruiterOrg/recruiterOrg.repository.js';
import { CandidateProfileModel } from '../job/candidateProfile.model.js';
import { JobModel } from '../job/job.model.js';
import { UserModel } from '../user/user.model.js';
import { ResumeModel } from '../resume/resume.model.js';
import { UserProfileModel } from '../profile/profile.model.js';
import { embeddingService } from '../embedding/embedding.service.js';
import { AppError } from '../../utils/appError.js';
import { CREDIT_PACKS } from './creditPacks.constants.js';
import { MATCH_VOLUME_OPTIONS, PIPELINE_SUB_OPTIONS, SUB_OPTION_CREDIT_COST } from './pipelineCreditCosts.constants.js';
import {
  CREDIT_VALUE_INR,
  INITIAL_PROMOTIONAL_CREDITS,
  REFERRAL_REWARD_CREDITS,
  FEATURE_PRICING,
  SUBSCRIPTION_PLANS,
  CREDIT_TOPUP_PACKS,
  CANDIDATE_PLAN_CATEGORIES,
  COMPANY_SUBSCRIPTION_IDS,
  COMPANY_PLAN_CATEGORIES,
  STARTUP_SUBSCRIPTION_IDS,
  STARTUP_PLAN_CATEGORIES,
  INSTITUTION_SUBSCRIPTION_IDS,
  INSTITUTION_PLAN_CATEGORIES,
  SubscriptionDurationKey,
} from '../../config/pricing.config.js';

const CONTACT_REVEAL_COST = 5;

function maskEmail(email?: string): string {
  if (!email) return '';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

function maskPhone(phone?: string): string {
  if (!phone) return '';
  return phone.length <= 4 ? phone : `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}

export interface CreditOwnerContext {
  orgId?: string;
  userId: string;
}

export class RecruiterCreditsService {
  private orgRepository = new RecruiterOrgRepository();

  /** Resolves whether the user has an organization (recruiter) or is acting as an individual (candidate/user). */
  async resolveOwner(userId: string): Promise<CreditOwnerContext> {
    try {
      const org = await this.orgRepository.findByOwnerUserId(userId);
      if (org) {
        return { orgId: org._id.toString(), userId };
      }
    } catch {
      // Fallback to userId
    }
    return { userId };
  }

  /** Backward-compatible helper for recruiter-only flows */
  private async requireOrgId(userId: string): Promise<string> {
    const org = await this.orgRepository.findByOwnerUserId(userId);
    if (!org) {
      throw AppError.badRequest('Complete your organization profile before using recruiter credits');
    }
    return org._id.toString();
  }

  /**
   * Retrieves authoritative pricing configuration, checking MongoDB overrides first.
   */
  async getAuthoritativePricing(): Promise<{
    creditValueInr: number;
    featurePricing: typeof FEATURE_PRICING;
    initialPromotionalCredits: number;
    referralRewardCredits: number;
    candidatePlans?: any[];
    companyPlans?: any[];
    startupPlans?: any[];
    institutionPlans?: any[];
    subscriptionPlans?: any[];
  }> {
    try {
      const config = await mongoose.connection.db?.collection('creditpricingconfigs').findOne({ key: 'default' });
      if (config) {
        return {
          creditValueInr: config.creditValueInr || CREDIT_VALUE_INR,
          featurePricing: { ...FEATURE_PRICING, ...(config.featurePricing || {}) },
          initialPromotionalCredits: config.initialPromotionalCredits || INITIAL_PROMOTIONAL_CREDITS,
          referralRewardCredits: config.referralRewardCredits || REFERRAL_REWARD_CREDITS,
          candidatePlans: config.candidatePlans && config.candidatePlans.length ? config.candidatePlans : undefined,
          companyPlans: config.companyPlans && config.companyPlans.length ? config.companyPlans : undefined,
          startupPlans: config.startupPlans && config.startupPlans.length ? config.startupPlans : undefined,
          institutionPlans: config.institutionPlans && config.institutionPlans.length ? config.institutionPlans : undefined,
          subscriptionPlans: config.subscriptionPlans && config.subscriptionPlans.length ? config.subscriptionPlans : undefined,
        };
      }
    } catch {
      // Fallback safely to compiled constants
    }
    return {
      creditValueInr: CREDIT_VALUE_INR,
      featurePricing: FEATURE_PRICING,
      initialPromotionalCredits: INITIAL_PROMOTIONAL_CREDITS,
      referralRewardCredits: REFERRAL_REWARD_CREDITS,
    };
  }

  /**
   * Universal getOrCreateCredits:
   * Supports orgId or userId. Automatically grants initial promotional balance (20 credits = ₹200)
   * on first account access if not already granted.
   */
  async getOrCreateCredits(owner: { orgId?: string; userId?: string }): Promise<IRecruiterCreditsDocument> {
    let query: Record<string, unknown> = {};
    if (owner.orgId) {
      query = { orgId: owner.orgId };
    } else if (owner.userId) {
      query = { userId: owner.userId };
    } else {
      throw AppError.badRequest('Invalid credit owner context');
    }

    let credits = await RecruiterCreditsModel.findOne(query);

    // If querying by orgId, check if owner user already has credits under userId to prevent duplicate promotional bonus
    if (!credits && owner.orgId && owner.userId) {
      const userCredits = await RecruiterCreditsModel.findOne({ userId: owner.userId });
      if (userCredits) {
        userCredits.orgId = new mongoose.Types.ObjectId(owner.orgId);
        await userCredits.save();
        return userCredits;
      }
    }

    if (!credits && owner.orgId && !owner.userId) {
      try {
        const org = await mongoose.model('RecruiterOrganization').findById(owner.orgId).select('ownerUserId');
        if (org?.ownerUserId) {
          const userCredits = await RecruiterCreditsModel.findOne({ userId: org.ownerUserId });
          if (userCredits) {
            userCredits.orgId = new mongoose.Types.ObjectId(owner.orgId);
            await userCredits.save();
            return userCredits;
          }
        }
      } catch {}
    }

    if (!credits) {
      const referralCode = `LGI-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      try {
        credits = await RecruiterCreditsModel.create({
          orgId: owner.orgId ? new mongoose.Types.ObjectId(owner.orgId) : undefined,
          userId: owner.userId ? new mongoose.Types.ObjectId(owner.userId) : undefined,
          balance: INITIAL_PROMOTIONAL_CREDITS,
          promotionalGranted: true,
          referralCode,
        });

        // Record welcome promotional credit grant in ledger (strictly once per account)
        await CreditTransactionModel.create({
          orgId: owner.orgId ? new mongoose.Types.ObjectId(owner.orgId) : undefined,
          userId: owner.userId ? new mongoose.Types.ObjectId(owner.userId) : undefined,
          type: 'grant',
          amount: INITIAL_PROMOTIONAL_CREDITS,
          balanceBefore: 0,
          balanceAfter: INITIAL_PROMOTIONAL_CREDITS,
          feature: 'promotional_welcome',
          reason: 'Initial promotional balance (20 credits = ₹200)',
          status: 'completed',
        });
      } catch (err: any) {
        if (err.code === 11000) {
          credits = await RecruiterCreditsModel.findOne(query);
          if (credits) return credits;
        }
        throw err;
      }
    } else if (!credits.promotionalGranted && credits.balance === 0) {
      // Award promotional balance if existing user never got it (legacy accounts)
      credits.balance += INITIAL_PROMOTIONAL_CREDITS;
      credits.promotionalGranted = true;
      await credits.save();

      await CreditTransactionModel.create({
        orgId: owner.orgId ? new mongoose.Types.ObjectId(owner.orgId) : undefined,
        userId: owner.userId ? new mongoose.Types.ObjectId(owner.userId) : undefined,
        type: 'grant',
        amount: INITIAL_PROMOTIONAL_CREDITS,
        balanceBefore: 0,
        balanceAfter: credits.balance,
        feature: 'promotional_welcome',
        reason: 'Initial promotional balance (20 credits = ₹200)',
        status: 'completed',
      });
    }

    return credits;
  }

  /** Org-scoped read, for callers (like job creation) that already resolved orgId themselves. */
  async getBalanceForOrg(orgId: string): Promise<number> {
    const credits = await this.getOrCreateCredits({ orgId });
    return credits.balance;
  }

  /**
   * Recruiter dashboard credits view (maintains exact backward compatibility)
   */
  async getBalance(userId: string): Promise<{
    balance: number;
    packs: typeof CREDIT_PACKS;
    pipelineSubOptions: typeof PIPELINE_SUB_OPTIONS;
    subOptionCost: number;
    matchVolumeOptions: typeof MATCH_VOLUME_OPTIONS;
  }> {
    const owner = await this.resolveOwner(userId);
    const credits = await this.getOrCreateCredits(owner);

    return {
      balance: credits.balance,
      packs: CREDIT_PACKS,
      pipelineSubOptions: PIPELINE_SUB_OPTIONS,
      subOptionCost: SUB_OPTION_CREDIT_COST,
      matchVolumeOptions: MATCH_VOLUME_OPTIONS,
    };
  }

  /**
   * Universal wallet view for both Candidate and Recruiter:
   * Returns current balance, transactions history, active subscriptions, and authoritative pricing plans.
   */
  async getUserWallet(userId: string, role?: string): Promise<{
    balance: number;
    referralCode?: string;
    promotionalGranted: boolean;
    subscriptions: any[];
    packages: any[];
    transactions: any[];
    pricingCatalog: {
      creditValueInr: number;
      featurePricing: typeof FEATURE_PRICING;
      subscriptionPlans: typeof SUBSCRIPTION_PLANS;
      creditPacks: typeof CREDIT_TOPUP_PACKS;
      candidatePlans?: typeof CANDIDATE_PLAN_CATEGORIES;
      companyPlans?: typeof COMPANY_PLAN_CATEGORIES;
      startupPlans?: typeof STARTUP_PLAN_CATEGORIES;
      institutionPlans?: typeof INSTITUTION_PLAN_CATEGORIES;
    };
  }> {
    const owner = await this.resolveOwner(userId);
    const credits = await this.getOrCreateCredits(owner);

    // Fetch transactions
    const query: Record<string, unknown> = owner.orgId
      ? { $or: [{ orgId: owner.orgId }, { userId }] }
      : { userId };

    const transactions = await CreditTransactionModel.find(query)
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    // Fetch active subscriptions and packages
    const now = new Date();
    const subscriptions = await UserSubscriptionModel.find({
      userId,
      status: 'active',
      expiresAt: { $gt: now },
    }).lean();

    const user = await UserModel.findById(userId).select('role entityType').lean();
    const effectiveRole = role || user?.role || 'user';
    const isCandidate = effectiveRole === 'candidate' || effectiveRole === 'user';

    const org = await this.orgRepository.findByOwnerUserId(userId);
    const entity = org?.entity || user?.entityType || 'company';
    const isInstitution = (effectiveRole === 'institution') || ((effectiveRole === 'recruiter') && entity === 'institution');
    const isStartup = !isInstitution && ((effectiveRole === 'startup') || ((effectiveRole === 'recruiter') && entity === 'startup'));
    const isCompany = !isStartup && !isInstitution && (effectiveRole === 'recruiter' || effectiveRole === 'company') && (entity === 'company');

    const authPricing = await this.getAuthoritativePricing();
    const baseSubscriptionPlans = authPricing.subscriptionPlans || SUBSCRIPTION_PLANS;

    let subscriptionPlans = baseSubscriptionPlans;
    if (isCandidate) {
      subscriptionPlans = [];
    } else if (isInstitution) {
      // Institution accounts strictly only see the Institution subscription plan (Monthly ₹1000, 6 Months ₹5000, Yearly ₹10000)
      subscriptionPlans = baseSubscriptionPlans.filter((s: any) => INSTITUTION_SUBSCRIPTION_IDS.includes(s.id));
    } else if (isStartup) {
      // Startup accounts strictly see the Startup, Job Posting, and HRMS subscription plans
      subscriptionPlans = baseSubscriptionPlans.filter((s: any) => STARTUP_SUBSCRIPTION_IDS.includes(s.id));
    } else if (isCompany) {
      // Company accounts strictly only see the 3 approved company subscription categories
      subscriptionPlans = baseSubscriptionPlans.filter((s: any) => COMPANY_SUBSCRIPTION_IDS.includes(s.id));
    }

    const companyPackages = subscriptions.filter((s) => s.packageType === 'company_promotion' || s.packageType === 'promotion');
    const candidatePackages = subscriptions.filter((s) => s.packageType === 'ai_apply' || s.packageType === 'candidate_package');
    const startupPackages = subscriptions.filter((s) => s.packageType === 'startup_service' || s.packageType === 'startup');
    const institutionPackages = subscriptions.filter((s) => s.packageType === 'subscription' || s.planId === 'institution');

    return {
      balance: credits.balance,
      referralCode: credits.referralCode,
      promotionalGranted: !!credits.promotionalGranted,
      subscriptions,
      packages: isCandidate ? candidatePackages : (isInstitution ? institutionPackages : (isStartup ? startupPackages : (isCompany ? companyPackages : []))),
      transactions,
      pricingCatalog: {
        creditValueInr: authPricing.creditValueInr,
        featurePricing: authPricing.featurePricing,
        subscriptionPlans,
        creditPacks: CREDIT_TOPUP_PACKS,
        candidatePlans: isCandidate ? (authPricing.candidatePlans || CANDIDATE_PLAN_CATEGORIES) : undefined,
        companyPlans: isCompany ? (authPricing.companyPlans || COMPANY_PLAN_CATEGORIES) : undefined,
        startupPlans: isStartup ? (authPricing.startupPlans || STARTUP_PLAN_CATEGORIES) : undefined,
        institutionPlans: isInstitution ? (authPricing.institutionPlans || INSTITUTION_PLAN_CATEGORIES) : undefined,
      },
    };
  }

  /**
   * Check if user has an active subscription for a specific module or plan
   */
  async hasActiveSubscription(userId: string, planId: string): Promise<boolean> {
    const now = new Date();
    const sub = await UserSubscriptionModel.findOne({
      userId,
      planId,
      status: 'active',
      expiresAt: { $gt: now },
    });
    return !!sub;
  }

  /**
   * Shared atomic deduct primitive:
   * Concurrency-safe balance verification and decrement using atomic conditional update.
   * Throws HTTP 402 INSUFFICIENT_CREDITS with exact shortfall if balance is inadequate.
   */
  async deduct(
    owner: CreditOwnerContext | string,
    amount: number,
    reason: string,
    feature?: string,
    refId?: unknown
  ): Promise<{ balance: number }> {
    const resolvedOwner = typeof owner === 'string' ? await this.resolveOwner(owner) : owner;

    if (amount <= 0) {
      throw AppError.badRequest('Credit deduction amount must be greater than zero');
    }

    const query: Record<string, unknown> = resolvedOwner.orgId ? { orgId: resolvedOwner.orgId } : { userId: resolvedOwner.userId };

    // Atomic update preventing negative balance
    const updated = await RecruiterCreditsModel.findOneAndUpdate(
      { ...query, balance: { $gte: amount } },
      { $inc: { balance: -amount } },
      { new: true }
    );

    if (!updated) {
      // Query current balance to return accurate shortfall info
      const current = await this.getOrCreateCredits(resolvedOwner);
      const shortfall = Math.max(0, amount - current.balance);
      const featureName = feature && FEATURE_PRICING[feature] ? FEATURE_PRICING[feature].name : feature || 'This action';

      throw new AppError(
        `Insufficient credits. ${featureName} requires ${amount} credits, but your balance is ${current.balance} credits. Purchase additional credits to continue.`,
        402,
        'INSUFFICIENT_CREDITS',
        {
          requiredCredits: amount,
          availableBalance: current.balance,
          shortfall,
          feature,
        }
      );
    }

    const balanceBefore = updated.balance + amount;
    const balanceAfter = updated.balance;

    await CreditTransactionModel.create({
      orgId: resolvedOwner.orgId ? new mongoose.Types.ObjectId(resolvedOwner.orgId) : undefined,
      userId: resolvedOwner.userId ? new mongoose.Types.ObjectId(resolvedOwner.userId) : undefined,
      type: 'spend',
      amount,
      balanceBefore,
      balanceAfter,
      feature,
      reason,
      refId: refId ? new mongoose.Types.ObjectId(String(refId)) : undefined,
      status: 'completed',
    });

    return { balance: updated.balance };
  }

  /**
   * Charge user for an authoritative feature from the pricing table.
   * Verifies balance and charges atomically.
   */
  async chargeForFeature(
    userId: string,
    featureKey: string,
    customCreditsOrOptions?: number | { customCredits?: number; refId?: unknown; reasonOverride?: string; returnUrl?: string } | string,
    refId?: unknown,
    reasonOverride?: string
  ): Promise<{ balance: number; cost: number; feature: string }> {
    let customCredits: number | undefined;
    let finalRefId = refId;
    let finalReasonOverride = reasonOverride;

    if (typeof customCreditsOrOptions === 'number') {
      customCredits = customCreditsOrOptions;
    } else if (typeof customCreditsOrOptions === 'object' && customCreditsOrOptions !== null) {
      customCredits = customCreditsOrOptions.customCredits;
      finalRefId = customCreditsOrOptions.refId ?? refId;
      finalReasonOverride = customCreditsOrOptions.reasonOverride ?? reasonOverride;
    }

    const authPricing = await this.getAuthoritativePricing();
    const featureDef = authPricing.featurePricing[featureKey] || FEATURE_PRICING[featureKey];
    
    // Server enforces authoritative pricing; client cannot lower or zero out standard feature costs
    let cost = featureDef?.credits;
    if (typeof cost !== 'number' || cost <= 0) {
      if (typeof customCredits === 'number' && customCredits > 0) {
        cost = customCredits;
      } else {
        cost = 10;
      }
    } else if (typeof customCredits === 'number' && customCredits > cost) {
      // Allow higher custom credit charges (e.g. multi-unit batches), but never allow client to lower or zero out standard cost
      cost = customCredits;
    }
    const reason = finalReasonOverride || featureDef?.name || `Used ${featureKey}`;

    const owner = await this.resolveOwner(userId);
    const { balance } = await this.deduct(owner, cost, reason, featureKey, finalRefId);

    return { balance, cost, feature: featureKey };
  }

  /** Charges an org for a job's published hiring-pipeline selection. Backward compatible. */
  async chargeForJobPublish(orgId: string, jobId: string, amount: number): Promise<{ balance: number }> {
    if (amount <= 0) {
      const credits = await this.getOrCreateCredits({ orgId });
      return { balance: credits.balance };
    }
    return this.deduct({ orgId, userId: '' }, amount, 'Job hiring pipeline published', 'standard_job_posting', jobId);
  }

  /**
   * Charge a startup account for one of the 6 authoritative startup features with strict role verification.
   */
  async chargeStartupFeature(
    userId: string,
    featureKey:
      | 'startup_business_plus'
      | 'startup_documentations'
      | 'startup_funding_support'
      | 'startup_networking'
      | 'startup_incubations'
      | 'startup_accelerators',
    refId?: unknown,
    reasonOverride?: string
  ): Promise<{ balance: number; cost: number; feature: string }> {
    const user = await UserModel.findById(userId).select('role entityType').lean();
    const effectiveRole = user?.role || 'user';
    const org = await this.orgRepository.findByOwnerUserId(userId);
    const entity = org?.entity || user?.entityType || 'company';
    const isStartup = (effectiveRole === 'startup') || ((effectiveRole === 'recruiter') && entity === 'startup');

    if (!isStartup && effectiveRole !== 'admin' && effectiveRole !== 'superadmin') {
      throw AppError.forbidden('Only verified Startup accounts can access startup-specific services');
    }

    return this.chargeForFeature(userId, featureKey, undefined, refId, reasonOverride);
  }

  /**
   * Charge an institution account for an authoritative institution service.
   * Supports batch multiplier for per-student applications (2 cr/student) and Genius test (5 cr/student).
   */
  async chargeInstitutionFeature(
    userId: string,
    featureKey:
      | 'inst_placement_mass_application'
      | 'inst_campus_drive'
      | 'inst_job_fair_campus'
      | 'inst_job_fair_online'
      | 'inst_career_enhancement'
      | 'inst_skills_enhancement_batch'
      | 'inst_genius_test_campus',
    options?: { count?: number; quantity?: number; customCredits?: number; refId?: unknown; reasonOverride?: string; details?: any }
  ): Promise<{ balance: number; cost: number; feature: string }> {
    const user = await UserModel.findById(userId).select('role entityType').lean();
    const effectiveRole = user?.role || 'user';
    const org = await this.orgRepository.findByOwnerUserId(userId);
    const entity = org?.entity || user?.entityType || 'company';
    const isInstitution = (effectiveRole === 'institution') || ((effectiveRole === 'recruiter') && entity === 'institution');

    if (!isInstitution && effectiveRole !== 'admin' && effectiveRole !== 'superadmin') {
      throw AppError.forbidden('Only verified Institution accounts can access institution-specific services');
    }

    const featureDef = FEATURE_PRICING[featureKey];
    if (!featureDef) {
      throw AppError.badRequest(`Invalid institution feature specified: ${featureKey}`);
    }

    const units = options?.quantity ?? options?.count;
    let cost = featureDef.credits;
    if (units !== undefined && units > 0) {
      if (featureKey === 'inst_placement_mass_application') {
        cost = Math.round(units * 2);
      } else if (featureKey === 'inst_genius_test_campus') {
        cost = Math.round(units * 5);
      } else {
        cost = Math.round(units * featureDef.credits);
      }
    } else if (typeof options?.customCredits === 'number' && options.customCredits > 0) {
      cost = Math.round(options.customCredits);
    }

    const reason = options?.reasonOverride || `${featureDef.name}${units && units > 1 ? ` (${units} units)` : ''}`;
    const owner = await this.resolveOwner(userId);
    const { balance } = await this.deduct(owner, cost, reason, featureKey, options?.refId);

    return { balance, cost, feature: featureKey };
  }

  /**
   * Create Payment Order on backend with server-authoritative amount.
   */
  async createPaymentOrder(
    userId: string,
    params: {
      purchaseType: 'credits' | 'subscription' | 'package';
      itemKey: string;
      billingCycle?: SubscriptionDuration | string;
      customCredits?: number;
    },
    role?: string
  ): Promise<{
    orderId: string;
    amountInr: number;
    currency: string;
    credits: number;
    itemName: string;
    purchaseType: string;
    keyId?: string;
  }> {
    const user = await UserModel.findById(userId).select('role entityType').lean();
    const effectiveRole = role || user?.role || 'user';
    const org = await this.orgRepository.findByOwnerUserId(userId);
    const entity = org?.entity || user?.entityType || 'company';
    const isInstitution = (effectiveRole === 'institution') || ((effectiveRole === 'recruiter') && entity === 'institution');
    const isStartup = !isInstitution && ((effectiveRole === 'startup') || ((effectiveRole === 'recruiter') && entity === 'startup'));
    const isCompany = !isStartup && !isInstitution && (effectiveRole === 'recruiter' || effectiveRole === 'company') && (entity === 'company');

    if (params.purchaseType === 'package' && (effectiveRole === 'recruiter' || effectiveRole === 'company' || effectiveRole === 'startup' || effectiveRole === 'institution')) {
      throw AppError.forbidden('Candidate packages are only available to candidate accounts');
    }
    if (params.purchaseType === 'subscription') {
      if (effectiveRole === 'candidate' || effectiveRole === 'user') {
        throw AppError.forbidden('Enterprise subscriptions are only available to business accounts');
      }
      if (isInstitution && !INSTITUTION_SUBSCRIPTION_IDS.includes(params.itemKey)) {
        throw AppError.badRequest('Invalid subscription plan for institution account. Only Institution subscription plan is supported.');
      }
      if (isStartup && !STARTUP_SUBSCRIPTION_IDS.includes(params.itemKey)) {
        throw AppError.badRequest('Invalid subscription plan for startup account. Only Startup subscription plans are supported.');
      }
      if (isCompany && !COMPANY_SUBSCRIPTION_IDS.includes(params.itemKey)) {
        throw AppError.badRequest('Invalid subscription plan for company account. Only Job Posting, HRMS, and Recruitment Suite are supported.');
      }
    }

    const owner = await this.resolveOwner(userId);
    let amountInr = 0;
    let credits = 0;
    let itemName = '';

    if (params.purchaseType === 'credits') {
      const pack = CREDIT_TOPUP_PACKS.find((p) => p.id === params.itemKey);
      if (pack) {
        credits = pack.credits;
        amountInr = pack.priceInr;
        itemName = `${pack.name} (${pack.credits} Credits)`;
      } else if (params.itemKey === 'custom') {
        if (!params.customCredits || params.customCredits < 1 || params.customCredits > 10000 || !Number.isInteger(params.customCredits)) {
          throw AppError.badRequest('Custom top-up must be an integer between 1 and 10,000 credits');
        }
        credits = Math.round(params.customCredits);
        amountInr = credits * CREDIT_VALUE_INR;
        itemName = `Custom Top-up (${credits} Credits)`;
      } else {
        // Fallback to legacy pack IDs like 'starter', 'growth', 'scale'
        const legacyPack = CREDIT_PACKS.find((p) => p.id === params.itemKey);
        if (legacyPack) {
          credits = legacyPack.credits;
          amountInr = legacyPack.price;
          itemName = `${legacyPack.id.toUpperCase()} Pack (${legacyPack.credits} Credits)`;
        } else {
          throw AppError.badRequest('Invalid credit package specified');
        }
      }
    } else if (params.purchaseType === 'subscription') {
      const authPricing = await this.getAuthoritativePricing();
      const allSubscriptions = authPricing.subscriptionPlans || SUBSCRIPTION_PLANS;
      const plan = allSubscriptions.find((p: any) => p.id === params.itemKey);
      if (!plan) {
        throw AppError.badRequest('Invalid subscription plan specified');
      }
      const cycleKey = (params.billingCycle || 'monthly') as SubscriptionDurationKey;
      const durationConfig = plan.durations[cycleKey];
      if (!durationConfig) {
        throw AppError.badRequest('Invalid billing cycle for subscription plan');
      }

      credits = durationConfig.credits;
      amountInr = durationConfig.priceInr;
      itemName = `${plan.name} (${cycleKey.replace('_', ' ')})`;
    } else if (params.purchaseType === 'package') {
      const authPricing = await this.getAuthoritativePricing();
      const pkg = authPricing.featurePricing[params.itemKey] || FEATURE_PRICING[params.itemKey];
      if (!pkg) {
        throw AppError.badRequest('Invalid package specified');
      }
      credits = pkg.credits;
      amountInr = pkg.priceInr;
      itemName = pkg.name;
    } else {
      throw AppError.badRequest('Invalid purchase type');
    }

    const orderId = `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const idempotencyKey = crypto.randomUUID();

    await PaymentOrderModel.create({
      orderId,
      userId: new mongoose.Types.ObjectId(userId),
      orgId: owner.orgId ? new mongoose.Types.ObjectId(owner.orgId) : undefined,
      purchaseType: params.purchaseType,
      itemKey: params.itemKey,
      itemName,
      credits,
      amountInr,
      currency: 'INR',
      billingCycle: params.billingCycle,
      status: 'created',
      provider: 'razorpay',
      idempotencyKey,
    });

    const keyId = process.env.RAZORPAY_KEY_ID || undefined;

    return {
      orderId,
      amountInr,
      currency: 'INR',
      credits,
      itemName,
      purchaseType: params.purchaseType,
      keyId,
    };
  }

  /**
   * Verify Payment result on backend:
   * Validates order, verifies provider signature (if key configured), credits wallet or activates subscription.
   * Guaranteed idempotent — will not credit twice on repeated callbacks or refreshes.
   */
  async verifyPayment(
    userId: string,
    params: {
      orderId: string;
      paymentId: string;
      signature?: string;
    }
  ): Promise<{
    success: boolean;
    message: string;
    balance: number;
    creditsAdded: number;
    orderId: string;
    subscription?: any;
  }> {
    if (!params.orderId || !params.paymentId) {
      throw AppError.badRequest('Payment verification requires both orderId and paymentId');
    }

    // Reject simulated or unverified payment identifiers that bypass the payment gateway
    if (params.paymentId.startsWith('sim_') || params.paymentId.startsWith('mock_')) {
      throw AppError.badRequest('Unverified simulated payment is not permitted');
    }

    const order = await PaymentOrderModel.findOne({ orderId: params.orderId, userId });
    if (!order) {
      throw AppError.notFound('Payment order not found or does not belong to the user');
    }

    const owner = await this.resolveOwner(userId);
    const creditsDoc = await this.getOrCreateCredits(owner);

    // If already paid, return current state idempotently
    if (order.status === 'paid') {
      return {
        success: true,
        message: 'Payment already verified and credited',
        balance: creditsDoc.balance,
        creditsAdded: order.credits,
        orderId: order.orderId,
      };
    }

    if (order.status === 'failed' || order.status === 'cancelled') {
      throw AppError.badRequest(`Cannot verify payment for an order with status "${order.status}"`);
    }

    // When online payments functionality is inactive or unverified:
    const paymentsActive = process.env.PAYMENTS_ENABLED === 'true';
    if (!paymentsActive && process.env.NODE_ENV !== 'test' && process.env.ENABLE_TEST_PAYMENTS !== 'true') {
      order.status = 'failed';
      await order.save();
      throw AppError.badRequest(
        'Credit purchasing and wallet top-ups are currently inactive until payment processing is officially enabled. Credits have not been granted.'
      );
    }

    // Verify cryptographic signature if Razorpay Secret is configured
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
    if (razorpaySecret) {
      if (!params.signature) {
        order.status = 'failed';
        await order.save();
        throw AppError.badRequest('Payment verification failed: cryptographic signature is required');
      }

      const generatedSignature = crypto
        .createHmac('sha256', razorpaySecret)
        .update(`${order.providerOrderId || order.orderId}|${params.paymentId}`)
        .digest('hex');

      if (generatedSignature !== params.signature) {
        order.status = 'failed';
        await order.save();
        throw AppError.badRequest('Invalid payment signature verification failed');
      }
    }

    // Update order status
    order.status = 'paid';
    order.providerPaymentId = params.paymentId;
    order.providerSignature = params.signature;
    await order.save();

    let newBalance = creditsDoc.balance;

    if (order.purchaseType === 'credits') {
      // Add credits to wallet balance atomically
      const query: Record<string, unknown> = owner.orgId ? { orgId: owner.orgId } : { userId: owner.userId };
      const updatedCredits = await RecruiterCreditsModel.findOneAndUpdate(
        query,
        { $inc: { balance: order.credits } },
        { new: true }
      );
      newBalance = updatedCredits?.balance || creditsDoc.balance + order.credits;

      // Record transaction
      await CreditTransactionModel.create({
        orgId: owner.orgId ? new mongoose.Types.ObjectId(owner.orgId) : undefined,
        userId: new mongoose.Types.ObjectId(userId),
        type: 'purchase',
        amount: order.credits,
        balanceBefore: creditsDoc.balance,
        balanceAfter: newBalance,
        feature: 'credit_purchase',
        reason: `Purchased ${order.credits} credits (${order.itemName})`,
        orderId: order.orderId,
        paymentId: params.paymentId,
        status: 'completed',
      });

      return {
        success: true,
        message: `Successfully credited ${order.credits} credits to your account`,
        balance: newBalance,
        creditsAdded: order.credits,
        orderId: order.orderId,
      };
    } else if (order.purchaseType === 'subscription') {
      // Activate subscription duration
      const plan = SUBSCRIPTION_PLANS.find((p) => p.id === order.itemKey);
      const cycleKey = (order.billingCycle || 'monthly') as SubscriptionDurationKey;
      const durationConfig = plan?.durations[cycleKey];
      const durationDays = durationConfig?.days || 30;

      const startDate = new Date();
      const expiresAt = new Date(startDate.getTime() + durationDays * 24 * 3600 * 1000);

      const subscription = await UserSubscriptionModel.create({
        userId: new mongoose.Types.ObjectId(userId),
        orgId: owner.orgId ? new mongoose.Types.ObjectId(owner.orgId) : undefined,
        planId: order.itemKey,
        planName: order.itemName,
        billingCycle: order.billingCycle || 'monthly',
        creditsIncluded: order.credits,
        priceInr: order.amountInr,
        startDate,
        expiresAt,
        status: 'active',
        orderId: order.orderId,
        paymentId: params.paymentId,
      });

      // Credit the included subscription credits to user's wallet
      if (order.credits > 0) {
        const query: Record<string, unknown> = owner.orgId ? { orgId: owner.orgId } : { userId: owner.userId };
        const updatedCredits = await RecruiterCreditsModel.findOneAndUpdate(
          query,
          { $inc: { balance: order.credits } },
          { new: true }
        );
        newBalance = updatedCredits?.balance || creditsDoc.balance + order.credits;

        await CreditTransactionModel.create({
          orgId: owner.orgId ? new mongoose.Types.ObjectId(owner.orgId) : undefined,
          userId: new mongoose.Types.ObjectId(userId),
          type: 'purchase',
          amount: order.credits,
          balanceBefore: creditsDoc.balance,
          balanceAfter: newBalance,
          feature: `subscription_${order.itemKey}`,
          reason: `Subscription activated: ${order.itemName} (+${order.credits} credits)`,
          orderId: order.orderId,
          paymentId: params.paymentId,
          status: 'completed',
        });
      }

      return {
        success: true,
        message: `Successfully activated ${order.itemName}`,
        balance: newBalance,
        creditsAdded: order.credits,
        orderId: order.orderId,
        subscription,
      };
    } else if (order.purchaseType === 'package') {
      let quota = 10;
      let durationDays = 1;
      if (order.itemKey === 'ai_apply_10jobs_1day') {
        quota = 10;
        durationDays = 1;
      } else if (order.itemKey === 'ai_apply_20jobs_7days') {
        quota = 20;
        durationDays = 7;
      } else if (order.itemKey === 'ai_apply_50jobs_10days') {
        quota = 50;
        durationDays = 10;
      }

      const startDate = new Date();
      const expiresAt = new Date(startDate.getTime() + durationDays * 24 * 3600 * 1000);

      const subscription = await UserSubscriptionModel.create({
        userId: new mongoose.Types.ObjectId(userId),
        planId: order.itemKey,
        planName: order.itemName,
        billingCycle: `${durationDays}_days`,
        creditsIncluded: order.credits,
        priceInr: order.amountInr,
        quotaTotal: quota,
        quotaUsed: 0,
        quotaRemaining: quota,
        packageType: 'ai_apply',
        startDate,
        expiresAt,
        status: 'active',
        orderId: order.orderId,
        paymentId: params.paymentId,
      });

      return {
        success: true,
        message: `Successfully activated ${order.itemName} (${quota} jobs valid for ${durationDays} days)`,
        balance: newBalance,
        creditsAdded: 0,
        orderId: order.orderId,
        subscription,
      };
    }

    return {
      success: true,
      message: 'Payment processed',
      balance: newBalance,
      creditsAdded: order.credits,
      orderId: order.orderId,
    };
  }

  /**
   * Activate candidate package using wallet credits:
   * e.g., AI Apply 10 jobs/1 day (20 credits), 20 jobs/7 days (40 credits), 50 jobs/10 days (50 credits).
   * Enforces limits, duration, and credit deduction.
   */
  async activateCandidatePackage(
    userId: string,
    packageKey: string,
    role?: string
  ): Promise<{
    success: boolean;
    message: string;
    subscription: any;
    balance: number;
  }> {
    if (role === 'recruiter') {
      throw AppError.forbidden('Candidate packages are only available to candidate accounts');
    }
    const pkg = FEATURE_PRICING[packageKey];
    if (!pkg) {
      throw AppError.badRequest(`Invalid candidate package: ${packageKey}`);
    }

    let quota = 10;
    let durationDays = 1;

    if (packageKey === 'ai_apply_10jobs_1day') {
      quota = 10;
      durationDays = 1;
    } else if (packageKey === 'ai_apply_20jobs_7days') {
      quota = 20;
      durationDays = 7;
    } else if (packageKey === 'ai_apply_50jobs_10days') {
      quota = 50;
      durationDays = 10;
    } else {
      throw AppError.badRequest(`Package ${packageKey} is not an activatable candidate package`);
    }

    // Deduct credits atomically
    const { balance } = await this.deduct(userId, pkg.credits, `Activated ${pkg.name}`, packageKey);

    const startDate = new Date();
    const expiresAt = new Date(startDate.getTime() + durationDays * 24 * 3600 * 1000);

    const subscription = await UserSubscriptionModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      planId: packageKey,
      planName: pkg.name,
      billingCycle: `${durationDays}_days`,
      creditsIncluded: pkg.credits,
      priceInr: pkg.priceInr,
      quotaTotal: quota,
      quotaUsed: 0,
      quotaRemaining: quota,
      packageType: 'ai_apply',
      startDate,
      expiresAt,
      status: 'active',
    });

    return {
      success: true,
      message: `Successfully activated ${pkg.name} (${quota} jobs valid for ${durationDays} days)`,
      subscription,
      balance,
    };
  }

  /**
   * Activate company promotion using wallet credits:
   * e.g., List on landing pages (50 cr), Featured Jobs (30 cr), Recently Posted (10 cr),
   * Stay on first page (50 cr / 7 days), Stay in front row (75 cr / 7 days),
   * Promote on Social Media (30 cr), Promote on Job Fair (100 cr).
   * Note: Advertisement is case-by-case (to be agreed) and cannot be activated via fixed credits.
   */
  async activateCompanyPromotion(
    userId: string,
    promoKey: string,
    role?: string,
    jobId?: string,
    notes?: string
  ): Promise<{
    success: boolean;
    message: string;
    subscription: any;
    balance: number;
  }> {
    const user = await UserModel.findById(userId).select('role entityType').lean();
    const effectiveRole = role || user?.role || 'user';
    if (effectiveRole === 'candidate' || effectiveRole === 'user') {
      throw AppError.forbidden('Company promotions are only available to company recruiter accounts');
    }

    const pkg = FEATURE_PRICING[promoKey];
    if (!pkg) {
      throw AppError.badRequest(`Invalid company promotion item: ${promoKey}`);
    }

    if (promoKey === 'promo_advertisement' || pkg.caseByCase || pkg.credits <= 0) {
      throw AppError.badRequest(
        'Advertisement campaigns are priced on a case-by-case agreed quote basis. Please contact support or your account manager for a custom placement proposal.'
      );
    }

    // Determine duration and cycle (strictly 7 days for first page and front row placements)
    let durationDays = 30;
    let billingCycle = 'campaign';
    if (promoKey === 'promo_first_page_7d' || promoKey === 'promo_front_row_7d') {
      durationDays = 7;
      billingCycle = '7_days';
    }

    const owner = await this.resolveOwner(userId);
    const reason = `Activated promotion: ${pkg.name}${jobId ? ` (Job: ${jobId})` : ''}${notes ? ` - ${notes}` : ''}`;
    const { balance } = await this.deduct(owner, pkg.credits, reason, promoKey, jobId);

    const startDate = new Date();
    const expiresAt = new Date(startDate.getTime() + durationDays * 24 * 3600 * 1000);

    const subscription = await UserSubscriptionModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      orgId: owner.orgId ? new mongoose.Types.ObjectId(owner.orgId) : undefined,
      planId: promoKey,
      planName: pkg.name,
      billingCycle,
      creditsIncluded: pkg.credits,
      priceInr: pkg.priceInr,
      packageType: 'company_promotion',
      startDate,
      expiresAt,
      status: 'active',
    });

    return {
      success: true,
      message: `Successfully activated ${pkg.name} (${durationDays === 7 ? '7-day placement' : 'campaign placement'})`,
      subscription,
      balance,
    };
  }

  /**
   * Claim referral reward:
   * Grants 10 credits to claimant and 10 credits to referrer if valid and eligible.
   */
  async claimReferral(userId: string, code: string): Promise<{ success: boolean; message: string; balance: number; reward?: number }> {
    const cleanCode = code.trim().toUpperCase();
    const referrerCredits = await RecruiterCreditsModel.findOne({ referralCode: cleanCode });
    if (!referrerCredits) {
      throw AppError.badRequest('Invalid referral code');
    }

    const claimantOwner = await this.resolveOwner(userId);
    const claimantCredits = await this.getOrCreateCredits(claimantOwner);

    if (claimantCredits.referredBy) {
      throw AppError.badRequest('You have already redeemed a referral reward');
    }

    if (String(referrerCredits._id) === String(claimantCredits._id)) {
      throw AppError.badRequest('You cannot use your own referral code');
    }

    // Award claimant 10 credits
    claimantCredits.balance += REFERRAL_REWARD_CREDITS;
    claimantCredits.referredBy = referrerCredits.userId || (referrerCredits.orgId as any);
    await claimantCredits.save();

    await CreditTransactionModel.create({
      orgId: claimantOwner.orgId ? new mongoose.Types.ObjectId(claimantOwner.orgId) : undefined,
      userId: new mongoose.Types.ObjectId(userId),
      type: 'referral',
      amount: REFERRAL_REWARD_CREDITS,
      balanceBefore: claimantCredits.balance - REFERRAL_REWARD_CREDITS,
      balanceAfter: claimantCredits.balance,
      feature: 'referral_bonus',
      reason: `Claimed referral reward from code ${cleanCode}`,
      status: 'completed',
    });

    // Award referrer 10 credits
    referrerCredits.balance += REFERRAL_REWARD_CREDITS;
    await referrerCredits.save();

    await CreditTransactionModel.create({
      orgId: referrerCredits.orgId,
      userId: referrerCredits.userId,
      type: 'referral',
      amount: REFERRAL_REWARD_CREDITS,
      balanceBefore: referrerCredits.balance - REFERRAL_REWARD_CREDITS,
      balanceAfter: referrerCredits.balance,
      feature: 'referral_reward',
      reason: `Referral reward for inviting user`,
      status: 'completed',
    });

    return {
      success: true,
      message: `Referral applied! ${REFERRAL_REWARD_CREDITS} credits added to your wallet.`,
      balance: claimantCredits.balance,
      reward: REFERRAL_REWARD_CREDITS,
    };
  }

  /** Direct credit purchases and wallet top-ups are inactive until payment functionality is officially enabled. */
  async purchase(_userId: string, _packId: string): Promise<{ balance: number }> {
    throw AppError.badRequest(
      'Credit purchasing and wallet top-ups are currently inactive until payment processing is officially enabled.'
    );
  }

  /** Authorized Admin manual credit adjustment (add or deduct credits with immutable ledger audit trail) */
  async adjustCredits(
    identifier: string,
    amount: number,
    reason: string = 'Admin Adjustment'
  ): Promise<{ balance: number; previousBalance: number }> {
    const owner = await this.resolveOwner(identifier);
    const creditsDoc = await this.getOrCreateCredits(owner);

    const previousBalance = creditsDoc.balance;
    const newBalance = previousBalance + amount;
    if (newBalance < 0) {
      throw AppError.badRequest('Credit adjustment would result in a negative balance');
    }

    creditsDoc.balance = newBalance;
    await creditsDoc.save();

    await CreditTransactionModel.create({
      orgId: owner.orgId ? new mongoose.Types.ObjectId(owner.orgId) : undefined,
      userId: owner.userId ? new mongoose.Types.ObjectId(owner.userId) : undefined,
      type: amount >= 0 ? 'grant' : 'spend',
      amount: Math.abs(amount),
      balanceBefore: previousBalance,
      balanceAfter: newBalance,
      feature: 'admin_adjustment',
      reason,
      status: 'completed',
    });

    return { balance: newBalance, previousBalance };
  }

  async revealContact(
    userId: string,
    candidateUserId: string
  ): Promise<{ email?: string; phone?: string; balance: number }> {
    const owner = await this.resolveOwner(userId);

    const candidate = await UserModel.findById(candidateUserId);
    if (!candidate) {
      throw AppError.notFound('Candidate not found');
    }

    const orgId = owner.orgId ? new mongoose.Types.ObjectId(owner.orgId) : undefined;
    const existingReveal = await CandidateContactRevealModel.findOne({
      ...(orgId ? { orgId } : { candidateUserId: candidate._id }),
    });

    if (existingReveal) {
      const credits = await this.getOrCreateCredits(owner);
      return { email: candidate.email, phone: candidate.phone, balance: credits.balance };
    }

    const { balance } = await this.deduct(owner, CONTACT_REVEAL_COST, 'Revealed candidate contact', 'contact_reveal', candidate._id);
    if (orgId) {
      await CandidateContactRevealModel.create({ orgId, candidateUserId });
    }

    return { email: candidate.email, phone: candidate.phone, balance };
  }

  async searchCandidates(
    userId: string,
    params: { jobId?: string; query?: string; limit?: number }
  ): Promise<any[]> {
    const owner = await this.resolveOwner(userId);
    const orgId = owner.orgId;
    const limit = Math.min(50, params.limit || 20);

    let queryEmbedding: number[] | undefined;
    if (params.jobId) {
      if (!mongoose.Types.ObjectId.isValid(params.jobId)) {
        throw AppError.badRequest('Invalid jobId format');
      }
      const job = await JobModel.findById(params.jobId);
      if (!job) {
        throw AppError.notFound('Job not found');
      }

      if (job.embedding && job.embedding.length > 0) {
        queryEmbedding = job.embedding;
      } else {
        try {
          const normalizedText = embeddingService.buildJobEmbeddingText(job);
          const result = await embeddingService.generateEmbedding(normalizedText);
          queryEmbedding = result.embedding;
          job.embedding = result.embedding;
          job.embeddingModel = result.model;
          job.embeddingVersion = result.version;
          job.embeddingStatus = 'completed';
          await job.save().catch((e) => console.warn('[searchCandidates] Failed saving computed embedding to job:', e));
        } catch (err: any) {
          console.warn('[searchCandidates] Failed generating job embedding on the fly:', err?.message || err);
        }
      }
    } else if (params.query && params.query.trim().length > 0) {
      try {
        const result = await embeddingService.generateEmbedding(params.query.trim());
        queryEmbedding = result.embedding;
      } catch (err: any) {
        console.warn('[searchCandidates] Failed generating query embedding:', err?.message || err);
      }
    } else {
      throw AppError.badRequest('A jobId or query string is required to search candidates');
    }

    if (!queryEmbedding || queryEmbedding.length === 0) {
      throw AppError.internal('Unable to generate search vector for candidate matching');
    }

    let profiles = await CandidateProfileModel.find({ embeddingStatus: 'completed' })
      .populate({ path: 'userId', select: 'fullName username email phone avatarUrl avatar role' })
      .lean();

    if (profiles.length === 0) {
      profiles = await CandidateProfileModel.find({})
        .populate({ path: 'userId', select: 'fullName username email phone avatarUrl avatar role' })
        .lean();
    }

    const seenUserIds = new Set<string>();
    const validCandidateProfiles = profiles.filter((p: any) => {
      if (!p.userId || !p.userId._id) return false;
      if (p.userId.role === 'recruiter' || p.userId.role === 'admin') return false;
      const uId = String(p.userId._id);
      if (seenUserIds.has(uId)) return false;
      seenUserIds.add(uId);
      return true;
    });

    const revealedSet = new Set(
      orgId
        ? (await CandidateContactRevealModel.find({ orgId }).select('candidateUserId').lean()).map((r) =>
            String(r.candidateUserId)
          )
        : []
    );

    const userIds = validCandidateProfiles.map((p: any) => p.userId._id);

    const [resumes, userProfiles] = await Promise.all([
      ResumeModel.find({ userId: { $in: userIds } }).sort({ updatedAt: -1 }).lean(),
      UserProfileModel.find({ userId: { $in: userIds } }).lean(),
    ]);

    const resumesByUserId = new Map<string, any[]>();
    for (const r of resumes) {
      const uId = String(r.userId);
      if (!resumesByUserId.has(uId)) {
        resumesByUserId.set(uId, []);
      }
      resumesByUserId.get(uId)!.push(r);
    }

    const userProfilesByUserId = new Map<string, any>();
    for (const up of userProfiles) {
      userProfilesByUserId.set(String(up.userId), up);
    }

    const ranked = validCandidateProfiles
      .map((profile: any) => {
        let score = 0.5;
        if (profile.embedding && profile.embedding.length > 0 && queryEmbedding && queryEmbedding.length > 0) {
          score = embeddingService.cosineSimilarity(queryEmbedding, profile.embedding);
        } else if (profile.skills && profile.skills.length > 0) {
          score = 0.65;
        }

        const candidateUserId = String(profile.userId._id);
        const isRevealed = revealedSet.has(candidateUserId);
        const candidateResumes = resumesByUserId.get(candidateUserId) || [];
        const latestResume = candidateResumes.find((r) => r.isActive) || candidateResumes[0] || null;
        const userProfile = userProfilesByUserId.get(candidateUserId) || null;

        const resumeContent = (latestResume?.content as any) || {};
        const personalInfo = resumeContent.personalInfo || {};

        const name = profile.userId?.fullName || userProfile?.contact?.fullName || profile.userId?.username || 'Candidate';
        const avatarUrl =
          profile.userId?.avatarUrl ||
          profile.userId?.avatar ||
          personalInfo?.avatarUrl ||
          userProfile?.personal?.avatarUrl ||
          '';
        const headline =
          profile.headline ||
          personalInfo?.headline ||
          userProfile?.personal?.headline ||
          'Professional Profile';
        const location =
          profile.location ||
          personalInfo?.location ||
          (userProfile?.contact?.city ? `${userProfile.contact.city}${userProfile.contact.country ? `, ${userProfile.contact.country}` : ''}` : '') ||
          'Remote';
        const summary = resumeContent.summary || userProfile?.personal?.bio || profile.summary || '';

        let experiences = resumeContent.experiences || [];
        if ((!experiences || experiences.length === 0) && userProfile?.experiencesList && userProfile.experiencesList.length > 0) {
          experiences = userProfile.experiencesList.map((exp: any, idx: number) => ({
            id: exp.id || `exp-${idx}`,
            company: exp.company,
            position: exp.title,
            location: '',
            startDate: exp.start,
            endDate: exp.end,
            isCurrent: !exp.end || exp.end.toLowerCase() === 'present',
            highlights: exp.highlights ? (Array.isArray(exp.highlights) ? exp.highlights : [exp.highlights]) : [],
          }));
        }

        let educations = resumeContent.educations || [];
        if ((!educations || educations.length === 0) && userProfile?.educationsList && userProfile.educationsList.length > 0) {
          educations = userProfile.educationsList.map((edu: any, idx: number) => ({
            id: edu.id || `edu-${idx}`,
            institution: edu.institution,
            degree: edu.degree,
            fieldOfStudy: '',
            startDate: edu.startYear,
            endDate: edu.endYear,
          }));
        }

        const rawSkills =
          profile.skills && profile.skills.length > 0
            ? profile.skills
            : Array.isArray(resumeContent.skills)
              ? resumeContent.skills.map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean)
              : userProfile?.skills || [];
        const skills = Array.from(new Set(rawSkills.filter(Boolean)));

        const projects = resumeContent.projects || [];
        const certificates = resumeContent.certificates || [];
        const languages = resumeContent.languages || [];
        const socialLinks = resumeContent.socialLinks || [];

        const compositeResume = latestResume
          ? {
              ...latestResume,
              content: {
                ...resumeContent,
                personalInfo: {
                  ...personalInfo,
                  fullName: name,
                  headline,
                  location,
                  avatarUrl,
                  email: isRevealed ? profile.userId?.email : undefined,
                  phone: isRevealed ? profile.userId?.phone : undefined,
                },
                summary: summary || resumeContent.summary,
                skills: skills.length > 0 ? skills : resumeContent.skills,
                experiences: experiences.length > 0 ? experiences : resumeContent.experiences,
                educations: educations.length > 0 ? educations : resumeContent.educations,
                projects,
                certificates,
                languages,
                socialLinks,
              },
            }
          : {
              _id: `res-${candidateUserId}`,
              title: `${name}'s Resume`,
              templateId: 'modern-sleek',
              atsScore: 85,
              content: {
                personalInfo: {
                  fullName: name,
                  headline,
                  location,
                  avatarUrl,
                  email: isRevealed ? profile.userId?.email : undefined,
                  phone: isRevealed ? profile.userId?.phone : undefined,
                },
                summary,
                skills,
                experiences,
                educations,
                projects,
                certificates,
                languages,
                socialLinks,
              },
              settings: {
                primaryColor: '#1e293b',
                fontFamily: 'Inter, system-ui, sans-serif',
              },
            };

        return {
          candidateUserId,
          name,
          avatarUrl,
          headline,
          location,
          skills,
          summary,
          experiences,
          educations,
          projects,
          certificates,
          languages,
          socialLinks,
          yearsOfExperience: profile.yearsOfExperience || (experiences.length > 0 ? experiences.length * 2 : 0),
          matchScore: Math.max(10, Math.min(99, Math.round(score * 100))),
          email: isRevealed ? profile.userId?.email : maskEmail(profile.userId?.email),
          phone: isRevealed ? profile.userId?.phone : maskPhone(profile.userId?.phone),
          contactRevealed: isRevealed,
          resume: compositeResume,
          candidate: {
            _id: candidateUserId,
            fullName: name,
            username: profile.userId?.username,
            email: isRevealed ? profile.userId?.email : maskEmail(profile.userId?.email),
            phone: isRevealed ? profile.userId?.phone : maskPhone(profile.userId?.phone),
            avatarUrl,
          },
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);

    return ranked;
  }
}

export const recruiterCreditsService = new RecruiterCreditsService();
