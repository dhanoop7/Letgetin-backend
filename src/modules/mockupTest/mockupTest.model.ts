import { Schema, model, Document, Types } from 'mongoose';

export type TestType = 'aptitude' | 'technical';
export type TestMode = 'objective' | 'rapid' | 'descriptive' | 'quick5m';
export type SessionStatus = 'in-progress' | 'completed' | 'abandoned';

export interface IMockupQuestion {
  id: string;
  type: 'objective' | 'rapid' | 'descriptive';
  question: string;
  category: string;
  options?: string[];
  correctAnswer?: string;
  correctOptionIndex?: number;
  explanation?: string;
  difficulty?: string;
  starTip?: string;
}

export interface IMockupAnswer {
  questionId: string;
  selectedOption?: number;
  selectedAnswer?: string;
  textAnswer?: string;
  timeSpentSeconds?: number;
  isCorrect?: boolean;
}

export interface IMockupScorecard {
  overallScore: number; // 0 - 100
  correctCount?: number;
  totalQuestions?: number;
  percentage?: number;
  technicalScore?: number;
  communicationScore?: number;
  problemSolvingScore?: number;
  starCoherence?: number;
  speechPacingWpm?: number;
  readinessIndex?: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  categoryBreakdown?: { category: string; score: number; total: number }[];
  starAnalysis?: {
    s: string;
    t: string;
    a: string;
    r: string;
  };
}

export interface IMockupTestSessionDocument extends Document {
  sessionId: string;
  userId?: Types.ObjectId;
  testType: TestType;
  mode: TestMode;
  assessmentType?: string;
  interactionMode?: 'text' | 'audio' | 'video';
  jobDescription?: string;
  extractedSkills: string[];
  questions: IMockupQuestion[];
  answers: IMockupAnswer[];
  score: number;
  totalPossible: number;
  percentage: number;
  scorecard?: IMockupScorecard;
  status: SessionStatus;
  generationSource?: string;
  generationModel?: string;
  generationId?: string;
  generatedAt?: Date;
  startedAt: Date;
  completedAt?: Date;
  durationSeconds?: number;
  createdAt: Date;
  updatedAt: Date;
}

const MockupQuestionSchema = new Schema<IMockupQuestion>(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ['objective', 'rapid', 'descriptive'], required: true },
    question: { type: String, required: true },
    category: { type: String, default: 'General' },
    options: { type: [String], default: [] },
    correctAnswer: { type: String },
    correctOptionIndex: { type: Number },
    explanation: { type: String },
    difficulty: { type: String, default: 'medium' },
    starTip: { type: String },
  },
  { _id: false }
);

const MockupAnswerSchema = new Schema<IMockupAnswer>(
  {
    questionId: { type: String, required: true },
    selectedOption: { type: Number },
    selectedAnswer: { type: String },
    textAnswer: { type: String },
    timeSpentSeconds: { type: Number, default: 0 },
    isCorrect: { type: Boolean },
  },
  { _id: false }
);

const MockupScorecardSchema = new Schema<IMockupScorecard>(
  {
    overallScore: { type: Number, default: 0 },
    correctCount: { type: Number },
    totalQuestions: { type: Number },
    percentage: { type: Number },
    technicalScore: { type: Number },
    communicationScore: { type: Number },
    problemSolvingScore: { type: Number },
    starCoherence: { type: Number },
    speechPacingWpm: { type: Number },
    readinessIndex: { type: Number },
    summary: { type: String, default: '' },
    strengths: { type: [String], default: [] },
    improvements: { type: [String], default: [] },
    categoryBreakdown: [
      {
        category: { type: String },
        score: { type: Number },
        total: { type: Number },
      },
    ],
    starAnalysis: {
      s: { type: String },
      t: { type: String },
      a: { type: String },
      r: { type: String },
    },
  },
  { _id: false }
);

const MockupTestSessionSchema = new Schema<IMockupTestSessionDocument>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    testType: { type: String, enum: ['aptitude', 'technical'], required: true, index: true },
    mode: { type: String, enum: ['objective', 'rapid', 'descriptive', 'quick5m'], required: true, index: true },
    assessmentType: { type: String, index: true },
    interactionMode: { type: String, enum: ['text', 'audio', 'video'], default: 'text', index: true },
    jobDescription: { type: String, default: '' },
    extractedSkills: { type: [String], default: [] },
    questions: { type: [MockupQuestionSchema], default: [] },
    answers: { type: [MockupAnswerSchema], default: [] },
    score: { type: Number, default: 0 },
    totalPossible: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    scorecard: { type: MockupScorecardSchema, required: false },
    status: { type: String, enum: ['in-progress', 'completed', 'abandoned'], default: 'in-progress', index: true },
    generationSource: { type: String, default: 'gemini' },
    generationModel: { type: String, default: 'gemini-3.6-flash' },
    generationId: { type: String },
    generatedAt: { type: Date },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    durationSeconds: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

MockupTestSessionSchema.index({ userId: 1, createdAt: -1 });
MockupTestSessionSchema.index({ sessionId: 1, status: 1 });

export const MockupTestSessionModel = model<IMockupTestSessionDocument>(
  'MockupTestSession',
  MockupTestSessionSchema
);
