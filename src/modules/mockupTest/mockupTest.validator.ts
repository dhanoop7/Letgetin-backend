import { z } from 'zod';

export const generateTestSchema = z.object({
  body: z.object({
    testType: z.enum(['aptitude', 'technical']).optional(),
    assessmentType: z.string().optional(),
    interactionMode: z.enum(['text', 'audio', 'video']).optional(),
    jobDescription: z.string().max(10000).optional(),
    mode: z.enum(['objective', 'rapid', 'descriptive', 'quick5m']).optional(),
  }),
});

export const createSessionSchema = z.object({
  body: z.object({
    testType: z.enum(['aptitude', 'technical']).optional(),
    assessmentType: z.string().optional(),
    interactionMode: z.enum(['text', 'audio', 'video']).optional(),
    mode: z.enum(['objective', 'rapid', 'descriptive', 'quick5m']).optional(),
    jobDescription: z.string().max(10000).optional(),
  }),
});

export const submitSessionSchema = z.object({
  body: z.object({
    answers: z.array(
      z.object({
        questionId: z.string(),
        selectedOption: z.number().optional(),
        selectedAnswer: z.string().optional(),
        textAnswer: z.string().optional(),
        timeSpentSeconds: z.number().optional(),
      })
    ),
    durationSeconds: z.number().optional(),
  }),
});

export const evaluateDescriptiveSchema = z.object({
  body: z.object({
    question: z.string().min(3),
    answer: z.string().min(5),
    category: z.string().optional(),
    testType: z.enum(['aptitude', 'technical']).optional(),
    jobDescription: z.string().optional(),
  }),
});

export const generateAssessmentSchema = z.object({
  body: z.object({
    assessmentType: z.string().min(1),
    interactionMode: z.enum(['text', 'audio', 'video']).default('text'),
    jobDescription: z.string().min(5).max(10000),
  }),
});

export const evaluateAssessmentAnswerSchema = z.object({
  body: z.object({
    question: z.string().min(3),
    answer: z.string().min(1),
    category: z.string().optional(),
    assessmentType: z.string().optional(),
    expectedAnswer: z.string().optional(),
    jobDescription: z.string().optional(),
    interactionMode: z.enum(['text', 'audio', 'video']).optional(),
  }),
});
