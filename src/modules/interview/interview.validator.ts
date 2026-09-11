import { z } from 'zod';

export const createInterviewSchema = z.object({
  body: z.object({
    candidateName: z.string().min(1, 'Candidate name is required'),
    candidateEmail: z.string().email('Valid email is required'),
    candidateAvatar: z.string().optional(),
    candidateId: z.string().optional(),
    position: z.string().min(1, 'Position is required'),
    department: z.string().default('Engineering'),
    jobId: z.string().optional(),
    roundName: z.string().default('Technical Round 1'),
    stage: z
      .enum(['to_schedule', 'upcoming', 'today', 'feedback_pending', 'completed', 'cancelled'])
      .default('upcoming'),
    type: z.enum(['live_video', 'ai_interview', 'onsite']).default('live_video'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    time: z.string().min(1, 'Time is required'),
    durationMinutes: z.number().int().positive().default(45),
    platform: z
      .enum(['LetGetIn Room', 'Google Meet', 'Zoom', 'Microsoft Teams', 'On-Site'])
      .default('LetGetIn Room'),
    meetingLink: z.string().optional(),
    roomCode: z.string().optional(),
    interviewers: z
      .array(
        z.object({
          name: z.string().min(1),
          role: z.string().default('Interviewer'),
          email: z.string().email().optional(),
          avatar: z.string().optional(),
        })
      )
      .default([]),
  }),
});

export const updateInterviewSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Interview ID is required'),
  }),
  body: z.object({
    candidateName: z.string().optional(),
    candidateEmail: z.string().email().optional(),
    position: z.string().optional(),
    department: z.string().optional(),
    roundName: z.string().optional(),
    stage: z
      .enum(['to_schedule', 'upcoming', 'today', 'feedback_pending', 'completed', 'cancelled'])
      .optional(),
    type: z.enum(['live_video', 'ai_interview', 'onsite']).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    time: z.string().optional(),
    durationMinutes: z.number().int().positive().optional(),
    platform: z
      .enum(['LetGetIn Room', 'Google Meet', 'Zoom', 'Microsoft Teams', 'On-Site'])
      .optional(),
    meetingLink: z.string().optional(),
    score: z.number().min(1).max(5).optional(),
    feedbackNotes: z.string().optional(),
  }),
});

export const updateStageSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Interview ID is required'),
  }),
  body: z.object({
    stage: z.enum(['to_schedule', 'upcoming', 'today', 'feedback_pending', 'completed', 'cancelled']),
  }),
});

export const submitFeedbackSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Interview ID is required'),
  }),
  body: z.object({
    score: z.number().min(1).max(5),
    feedbackNotes: z.string().min(1, 'Feedback notes are required'),
  }),
});

export const generateAiQuestionsSchema = z.object({
  body: z.object({
    role: z.string().min(1, 'Role is required'),
    skills: z.array(z.string()).default([]),
    experienceLevel: z.enum(['junior', 'mid', 'senior', 'lead']).default('mid'),
    focusAreas: z.array(z.string()).optional(),
    count: z.number().int().min(1).max(12).default(5),
  }),
});

export const evaluateInterviewSchema = z.object({
  body: z.object({
    role: z.string().min(1, 'Role is required'),
    questionsAndAnswers: z.array(
      z.object({
        question: z.string(),
        answer: z.string(),
      })
    ),
    interviewId: z.string().optional(),
  }),
});
