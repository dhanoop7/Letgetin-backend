import { Schema, model, Document } from 'mongoose';

export type VideoType = 'short' | 'long';

export interface IVideoCloudinary {
  publicId: string;
  url: string;
  secureUrl: string;
  format: string;
  resourceType: string;
}

export interface IVideoProfileDocument extends Document {
  userId: Schema.Types.ObjectId;
  videoType: VideoType;
  originalName: string;
  mimeType: string;
  size: number;
  cloudinary: IVideoCloudinary;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const VideoProfileSchema = new Schema<IVideoProfileDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    videoType: { type: String, enum: ['short', 'long'], required: true, index: true },
    originalName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    cloudinary: {
      publicId: { type: String, required: true },
      url: { type: String, required: true },
      secureUrl: { type: String, required: true },
      format: { type: String, default: 'raw' },
      resourceType: { type: String, default: 'video' },
    },
    isArchived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

VideoProfileSchema.index({ userId: 1, createdAt: -1 });
VideoProfileSchema.index({ userId: 1, videoType: 1, isArchived: 1 });

export const VideoProfileModel = model<IVideoProfileDocument>('VideoProfile', VideoProfileSchema);
