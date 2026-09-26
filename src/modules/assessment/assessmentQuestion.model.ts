import mongoose, { Document, Schema, Types } from 'mongoose';
import { GeneralAssessmentQuestionType } from '../job/job.model.js';

export { GeneralAssessmentQuestionType };

export type AssessmentLifecycleStatus = 'draft' | 'published' | 'closed';
export type QuestionStatus = 'draft' | 'published' | 'archived';
export type QuestionSource = 'manual' | 'ai_generated';

export interface IMcqOption {
  id: string;
  text: string;
}

export interface IAssessmentQuestion {
  id: string;
  jobId: Types.ObjectId | string;
  roundId: string;
  type: GeneralAssessmentQuestionType;
  order: number;
  question: string;
  instructions?: string;
  points: number;
  required: boolean;
  status: QuestionStatus;
  source: QuestionSource;

  // MCQ specific
  options?: IMcqOption[];
  correctOptionId?: string;

  // Short Answer specific
  expectedAnswer?: string;

  // Scenario specific
  context?: string;

  // Short Answer & Scenario evaluation criteria (internal)
  evaluationCriteria?: string[];

  // Internal metadata (e.g. AI generation metadata, version)
  metadata?: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export interface IAssessmentQuestionDocument extends Omit<IAssessmentQuestion, 'id'>, Document {
  id: string;
}

const McqOptionSchema = new Schema<IMcqOption>(
  {
    id: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
  },
  { _id: false }
);

export const AssessmentQuestionSchema = new Schema<IAssessmentQuestionDocument>(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    roundId: { type: String, required: true, trim: true, index: true },
    type: {
      type: String,
      enum: ['mcq', 'short_answer', 'scenario'],
      required: true,
      index: true,
    },
    order: { type: Number, required: true, min: 1 },
    question: { type: String, required: true, trim: true },
    instructions: { type: String, trim: true, default: undefined },
    points: { type: Number, required: true, min: 1, default: 1 },
    required: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    source: {
      type: String,
      enum: ['manual', 'ai_generated'],
      default: 'manual',
    },

    // MCQ specific
    options: {
      type: [McqOptionSchema],
      default: undefined,
    },
    correctOptionId: {
      type: String,
      trim: true,
      default: undefined,
    },

    // Short Answer specific
    expectedAnswer: {
      type: String,
      trim: true,
      default: undefined,
    },

    // Scenario specific
    context: {
      type: String,
      trim: true,
      default: undefined,
    },

    // Evaluation criteria
    evaluationCriteria: {
      type: [String],
      default: undefined,
    },

    // Internal metadata
    metadata: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound Indexes for fast querying and deterministic ordering
AssessmentQuestionSchema.index({ jobId: 1, roundId: 1, order: 1 });
AssessmentQuestionSchema.index({ jobId: 1, roundId: 1, type: 1 });
AssessmentQuestionSchema.index({ jobId: 1, status: 1 });

export const AssessmentQuestionModel = mongoose.model<IAssessmentQuestionDocument>(
  'AssessmentQuestion',
  AssessmentQuestionSchema
);
