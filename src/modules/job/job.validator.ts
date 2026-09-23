import { z } from 'zod';

const educationLevelSchema = z.enum([
  'none',
  'high_school',
  'associate',
  'diploma',
  'bachelor',
  'master',
  'doctorate',
  'other',
  'None',
  'HighSchool',
  'Associate',
  'Diploma',
  'Bachelor',
  'Master',
  'Doctorate',
  'Other',
]);

export const structuredRequirementsSchema = z
  .object({
    requiredSkills: z.array(z.string()).optional(),
    preferredSkills: z.array(z.string()).optional(),
    minimumExperienceYears: z.number().min(0, 'Minimum experience must be non-negative').optional(),
    maximumExperienceYears: z.number().min(0, 'Maximum experience must be non-negative').optional(),
    education: z
      .object({
        minimumLevel: educationLevelSchema.optional(),
        fields: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .refine(
    (data) => {
      if (
        typeof data.minimumExperienceYears === 'number' &&
        typeof data.maximumExperienceYears === 'number'
      ) {
        return data.maximumExperienceYears >= data.minimumExperienceYears;
      }
      return true;
    },
    {
      message: 'Maximum experience must be greater than or equal to minimum experience',
      path: ['maximumExperienceYears'],
    }
  );

export const createJobSchema = z.object({
  body: z
    .object({
      title: z.string().min(1, 'Job title is required'),
      companyName: z.string().optional(),
      location: z.string().optional(),
      employmentType: z.enum(['full-time', 'part-time', 'contract', 'internship', 'freelance']).optional(),
      workplaceType: z.enum(['remote', 'hybrid', 'onsite']).optional(),
      salaryText: z.string().optional(),
      skills: z.array(z.string()).optional(),
      description: z.string().optional(),
      responsibilities: z.array(z.string()).optional(),
      requirements: z.array(z.string()).optional(),
      structuredRequirements: structuredRequirementsSchema.optional(),
      minimumExperience: z.number().min(0).optional(),
      maximumExperience: z.number().min(0).optional(),
      eligibilityMinPercent: z.number().min(0).max(100).optional(),
      deadline: z.string().optional(),
      saveAsDraft: z.boolean().optional().default(false),
      finalShortlistTarget: z.number().int().min(1).max(500).optional(),
      idealIntake: z.number().int().min(1).optional(),
      minimumIntake: z.number().int().min(1).optional(),
      collectionDurationDays: z.number().int().min(1).optional(),
      autoExtensionEnabled: z.boolean().optional(),
      extensionDurationDays: z.number().int().min(1).optional(),
      maxExtensions: z.number().int().min(0).optional(),
      autoStartEnabled: z.boolean().optional(),
      rounds: z.array(z.string()).optional(),
      stages: z.array(z.any()).optional(),
      pipelineOptions: z
        .object({
          matchVolume: z.enum(['1:10', '1:100', '1:1000']).nullable().optional(),
          resumeMatch: z.boolean().default(false),
          resumeMatchTypes: z.array(z.string()).optional(),
          assessment: z.boolean().default(false),
          assessmentTypes: z.array(z.string()).optional(),
          aiInterview: z.boolean().default(false),
          aiInterviewTypes: z.array(z.string()).optional(),
          humanInterview: z.boolean().default(false),
          humanInterviewTypes: z.array(z.string()).optional(),
          roundOrder: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .refine(
      (data) => {
        if (typeof data.minimumExperience === 'number' && typeof data.maximumExperience === 'number') {
          return data.maximumExperience >= data.minimumExperience;
        }
        return true;
      },
      {
        message: 'Maximum experience must be greater than or equal to minimum experience',
        path: ['maximumExperience'],
      }
    ),
});

export const generateJobContentSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'A job title is required to generate content.'),
    employmentType: z.enum(['full-time', 'part-time', 'contract', 'internship', 'freelance']).optional(),
    workplaceType: z.enum(['remote', 'hybrid', 'onsite']).optional(),
    location: z.string().optional(),
  }),
});

export const updateJobStageSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    stage: z.enum(['open', 'shortlisting', 'interview', 'review', 'completed']),
  }),
});
