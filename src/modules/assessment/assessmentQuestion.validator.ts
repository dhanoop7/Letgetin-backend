import { z } from 'zod';

export const generalAssessmentQuestionTypeSchema = z.enum([
  'mcq',
  'short_answer',
  'scenario',
]);

export const mcqOptionInputSchema = z.object({
  id: z.string().trim().min(1, 'Option ID cannot be empty'),
  text: z.string().trim().min(1, 'Option text cannot be empty'),
});

const baseQuestionFields = {
  instructions: z.string().trim().optional(),
  points: z.number().min(1, 'Points must be at least 1').default(1),
  required: z.boolean().optional().default(true),
  order: z.number().int().min(1).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional().default('draft'),
  source: z.enum(['manual', 'ai_generated']).optional().default('manual'),
  metadata: z.record(z.unknown()).optional(),
};

export const createMcqQuestionSchema = z.object({
  type: z.literal('mcq'),
  question: z.string().trim().min(1, 'Question text cannot be empty'),
  options: z
    .array(mcqOptionInputSchema)
    .min(2, 'Multiple choice questions must have at least 2 options'),
  correctOptionId: z.string().trim().min(1, 'Correct option ID is required'),
  ...baseQuestionFields,
});

export const createShortAnswerQuestionSchema = z.object({
  type: z.literal('short_answer'),
  question: z.string().trim().min(1, 'Question text cannot be empty'),
  expectedAnswer: z.string().trim().optional(),
  evaluationCriteria: z.array(z.string().trim().min(1)).optional(),
  ...baseQuestionFields,
});

export const createScenarioQuestionSchema = z.object({
  type: z.literal('scenario'),
  question: z.string().trim().min(1, 'Question text cannot be empty'),
  context: z.string().trim().optional(),
  evaluationCriteria: z.array(z.string().trim().min(1)).optional(),
  ...baseQuestionFields,
});

export const createQuestionSchema = z
  .discriminatedUnion('type', [
    createMcqQuestionSchema,
    createShortAnswerQuestionSchema,
    createScenarioQuestionSchema,
  ])
  .superRefine((data, ctx) => {
    if (data.type === 'mcq') {
      const seenIds = new Set<string>();
      let hasDuplicate = false;

      for (const opt of data.options) {
        if (seenIds.has(opt.id)) {
          hasDuplicate = true;
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate option ID "${opt.id}" in MCQ options`,
            path: ['options'],
          });
        }
        seenIds.add(opt.id);
      }

      if (!hasDuplicate && !seenIds.has(data.correctOptionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `correctOptionId "${data.correctOptionId}" does not match any of the provided option IDs`,
          path: ['correctOptionId'],
        });
      }
    }
  });

export const updateQuestionSchema = z
  .object({
    question: z.string().trim().min(1, 'Question text cannot be empty').optional(),
    instructions: z.string().trim().optional(),
    points: z.number().min(1, 'Points must be at least 1').optional(),
    required: z.boolean().optional(),
    order: z.number().int().min(1).optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    options: z.array(mcqOptionInputSchema).min(2).optional(),
    correctOptionId: z.string().trim().min(1).optional(),
    expectedAnswer: z.string().trim().optional(),
    context: z.string().trim().optional(),
    evaluationCriteria: z.array(z.string().trim().min(1)).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.options && data.options.length > 0) {
      const seenIds = new Set<string>();
      for (const opt of data.options) {
        if (seenIds.has(opt.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate option ID "${opt.id}" in MCQ options`,
            path: ['options'],
          });
        }
        seenIds.add(opt.id);
      }
      if (data.correctOptionId && !seenIds.has(data.correctOptionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `correctOptionId "${data.correctOptionId}" does not match any of the provided option IDs`,
          path: ['correctOptionId'],
        });
      }
    }
  });

export const reorderQuestionsSchema = z.object({
  questionIds: z
    .array(z.string().trim().min(1, 'Question ID cannot be empty'))
    .min(1, 'At least one question ID is required to reorder'),
});

// Route-level schemas for Express middleware
export const createQuestionRouteSchema = z.object({
  params: z.object({
    jobId: z.string().min(1, 'Job ID is required'),
    roundId: z.string().min(1, 'Round ID is required'),
  }),
  body: createQuestionSchema,
});

export const updateQuestionRouteSchema = z.object({
  params: z.object({
    jobId: z.string().min(1, 'Job ID is required'),
    roundId: z.string().min(1, 'Round ID is required'),
    questionId: z.string().min(1, 'Question ID is required'),
  }),
  body: updateQuestionSchema,
});

export const reorderQuestionsRouteSchema = z.object({
  params: z.object({
    jobId: z.string().min(1, 'Job ID is required'),
    roundId: z.string().min(1, 'Round ID is required'),
  }),
  body: reorderQuestionsSchema,
});

export const assessmentParamsRouteSchema = z.object({
  params: z.object({
    jobId: z.string().min(1, 'Job ID is required'),
    roundId: z.string().min(1, 'Round ID is required'),
    questionId: z.string().optional(),
  }),
});

export type CreateQuestionInput = z.input<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.input<typeof updateQuestionSchema>;
export type ReorderQuestionsInput = z.input<typeof reorderQuestionsSchema>;
