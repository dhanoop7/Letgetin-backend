import { z } from 'zod';

const AI_WRITING_ACTIONS = [
  'improve',
  'rewrite',
  'professional',
  'expand',
  'shorten',
  'grammar',
  'simplify',
  'generate',
  'custom',
  'ats-optimize',
  'quantify-impact',
  'personalize',
  'suggest-skills',
] as const;

const AI_WRITING_CONTEXTS = [
  'job-description',
  'company-about',
  'startup-about',
  'institution-about',
  'resume-summary',
  'resume-experience',
  'resume-project',
  'cover-letter',
  'skills',
] as const;

export const aiWritingSchema = z.object({
  body: z
    .object({
      action: z.enum(AI_WRITING_ACTIONS),
      context: z.enum(AI_WRITING_CONTEXTS),
      text: z.string().max(6000, 'Text is too long for AI processing.').optional(),
      instruction: z.string().max(300, 'Instruction is too long.').optional(),
      metadata: z.record(z.string()).optional(),
    })
    .refine((data) => data.action === 'generate' || (data.text && data.text.trim().length > 0), {
      message: 'Text is required for this action.',
      path: ['text'],
    })
    .refine((data) => data.action !== 'custom' || (data.instruction && data.instruction.trim().length > 0), {
      message: 'A custom instruction is required.',
      path: ['instruction'],
    })
    .refine((data) => data.action !== 'generate' || (data.instruction && data.instruction.trim().length > 0), {
      message: 'Describe what you want to create.',
      path: ['instruction'],
    }),
});

export const improveSummarySchema = z.object({
  body: z.object({
    currentSummary: z.string().min(1, 'Current summary is required'),
    targetRole: z.string().optional(),
    tone: z.enum(['impactful', 'executive', 'technical', 'concise']).default('impactful'),
  }),
});

export const rewriteExperienceSchema = z.object({
  body: z.object({
    position: z.string().min(1, 'Position title is required'),
    rawBullet: z.string().min(1, 'Bullet text is required'),
    actionOriented: z.boolean().default(true),
  }),
});

export const generateSkillsSchema = z.object({
  body: z.object({
    targetJobTitle: z.string().min(1, 'Target job title is required'),
    existingSkills: z.array(z.string()).default([]),
  }),
});

export const atsAnalyzeSchema = z.object({
  body: z.object({
    resumeContent: z.record(z.unknown()),
    targetJobDescription: z.string().optional(),
  }),
});

export const optimizeSectionSchema = z.object({
  body: z.object({
    sectionName: z.string().min(1, 'Section name is required'),
    sectionData: z.unknown(),
  }),
});

export const chatSchema = z.object({
  body: z.object({
    message: z.string().min(1, 'Message is required'),
    resumeContext: z.record(z.unknown()).optional(),
    resumeId: z.string().optional(),
    activeResumeContext: z.record(z.unknown()).optional(),
    stream: z.boolean().optional(),
    conversationHistory: z
      .array(
        z.object({
          id: z.string().optional(),
          sender: z.string(),
          text: z.string().optional(),
          message: z.string().optional(),
          content: z.string().optional(),
          analysis: z.unknown().optional(),
          status: z.string().optional(),
          questions: z.array(z.string()).optional(),
          draft: z.unknown().optional(),
          action: z.unknown().optional(),
          timestamp: z.string().optional(),
        })
      )
      .optional(),
  }),
});

export const assistantChatSchema = z.object({
  body: z.object({
    message: z.string().min(1, 'Message is required'),
    context: z.enum(['explore', 'profile', 'resume', 'drive']),
    mode: z.enum(['instant', 'expert']).default('instant'),
    contextPayload: z
      .object({
        resumeId: z.string().optional(),
        activeResumeContext: z.record(z.unknown()).optional(),
        selectedJobId: z.string().optional(),
        driveFileId: z.string().optional(),
        activeProfileContext: z.record(z.unknown()).optional(),
        activeProfileSection: z.string().optional(),
      })
      .optional(),
    conversationHistory: z
      .array(
        z.object({
          id: z.string().optional(),
          sender: z.string(),
          text: z.string().optional(),
          message: z.string().optional(),
          content: z.string().optional(),
          timestamp: z.string().optional(),
        })
      )
      .optional(),
    stream: z.boolean().optional(),
  }),
});

export const aiApplyAssistSchema = z.object({
  body: z
    .object({
      action: z.enum(['status_suggestion', 'title_expansion']),
      seedTitle: z.string().optional(),
    })
    .refine((data) => data.action !== 'title_expansion' || (data.seedTitle && data.seedTitle.trim().length > 0), {
      message: 'seedTitle is required for title_expansion',
      path: ['seedTitle'],
    }),
});

export const parseResumeSchema = z.object({
  body: z.object({
    rawText: z.string().min(5, 'Raw resume text is required'),
  }),
});

export const matchJobSchema = z.object({
  body: z.object({
    resumeContent: z.record(z.unknown()),
    jobDescription: z.string().min(5, 'Job description is required'),
  }),
});

