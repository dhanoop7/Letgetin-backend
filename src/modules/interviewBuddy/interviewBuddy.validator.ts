import { z } from 'zod';

export const generateBuddyQuestionsSchema = z.object({
  body: z.object({
    mode: z.string().min(1, 'Interview mode is required'),
    jobDescription: z.string().optional(),
    customConfig: z
      .object({
        role: z.string().optional(),
        seniority: z.string().optional(),
        scenario: z.string().optional(),
        interviewStyle: z.string().optional(),
        technicalScope: z.string().optional(),
      })
      .optional(),
  }),
});

export const evaluateBuddyAnswerSchema = z.object({
  body: z.object({
    question: z.string().min(1, 'Question text is required'),
    answer: z.string().min(1, 'Candidate answer is required'),
    category: z.string().optional(),
    mode: z.string().optional(),
    expectedAnswer: z.string().optional(),
    jobDescription: z.string().optional(),
  }),
});
