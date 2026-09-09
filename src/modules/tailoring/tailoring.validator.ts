import { z } from 'zod';

export const createTailoringSessionSchema = z.object({
  body: z.object({
    resumeId: z.string().min(1, 'resumeId is required'),
    jobDescription: z.string().min(20, 'Job description must be at least 20 characters'),
  }),
});

export const getActiveTailoringSessionSchema = z.object({
  query: z.object({
    resumeId: z.string().min(1, 'resumeId is required'),
  }),
});

const suggestionUpdateSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'accepted', 'declined', 'edited']),
  proposedText: z.string().optional(),
  // Present only when the client is appending a brand-new, chat-sourced suggestion that
  // doesn't exist in the session yet (upserted by id in the service layer).
  section: z.enum(['summary', 'experience', 'skills', 'projects']).optional(),
  itemId: z.string().optional(),
  changeType: z.enum(['addition', 'replacement', 'rewrite']).optional(),
  originalText: z.string().optional(),
  reason: z.string().optional(),
  relatedKeywords: z.array(z.string()).optional(),
});

export const updateTailoringSuggestionsSchema = z.object({
  body: z.object({
    suggestions: z.array(suggestionUpdateSchema).min(1),
  }),
});

export const finalizeTailoringSessionSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(200).optional(),
  }),
});
