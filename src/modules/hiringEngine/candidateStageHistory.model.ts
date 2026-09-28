import { Schema, model, Document, Types } from 'mongoose';

export type StageTransitionStatus =
  | 'invited'
  | 'started'
  | 'completed'
  | 'passed'
  | 'failed'
  | 'no_show';

export interface ICandidateStageHistoryDocument extends Document {
  applicationId: Types.ObjectId;
  jobId: Types.ObjectId;
  candidateId: Types.ObjectId;
  stageId: string;
  stageName: string;
  stageIndex: number;
  status: StageTransitionStatus;
  score?: number;
  evaluationDetails?: Record<string, any>;
  promotedFromReserve: boolean;
  notes?: string;
  enteredAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CandidateStageHistorySchema = new Schema<ICandidateStageHistoryDocument>(
  {
    applicationId: { type: Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    candidateId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    stageId: { type: String, required: true, trim: true },
    stageName: { type: String, required: true, trim: true },
    stageIndex: { type: Number, required: true },
    status: {
      type: String,
      enum: ['invited', 'started', 'completed', 'passed', 'failed', 'no_show'],
      required: true,
      index: true,
    },
    score: { type: Number },
    evaluationDetails: { type: Schema.Types.Mixed, default: {} },
    promotedFromReserve: { type: Boolean, default: false },
    notes: { type: String, default: '' },
    enteredAt: { type: Date, default: Date.now, index: true },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

// Helpful compound indexes for audit tracking and fast stage queries
CandidateStageHistorySchema.index({ applicationId: 1, enteredAt: -1 });
CandidateStageHistorySchema.index({ jobId: 1, stageId: 1, status: 1 });
CandidateStageHistorySchema.index({ candidateId: 1, enteredAt: -1 });

export const CandidateStageHistoryModel = model<ICandidateStageHistoryDocument>(
  'CandidateStageHistory',
  CandidateStageHistorySchema
);
