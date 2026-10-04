import { z } from 'zod';

export const generateAssessmentSchema = z.object({
  body: z.object({
    assessmentType: z.string().min(1, 'assessmentType is required'),
    interactionMode: z.enum(['text', 'audio', 'video']).default('text'),
    jobDescription: z.string().min(1, 'jobDescription is required'),
  }),
});

export const evaluateAssessmentAnswerSchema = z.object({
  body: z.object({
    question: z.string().min(1, 'Question text is required'),
    answer: z.string().min(1, 'Candidate answer is required'),
    category: z.string().optional(),
    assessmentType: z.string().optional(),
    expectedAnswer: z.string().optional(),
    jobDescription: z.string().optional(),
    interactionMode: z.enum(['text', 'audio', 'video']).optional(),
  }),
});
