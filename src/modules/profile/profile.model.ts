import mongoose, { Schema, Document } from 'mongoose';

export type Track = 'fresher' | 'experienced';
export type Mode = 'resume' | 'manual';

export interface IEducationItem {
  id: string;
  institution: string;
  degree: string;
  startYear: string;
  endYear: string;
  certificateUrl?: string;
}

export interface IExperienceItem {
  id: string;
  company: string;
  title: string;
  start: string;
  end: string;
  highlights: string;
}

export interface IUserProfileDocument extends Document {
  userId: mongoose.Types.ObjectId;
  track: Track | null;
  mode: Mode | null;
  resumeName: string | null;
  videoName: string | null;
  contact: {
    fullName: string;
    phone: string;
    city: string;
    country: string;
    linkedin: string;
    email?: string;
    alternateEmail?: string;
    resumeEmail?: string;
    alternateEmailVerified?: boolean;
    resumeEmailVerified?: boolean;
    streetAddress?: string;
    state?: string;
    postalCode?: string;
  };
  personal: {
    firstName: string;
    lastName: string;
    headline: string;
    dob: string;
    bio: string;
  };
  education: {
    institution: string;
    degree: string;
    startYear: string;
    endYear: string;
    certificateUrl?: string;
  };
  educationsList: IEducationItem[];
  experience: {
    company: string;
    title: string;
    start: string;
    end: string;
    highlights: string;
  };
  experiencesList: IExperienceItem[];
  skills: string[];
  academicPercentage?: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const EducationItemSchema = new Schema<IEducationItem>(
  {
    id: { type: String, required: true },
    institution: { type: String, default: '' },
    degree: { type: String, default: '' },
    startYear: { type: String, default: '' },
    endYear: { type: String, default: '' },
    certificateUrl: { type: String, default: '' },
  },
  { _id: false }
);

const ExperienceItemSchema = new Schema<IExperienceItem>(
  {
    id: { type: String, required: true },
    company: { type: String, default: '' },
    title: { type: String, default: '' },
    start: { type: String, default: '' },
    end: { type: String, default: '' },
    highlights: { type: String, default: '' },
  },
  { _id: false }
);

const UserProfileSchema = new Schema<IUserProfileDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    track: {
      type: String,
      enum: ['fresher', 'experienced', null],
      default: 'experienced',
    },
    mode: {
      type: String,
      enum: ['resume', 'manual', null],
      default: 'manual',
    },
    resumeName: { type: String, default: null },
    videoName: { type: String, default: null },
    contact: {
      fullName: { type: String, default: '' },
      phone: { type: String, default: '' },
      city: { type: String, default: '' },
      country: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      email: { type: String, default: '' },
      alternateEmail: { type: String, default: '' },
      resumeEmail: { type: String, default: '' },
      alternateEmailVerified: { type: Boolean, default: false },
      resumeEmailVerified: { type: Boolean, default: false },
      streetAddress: { type: String, default: '' },
      state: { type: String, default: '' },
      postalCode: { type: String, default: '' },
    },
    personal: {
      firstName: { type: String, default: '' },
      lastName: { type: String, default: '' },
      headline: { type: String, default: '' },
      dob: { type: String, default: '' },
      bio: { type: String, default: '' },
    },
    education: {
      institution: { type: String, default: '' },
      degree: { type: String, default: '' },
      startYear: { type: String, default: '' },
      endYear: { type: String, default: '' },
      certificateUrl: { type: String, default: '' },
    },
    educationsList: {
      type: [EducationItemSchema],
      default: [],
    },
    experience: {
      company: { type: String, default: '' },
      title: { type: String, default: '' },
      start: { type: String, default: '' },
      end: { type: String, default: '' },
      highlights: { type: String, default: '' },
    },
    experiencesList: {
      type: [ExperienceItemSchema],
      default: [],
    },
    skills: {
      type: [String],
      default: [],
    },
    academicPercentage: {
      type: Number,
      min: 0,
      max: 100,
    },
    version: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

export const UserProfileModel = mongoose.model<IUserProfileDocument>(
  'UserProfile',
  UserProfileSchema
);
