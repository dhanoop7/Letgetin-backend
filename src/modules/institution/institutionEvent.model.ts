import { Schema, model, Document, Types } from 'mongoose';

export type InstitutionEventType = 'interview_drive' | 'aptitude_test' | 'campus_visit' | 'meeting' | 'other';

export interface IInstitutionEventDocument extends Document {
  institutionOrgId: Types.ObjectId;
  title: string;
  date: Date;
  type: InstitutionEventType;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InstitutionEventSchema = new Schema<IInstitutionEventDocument>(
  {
    institutionOrgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    date: { type: Date, required: true, index: true },
    type: {
      type: String,
      enum: ['interview_drive', 'aptitude_test', 'campus_visit', 'meeting', 'other'],
      default: 'other',
    },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

InstitutionEventSchema.index({ institutionOrgId: 1, date: 1 });

export const InstitutionEventModel = model<IInstitutionEventDocument>('InstitutionEvent', InstitutionEventSchema);
