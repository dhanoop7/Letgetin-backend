import { z } from 'zod';

export const uploadVideoSchema = z.object({
  body: z.object({
    videoType: z.enum(['short', 'long']),
  }),
});
