import mongoose, { Document, Schema, Types } from 'mongoose';

export type AttemptStatus = 'in_progress' | 'submitted' | 'evaluated' | 'expired';
export type AttemptVerdict = 'strong_hire' | 'hire' | 'borderline' | 'reject';

export interface IAttemptAnswer {
  questionId: string;
  answer: string;
  language?: string;
  autoSavedAt?: Date;
  isCorrect?: boolean;
  score?: number;
  feedback?: string;
}

export interface ISkillScoreBreakdown {
  skill: string;
  score: number;
  maxScore: number;
  percentage: number;
  feedback: string;
}

export interface IModeScoreBreakdown {
  mode: string;
  score: number;
  maxScore: number;
  percentage: number;
}

export interface IAttemptEvaluation {
  totalScore: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  verdict: AttemptVerdict;
  summary: string;
  skillBreakdown: ISkillScoreBreakdown[];
  modeBreakdown: IModeScoreBreakdown[];
  strengths: string[];
  gaps: string[];
  recommendations: string;
  evaluatedAt?: Date;
}

export interface IAssessmentAttempt {
  id?: string;
  attemptId: string;
  assessmentId: Types.ObjectId | string;
  candidateId?: Types.ObjectId | string;
  candidateName: string;
  candidateEmail: string;
  status: AttemptStatus;
  startedAt: Date;
  submittedAt?: Date;
  timeSpentSeconds: number;
  timeLimitMinutes: number;
  answers: IAttemptAnswer[];
  evaluation?: IAttemptEvaluation;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAssessmentAttemptDocument extends Omit<IAssessmentAttempt, 'id'>, Document {
  id: string;
}

const AttemptAnswerSchema = new Schema<IAttemptAnswer>(
  {
    questionId: { type: String, required: true },
    answer: { type: String, default: '' },
    language: { type: String },
    autoSavedAt: { type: Date, default: Date.now },
    isCorrect: { type: Boolean },
    score: { type: Number, default: 0 },
    feedback: { type: String },
  },
  { _id: false }
);

const SkillBreakdownSchema = new Schema<ISkillScoreBreakdown>(
  {
    skill: { type: String, required: true },
    score: { type: Number, required: true },
    maxScore: { type: Number, required: true },
    percentage: { type: Number, required: true },
    feedback: { type: String, default: '' },
  },
  { _id: false }
);

const ModeBreakdownSchema = new Schema<IModeScoreBreakdown>(
  {
    mode: { type: String, required: true },
    score: { type: Number, required: true },
    maxScore: { type: Number, required: true },
    percentage: { type: Number, required: true },
  },
  { _id: false }
);

const AttemptEvaluationSchema = new Schema<IAttemptEvaluation>(
  {
    totalScore: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    verdict: {
      type: String,
      enum: ['strong_hire', 'hire', 'borderline', 'reject'],
      default: 'borderline',
    },
    summary: { type: String, default: '' },
    skillBreakdown: { type: [SkillBreakdownSchema], default: [] },
    modeBreakdown: { type: [ModeBreakdownSchema], default: [] },
    strengths: { type: [String], default: [] },
    gaps: { type: [String], default: [] },
    recommendations: { type: String, default: '' },
    evaluatedAt: { type: Date },
  },
  { _id: false }
);

export const AssessmentAttemptSchema = new Schema<IAssessmentAttemptDocument>(
  {
    attemptId: { type: String, required: true, unique: true, index: true },
    assessmentId: {
      type: Schema.Types.ObjectId,
      ref: 'DomainAssessment',
      required: true,
      index: true,
    },
    candidateId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    candidateName: { type: String, required: true, trim: true },
    candidateEmail: { type: String, required: true, trim: true, lowercase: true },
    status: {
      type: String,
      enum: ['in_progress', 'submitted', 'evaluated', 'expired'],
      default: 'in_progress',
      index: true,
    },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
    timeSpentSeconds: { type: Number, default: 0 },
    timeLimitMinutes: { type: Number, default: 60 },
    answers: { type: [AttemptAnswerSchema], default: [] },
    evaluation: { type: AttemptEvaluationSchema, default: undefined },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id = ret._id?.toString() || ret.attemptId;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

AssessmentAttemptSchema.index({ assessmentId: 1, createdAt: -1 });
AssessmentAttemptSchema.index({ candidateEmail: 1 });

export const AssessmentAttemptModel = mongoose.model<IAssessmentAttemptDocument>(
  'AssessmentAttempt',
  AssessmentAttemptSchema
);
