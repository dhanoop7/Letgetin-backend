import { Schema, model, Document, Types } from 'mongoose';

export type FunnelStageType = 'resume_match' | 'assessment' | 'ai_interview' | 'manual_review';
export type FunnelConfigStatus = 'draft' | 'active' | 'completed' | 'paused';

export interface IFunnelStage {
  stageId: string;
  stageName: string;
  stageType: FunnelStageType;
  order: number;
  expectedAttendanceRate: number; // > 0 and <= 1
  expectedPassRate: number;       // > 0 and <= 1
  targetCount: number;            // Calculated by reverse funnel pass
  deadlineHours: number;          // Hours before candidate is marked no_show if not started
  autoAdvanceScoreThreshold: number; // e.g. 70 out of 100
  autoRefillEnabled: boolean;
}

export interface IHiringFunnelConfigDocument extends Document {
  jobId: Types.ObjectId;
  orgId?: Types.ObjectId;
  finalShortlistTarget: number;
  stages: IFunnelStage[];
  status: FunnelConfigStatus;
  totalFunnelIntakeTarget: number;
  currentShortlistedCount: number;
  lastCalculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FunnelStageSchema = new Schema<IFunnelStage>(
  {
    stageId: { type: String, required: true, trim: true },
    stageName: { type: String, required: true, trim: true },
    stageType: {
      type: String,
      enum: ['resume_match', 'assessment', 'ai_interview', 'manual_review'],
      required: true,
    },
    order: { type: Number, required: true },
    expectedAttendanceRate: { type: Number, required: true, min: 0.01, max: 1.0 },
    expectedPassRate: { type: Number, required: true, min: 0.01, max: 1.0 },
    targetCount: { type: Number, required: true, min: 1 },
    deadlineHours: { type: Number, default: 48, min: 1 },
    autoAdvanceScoreThreshold: { type: Number, default: 70, min: 0, max: 100 },
    autoRefillEnabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const HiringFunnelConfigSchema = new Schema<IHiringFunnelConfigDocument>(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, unique: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrg', index: true },
    finalShortlistTarget: { type: Number, required: true, min: 1 },
    stages: { type: [FunnelStageSchema], required: true },
    status: {
      type: String,
      enum: ['draft', 'active', 'completed', 'paused'],
      default: 'active',
      index: true,
    },
    totalFunnelIntakeTarget: { type: Number, required: true, min: 1 },
    currentShortlistedCount: { type: Number, default: 0, min: 0 },
    lastCalculatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const HiringFunnelConfigModel = model<IHiringFunnelConfigDocument>(
  'HiringFunnelConfig',
  HiringFunnelConfigSchema
);
