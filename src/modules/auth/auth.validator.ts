import { z } from 'zod';

export const sendOtpSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address format'),
  }),
});

export const sendEmailOtpSchema = sendOtpSchema;

// entityType is intentionally NOT required for role='recruiter' — organization type
// (Company/Institution/Startup) is chosen during the post-signup onboarding flow
// (/recruiter/setup), not at account creation.
export const verifyOtpSchema = z.object({
  body: z.object({
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(30, 'Username cannot exceed 30 characters')
      .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens'),
    email: z.string().email('Invalid email address format'),
    password: z.string().min(8, 'Password must be at least 8 characters long'),
    confirmPassword: z.string().min(1, 'Confirm password is required'),
    otp: z.string().length(6, 'OTP must be exactly 6 digits'),
    role: z.enum(['user', 'recruiter']).optional().default('user'),
    entityType: z.enum(['company', 'institution', 'startup']).optional(),
  }).refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }),
});

export const verifyEmailOtpSchema = verifyOtpSchema;

export const sendWhatsAppOtpSchema = z.object({
  body: z.object({
    countryCode: z.string().optional().default('+1'),
    phone: z.string().min(6, 'Phone number must be at least 6 digits'),
  }),
});

// Same rationale as verifyOtpSchema above: entityType is not required for role='recruiter' here.
export const verifyWhatsAppOtpSchema = z.object({
  body: z.object({
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(30, 'Username cannot exceed 30 characters')
      .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens'),
    countryCode: z.string().optional().default('+1'),
    phone: z.string().min(6, 'Phone number must be at least 6 digits'),
    password: z.string().min(8, 'Password must be at least 8 characters long'),
    confirmPassword: z.string().min(1, 'Confirm password is required'),
    otp: z.string().length(6, 'OTP must be exactly 6 digits'),
    role: z.enum(['user', 'recruiter']).optional().default('user'),
    entityType: z.enum(['company', 'institution', 'startup']).optional(),
  }).refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().optional(),
    phone: z.string().optional(),
    emailOrPhone: z.string().optional(),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const googleAuthSchema = z.object({
  body: z.object({
    credential: z.string().min(1, 'Google credential token is required'),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().optional(),
  }).optional(),
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>['body'];
export type SendEmailOtpInput = z.infer<typeof sendEmailOtpSchema>['body'];
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>['body'];
export type VerifyEmailOtpInput = z.infer<typeof verifyEmailOtpSchema>['body'];
export type SendWhatsAppOtpInput = z.infer<typeof sendWhatsAppOtpSchema>['body'];
export type VerifyWhatsAppOtpInput = z.infer<typeof verifyWhatsAppOtpSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>['body'];
