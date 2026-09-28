import { z } from 'zod';

export const getOrgFormMetaSchema = z.object({
  query: z.object({
    entity: z.enum(['company', 'institution', 'startup']),
  }),
});

export const saveOrgProfileSchema = z.object({
  body: z.object({
    entity: z.enum(['company', 'institution', 'startup'], { message: 'A valid entity type is required' }),
    name: z.string().min(1, 'Name is required').trim(),
    address: z.string().optional(),
    headquarters: z.string().optional(),
    orgType: z.string().optional(),
    employees: z.string().optional(),
    valuation: z.string().optional(),
    revenue: z.string().optional(),
    ceoName: z.string().optional(),
    ceoEmail: z.string().email('Invalid email address').optional().or(z.literal('')),
    phone: z.string().optional(),
    industry: z.string().optional(),
    founded: z.string().optional(),
    website: z.string().optional(),
    registrationId: z.string().optional(),
    bio: z.string().optional(),
    description: z.string().optional(),
    whyJoinUs: z.string().optional(),
    googleMapsUrl: z.string().optional(),
    mapLocation: z
      .object({
        address: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        placeId: z.string().optional(),
      })
      .optional(),
    // Startup Specific Fields
    founders: z.string().optional(),
    foundingTheme: z.string().optional(),
    sector: z.string().optional(),
    productDetails: z.string().optional(),
    productLink: z.string().optional(),
    fundraiser: z.string().optional(),
    // Institution Specific Fields
    mission: z.string().optional(),
    vision: z.string().optional(),
    values: z.string().optional(),
    campusContext: z.string().optional(),
    legalStatus: z.string().optional(),
    governingBody: z.string().optional(),
    executiveLeadership: z.string().optional(),
    orgStructure: z.string().optional(),
    academicPrograms: z.string().optional(),
    academicCalendar: z.string().optional(),
    gradingScale: z.string().optional(),
    graduationRequirements: z.string().optional(),
    totalEnrollment: z.string().optional(),
    averageClassSize: z.string().optional(),
    graduationRate: z.string().optional(),
    placementRate: z.string().optional(),
    internationalStudents: z.string().optional(),
    scholarshipRecipients: z.string().optional(),
    diversityInclusion: z.string().optional(),
    testScores: z.string().optional(),
    totalFaculty: z.string().optional(),
    facultyAdvancedDegrees: z.string().optional(),
    studentTeacherRatio: z.string().optional(),
    supportStaffCount: z.string().optional(),
    facultyExperience: z.string().optional(),
    professionalDevelopment: z.string().optional(),
    campusArea: z.string().optional(),
    laboratories: z.string().optional(),
    libraryResources: z.string().optional(),
    artsRecreation: z.string().optional(),
    itInfrastructure: z.string().optional(),
    campusAccessibility: z.string().optional(),
    accreditations: z.string().optional(),
    awardsHonors: z.string().optional(),
    membershipsAffiliations: z.string().optional(),
    tuitionFeeSchedule: z.string().optional(),
    financialAidAvailable: z.string().optional(),
    endowmentBudget: z.string().optional(),
    academicSupportServices: z.string().optional(),
    wellnessSocialSupport: z.string().optional(),
    extracurricularClubs: z.string().optional(),
    transportationHousing: z.string().optional(),
  }),
});

export const autofillOrgProfileSchema = z.object({
  body: z.object({
    url: z
      .string()
      .url('Please enter a valid website URL.')
      .refine((val) => /^https?:\/\//i.test(val), 'Please enter a valid website URL.'),
    entity: z.enum(['company', 'institution', 'startup'], { message: 'A valid entity type is required' }),
  }),
});

export type GetOrgFormMetaInput = z.infer<typeof getOrgFormMetaSchema>['query'];
export type SaveOrgProfileInput = z.infer<typeof saveOrgProfileSchema>['body'];
export type AutofillOrgProfileInput = z.infer<typeof autofillOrgProfileSchema>['body'];
