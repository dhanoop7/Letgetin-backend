import { Schema, model, Document, Types } from 'mongoose';

export interface INoteDocument extends Document {
  userId: Types.ObjectId;
  orgId?: Types.ObjectId;
  title: string;
  content: string;
  tags: string[];
  workspaceName?: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NoteSchema = new Schema<INoteDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', index: true },
    title: { type: String, default: 'New note', trim: true },
    content: { type: String, default: '' },
    tags: { type: [String], default: [] },
    workspaceName: { type: String, default: 'Personal Workspace' },
    pinned: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id = ret._id.toString();
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id = ret._id.toString();
        delete ret.__v;
        return ret;
      },
    },
  }
);

NoteSchema.index({ userId: 1, updatedAt: -1 });
NoteSchema.index({ orgId: 1, updatedAt: -1 });

export const NoteModel = model<INoteDocument>('Note', NoteSchema);
