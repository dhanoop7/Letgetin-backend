import { Schema, model, Document } from 'mongoose';
import { EmbeddingStatus } from '../embedding/embedding.types.js';

export interface ICandidateProfileDocument extends Document {
  userId: Schema.Types.ObjectId;
  resumeId?: Schema.Types.ObjectId;
  headline?: string;
  summary?: string;
  skills: string[];
  yearsOfExperience: number;
  location?: string;
  education?: string;
  embedding?: number[];
  embeddingModel: string;
  embeddingVersion: string;
  embeddingStatus: EmbeddingStatus;
  rawText?: string;
  profileVersion?: number;
  embeddedVersion?: number;
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CandidateProfileSchema = new Schema<ICandidateProfileDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    resumeId: { type: Schema.Types.ObjectId, ref: 'Resume', sparse: true },
    headline: { type: String, default: '' },
    summary: { type: String, default: '' },
    skills: { type: [String], default: [] },
    yearsOfExperience: { type: Number, default: 0 },
    location: { type: String, default: '' },
    education: { type: String, default: '' },
    embedding: {
      type: [Number],
      default: undefined,
    },
    embeddingModel: { type: String, default: 'gemini-embedding-001' },
    embeddingVersion: { type: String, default: 'v1' },
    embeddingStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    rawText: { type: String, default: '' },
    profileVersion: { type: Number, default: 0 },
    embeddedVersion: { type: Number, default: 0 },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

export const CandidateProfileModel = model<ICandidateProfileDocument>(
  'CandidateProfile',
  CandidateProfileSchema
);
