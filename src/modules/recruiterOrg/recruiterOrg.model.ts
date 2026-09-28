import { Schema, model, Document, Types } from 'mongoose';

export type EntityType = 'company' | 'institution' | 'startup';

export interface IFundraisingProfile {
  fundingStage?: 'idea' | 'pre-seed' | 'seed' | 'series-a' | 'series-b' | 'series-c+';
  fundraisingStatus?: 'active' | 'closed' | 'upcoming' | 'paused';
  targetAmount?: number;
  raisedAmount?: number;
  committedAmount?: number;
  minInvestment?: number;
  maxInvestment?: number;
  valuationCap?: number;
  previousFunding?: number;
  currency?: string;
  roundName?: string;
  closeDate?: string;
  instrument?: string;
  startupSlug?: string;
  revenue?: string;
  mrr?: number;
  arr?: number;
  growthRate?: string;
  customerCount?: number;
  traction?: string;
  businessModel?: string;
  targetMarket?: string;
  tam?: string;
  sam?: string;
  som?: string;
  competitiveAdvantage?: string;
  pitchDeckUrl?: string;
  activePitchDeckId?: string;
  foundersList?: Array<{
    name: string;
    role: string;
    linkedinUrl?: string;
    bio?: string;
  }>;
  preferences?: {
    preferredInvestorTypes?: string[];
    preferredGeographies?: string[];
    preferredSectors?: string[];
    preferredTicketSize?: string;
  };
}

export interface IRecruiterOrganizationDocument extends Document {
  ownerUserId: Types.ObjectId;
  entity: EntityType;
  name: string;
  address?: string;
  headquarters?: string;
  orgType?: string;
  employees?: string;
  valuation?: string;
  revenue?: string;
  ceoName?: string;
  ceoEmail?: string;
  phone?: string;
  industry?: string;
  founded?: string;
  website?: string;
  registrationId?: string;
  bio?: string;
  description?: string;
  whyJoinUs?: string;
  googleMapsUrl?: string;
  mapLocation?: {
    address?: string;
    lat?: number;
    lng?: number;
    placeId?: string;
  };
  // Startup Specific Fields
  founders?: string;
  foundingTheme?: string;
  sector?: string;
  productDetails?: string;
  productLink?: string;
  fundraiser?: string;
  fundraisingProfile?: IFundraisingProfile;
  // Institution Specific Fields (HTML Specification)
  mission?: string;
  vision?: string;
  values?: string;
  campusContext?: string;
  legalStatus?: string;
  governingBody?: string;
  executiveLeadership?: string;
  orgStructure?: string;
  academicPrograms?: string;
  academicCalendar?: string;
  gradingScale?: string;
  graduationRequirements?: string;
  totalEnrollment?: string;
  averageClassSize?: string;
  graduationRate?: string;
  placementRate?: string;
  internationalStudents?: string;
  scholarshipRecipients?: string;
  diversityInclusion?: string;
  testScores?: string;
  totalFaculty?: string;
  facultyAdvancedDegrees?: string;
  studentTeacherRatio?: string;
  supportStaffCount?: string;
  facultyExperience?: string;
  professionalDevelopment?: string;
  campusArea?: string;
  laboratories?: string;
  libraryResources?: string;
  artsRecreation?: string;
  itInfrastructure?: string;
  campusAccessibility?: string;
  accreditations?: string;
  awardsHonors?: string;
  membershipsAffiliations?: string;
  tuitionFeeSchedule?: string;
  financialAidAvailable?: string;
  endowmentBudget?: string;
  academicSupportServices?: string;
  wellnessSocialSupport?: string;
  extracurricularClubs?: string;
  transportationHousing?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RecruiterOrganizationSchema = new Schema<IRecruiterOrganizationDocument>(
  {
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    entity: { type: String, enum: ['company', 'institution', 'startup'], required: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, default: '' },
    headquarters: { type: String, default: '' },
    googleMapsUrl: { type: String, default: '' },
    mapLocation: {
      address: { type: String, default: '' },
      lat: { type: Number },
      lng: { type: Number },
      placeId: { type: String, default: '' },
    },
    orgType: { type: String, default: '' },
    employees: { type: String, default: '' },
    valuation: { type: String, default: '' },
    revenue: { type: String, default: '' },
    ceoName: { type: String, default: '' },
    ceoEmail: { type: String, default: '' },
    phone: { type: String, default: '' },
    industry: { type: String, default: '' },
    founded: { type: String, default: '' },
    website: { type: String, default: '' },
    registrationId: { type: String, default: '' },
    bio: { type: String, default: '' },
    description: { type: String, default: '' },
    whyJoinUs: { type: String, default: '' },
    // Startup Specific Fields
    founders: { type: String, default: '' },
    foundingTheme: { type: String, default: '' },
    sector: { type: String, default: '' },
    productDetails: { type: String, default: '' },
    productLink: { type: String, default: '' },
    fundraiser: { type: String, default: '' },
    fundraisingProfile: {
      fundingStage: { type: String, default: 'seed' },
      fundraisingStatus: { type: String, default: 'active' },
      targetAmount: { type: Number, default: 2000000 },
      raisedAmount: { type: Number, default: 750000 },
      committedAmount: { type: Number, default: 750000 },
      minInvestment: { type: Number, default: 50000 },
      maxInvestment: { type: Number, default: 1000000 },
      valuationCap: { type: Number, default: 12000000 },
      previousFunding: { type: Number, default: 250000 },
      currency: { type: String, default: '$' },
      roundName: { type: String, default: 'Seed Round' },
      closeDate: { type: String, default: 'Nov 30, 2026' },
      instrument: { type: String, default: 'Post-Money SAFE (with MFN)' },
      startupSlug: { type: String, default: '' },
      revenue: { type: String, default: '' },
      mrr: { type: Number, default: 0 },
      arr: { type: Number, default: 0 },
      growthRate: { type: String, default: '' },
      customerCount: { type: Number, default: 0 },
      traction: { type: String, default: '' },
      businessModel: { type: String, default: 'B2B SaaS' },
      targetMarket: { type: String, default: '' },
      tam: { type: String, default: '' },
      sam: { type: String, default: '' },
      som: { type: String, default: '' },
      competitiveAdvantage: { type: String, default: '' },
      pitchDeckUrl: { type: String, default: '' },
      activePitchDeckId: { type: String, default: '' },
      foundersList: [
        {
          name: { type: String, default: '' },
          role: { type: String, default: '' },
          linkedinUrl: { type: String, default: '' },
          bio: { type: String, default: '' },
        },
      ],
      preferences: {
        preferredInvestorTypes: [{ type: String }],
        preferredGeographies: [{ type: String }],
        preferredSectors: [{ type: String }],
        preferredTicketSize: { type: String, default: '' },
      },
    },
    // Institution Specific Fields
    mission: { type: String, default: '' },
    vision: { type: String, default: '' },
    values: { type: String, default: '' },
    campusContext: { type: String, default: '' },
    legalStatus: { type: String, default: '' },
    governingBody: { type: String, default: '' },
    executiveLeadership: { type: String, default: '' },
    orgStructure: { type: String, default: '' },
    academicPrograms: { type: String, default: '' },
    academicCalendar: { type: String, default: '' },
    gradingScale: { type: String, default: '' },
    graduationRequirements: { type: String, default: '' },
    totalEnrollment: { type: String, default: '' },
    averageClassSize: { type: String, default: '' },
    graduationRate: { type: String, default: '' },
    placementRate: { type: String, default: '' },
    internationalStudents: { type: String, default: '' },
    scholarshipRecipients: { type: String, default: '' },
    diversityInclusion: { type: String, default: '' },
    testScores: { type: String, default: '' },
    totalFaculty: { type: String, default: '' },
    facultyAdvancedDegrees: { type: String, default: '' },
    studentTeacherRatio: { type: String, default: '' },
    supportStaffCount: { type: String, default: '' },
    facultyExperience: { type: String, default: '' },
    professionalDevelopment: { type: String, default: '' },
    campusArea: { type: String, default: '' },
    laboratories: { type: String, default: '' },
    libraryResources: { type: String, default: '' },
    artsRecreation: { type: String, default: '' },
    itInfrastructure: { type: String, default: '' },
    campusAccessibility: { type: String, default: '' },
    accreditations: { type: String, default: '' },
    awardsHonors: { type: String, default: '' },
    membershipsAffiliations: { type: String, default: '' },
    tuitionFeeSchedule: { type: String, default: '' },
    financialAidAvailable: { type: String, default: '' },
    endowmentBudget: { type: String, default: '' },
    academicSupportServices: { type: String, default: '' },
    wellnessSocialSupport: { type: String, default: '' },
    extracurricularClubs: { type: String, default: '' },
    transportationHousing: { type: String, default: '' },
  },
  { timestamps: true }
);

export const RecruiterOrganizationModel = model<IRecruiterOrganizationDocument>(
  'RecruiterOrganization',
  RecruiterOrganizationSchema
);
