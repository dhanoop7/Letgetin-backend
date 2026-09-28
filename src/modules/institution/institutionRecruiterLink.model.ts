import { Schema, model, Document, Types } from 'mongoose';

export type InstitutionRecruiterLinkStatus = 'active' | 'pending' | 'inactive';

export interface IRecruiterRequirement {
  _id: Types.ObjectId;
  title: string;
  openings?: number;
  notes?: string;
}

export interface IInstitutionRecruiterLinkDocument extends Document {
  institutionOrgId: Types.ObjectId;
  recruiterOrgId?: Types.ObjectId;
  company: string;
  contactPerson?: string;
  email: string;
  phone?: string;
  industry?: string;
  status: InstitutionRecruiterLinkStatus;
  requirements: IRecruiterRequirement[];
  connectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RecruiterRequirementSchema = new Schema<IRecruiterRequirement>(
  {
    title: { type: String, required: true, trim: true },
    openings: { type: Number, min: 0 },
    notes: { type: String, default: '' },
  },
  { _id: true }
);

const InstitutionRecruiterLinkSchema = new Schema<IInstitutionRecruiterLinkDocument>(
  {
    institutionOrgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', required: true, index: true },
    // Optional — kept only for backward compatibility with links created before recruiters
    // became manually entered. New recruiters are not tied to a real platform org account.
    recruiterOrgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization' },
    company: { type: String, required: true, trim: true },
    contactPerson: { type: String, default: '' },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: '' },
    industry: { type: String, default: '' },
    status: { type: String, enum: ['active', 'pending', 'inactive'], default: 'active' },
    requirements: { type: [RecruiterRequirementSchema], default: [] },
    connectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

InstitutionRecruiterLinkSchema.index({ institutionOrgId: 1, email: 1 }, { unique: true });

export const InstitutionRecruiterLinkModel = model<IInstitutionRecruiterLinkDocument>(
  'InstitutionRecruiterLink',
  InstitutionRecruiterLinkSchema
);
