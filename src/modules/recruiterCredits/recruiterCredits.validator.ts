import { z } from 'zod';

export const purchaseCreditsSchema = z.object({
  body: z.object({
    packId: z.string().min(1, 'A credit pack is required'),
  }),
});

export const revealContactSchema = z.object({
  params: z.object({
    userId: z.string().min(1, 'Candidate ID is required'),
  }),
});

export const searchCandidatesSchema = z.object({
  query: z.object({
    jobId: z.string().optional(),
    query: z.string().optional(),
    limit: z.string().optional(),
  }),
});
