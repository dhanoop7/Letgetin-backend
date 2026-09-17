import { Schema, model, Document, Types } from 'mongoose';
import { EmbeddingStatus } from '../embedding/embedding.types.js';

export type ExperienceLevel = 'internship' | 'entry' | 'junior' | 'mid' | 'senior' | 'lead';
export type EmploymentType = 'full-time' | 'part-time' | 'contract' | 'internship' | 'freelance';
export type WorkplaceType = 'remote' | 'hybrid' | 'onsite';
export type JobStatus = 'active' | 'closed' | 'draft';
export type RecruiterJobStage = 'open' | 'shortlisting' | 'interview' | 'review' | 'completed';

export type ApplicationCollectionStatus =
  | 'collecting'
  | 'ready'
  | 'extended'
  | 'started'
  | 'insufficient'
  | 'closed';

export interface IApplicationCollection {
  idealIntake: number;
  minimumIntake: number;
  actualQualifiedCount: number;
  initialDeadline?: Date;
  currentDeadline?: Date;
  autoExtensionEnabled: boolean;
  extensionDurationDays: number;
  maxExtensions: number;
  extensionsUsed: number;
  autoStartEnabled: boolean;
  status: ApplicationCollectionStatus;
}

export interface IJobDocument extends Document {
  title: string;
  company: {
    name: string;
    logo?: string;
    website?: string;
  };
  description: string;
  responsibilities: string[];
  requirements: string[];
  preferredQualifications: string[];
  skills: string[];
  experienceLevel: ExperienceLevel;
  minimumExperience: number;
  maximumExperience?: number;
  employmentType: EmploymentType;
  workplaceType: WorkplaceType;
  location: {
    city?: string;
    state?: string;
    country: string;
    remote: boolean;
  };
  salary: {
    min: number;
    max: number;
    currency: string;
    period: 'yearly' | 'monthly' | 'hourly';
  };
  educationRequirements?: string;
  benefits: string[];
  applicationUrl: string;
  source: string;
  status: JobStatus;
  publishedAt: Date;
  expiresAt?: Date;
  embedding?: number[];
  embeddingModel: string;
  embeddingVersion: string;
  embeddingStatus: EmbeddingStatus;
  // --- Recruiter-posted job fields (undefined for candidate-search/seeded jobs) ---
  postedBy?: Schema.Types.ObjectId;
  orgId?: Schema.Types.ObjectId;
  salaryText?: string;
  rounds?: string[];
  pipelineOptions?: {
    matchVolume: string | null;
    resumeMatch: boolean;
    resumeMatchTypes: string[];
    assessment: boolean;
    assessmentTypes: string[];
    aiInterview: boolean;
    aiInterviewTypes: string[];
    humanInterview?: boolean;
    humanInterviewTypes?: string[];
    roundOrder?: string[];
  };
  recruiterStage?: RecruiterJobStage;
  completedAt?: Date;
  creditsCost?: number;
  eligibilityMinPercent?: number;
  finalShortlistTarget?: number;
  applicationCollection?: IApplicationCollection;
  hiringEngineConfigId?: Types.ObjectId;
  hiringEngineEnabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const JobSchema = new Schema<IJobDocument>(
  {
    title: { type: String, required: true, trim: true, index: true },
    company: {
      name: { type: String, required: true, trim: true },
      logo: { type: String, default: '' },
      website: { type: String, default: '' },
    },
    description: { type: String, required: true },
    responsibilities: { type: [String], default: [] },
    requirements: { type: [String], default: [] },
    preferredQualifications: { type: [String], default: [] },
    skills: { type: [String], default: [], index: true },
    experienceLevel: {
      type: String,
      enum: ['internship', 'entry', 'junior', 'mid', 'senior', 'lead'],
      default: 'mid',
      index: true,
    },
    minimumExperience: { type: Number, default: 0, min: 0 },
    maximumExperience: { type: Number, default: 10, min: 0 },
    employmentType: {
      type: String,
      enum: ['full-time', 'part-time', 'contract', 'internship', 'freelance'],
      default: 'full-time',
      index: true,
    },
    workplaceType: {
      type: String,
      enum: ['remote', 'hybrid', 'onsite'],
      default: 'remote',
      index: true,
    },
    location: {
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      country: { type: String, default: 'India', index: true },
      remote: { type: Boolean, default: false },
    },
    salary: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      currency: { type: String, default: 'INR' },
      period: { type: String, enum: ['yearly', 'monthly', 'hourly'], default: 'yearly' },
    },
    educationRequirements: { type: String, default: "Bachelor's Degree in Computer Science or related field" },
    benefits: { type: [String], default: [] },
    applicationUrl: { type: String, default: '' },
    source: { type: String, default: 'seed' },
    status: {
      type: String,
      enum: ['active', 'closed', 'draft'],
      default: 'active',
      index: true,
    },
    publishedAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date },
    embedding: {
      type: [Number],
      default: undefined,
    },
    embeddingModel: { type: String, default: 'gemini-embedding-001' },
    embeddingVersion: { type: String, default: 'v1' },
    embeddingStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    postedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', index: true },
    salaryText: { type: String, default: '' },
    rounds: { type: [String], default: undefined },
    pipelineOptions: {
      matchVolume: { type: String, enum: ['1:10', '1:100', '1:1000'], default: null },
      resumeMatch: { type: Boolean, default: false },
      resumeMatchTypes: { type: [String], default: [] },
      assessment: { type: Boolean, default: false },
      assessmentTypes: { type: [String], default: [] },
      aiInterview: { type: Boolean, default: false },
      aiInterviewTypes: { type: [String], default: [] },
      humanInterview: { type: Boolean, default: false },
      humanInterviewTypes: { type: [String], default: [] },
      roundOrder: { type: [String], default: undefined },
    },
    recruiterStage: {
      type: String,
      enum: ['open', 'shortlisting', 'interview', 'review', 'completed'],
      default: undefined,
    },
    completedAt: { type: Date, default: undefined },
    creditsCost: { type: Number, default: undefined },
    eligibilityMinPercent: { type: Number, min: 0, max: 100 },
    finalShortlistTarget: { type: Number, min: 1, default: undefined },
    applicationCollection: {
      idealIntake: { type: Number, min: 1 },
      minimumIntake: { type: Number, min: 1 },
      actualQualifiedCount: { type: Number, default: 0, min: 0 },
      initialDeadline: { type: Date },
      currentDeadline: { type: Date },
      autoExtensionEnabled: { type: Boolean, default: true },
      extensionDurationDays: { type: Number, default: 3, min: 1 },
      maxExtensions: { type: Number, default: 2, min: 0 },
      extensionsUsed: { type: Number, default: 0, min: 0 },
      autoStartEnabled: { type: Boolean, default: false },
      status: {
        type: String,
        enum: ['collecting', 'ready', 'extended', 'started', 'insufficient', 'closed'],
        default: 'collecting',
        index: true,
      },
    },
    hiringEngineConfigId: { type: Schema.Types.ObjectId, ref: 'HiringFunnelConfig', default: undefined },
    hiringEngineEnabled: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound and search indexes
JobSchema.index({ status: 1, publishedAt: -1 });
JobSchema.index({ experienceLevel: 1, workplaceType: 1, status: 1 });
JobSchema.index({ 'location.country': 1, workplaceType: 1 });
JobSchema.index({ embeddingStatus: 1, status: 1 });
JobSchema.index(
  {
    title: 'text',
    description: 'text',
    skills: 'text',
    'company.name': 'text',
  },
  {
    weights: {
      title: 10,
      skills: 8,
      'company.name': 5,
      description: 1,
    },
    name: 'job_keyword_search_index',
  }
);

export const JobModel = model<IJobDocument>('Job', JobSchema);
