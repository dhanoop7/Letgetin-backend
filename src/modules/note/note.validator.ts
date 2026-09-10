import { z } from 'zod';

export const createNoteSchema = z.object({
  body: z.object({
    title: z.string().optional().default('New note'),
    content: z.string().optional().default(''),
    tags: z.array(z.string()).optional().default([]),
    workspaceName: z.string().optional().default('Personal Workspace'),
    pinned: z.boolean().optional().default(false),
  }),
});

export const updateNoteSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Note ID is required'),
  }),
  body: z.object({
    title: z.string().optional(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    workspaceName: z.string().optional(),
    pinned: z.boolean().optional(),
  }),
});
