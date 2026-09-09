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
  },
  { timestamps: true }
);

// One application per candidate per job - prevents duplicate applications on repeat AI Apply runs.
ApplicationSchema.index({ userId: 1, jobId: 1 }, { unique: true });
ApplicationSchema.index({ userId: 1, appliedAt: -1 });

export const ApplicationModel = model<IApplicationDocument>('Application', ApplicationSchema);
