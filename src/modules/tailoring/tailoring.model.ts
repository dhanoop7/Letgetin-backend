import { Schema, model, Document } from 'mongoose';

export type TailoringSection = 'summary' | 'experience' | 'skills' | 'projects';
export type TailoringChangeType = 'addition' | 'replacement' | 'rewrite';
export type TailoringSuggestionStatus = 'pending' | 'accepted' | 'declined' | 'edited';
export type TailoringSessionStatus = 'active' | 'completed';

export interface ITailoringSuggestion {
  id: string;
  section: TailoringSection;
  itemId?: string;
  changeType: TailoringChangeType;
  originalText: string;
  proposedText: string;
  reason: string;
  relatedKeywords: string[];
  status: TailoringSuggestionStatus;
}

export interface IMissingSection {
  section: TailoringSection;
  reason: string;
}

export interface ITailoringSessionDocument extends Document {
  userId: Schema.Types.ObjectId;
  sourceResumeId: Schema.Types.ObjectId;
  jobDescription: string;
  matchScore: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  missingSkills: string[];
  recommendedImprovements: string[];
  suggestions: ITailoringSuggestion[];
  missingSections: IMissingSection[];
  status: TailoringSessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

const TailoringSuggestionSchema = new Schema<ITailoringSuggestion>(
  {
    id: { type: String, required: true },
    section: { type: String, enum: ['summary', 'experience', 'skills', 'projects'], required: true },
    itemId: { type: String },
    changeType: { type: String, enum: ['addition', 'replacement', 'rewrite'], required: true },
    originalText: { type: String, default: '' },
    proposedText: { type: String, required: true },
    reason: { type: String, default: '' },
    relatedKeywords: { type: [String], default: [] },
    status: { type: String, enum: ['pending', 'accepted', 'declined', 'edited'], default: 'pending' },
  },
  { _id: false }
);

const MissingSectionSchema = new Schema<IMissingSection>(
  {
    section: { type: String, enum: ['summary', 'experience', 'skills', 'projects'], required: true },
    reason: { type: String, default: '' },
  },
  { _id: false }
);

const TailoringSessionSchema = new Schema<ITailoringSessionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sourceResumeId: { type: Schema.Types.ObjectId, ref: 'Resume', required: true, index: true },
    jobDescription: { type: String, required: true },
    matchScore: { type: Number, default: 0 },
    matchedKeywords: { type: [String], default: [] },
    missingKeywords: { type: [String], default: [] },
    missingSkills: { type: [String], default: [] },
    recommendedImprovements: { type: [String], default: [] },
    suggestions: { type: [TailoringSuggestionSchema], default: [] },
    missingSections: { type: [MissingSectionSchema], default: [] },
    status: { type: String, enum: ['active', 'completed'], default: 'active', index: true },
  },
  { timestamps: true }
);

TailoringSessionSchema.index({ userId: 1, sourceResumeId: 1, status: 1, updatedAt: -1 });

export const TailoringSessionModel = model<ITailoringSessionDocument>('TailoringSession', TailoringSessionSchema);
