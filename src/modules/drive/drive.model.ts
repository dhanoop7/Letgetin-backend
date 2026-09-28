import mongoose, { Schema, Document } from 'mongoose';

export type DriveCategory = 'pdf' | 'image' | 'document' | 'archive' | 'audio' | 'video' | 'other';

export interface IDriveFileCloudinary {
  publicId: string;
  url: string;
  secureUrl: string;
  format: string;
  resourceType: string;
}

export interface IDriveFile extends Document {
  userId: mongoose.Types.ObjectId;
  originalName: string;
  mimeType: string;
  size: number; // Size in bytes
  category: DriveCategory;
  cloudinary: IDriveFileCloudinary;
  starred: boolean;
  tags: string[];
  description?: string;
  extractedText?: string;
  extractedTextStatus?: 'pending' | 'done' | 'failed' | 'unsupported';
  aiSummary?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DriveFileSchema = new Schema<IDriveFile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    category: {
      type: String,
      enum: ['pdf', 'image', 'document', 'archive', 'audio', 'video', 'other'],
      required: true,
      index: true,
    },
    cloudinary: {
      publicId: { type: String, required: true },
      url: { type: String, required: true },
      secureUrl: { type: String, required: true },
      format: { type: String, default: 'raw' },
      resourceType: { type: String, default: 'raw' },
    },
    starred: {
      type: Boolean,
      default: false,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    description: {
      type: String,
      default: '',
    },
    extractedText: {
      type: String,
      default: undefined,
    },
    extractedTextStatus: {
      type: String,
      enum: ['pending', 'done', 'failed', 'unsupported'],
      default: undefined,
    },
    aiSummary: {
      type: String,
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

// Index for search & user queries
DriveFileSchema.index({ userId: 1, createdAt: -1 });
DriveFileSchema.index({ userId: 1, category: 1 });

export const DriveFileModel = mongoose.model<IDriveFile>('DriveFile', DriveFileSchema);
