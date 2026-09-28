import { Schema, model, Document } from 'mongoose';

export interface ICoverLetterDocument extends Document {
  userId: Schema.Types.ObjectId;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const CoverLetterSchema = new Schema<ICoverLetterDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, default: 'Untitled Cover Letter' },
    content: { type: String, required: true, default: '' },
  },
  {
    timestamps: true,
  }
);

CoverLetterSchema.index({ userId: 1, updatedAt: -1 });

export const CoverLetterModel = model<ICoverLetterDocument>('CoverLetter', CoverLetterSchema);
