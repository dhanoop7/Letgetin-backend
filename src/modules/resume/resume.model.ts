import { Schema, model, Document } from 'mongoose';

export interface IResumeDocument extends Document {
  userId: Schema.Types.ObjectId;
  templateId: string;
  title: string;
  content: Record<string, unknown>;
  settings: Record<string, unknown>;
  atsScore: number;
  isPublic: boolean;
  starred?: boolean;
  isActive?: boolean;
  shareToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ResumeSchema = new Schema<IResumeDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    templateId: { type: String, required: true, default: 'modern-sleek' },
    title: { type: String, required: true, default: 'Untitled Resume' },
    content: { type: Schema.Types.Mixed, required: true },
    settings: { type: Schema.Types.Mixed, default: {} },
    atsScore: { type: Number, default: 0 },
    isPublic: { type: Boolean, default: false },
    starred: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },
    shareToken: { type: String, default: null, sparse: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ResumeSchema.index({ userId: 1, updatedAt: -1 });

export const ResumeModel = model<IResumeDocument>('Resume', ResumeSchema);
