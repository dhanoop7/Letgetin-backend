import { Schema, model, Document, Types } from 'mongoose';

export type AdmissionStage =
  | 'inquiry'
  | 'submitted'
  | 'shortlisted'
  | 'counseling'
  | 'enrolled'
  | 'rejected';

export type VerificationStatus = 'verified' | 'in_progress' | 'pending' | 'flagged';

export interface IDocumentRecord {
  name: string;
  type: string;
  size: string;
  status: VerificationStatus;
  updatedAt: Date;
}

export interface IBgCheckItem {
  id: string;
  label: string;
  desc: string;
  vendor: string;
  status: VerificationStatus;
  updatedAt: Date;
}

export interface IAssessmentItem {
  name: string;
  weight: number;
  score: number | null;
  max: number;
  status: 'done' | 'pending';
}

export interface ITimelineEvent {
  title: string;
  meta: string;
  date: Date;
}

export interface IInternalNote {
  text: string;
  author: string;
  createdAt: Date;
}

export interface IInstitutionAdmissionApplicationDocument extends Document {
  institutionOrgId: Types.ObjectId;
  applicantId: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  program: string;
  stage: AdmissionStage;
  score: string;
  gpa: string;
  category: string;
  source: string;
  counselor: string;
  appliedDate: string;
  meritRank?: number;
  meritIndex?: number;
  enrollmentNo?: string;
  feeStatus: 'Full Fee Paid' | 'Token Paid (₹50k)' | 'Scholarship 100%' | 'Pending';
  scholarshipTier: string;
  hostelOpted: boolean;
  callLetterSent: boolean;
  documents: IDocumentRecord[];
  bgChecks: {
    overall: VerificationStatus;
    checks: IBgCheckItem[];
  };
  assessments: IAssessmentItem[];
  timeline: ITimelineEvent[];
  notes: IInternalNote[];
  createdAt: Date;
  updatedAt: Date;
}

const DocumentRecordSchema = new Schema<IDocumentRecord>(
  {
    name: { type: String, required: true },
    type: { type: String, default: 'PDF' },
    size: { type: String, default: '1.2 MB' },
    status: {
      type: String,
      enum: ['verified', 'in_progress', 'pending', 'flagged'],
      default: 'pending',
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const BgCheckItemSchema = new Schema<IBgCheckItem>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    desc: { type: String, default: '' },
    vendor: { type: String, default: 'CredCheck' },
    status: {
      type: String,
      enum: ['verified', 'in_progress', 'pending', 'flagged'],
      default: 'pending',
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const AssessmentItemSchema = new Schema<IAssessmentItem>(
  {
    name: { type: String, required: true },
    weight: { type: Number, default: 25 },
    score: { type: Number, default: null },
    max: { type: Number, default: 100 },
    status: { type: String, enum: ['done', 'pending'], default: 'pending' },
  },
  { _id: false }
);

const TimelineEventSchema = new Schema<ITimelineEvent>(
  {
    title: { type: String, required: true },
    meta: { type: String, default: '' },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const InternalNoteSchema = new Schema<IInternalNote>(
  {
    text: { type: String, required: true },
    author: { type: String, default: 'Admissions Officer' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const InstitutionAdmissionApplicationSchema = new Schema<IInstitutionAdmissionApplicationDocument>(
  {
    institutionOrgId: {
      type: Schema.Types.ObjectId,
      ref: 'RecruiterOrganization',
      required: true,
      index: true,
    },
    applicantId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: '' },
    city: { type: String, default: 'India' },
    program: { type: String, required: true, index: true },
    stage: {
      type: String,
      enum: ['inquiry', 'submitted', 'shortlisted', 'counseling', 'enrolled', 'rejected'],
      default: 'inquiry',
      index: true,
    },
    score: { type: String, default: '' },
    gpa: { type: String, default: '' },
    category: { type: String, default: 'General Merit' },
    source: { type: String, default: 'Website' },
    counselor: { type: String, default: 'Priya Nair' },
    appliedDate: { type: String, default: () => new Date().toISOString().slice(0, 10) },
    meritRank: { type: Number },
    meritIndex: { type: Number },
    enrollmentNo: { type: String },
    feeStatus: {
      type: String,
      enum: ['Full Fee Paid', 'Token Paid (₹50k)', 'Scholarship 100%', 'Pending'],
      default: 'Pending',
    },
    scholarshipTier: { type: String, default: 'None' },
    hostelOpted: { type: Boolean, default: false },
    callLetterSent: { type: Boolean, default: false },
    documents: { type: [DocumentRecordSchema], default: [] },
    bgChecks: {
      overall: {
        type: String,
        enum: ['verified', 'in_progress', 'pending', 'flagged'],
        default: 'pending',
      },
      checks: { type: [BgCheckItemSchema], default: [] },
    },
    assessments: { type: [AssessmentItemSchema], default: [] },
    timeline: { type: [TimelineEventSchema], default: [] },
    notes: { type: [InternalNoteSchema], default: [] },
  },
  { timestamps: true }
);

InstitutionAdmissionApplicationSchema.index({ institutionOrgId: 1, applicantId: 1 }, { unique: true });
InstitutionAdmissionApplicationSchema.index({ institutionOrgId: 1, email: 1 });

export const InstitutionAdmissionApplicationModel = model<IInstitutionAdmissionApplicationDocument>(
  'InstitutionAdmissionApplication',
  InstitutionAdmissionApplicationSchema
);
