import { z } from 'zod';

export const createStudentSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').trim(),
    email: z.string().email('Invalid email address').trim(),
    course: z.string().min(1, 'Course is required').trim(),
    year: z.string().optional(),
    skills: z.array(z.string()).optional(),
    status: z.enum(['active', 'placed', 'pending']).optional(),
  }),
});

export const updateStudentSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z.string().min(1).trim().optional(),
    email: z.string().email('Invalid email address').trim().optional(),
    course: z.string().min(1).trim().optional(),
    year: z.string().optional(),
    skills: z.array(z.string()).optional(),
    status: z.enum(['active', 'placed', 'pending']).optional(),
  }),
});

export const studentIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

const requirementSchema = z.object({
  title: z.string().min(1, 'Requirement title is required').trim(),
  openings: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export const addRecruiterSchema = z.object({
  body: z.object({
    company: z.string().min(1, 'Company is required').trim(),
    contactPerson: z.string().optional(),
    email: z.string().email('Invalid email address').trim(),
    phone: z.string().optional(),
    industry: z.string().optional(),
    status: z.enum(['active', 'pending', 'inactive']).optional(),
    requirements: z.array(requirementSchema).optional(),
  }),
});

export const updateRecruiterSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    company: z.string().min(1).trim().optional(),
    contactPerson: z.string().optional(),
    email: z.string().email('Invalid email address').trim().optional(),
    phone: z.string().optional(),
    industry: z.string().optional(),
    status: z.enum(['active', 'pending', 'inactive']).optional(),
    requirements: z.array(requirementSchema).optional(),
  }),
});

export const recruiterLinkIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const createEventSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required').trim(),
    date: z.string().min(1, 'Date is required'),
    type: z.enum(['interview_drive', 'aptitude_test', 'campus_visit', 'meeting', 'other']).optional(),
    notes: z.string().optional(),
  }),
});

export const listEventsSchema = z.object({
  query: z.object({
    year: z.string().regex(/^\d{4}$/).optional(),
    month: z.string().regex(/^\d{1,2}$/).optional(),
  }),
});

export const updateEventSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    title: z.string().min(1).trim().optional(),
    date: z.string().min(1).optional(),
    type: z.enum(['interview_drive', 'aptitude_test', 'campus_visit', 'meeting', 'other']).optional(),
    notes: z.string().optional(),
  }),
});

export const eventIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const createTaskSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Task name is required').trim(),
    estimatedTime: z.string().optional(),
    priority: z.enum(['Low', 'Medium', 'High']).optional(),
  }),
});

export const updateTaskSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z.string().min(1).trim().optional(),
    estimatedTime: z.string().optional(),
    priority: z.enum(['Low', 'Medium', 'High']).optional(),
    done: z.boolean().optional(),
  }),
});

export const taskIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const createTrainingProgramSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Program name is required').trim(),
    scheduledDate: z.string().optional(),
    attendees: z.number().int().min(0).optional(),
    notes: z.string().optional(),
  }),
});

export const trainingProgramIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const updatePolicySchema = z.object({
  body: z.object({
    oneStudentOneJob: z.boolean().optional(),
    dreamOfferOption: z.boolean().optional(),
    banPeriodDays: z.number().int().min(0).max(365).optional(),
    additionalRules: z.string().max(2000).optional(),
  }),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>['body'];
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>['body'];
export type AddRecruiterInput = z.infer<typeof addRecruiterSchema>['body'];
export type UpdateRecruiterInput = z.infer<typeof updateRecruiterSchema>['body'];
export type CreateEventInput = z.infer<typeof createEventSchema>['body'];
export type UpdateEventInput = z.infer<typeof updateEventSchema>['body'];
export type CreateTaskInput = z.infer<typeof createTaskSchema>['body'];
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>['body'];
export type CreateTrainingProgramInput = z.infer<typeof createTrainingProgramSchema>['body'];
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>['body'];
