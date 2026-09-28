import { Schema, model, Document, Types } from 'mongoose';

export type CurrentStatus =
  | 'employed_happy'
  | 'unemployed'
  | 'urgently_looking'
  | 'employed_switching'
  | 'employed_higher_opportunities';

export type EmploymentTypePref = 'all' | 'full-time' | 'part-time' | 'contract-freelance';
export type ContactChannel = 'email' | 'mobile' | 'inbox' | 'linkedin';
export type ContactTiming = 'morning' | 'noon' | 'evening' | 'night';
export type YesNo = 'yes' | 'no';

export interface IYesNoDescribe {
  value?: YesNo;
  description?: string;
}

export interface IAiApplyPreferencesDocument extends Document {
  userId: Types.ObjectId;

  // Step 1 - Current Status
  currentStatus?: CurrentStatus;

  // Step 2 - Desired Job Title(s)
  desiredJobTitles: string[];

  // Step 3 - Resume / Cover Letter selection
  resumeId?: Types.ObjectId;
  resumePriority: number;
  coverLetterId?: Types.ObjectId;
  coverLetterPriority?: number;

  // Step 4 - Your Priorities
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency: string;
  preferredCountry?: string;
  preferredState?: string;
  preferredLocation?: string;
  willingToRelocate?: YesNo;
  industries: string[];
  employmentType: EmploymentTypePref;
  joiningDate?: string; // ISO date string, or literal 'ASAP'

  // Step 5 - Your Personal Priorities (candidate-entered only, never AI-populated)
  hasDisabilityOrChronicCondition: IYesNoDescribe;
  hasMedicalConditionNeedsAttention: IYesNoDescribe;
  okWithShiftJobs?: YesNo;
  hasAllergies: IYesNoDescribe;

  // Step 6 - Communication Preference
  contactChannels: ContactChannel[];
  contactTiming?: ContactTiming;

  // Lifecycle
  status: 'draft' | 'active' | 'paused';
  lastAppliedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const YesNoDescribeSchema = new Schema<IYesNoDescribe>(
  {
    value: { type: String, enum: ['yes', 'no'] },
    description: { type: String, default: '' },
  },
  { _id: false }
);

const AiApplyPreferencesSchema = new Schema<IAiApplyPreferencesDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    currentStatus: {
      type: String,
      enum: ['employed_happy', 'unemployed', 'urgently_looking', 'employed_switching', 'employed_higher_opportunities'],
    },
    desiredJobTitles: { type: [String], default: [] },

    resumeId: { type: Schema.Types.ObjectId, ref: 'Resume' },
    resumePriority: { type: Number, default: 1 },
    coverLetterId: { type: Schema.Types.ObjectId, ref: 'CoverLetter' },
    coverLetterPriority: { type: Number, default: 1 },

    salaryMin: { type: Number },
    salaryMax: { type: Number },
    salaryCurrency: { type: String, default: 'INR' },
    preferredCountry: { type: String },
    preferredState: { type: String },
    preferredLocation: { type: String },
    willingToRelocate: { type: String, enum: ['yes', 'no'] },
    industries: { type: [String], default: [] },
    employmentType: { type: String, enum: ['all', 'full-time', 'part-time', 'contract-freelance'], default: 'all' },
    joiningDate: { type: String },

    hasDisabilityOrChronicCondition: { type: YesNoDescribeSchema, default: () => ({}) },
    hasMedicalConditionNeedsAttention: { type: YesNoDescribeSchema, default: () => ({}) },
    okWithShiftJobs: { type: String, enum: ['yes', 'no'] },
    hasAllergies: { type: YesNoDescribeSchema, default: () => ({}) },

    contactChannels: { type: [String], enum: ['email', 'mobile', 'inbox', 'linkedin'], default: [] },
    contactTiming: { type: String, enum: ['morning', 'noon', 'evening', 'night'] },

    status: { type: String, enum: ['draft', 'active', 'paused'], default: 'draft' },
    lastAppliedAt: { type: Date },
  },
  { timestamps: true }
);

export const AiApplyPreferencesModel = model<IAiApplyPreferencesDocument>(
  'AiApplyPreferences',
  AiApplyPreferencesSchema
);
