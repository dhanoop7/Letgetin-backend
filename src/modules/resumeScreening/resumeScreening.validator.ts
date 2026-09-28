import { z } from 'zod';

export const getScreeningCandidatesSchema = z.object({
  params: z.object({
    jobId: z.string().min(1, 'Job ID is required'),
  }),
  query: z.object({
    decision: z.enum(['pending', 'shortlisted', 'rejected', 'needs_review', 'all']).optional(),
    screeningStatus: z.enum(['pending', 'ai_reviewing', 'ai_reviewed', 'all']).optional(),
    search: z.string().optional(),
    minScore: z.string().transform((val) => parseInt(val, 10)).optional(),
    page: z.string().transform((val) => parseInt(val, 10)).optional(),
    limit: z.string().transform((val) => parseInt(val, 10)).optional(),
    sortBy: z.enum(['score', 'appliedAt', 'name']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  }),
});

export const recordDecisionSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Application ID is required'),
  }),
  body: z.object({
    decision: z.enum(['shortlisted', 'rejected', 'needs_review', 'pending']),
    notes: z.string().optional(),
  }),
});

export const recordBulkDecisionSchema = z.object({
  params: z.object({
    jobId: z.string().min(1, 'Job ID is required'),
  }),
  body: z.object({
    applicationIds: z.array(z.string().min(1)).min(1, 'At least one application ID is required'),
    decision: z.enum(['shortlisted', 'rejected', 'needs_review']),
    notes: z.string().optional(),
  }),
});

export const applicationParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Application ID is required'),
  }),
});

export const jobParamSchema = z.object({
  params: z.object({
    jobId: z.string().min(1, 'Job ID is required'),
  }),
});
