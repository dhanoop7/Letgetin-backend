import { Schema, model, Document, Types } from 'mongoose';

export type InvestorType =
  | 'Angel'
  | 'Venture Capital'
  | 'Family Office'
  | 'Corporate VC'
  | 'Accelerator'
  | 'Incubator';

export interface IInvestorDocument extends Document {
  name: string;
  firm: string;
  type: InvestorType;
  website: string;
  location: string;
  countries: string[];
  sectors: string[];
  stages: string[];
  minTicket: number;
  maxTicket: number;
  typicalTicket: string;
  thesis: string;
  description: string;
  portfolioCompanies: string[];
  contactPerson: {
    name: string;
    role: string;
    email?: string;
    linkedinUrl?: string;
  };
  status: 'active' | 'inactive';
  source: 'verified_directory' | 'user_added' | 'admin';
  isSystem: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const InvestorSchema = new Schema<IInvestorDocument>(
  {
    name: { type: String, required: true, trim: true, index: true },
    firm: { type: String, required: true, trim: true, index: true },
    type: {
      type: String,
      enum: ['Angel', 'Venture Capital', 'Family Office', 'Corporate VC', 'Accelerator', 'Incubator'],
      default: 'Venture Capital',
      index: true,
    },
    website: { type: String, default: '' },
    location: { type: String, default: '', index: true },
    countries: [{ type: String }],
    sectors: [{ type: String, index: true }],
    stages: [{ type: String, index: true }],
    minTicket: { type: Number, default: 50000 },
    maxTicket: { type: Number, default: 2000000 },
    typicalTicket: { type: String, default: '$500k - $2M' },
    thesis: { type: String, default: '' },
    description: { type: String, default: '' },
    portfolioCompanies: [{ type: String }],
    contactPerson: {
      name: { type: String, default: '' },
      role: { type: String, default: '' },
      email: { type: String, default: '' },
      linkedinUrl: { type: String, default: '' },
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    source: {
      type: String,
      enum: ['verified_directory', 'user_added', 'admin'],
      default: 'verified_directory',
    },
    isSystem: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

InvestorSchema.index({ name: 'text', firm: 'text', thesis: 'text', description: 'text' });

export const InvestorModel = model<IInvestorDocument>('Investor', InvestorSchema);

// ==========================================
// Deal / Pipeline Model
// ==========================================

export type FundraisingDealStage =
  | 'prospect'
  | 'contacted'
  | 'engaged'
  | 'meeting'
  | 'diligence'
  | 'termsheet'
  | 'passed';

export interface IDealActivity {
  id: string;
  date: string;
  type: 'note' | 'email' | 'meeting' | 'call' | 'stage_change' | 'data_room';
  note: string;
  author: string;
}

export interface IInvestorDealDocument extends Document {
  startupOrgId: Types.ObjectId;
  ownerUserId: Types.ObjectId;
  investorId?: Types.ObjectId;
  fundName: string;
  fundLogoText: string;
  tier: 'Tier 1 VC' | 'Growth VC' | 'Angel Syndicate' | 'Family Office' | 'Micro VC';
  leadPartner: string;
  partnerRole: string;
  partnerEmail: string;
  linkedinUrl?: string;
  stage: FundraisingDealStage;
  checkSize: number;
  checkSizeText: string;
  focusTags: string[];
  lastTouch: string;
  lastTouchType: 'email' | 'meeting' | 'deck_view' | 'call' | 'data_room';
  deckViewsCount: number;
  timeSpentOnDeck: string;
  notes: string;
  followUpDate?: string;
  probability: number;
  recentDeal: string;
  activities: IDealActivity[];
  createdAt: Date;
  updatedAt: Date;
}

const InvestorDealSchema = new Schema<IInvestorDealDocument>(
  {
    startupOrgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', required: true, index: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    investorId: { type: Schema.Types.ObjectId, ref: 'Investor' },
    fundName: { type: String, required: true, trim: true },
    fundLogoText: { type: String, default: 'VC' },
    tier: {
      type: String,
      enum: ['Tier 1 VC', 'Growth VC', 'Angel Syndicate', 'Family Office', 'Micro VC'],
      default: 'Tier 1 VC',
    },
    leadPartner: { type: String, default: '' },
    partnerRole: { type: String, default: 'Partner' },
    partnerEmail: { type: String, default: '' },
    linkedinUrl: { type: String, default: '' },
    stage: {
      type: String,
      enum: ['prospect', 'contacted', 'engaged', 'meeting', 'diligence', 'termsheet', 'passed'],
      default: 'prospect',
      index: true,
    },
    checkSize: { type: Number, default: 500000 },
    checkSizeText: { type: String, default: '$500,000' },
    focusTags: [{ type: String }],
    lastTouch: { type: String, default: 'Just added' },
    lastTouchType: {
      type: String,
      enum: ['email', 'meeting', 'deck_view', 'call', 'data_room'],
      default: 'email',
    },
    deckViewsCount: { type: Number, default: 0 },
    timeSpentOnDeck: { type: String, default: '0m' },
    notes: { type: String, default: '' },
    followUpDate: { type: String, default: '' },
    probability: { type: Number, default: 10, min: 0, max: 100 },
    recentDeal: { type: String, default: '' },
    activities: [
      {
        id: { type: String, required: true },
        date: { type: String, required: true },
        type: {
          type: String,
          enum: ['note', 'email', 'meeting', 'call', 'stage_change', 'data_room'],
          default: 'note',
        },
        note: { type: String, required: true },
        author: { type: String, default: 'Founder' },
      },
    ],
  },
  { timestamps: true }
);

InvestorDealSchema.index({ startupOrgId: 1, stage: 1 });
InvestorDealSchema.index({ ownerUserId: 1, createdAt: -1 });

export const InvestorDealModel = model<IInvestorDealDocument>('InvestorDeal', InvestorDealSchema);

// ==========================================
// Ecosystem Tracker Model
// ==========================================

export interface IEcosystemApplicationDocument extends Document {
  startupOrgId: Types.ObjectId;
  ownerUserId: Types.ObjectId;
  programType: 'accelerator' | 'incubator' | 'grant' | 'govt_scheme';
  programName: string;
  status: 'Not Started' | 'Considering' | 'Applied' | 'Interview' | 'Accepted' | 'Rejected';
  notes: string;
  appliedAt?: Date;
  deadline?: string;
  link?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EcosystemApplicationSchema = new Schema<IEcosystemApplicationDocument>(
  {
    startupOrgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', required: true, index: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    programType: {
      type: String,
      enum: ['accelerator', 'incubator', 'grant', 'govt_scheme'],
      required: true,
      index: true,
    },
    programName: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['Not Started', 'Considering', 'Applied', 'Interview', 'Accepted', 'Rejected'],
      default: 'Considering',
    },
    notes: { type: String, default: '' },
    appliedAt: { type: Date },
    deadline: { type: String, default: '' },
    link: { type: String, default: '' },
  },
  { timestamps: true }
);

EcosystemApplicationSchema.index({ startupOrgId: 1, programType: 1 });

export const EcosystemApplicationModel = model<IEcosystemApplicationDocument>(
  'EcosystemApplication',
  EcosystemApplicationSchema
);
