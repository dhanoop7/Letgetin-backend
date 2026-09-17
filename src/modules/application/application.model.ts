import { Schema, model, Document, Types } from 'mongoose';

export type ApplicationSource = 'ai_apply' | 'manual';
export type ApplicationStatus =
  | 'submitted'
  | 'reviewing'
  | 'shortlisted'
  | 'interviewing'
  | 'offered'
  | 'rejected'
  | 'failed';

export type CandidatePoolType = 'primary' | 'reserve' | 'disqualified';
export type StageStatus = 'invited' | 'started' | 'completed' | 'passed' | 'failed' | 'no_show';

export interface IApplicationDocument extends Document {
  userId: Types.ObjectId;
  jobId: Types.ObjectId;
  resumeId?: Types.ObjectId;
  coverLetterId?: Types.ObjectId;
  source: ApplicationSource;
  status: ApplicationStatus;
  matchScore?: number;
  assessmentScore?: number;
  aiScore?: number;
  aiApplyPreferencesId?: Types.ObjectId;
  notes?: string;
  appliedAt: Date;
  // --- Hiring Engine Extensions ---
  poolType?: CandidatePoolType;
  currentStageIndex?: number;
  currentStageId?: string;
  stageStatus?: StageStatus;
  stageDeadline?: Date;
  compositeRank?: number;
  invitedAt?: Date;
  stageStartedAt?: Date;
  stageCompletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ApplicationSchema = new Schema<IApplicationDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    resumeId: { type: Schema.Types.ObjectId, ref: 'Resume', required: false },
    coverLetterId: { type: Schema.Types.ObjectId, ref: 'CoverLetter' },
    source: { type: String, enum: ['ai_apply', 'manual'], default: 'ai_apply' },
    status: {
      type: String,
      enum: ['submitted', 'reviewing', 'shortlisted', 'interviewing', 'offered', 'rejected', 'failed'],
      default: 'submitted',
      index: true,
    },
    matchScore: { type: Number },
    assessmentScore: { type: Number },
    aiScore: { type: Number },
    aiApplyPreferencesId: { type: Schema.Types.ObjectId, ref: 'AiApplyPreferences' },
    notes: { type: String, default: '' },
    appliedAt: { type: Date, default: Date.now },
    // --- Hiring Engine Extensions ---
    poolType: {
      type: String,
      enum: ['primary', 'reserve', 'disqualified'],
      index: true,
    },
    currentStageIndex: { type: Number },
    currentStageId: { type: String, trim: true },
    stageStatus: {
      type: String,
      enum: ['invited', 'started', 'completed', 'passed', 'failed', 'no_show'],
      index: true,
    },
    stageDeadline: { type: Date },
    compositeRank: { type: Number },
    invitedAt: { type: Date },
    stageStartedAt: { type: Date },
    stageCompletedAt: { type: Date },
  },
  { timestamps: true }
);

// One application per candidate per job - prevents duplicate applications on repeat AI Apply runs.
ApplicationSchema.index({ userId: 1, jobId: 1 }, { unique: true });
ApplicationSchema.index({ userId: 1, appliedAt: -1 });

// Hiring Engine Compound Indexes
ApplicationSchema.index({ jobId: 1, currentStageId: 1, poolType: 1, stageStatus: 1 });
ApplicationSchema.index({ jobId: 1, poolType: 1, compositeRank: -1 });

export const ApplicationModel = model<IApplicationDocument>('Application', ApplicationSchema);
