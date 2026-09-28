import mongoose, { Document, Schema, Types } from 'mongoose';

export type AssessmentDifficulty = 'junior' | 'mid' | 'senior' | 'lead' | 'principal';
export type AssessmentStatus = 'draft' | 'ready' | 'published' | 'archived';
export type QuestionType = 'mcq' | 'coding' | 'architecture' | 'system_design' | 'debugging' | 'short_answer';
export type TestingMode = 'coding' | 'architecture' | 'system' | 'debugging' | 'database' | 'security';

export interface IMcqOption {
  id: string;
  text: string;
}

export interface ITestCase {
  input: string;
  expectedOutput: string;
  isHidden?: boolean;
}

export interface IDomainAssessmentQuestion {
  id: string;
  order: number;
  title: string;
  question: string;
  type: QuestionType;
  testingMode: TestingMode;
  skill: string;
  difficulty: AssessmentDifficulty;
  points: number;
  instructions?: string;
  context?: string;
  starterCode?: string;
  solutionCode?: string;
  language?: string;
  testCases?: ITestCase[];
  options?: IMcqOption[];
  correctOptionId?: string;
  expectedAnswer?: string;
  evaluationCriteria?: string[];
}

export interface IDomainAssessmentOptions {
  allowCodeCompilation: boolean;
  enableAiHints: boolean;
  recordScreen: boolean;
  autoEvaluateRubrics: boolean;
}

export interface IDomainAssessment {
  id?: string;
  assessmentId: string;
  recruiterId?: Types.ObjectId | string;
  title: string;
  role: string;
  jobId?: Types.ObjectId | string;
  jobTitle?: string;
  jobDescription: string;
  domain: string;
  skillAreas: string[];
  difficulty: AssessmentDifficulty;
  timeLimitMinutes: number;
  testingModes: TestingMode[];
  options: IDomainAssessmentOptions;
  customInstructions?: string;
  status: AssessmentStatus;
  questions: IDomainAssessmentQuestion[];
  questionsCount: number;
  totalPoints: number;
  passingPercentage: number;
  publishedAt?: Date;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDomainAssessmentDocument extends Omit<IDomainAssessment, 'id'>, Document {
  id: string;
}

const McqOptionSchema = new Schema<IMcqOption>(
  {
    id: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const TestCaseSchema = new Schema<ITestCase>(
  {
    input: { type: String, default: '' },
    expectedOutput: { type: String, default: '' },
    isHidden: { type: Boolean, default: false },
  },
  { _id: false }
);

const DomainAssessmentQuestionSchema = new Schema<IDomainAssessmentQuestion>(
  {
    id: { type: String, required: true },
    order: { type: Number, required: true },
    title: { type: String, required: true, trim: true },
    question: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['mcq', 'coding', 'architecture', 'system_design', 'debugging', 'short_answer'],
      default: 'mcq',
    },
    testingMode: {
      type: String,
      enum: ['coding', 'architecture', 'system', 'debugging', 'database', 'security'],
      default: 'coding',
    },
    skill: { type: String, required: true, trim: true },
    difficulty: {
      type: String,
      enum: ['junior', 'mid', 'senior', 'lead', 'principal'],
      default: 'mid',
    },
    points: { type: Number, default: 10, min: 1 },
    instructions: { type: String, trim: true },
    context: { type: String, trim: true },
    starterCode: { type: String },
    solutionCode: { type: String },
    language: { type: String, default: 'javascript' },
    testCases: { type: [TestCaseSchema], default: [] },
    options: { type: [McqOptionSchema], default: [] },
    correctOptionId: { type: String },
    expectedAnswer: { type: String },
    evaluationCriteria: { type: [String], default: [] },
  },
  { _id: false }
);

export const DomainAssessmentSchema = new Schema<IDomainAssessmentDocument>(
  {
    assessmentId: { type: String, required: true, unique: true, index: true },
    recruiterId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    title: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', default: null, index: true },
    jobTitle: { type: String, trim: true },
    jobDescription: { type: String, required: true },
    domain: { type: String, required: true, trim: true, index: true },
    skillAreas: { type: [String], default: [] },
    difficulty: {
      type: String,
      enum: ['junior', 'mid', 'senior', 'lead', 'principal'],
      default: 'mid',
      index: true,
    },
    timeLimitMinutes: { type: Number, default: 60 },
    testingModes: {
      type: [String],
      enum: ['coding', 'architecture', 'system', 'debugging', 'database', 'security'],
      default: ['coding', 'architecture', 'system'],
    },
    options: {
      allowCodeCompilation: { type: Boolean, default: true },
      enableAiHints: { type: Boolean, default: true },
      recordScreen: { type: Boolean, default: false },
      autoEvaluateRubrics: { type: Boolean, default: true },
    },
    customInstructions: { type: String, default: '' },
    status: {
      type: String,
      enum: ['draft', 'ready', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    questions: { type: [DomainAssessmentQuestionSchema], default: [] },
    questionsCount: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    passingPercentage: { type: Number, default: 70 },
    publishedAt: { type: Date },
    archivedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id = ret._id?.toString() || ret.assessmentId;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

DomainAssessmentSchema.index({ status: 1, createdAt: -1 });
DomainAssessmentSchema.index({ recruiterId: 1, status: 1 });

export const DomainAssessmentModel = mongoose.model<IDomainAssessmentDocument>(
  'DomainAssessment',
  DomainAssessmentSchema
);
