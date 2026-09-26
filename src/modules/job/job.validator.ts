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

export const skillProficiencySchema = z.enum([
  'beginner',
  'intermediate',
  'advanced',
  'expert',
]);

export const jobSkillRequirementSchema = z.object({
  name: z.string().trim().min(1, 'Skill name cannot be empty'),
  proficiency: skillProficiencySchema.optional().default('intermediate'),
});

export const skillItemInputSchema = z.union([
  z.string().trim().min(1, 'Skill name cannot be empty'),
  jobSkillRequirementSchema,
]);

export const structuredRequirementsSchema = z
  .object({
    requiredSkills: z.array(skillItemInputSchema).optional(),
    preferredSkills: z.array(skillItemInputSchema).optional(),
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

export const assessmentRoundTypeSchema = z.enum([
  'general',
  'coding',
]);

export const generalAssessmentQuestionTypeSchema = z.enum([
  'mcq',
  'short_answer',
  'scenario',
]);

export const generalAssessmentConfigSchema = z
  .object({
    questionTypes: z
      .array(generalAssessmentQuestionTypeSchema)
      .min(1, 'At least one question type is required for General Assessment'),
    mcq: z
      .object({
        questionCount: z.number().int().min(1, 'MCQ question count must be at least 1').optional(),
        difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'mixed']).optional(),
      })
      .passthrough()
      .optional(),
    shortAnswer: z
      .object({
        questionCount: z.number().int().min(1, 'Short Answer question count must be at least 1').optional(),
      })
      .passthrough()
      .optional(),
    scenario: z
      .object({
        questionCount: z.number().int().min(1, 'Scenario question count must be at least 1').optional(),
      })
      .passthrough()
      .optional(),
    durationMinutes: z.number().int().min(1, 'Duration must be at least 1 minute').max(480, 'Duration cannot exceed 480 minutes').optional(),
    passingScore: z.number().min(0, 'Passing score must be between 0 and 100').max(100, 'Passing score must be between 0 and 100').optional(),
  })
  .passthrough()
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    for (const qt of cfg.questionTypes) {
      if (seen.has(qt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate question type "${qt}" in General Assessment`,
          path: ['questionTypes'],
        });
      }
      seen.add(qt);
    }
  });

export const assessmentRoundSchema = z
  .object({
    id: z.string().trim().optional(),
    type: assessmentRoundTypeSchema,
    order: z.number().int().min(1).optional(),
    name: z.string().trim().optional(),
    enabled: z.boolean().optional().default(true),
    config: z.record(z.unknown()).optional(),
  })
  .superRefine((round, ctx) => {
    if (round.type === 'general' && round.enabled !== false) {
      if (!round.config || !round.config.questionTypes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'At least one question type must be selected for General Assessment',
          path: ['config', 'questionTypes'],
        });
        return;
      }
      const rawTypes = round.config.questionTypes;
      if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'At least one question type must be selected for General Assessment',
          path: ['config', 'questionTypes'],
        });
        return;
      }

      const seenTypes = new Set<string>();
      for (const qt of rawTypes) {
        if (qt === 'coding') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Coding cannot be a question type inside General Assessment. Coding Assessment must be configured as a separate round.',
            path: ['config', 'questionTypes'],
          });
        } else if (!['mcq', 'short_answer', 'scenario'].includes(qt as string)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid question type "${qt}" for General Assessment`,
            path: ['config', 'questionTypes'],
          });
        } else if (seenTypes.has(qt as string)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate question type "${qt}" in General Assessment`,
            path: ['config', 'questionTypes'],
          });
        }
        seenTypes.add(qt as string);
      }

      // Validate question counts if provided
      const configObj = round.config as any;
      if (seenTypes.has('mcq') && configObj.mcq) {
        if (typeof configObj.mcq.questionCount !== 'undefined') {
          if (!Number.isInteger(configObj.mcq.questionCount) || configObj.mcq.questionCount < 1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'MCQ question count must be an integer >= 1',
              path: ['config', 'mcq', 'questionCount'],
            });
          }
        }
      }
      if (seenTypes.has('short_answer') && configObj.shortAnswer) {
        if (typeof configObj.shortAnswer.questionCount !== 'undefined') {
          if (!Number.isInteger(configObj.shortAnswer.questionCount) || configObj.shortAnswer.questionCount < 1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Short Answer question count must be an integer >= 1',
              path: ['config', 'shortAnswer', 'questionCount'],
            });
          }
        }
      }
      if (seenTypes.has('scenario') && configObj.scenario) {
        if (typeof configObj.scenario.questionCount !== 'undefined') {
          if (!Number.isInteger(configObj.scenario.questionCount) || configObj.scenario.questionCount < 1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Scenario question count must be an integer >= 1',
              path: ['config', 'scenario', 'questionCount'],
            });
          }
        }
      }

      // Validate durationMinutes if provided
      if (typeof configObj.durationMinutes !== 'undefined') {
        if (!Number.isInteger(configObj.durationMinutes) || configObj.durationMinutes < 1 || configObj.durationMinutes > 480) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'durationMinutes must be an integer between 1 and 480',
            path: ['config', 'durationMinutes'],
          });
        }
      }

      // Validate passingScore if provided
      if (typeof configObj.passingScore !== 'undefined') {
        if (typeof configObj.passingScore !== 'number' || isNaN(configObj.passingScore) || configObj.passingScore < 0 || configObj.passingScore > 100) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'passingScore must be a number between 0 and 100',
            path: ['config', 'passingScore'],
          });
        }
      }
    }
  });

export const jobAssessmentConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    rounds: z.array(assessmentRoundSchema).optional().default([]),
  })
  .refine(
    (data) => {
      if (data.enabled) {
        const enabledRounds = data.rounds.filter((r) => r.enabled !== false);
        return enabledRounds.length > 0;
      }
      return true;
    },
    {
      message: 'At least one assessment round is required when assessment is enabled.',
      path: ['rounds'],
    }
  )
  .refine(
    (data) => {
      if (data.enabled && data.rounds.length > 0) {
        const types = data.rounds.filter((r) => r.enabled !== false).map((r) => r.type);
        const uniqueTypes = new Set(types);
        return uniqueTypes.size === types.length;
      }
      return true;
    },
    {
      message: 'Duplicate assessment types are not allowed for the same job.',
      path: ['rounds'],
    }
  )
  .refine(
    (data) => {
      if (data.enabled && data.rounds.length > 0) {
        const ids = data.rounds
          .filter((r) => r.enabled !== false && typeof r.id === 'string' && r.id.trim() !== '')
          .map((r) => r.id!.trim());
        const uniqueIds = new Set(ids);
        return uniqueIds.size === ids.length;
      }
      return true;
    },
    {
      message: 'Assessment round IDs must be unique.',
      path: ['rounds'],
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
      skills: z.array(skillItemInputSchema).optional(),
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
      assessment: jobAssessmentConfigSchema.optional(),
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
