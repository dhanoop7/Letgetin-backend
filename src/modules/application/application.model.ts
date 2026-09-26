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

// --- Resume Shortlisting Phase Types ---
export type ResumeScreeningStatus = 'pending' | 'ai_reviewing' | 'ai_reviewed';
export type ResumeDecision = 'pending' | 'shortlisted' | 'rejected' | 'needs_review';

export interface IResumeEvaluation {
  overallScore: number;
  skillsMatchScore: number;
  experienceMatchScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  weaknesses: string[];
  recommendation: 'strong_match' | 'potential_match' | 'not_recommended';
  evaluatedAt: Date;
  isAiEvaluated: boolean;
  breakdown?: {
    requiredSkillsScore: number;
    preferredSkillsScore: number;
    experienceScore: number;
    educationScore: number;
    semanticScore: number;
    roleRelevanceScore: number;
  };
  matchedPreferredSkills?: string[];
  missingRequiredSkills?: string[];
  explanations?: string[];
  canonicalMatch?: any;
}

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
  // --- Resume Shortlisting Layer (Qualification Boundary) ---
  resumeScreeningStatus: ResumeScreeningStatus;
  resumeDecision: ResumeDecision;
  resumeDecidedAt?: Date;
  resumeDecidedBy?: Types.ObjectId;
  resumeDecisionNotes?: string;
  resumeEvaluation?: IResumeEvaluation;
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
  // --- Final Shortlist & Offer Layer ---
  finalShortlistDecision?: 'pending' | 'offered' | 'hired' | 'rejected' | 'on_hold';
  offeredAt?: Date;
  hiredAt?: Date;
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
    // --- Resume Shortlisting Layer ---
    resumeScreeningStatus: {
      type: String,
      enum: ['pending', 'ai_reviewing', 'ai_reviewed'],
      default: 'pending',
      index: true,
    },
    resumeDecision: {
      type: String,
      enum: ['pending', 'shortlisted', 'rejected', 'needs_review'],
      default: 'pending',
      index: true,
    },
    resumeDecidedAt: { type: Date },
    resumeDecidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resumeDecisionNotes: { type: String, default: '' },
    resumeEvaluation: {
      overallScore: { type: Number },
      skillsMatchScore: { type: Number },
      experienceMatchScore: { type: Number },
      matchedSkills: { type: [String], default: [] },
      missingSkills: { type: [String], default: [] },
      strengths: { type: [String], default: [] },
      weaknesses: { type: [String], default: [] },
      recommendation: {
        type: String,
        enum: ['strong_match', 'potential_match', 'not_recommended'],
      },
      evaluatedAt: { type: Date },
      isAiEvaluated: { type: Boolean, default: false },
      breakdown: { type: Schema.Types.Mixed },
      matchedPreferredSkills: { type: [String], default: [] },
      missingRequiredSkills: { type: [String], default: [] },
      explanations: { type: [String], default: [] },
      canonicalMatch: { type: Schema.Types.Mixed },
    },
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
    // --- Final Shortlist & Offer Layer ---
    finalShortlistDecision: {
      type: String,
      enum: ['pending', 'offered', 'hired', 'rejected', 'on_hold'],
    },
    offeredAt: { type: Date },
    hiredAt: { type: Date },
  },
  { timestamps: true }
);

// One application per candidate per job - prevents duplicate applications on repeat AI Apply runs.
ApplicationSchema.index({ userId: 1, jobId: 1 }, { unique: true });
ApplicationSchema.index({ userId: 1, appliedAt: -1 });

// Hiring Engine Compound Indexes
ApplicationSchema.index({ jobId: 1, currentStageId: 1, poolType: 1, stageStatus: 1 });
ApplicationSchema.index({ jobId: 1, poolType: 1, compositeRank: -1 });

// Resume Shortlisting Compound Indexes
ApplicationSchema.index({ jobId: 1, resumeDecision: 1 });
ApplicationSchema.index({ jobId: 1, resumeScreeningStatus: 1 });

export const ApplicationModel = model<IApplicationDocument>('Application', ApplicationSchema);
