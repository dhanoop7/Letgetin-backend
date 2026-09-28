import { Schema, model, Document, Types } from 'mongoose';

export interface IInstitutionTrainingProgramDocument extends Document {
  institutionOrgId: Types.ObjectId;
  name: string;
  scheduledDate?: Date;
  attendees?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InstitutionTrainingProgramSchema = new Schema<IInstitutionTrainingProgramDocument>(
  {
    institutionOrgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    scheduledDate: { type: Date },
    attendees: { type: Number, min: 0 },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

export const InstitutionTrainingProgramModel = model<IInstitutionTrainingProgramDocument>(
  'InstitutionTrainingProgram',
  InstitutionTrainingProgramSchema
);
