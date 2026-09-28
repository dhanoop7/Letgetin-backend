import { z } from 'zod';

const yesNoDescribeSchema = z.object({
  value: z.enum(['yes', 'no']).optional(),
  description: z.string().optional(),
});

export const upsertAiApplyPreferencesSchema = z.object({
  body: z.object({
    // Step 1
    currentStatus: z
      .enum(['employed_happy', 'unemployed', 'urgently_looking', 'employed_switching', 'employed_higher_opportunities'])
      .optional(),

    // Step 2
    desiredJobTitles: z.array(z.string()).optional(),

    // Step 3
    resumeId: z.string().optional(),
    resumePriority: z.number().optional(),
    coverLetterId: z.string().optional(),
    coverLetterPriority: z.number().optional(),

    // Step 4
    salaryMin: z.number().optional(),
    salaryMax: z.number().optional(),
    salaryCurrency: z.string().optional(),
    preferredCountry: z.string().optional(),
    preferredState: z.string().optional(),
    preferredLocation: z.string().optional(),
    willingToRelocate: z.enum(['yes', 'no']).optional(),
    industries: z.array(z.string()).optional(),
    employmentType: z.enum(['all', 'full-time', 'part-time', 'contract-freelance']).optional(),
    joiningDate: z.string().optional(),

    // Step 5 - candidate-entered only
    hasDisabilityOrChronicCondition: yesNoDescribeSchema.optional(),
    hasMedicalConditionNeedsAttention: yesNoDescribeSchema.optional(),
    okWithShiftJobs: z.enum(['yes', 'no']).optional(),
    hasAllergies: yesNoDescribeSchema.optional(),

    // Step 6
    contactChannels: z.array(z.enum(['email', 'mobile', 'inbox', 'linkedin'])).optional(),
    contactTiming: z.enum(['morning', 'noon', 'evening', 'night']).optional(),
  }),
});
