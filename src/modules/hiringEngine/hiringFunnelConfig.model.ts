import { Schema, model, Document, Types } from 'mongoose';
import { AssessmentRoundType } from '../job/job.model.js';

export type FunnelStageType = 'resume_match' | 'assessment' | 'ai_interview' | 'manual_review' | 'human_interview';
export type FunnelConfigStatus = 'draft' | 'active' | 'completed' | 'paused';
export type FunnelHealth = 'healthy' | 'constrained' | 'starved';

export interface IFunnelStage {
  stageId: string;
  stageName: string;
  stageType: FunnelStageType;
  assessmentType?: AssessmentRoundType;
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
  idealStages?: IFunnelStage[];
  idealFunnelIntakeTarget?: number;
  isAdaptive?: boolean;
  funnelHealth?: FunnelHealth;
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
      enum: ['resume_match', 'assessment', 'ai_interview', 'manual_review', 'human_interview'],
      required: true,
    },
    assessmentType: {
      type: String,
      enum: ['general', 'coding'],
      default: undefined,
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
    idealStages: { type: [FunnelStageSchema], default: undefined },
    idealFunnelIntakeTarget: { type: Number },
    isAdaptive: { type: Boolean, default: false },
    funnelHealth: {
      type: String,
      enum: ['healthy', 'constrained', 'starved'],
      default: 'healthy',
    },
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
