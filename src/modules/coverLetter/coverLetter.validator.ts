import { z } from 'zod';

export const createCoverLetterSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required').default('Untitled Cover Letter'),
    content: z.string().default(''),
  }),
});

export const updateCoverLetterSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Cover letter ID is required'),
  }),
  body: z.object({
    title: z.string().optional(),
    content: z.string().optional(),
  }),
});
