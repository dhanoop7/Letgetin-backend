import { Schema, model, Document, Types } from 'mongoose';

export type AdmissionTrackStatus = 'Open' | 'Upcoming' | 'Closed';

export interface IInstitutionAdmissionTrackDocument extends Document {
  institutionOrgId: Types.ObjectId;
  program: string;
  school: string;
  seats: number;
  appliedCount: number;
  startDate: string;
  deadline: string;
  eligibility: string;
  applicationFee: string;
  status: AdmissionTrackStatus;
  createdAt: Date;
  updatedAt: Date;
}

const InstitutionAdmissionTrackSchema = new Schema<IInstitutionAdmissionTrackDocument>(
  {
    institutionOrgId: {
      type: Schema.Types.ObjectId,
      ref: 'RecruiterOrganization',
      required: true,
      index: true,
    },
    program: { type: String, required: true, trim: true },
    school: { type: String, required: true, trim: true },
    seats: { type: Number, required: true, default: 60, min: 1 },
    appliedCount: { type: Number, default: 0, min: 0 },
    startDate: { type: String, default: 'Oct 01, 2026' },
    deadline: { type: String, default: 'Dec 31, 2026' },
    eligibility: { type: String, default: '10+2 with minimum 60% aggregate in required domain' },
    applicationFee: { type: String, default: '₹1,200' },
    status: {
      type: String,
      enum: ['Open', 'Upcoming', 'Closed'],
      default: 'Open',
    },
  },
  { timestamps: true }
);

InstitutionAdmissionTrackSchema.index({ institutionOrgId: 1, program: 1 });

export const InstitutionAdmissionTrackModel = model<IInstitutionAdmissionTrackDocument>(
  'InstitutionAdmissionTrack',
  InstitutionAdmissionTrackSchema
);
