import { Schema, model, Document, Types } from 'mongoose';

export interface IRecruiterCreditsDocument extends Document {
  orgId: Types.ObjectId;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

const RecruiterCreditsSchema = new Schema<IRecruiterCreditsDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', required: true, unique: true, index: true },
    balance: { type: Number, default: 50, min: 0 },
  },
  { timestamps: true }
);

export const RecruiterCreditsModel = model<IRecruiterCreditsDocument>('RecruiterCredits', RecruiterCreditsSchema);

export type CreditTransactionType = 'purchase' | 'spend';

export interface ICreditTransactionDocument extends Document {
  orgId: Types.ObjectId;
  type: CreditTransactionType;
  amount: number;
  reason: string;
  refId?: Types.ObjectId;
  createdAt: Date;
}

const CreditTransactionSchema = new Schema<ICreditTransactionDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', required: true, index: true },
    type: { type: String, enum: ['purchase', 'spend'], required: true },
    amount: { type: Number, required: true },
    reason: { type: String, required: true },
    refId: { type: Schema.Types.ObjectId },
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
