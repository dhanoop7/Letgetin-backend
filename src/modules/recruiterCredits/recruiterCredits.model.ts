import { Schema, model, Document, Types } from 'mongoose';

export interface IRecruiterCreditsDocument extends Document {
  orgId?: Types.ObjectId;
  userId?: Types.ObjectId;
  balance: number;
  promotionalGranted?: boolean;
  referralCode?: string;
  referredBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RecruiterCreditsSchema = new Schema<IRecruiterCreditsDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', sparse: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', sparse: true },
    balance: { type: Number, default: 20, min: 0 },
    promotionalGranted: { type: Boolean, default: false },
    referralCode: { type: String, sparse: true, unique: true, index: true },
    referredBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

RecruiterCreditsSchema.index({ orgId: 1 }, { unique: true, sparse: true });
RecruiterCreditsSchema.index({ userId: 1 }, { unique: true, sparse: true });

export const RecruiterCreditsModel = model<IRecruiterCreditsDocument>('RecruiterCredits', RecruiterCreditsSchema);

export type CreditTransactionType = 'purchase' | 'spend' | 'grant' | 'referral' | 'refund';
export type CreditTransactionStatus = 'completed' | 'pending' | 'failed' | 'refunded';

export interface ICreditTransactionDocument extends Document {
  orgId?: Types.ObjectId;
  userId?: Types.ObjectId;
  type: CreditTransactionType;
  amount: number;
  balanceBefore?: number;
  balanceAfter?: number;
  feature?: string;
  reason: string;
  refId?: Types.ObjectId;
  orderId?: string;
  paymentId?: string;
  status: CreditTransactionStatus;
  idempotencyKey?: string;
  createdAt: Date;
}

const CreditTransactionSchema = new Schema<ICreditTransactionDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    type: { type: String, enum: ['purchase', 'spend', 'grant', 'referral', 'refund'], required: true },
    amount: { type: Number, required: true },
    balanceBefore: { type: Number },
    balanceAfter: { type: Number },
    feature: { type: String },
    reason: { type: String, required: true },
    refId: { type: Schema.Types.ObjectId },
    orderId: { type: String, index: true },
    paymentId: { type: String },
    status: { type: String, enum: ['completed', 'pending', 'failed', 'refunded'], default: 'completed', index: true },
    idempotencyKey: { type: String, sparse: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const CreditTransactionModel = model<ICreditTransactionDocument>('CreditTransaction', CreditTransactionSchema);

export interface ICandidateContactRevealDocument extends Document {
  orgId: Types.ObjectId;
  candidateUserId: Types.ObjectId;
  revealedAt: Date;
}

const CandidateContactRevealSchema = new Schema<ICandidateContactRevealDocument>({
  orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', required: true, index: true },
  candidateUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  revealedAt: { type: Date, default: Date.now },
});

CandidateContactRevealSchema.index({ orgId: 1, candidateUserId: 1 }, { unique: true });

export const CandidateContactRevealModel = model<ICandidateContactRevealDocument>(
  'CandidateContactReveal',
  CandidateContactRevealSchema
);

// ─── Subscription Model ───────────────────────────────────────────────────

export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';
export type SubscriptionDuration = 'monthly' | 'six_months' | 'yearly';

export interface IUserSubscriptionDocument extends Document {
  userId: Types.ObjectId;
  orgId?: Types.ObjectId;
  planId: string;
  planName: string;
  billingCycle: string;
  creditsIncluded: number;
  priceInr: number;
  quotaTotal?: number;
  quotaUsed?: number;
  quotaRemaining?: number;
  packageType?: 'subscription' | 'ai_apply' | 'candidate_package' | 'company_promotion' | 'promotion' | 'startup_service' | 'startup';
  startDate: Date;
  expiresAt: Date;
  status: SubscriptionStatus;
  orderId?: string;
  paymentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSubscriptionSchema = new Schema<IUserSubscriptionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', index: true },
    planId: { type: String, required: true, index: true },
    planName: { type: String, required: true },
    billingCycle: { type: String, required: true },
    creditsIncluded: { type: Number, required: true },
    priceInr: { type: Number, required: true },
    quotaTotal: { type: Number },
    quotaUsed: { type: Number, default: 0 },
    quotaRemaining: { type: Number },
    packageType: { type: String, enum: ['subscription', 'ai_apply', 'candidate_package', 'company_promotion', 'promotion', 'startup_service', 'startup'], default: 'subscription' },
    startDate: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active', index: true },
    orderId: { type: String },
    paymentId: { type: String },
  },
  { timestamps: true }
);

export const UserSubscriptionModel = model<IUserSubscriptionDocument>('UserSubscription', UserSubscriptionSchema);

// ─── Payment Order Model ──────────────────────────────────────────────────

export type PaymentOrderStatus = 'created' | 'paid' | 'failed' | 'cancelled';
export type PaymentPurchaseType = 'credits' | 'subscription';

export interface IPaymentOrderDocument extends Document {
  orderId: string;
  userId: Types.ObjectId;
  orgId?: Types.ObjectId;
  purchaseType: PaymentPurchaseType;
  itemKey: string;
  itemName: string;
  credits: number;
  amountInr: number;
  currency: string;
  billingCycle?: SubscriptionDuration;
  status: PaymentOrderStatus;
  provider: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  providerSignature?: string;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentOrderSchema = new Schema<IPaymentOrderDocument>(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', index: true },
    purchaseType: { type: String, enum: ['credits', 'subscription'], required: true },
    itemKey: { type: String, required: true },
    itemName: { type: String, required: true },
    credits: { type: Number, required: true },
    amountInr: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    billingCycle: { type: String, enum: ['monthly', 'six_months', 'yearly'] },
    status: { type: String, enum: ['created', 'paid', 'failed', 'cancelled'], default: 'created', index: true },
    provider: { type: String, default: 'razorpay' },
    providerOrderId: { type: String },
    providerPaymentId: { type: String },
    providerSignature: { type: String },
    idempotencyKey: { type: String, sparse: true, index: true },
  },
  { timestamps: true }
);

export const PaymentOrderModel = model<IPaymentOrderDocument>('PaymentOrder', PaymentOrderSchema);
