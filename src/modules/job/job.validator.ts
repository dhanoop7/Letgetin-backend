import { z } from 'zod';

export const createJobSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Job title is required'),
    companyName: z.string().optional(),
    location: z.string().optional(),
    employmentType: z.enum(['full-time', 'part-time', 'contract', 'internship', 'freelance']).optional(),
    workplaceType: z.enum(['remote', 'hybrid', 'onsite']).optional(),
    salaryText: z.string().optional(),
    skills: z.array(z.string()).optional(),
    description: z.string().optional(),
    eligibilityMinPercent: z.number().min(0).max(100).optional(),
    deadline: z.string().optional(),
    saveAsDraft: z.boolean().optional().default(false),
    pipelineOptions: z
      .object({
        matchVolume: z.enum(['1:10', '1:100', '1:1000']).nullable().optional(),
        resumeMatch: z.boolean().default(false),
        resumeMatchTypes: z.array(z.string()).optional(),
        assessment: z.boolean().default(false),
        assessmentTypes: z.array(z.string()).optional(),
        aiInterview: z.boolean().default(false),
        aiInterviewTypes: z.array(z.string()).optional(),
      })
      .optional(),
  }),
});

export const generateJobContentSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'A job title is required to generate content.'),
    employmentType: z.enum(['full-time', 'part-time', 'contract', 'internship', 'freelance']).optional(),
    workplaceType: z.enum(['remote', 'hybrid', 'onsite']).optional(),
    location: z.string().optional(),
  }),
});

export const updateJobStageSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    stage: z.enum(['open', 'shortlisting', 'interview', 'review', 'completed']),
  }),
});
