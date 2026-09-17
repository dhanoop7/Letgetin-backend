import { z } from 'zod';

export const configureHiringPipelineSchema = z.object({
  body: z.object({
    finalShortlistTarget: z.number().int().min(1, 'Final shortlist target must be at least 1 candidate'),
    stages: z
      .array(
        z.object({
          stageId: z.string().min(1, 'Stage ID is required'),
          stageName: z.string().min(1, 'Stage name is required'),
          stageType: z.enum(['resume_match', 'assessment', 'ai_interview', 'manual_review']),
          order: z.number().int().min(1),
          expectedAttendanceRate: z
            .number()
            .min(0.01, 'Attendance rate must be > 0')
            .max(1.0, 'Attendance rate cannot exceed 1.0 (100%)'),
          expectedPassRate: z
            .number()
            .min(0.01, 'Pass rate must be > 0')
            .max(1.0, 'Pass rate cannot exceed 1.0 (100%)'),
          deadlineHours: z.number().int().min(1).optional().default(48),
          autoAdvanceScoreThreshold: z.number().min(0).max(100).optional().default(70),
          autoRefillEnabled: z.boolean().optional().default(true),
        })
      )
      .min(1, 'At least one hiring stage is required'),
    status: z.enum(['draft', 'active', 'paused']).optional().default('active'),
  }),
});

export const advanceCandidateSchema = z.object({
  body: z.object({
    score: z.number().min(0).max(100).optional(),
    notes: z.string().optional(),
    evaluationDetails: z.record(z.any()).optional(),
  }),
});

export const failCandidateSchema = z.object({
  body: z.object({
    reason: z.string().optional(),
  }),
});

export const refillStageSchema = z.object({
  body: z.object({
    count: z.number().int().min(1).optional(),
  }),
});
