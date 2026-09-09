import { Schema, model, Document, Types } from 'mongoose';

export type InstitutionStudentStatus = 'active' | 'placed' | 'pending';

export interface IInstitutionStudentDocument extends Document {
  institutionOrgId: Types.ObjectId;
  name: string;
  email: string;
  course: string;
  year?: string;
  skills: string[];
  status: InstitutionStudentStatus;
  candidateUserId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const InstitutionStudentSchema = new Schema<IInstitutionStudentDocument>(
  {
    institutionOrgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    course: { type: String, required: true, trim: true },
    year: { type: String, default: '' },
    skills: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'placed', 'pending'], default: 'active' },
    candidateUserId: { type: Schema.Types.ObjectId, ref: 'User', default: undefined },
  },
  { timestamps: true }
);

InstitutionStudentSchema.index({ institutionOrgId: 1, email: 1 }, { unique: true });

export const InstitutionStudentModel = model<IInstitutionStudentDocument>(
  'InstitutionStudent',
  InstitutionStudentSchema
);
