import { Schema, model, Document, Types } from 'mongoose';

export type AiApplyBatchStatus = 'queued' | 'processing' | 'paused' | 'completed' | 'cancelled' | 'failed';

export interface IAppliedJobDetail {
  jobId: Types.ObjectId;
  title: string;
  company: string;
  companyLogo?: string;
  location?: string;
  salary?: string;
  matchScore: number;
  appliedAt: Date;
  status: 'applied' | 'skipped_duplicate' | 'failed';
  error?: string;
}

export interface IAiApplyBatchJobDocument extends Document {
  userId: Types.ObjectId;
  preferencesId: Types.ObjectId;
  resumeId: Types.ObjectId;
  coverLetterId?: Types.ObjectId;
  status: AiApplyBatchStatus;
  totalJobs: number;
  totalBatches: number;
  batchSize: number;
  currentBatch: number;
  appliedCount: number;
  skippedDuplicates: number;
  failedCount: number;
  selectedJobIds: Types.ObjectId[];
  appliedJobs: IAppliedJobDetail[];
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AppliedJobDetailSchema = new Schema<IAppliedJobDetail>(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    title: { type: String, required: true },
    company: { type: String, required: true },
    companyLogo: { type: String },
    location: { type: String },
    salary: { type: String },
    matchScore: { type: Number, default: 0 },
    appliedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['applied', 'skipped_duplicate', 'failed'],
      default: 'applied',
    },
    error: { type: String },
  },
  { _id: false }
);

const AiApplyBatchJobSchema = new Schema<IAiApplyBatchJobDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    preferencesId: { type: Schema.Types.ObjectId, ref: 'AiApplyPreferences', required: true },
    resumeId: { type: Schema.Types.ObjectId, ref: 'Resume', required: true },
    coverLetterId: { type: Schema.Types.ObjectId, ref: 'CoverLetter' },
    status: {
      type: String,
      enum: ['queued', 'processing', 'paused', 'completed', 'cancelled', 'failed'],
      default: 'queued',
      index: true,
    },
    totalJobs: { type: Number, default: 0 },
    totalBatches: { type: Number, default: 0 },
    batchSize: { type: Number, default: 10 },
    currentBatch: { type: Number, default: 0 },
    appliedCount: { type: Number, default: 0 },
    skippedDuplicates: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    selectedJobIds: [{ type: Schema.Types.ObjectId, ref: 'Job' }],
    appliedJobs: { type: [AppliedJobDetailSchema], default: [] },
    startedAt: { type: Date },
    completedAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true }
);

AiApplyBatchJobSchema.index({ userId: 1, createdAt: -1 });

export const AiApplyBatchJobModel = model<IAiApplyBatchJobDocument>(
  'AiApplyBatchJob',
  AiApplyBatchJobSchema
);
