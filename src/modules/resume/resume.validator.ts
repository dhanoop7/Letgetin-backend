import { z } from 'zod';

export const createResumeSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required').default('Untitled Resume'),
    templateId: z.string().default('modern-sleek'),
    content: z.record(z.unknown()),
    settings: z.record(z.unknown()).optional(),
  }),
});

export const updateResumeSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Resume ID is required'),
  }),
  body: z.object({
    title: z.string().optional(),
    templateId: z.string().optional(),
    content: z.record(z.unknown()).optional(),
    settings: z.record(z.unknown()).optional(),
  }),
});


