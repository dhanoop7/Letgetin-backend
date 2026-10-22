import { Schema, model, Document, Types } from 'mongoose';

export type HuremasoAccessStatus =
  | 'trial_not_started'
  | 'trial_active'
  | 'trial_expired'
  | 'subscription_active'
  | 'subscription_cancelled';

export interface IHuremasoSubscriptionDocument extends Document {
  ownerUserId: Types.ObjectId;
  orgId: Types.ObjectId;
  status: HuremasoAccessStatus;
  trialStartedAt?: Date | null;
  trialExpiresAt?: Date | null;
  trialUsed: boolean;
  subscriptionPlanId?: 'starter' | 'pro' | null;
  subscriptionPlanName?: string | null;
  billingCycle?: 'monthly' | 'annual' | null;
  amountPaid?: number | null;
  currency?: string;
  paymentId?: string | null;
  paymentStatus?: 'paid' | 'pending' | 'failed' | null;
  subscriptionStartedAt?: Date | null;
  subscriptionExpiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const HuremasoSubscriptionSchema = new Schema<IHuremasoSubscriptionDocument>(
  {
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    orgId: {
      type: Schema.Types.ObjectId,
      ref: 'RecruiterOrganization',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['trial_not_started', 'trial_active', 'trial_expired', 'subscription_active', 'subscription_cancelled'],
      default: 'trial_not_started',
      required: true,
      index: true,
    },
    trialStartedAt: {
      type: Date,
      default: null,
    },
    trialExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    trialUsed: {
      type: Boolean,
      default: false,
      index: true,
    },
    subscriptionPlanId: {
      type: String,
      enum: ['starter', 'pro', null],
      default: null,
    },
    subscriptionPlanName: {
      type: String,
      default: null,
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'annual', null],
      default: null,
    },
    amountPaid: {
      type: Number,
      default: null,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    paymentId: {
      type: String,
      default: null,
    },
    paymentStatus: {
      type: String,
      enum: ['paid', 'pending', 'failed', null],
      default: null,
    },
    subscriptionStartedAt: {
      type: Date,
      default: null,
    },
    subscriptionExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const HuremasoSubscriptionModel = model<IHuremasoSubscriptionDocument>(
  'HuremasoSubscription',
  HuremasoSubscriptionSchema
);
