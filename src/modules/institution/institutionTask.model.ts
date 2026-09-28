import { Schema, model, Document, Types } from 'mongoose';

export type InstitutionTaskPriority = 'Low' | 'Medium' | 'High';

export interface IInstitutionTaskDocument extends Document {
  institutionOrgId: Types.ObjectId;
  name: string;
  estimatedTime?: string;
  priority: InstitutionTaskPriority;
  done: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const InstitutionTaskSchema = new Schema<IInstitutionTaskDocument>(
  {
    institutionOrgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    estimatedTime: { type: String, default: '' },
    priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    done: { type: Boolean, default: false },
  },
  { timestamps: true }
);

InstitutionTaskSchema.index({ institutionOrgId: 1, done: 1, createdAt: -1 });

export const InstitutionTaskModel = model<IInstitutionTaskDocument>('InstitutionTask', InstitutionTaskSchema);
