import { Schema, model, Document, Types } from 'mongoose';

export interface IInstitutionPolicyDocument extends Document {
  institutionOrgId: Types.ObjectId;
  oneStudentOneJob: boolean;
  dreamOfferOption: boolean;
  banPeriodDays: number;
  additionalRules?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InstitutionPolicySchema = new Schema<IInstitutionPolicyDocument>(
  {
    institutionOrgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', required: true, unique: true, index: true },
    oneStudentOneJob: { type: Boolean, default: false },
    dreamOfferOption: { type: Boolean, default: false },
    banPeriodDays: { type: Number, default: 30, min: 0 },
    additionalRules: { type: String, default: '' },
  },
  { timestamps: true }
);

export const InstitutionPolicyModel = model<IInstitutionPolicyDocument>('InstitutionPolicy', InstitutionPolicySchema);
