import { z } from 'zod';

const subtaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  completed: z.boolean().default(false),
});

const attachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  size: z.string().optional(),
});

const participantSchema = z.object({
  name: z.string().min(1),
  isMe: z.boolean().optional().default(false),
  avatar: z.string().optional(),
});

export const createTaskSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Task title is required'),
    description: z.string().optional(),
    type: z.enum(['task', 'event', 'reminder']).optional().default('task'),
    status: z.enum(['todo', 'in_progress', 'done']).optional().default('in_progress'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
    projectId: z.string().optional().default('strategic'),
    typeName: z.string().optional(),
    date: z.string().nullable().optional(),
    startTime: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
    durationMinutes: z.number().min(0).optional().default(60),
    dueDate: z.string().nullable().optional(),
    estimatedTime: z.string().optional(),
    iconEmoji: z.string().optional(),
    location: z.string().optional(),
    meetingLink: z.string().optional(),
    workspaceName: z.string().optional(),
    repeats: z.boolean().optional().default(false),
    themeColor: z.string().optional().default('teal'),
    participants: z.array(participantSchema).optional().default([]),
    assignee: z
      .object({
        name: z.string().optional(),
        avatar: z.string().optional(),
      })
      .optional(),
    subtasks: z.array(subtaskSchema).optional().default([]),
    tags: z.array(z.string()).optional().default([]),
    attachments: z.array(attachmentSchema).optional().default([]),
    isWaitingList: z.boolean().optional().default(false),
  }),
});

export const updateTaskSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Task ID is required'),
  }),
  body: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    type: z.enum(['task', 'event', 'reminder']).optional(),
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    projectId: z.string().optional(),
    typeName: z.string().optional(),
    date: z.string().nullable().optional(),
    startTime: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
    durationMinutes: z.number().min(0).optional(),
    dueDate: z.string().nullable().optional(),
    estimatedTime: z.string().optional(),
    iconEmoji: z.string().optional(),
    location: z.string().optional(),
    meetingLink: z.string().optional(),
    workspaceName: z.string().optional(),
    repeats: z.boolean().optional(),
    themeColor: z.string().optional(),
    participants: z.array(participantSchema).optional(),
    assignee: z
      .object({
        name: z.string().optional(),
        avatar: z.string().optional(),
      })
      .optional(),
    subtasks: z.array(subtaskSchema).optional(),
    tags: z.array(z.string()).optional(),
    attachments: z.array(attachmentSchema).optional(),
    isWaitingList: z.boolean().optional(),
  }),
});

export const updateTaskStatusSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Task ID is required'),
  }),
  body: z.object({
    status: z.enum(['todo', 'in_progress', 'done']),
  }),
});
