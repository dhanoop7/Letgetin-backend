import mongoose, { Schema, Document } from 'mongoose';

export type SectionType = 'personal' | 'contacts' | 'education' | 'experience' | 'skills';
export type VerificationStatus = 'verified' | 'pending' | 'rejected' | 'unsubmitted';

export interface ICloudinaryMetadata {
  originalName: string;
  cloudinaryPublicId: string;
  cloudinaryUrl: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
}

export interface IVerificationDetails {
  status: VerificationStatus;
  confidence: number;
  reviewedBy?: string;
  reviewedAt?: Date;
  reason?: string;
}

export interface IAiMetadata {
  summary: string;
  issues: string[];
  extractedFields: Record<string, any>;
  rawResponse?: Record<string, any>;
}

export interface IVerificationDocument extends Document {
  userId: mongoose.Types.ObjectId;
  section: SectionType;
  documentType: string;
  cloudinary: ICloudinaryMetadata;
  verification: IVerificationDetails;
  ai: IAiMetadata;
  starred?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const VerificationDocumentSchema = new Schema<IVerificationDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    section: {
      type: String,
      enum: ['personal', 'contacts', 'education', 'experience', 'skills'],
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      required: true,
      default: 'other',
    },
    cloudinary: {
      originalName: { type: String, required: true },
      cloudinaryPublicId: { type: String, required: true },
      cloudinaryUrl: { type: String, required: true },
      mimeType: { type: String, required: true },
      size: { type: Number, required: true },
      uploadedAt: { type: Date, default: Date.now },
    },
    verification: {
      status: {
        type: String,
        enum: ['verified', 'pending', 'rejected', 'unsubmitted'],
        default: 'pending',
      },
      confidence: { type: Number, default: 0 },
      reviewedBy: { type: String },
      reviewedAt: { type: Date },
      reason: { type: String },
    },
    ai: {
      summary: { type: String, default: '' },
      issues: { type: [String], default: [] },
      extractedFields: { type: Schema.Types.Mixed, default: {} },
      rawResponse: { type: Schema.Types.Mixed, default: {} },
    },
    starred: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export const VerificationDocumentModel = mongoose.model<IVerificationDocument>(
  'VerificationDocument',
  VerificationDocumentSchema
);
