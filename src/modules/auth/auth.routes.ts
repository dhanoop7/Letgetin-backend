import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from './auth.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  sendOtpSchema,
  verifyOtpSchema,
  sendEmailOtpSchema,
  verifyEmailOtpSchema,
  sendWhatsAppOtpSchema,
  verifyWhatsAppOtpSchema,
  loginSchema,
  googleAuthSchema,
} from './auth.validator.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Rate limiter for auth endpoints (max 25 requests per 15 minutes per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication requests. Please try again in 15 minutes.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Email OTP Routes ---
router.post('/send-email-otp', authLimiter, validate(sendEmailOtpSchema), asyncHandler(AuthController.sendEmailOtp));
router.post('/verify-email-otp', authLimiter, validate(verifyEmailOtpSchema), asyncHandler(AuthController.verifyEmailOtp));

// Backward compatibility Email OTP routes
router.post('/send-otp', authLimiter, validate(sendOtpSchema), asyncHandler(AuthController.sendOtp));
router.post('/verify-otp', authLimiter, validate(verifyOtpSchema), asyncHandler(AuthController.verifyOtp));

// --- WhatsApp OTP Routes ---
router.post('/send-whatsapp-otp', authLimiter, validate(sendWhatsAppOtpSchema), asyncHandler(AuthController.sendWhatsAppOtp));
router.post('/verify-whatsapp-otp', authLimiter, validate(verifyWhatsAppOtpSchema), asyncHandler(AuthController.verifyWhatsAppOtp));

// Manual Signup & Login Routes
router.post('/signup', authLimiter, validate(verifyOtpSchema), asyncHandler(AuthController.signup));
router.post('/login', authLimiter, validate(loginSchema), asyncHandler(AuthController.login));

// Google OAuth Routes
router.post('/google', validate(googleAuthSchema), asyncHandler(AuthController.google));
router.get('/google', asyncHandler(AuthController.google));
router.get('/google/callback', asyncHandler(AuthController.google));

// Session & Token Refresh Routes
router.post('/refresh', asyncHandler(AuthController.refresh));
router.post('/logout', asyncHandler(AuthController.logout));
router.get('/me', authenticate, asyncHandler(AuthController.getMe));
router.post('/complete-onboarding', authenticate, asyncHandler(AuthController.completeOnboarding));
router.post('/mark-built-resume', authenticate, asyncHandler(AuthController.completeOnboarding));

// Authenticated Profile OTP Verification Routes
router.post('/profile/send-email-otp', authenticate, authLimiter, asyncHandler(AuthController.sendProfileEmailOtp));
router.post('/profile/verify-email-otp', authenticate, authLimiter, asyncHandler(AuthController.verifyProfileEmailOtp));
router.post('/profile/send-phone-otp', authenticate, authLimiter, asyncHandler(AuthController.sendProfilePhoneOtp));
router.post('/profile/verify-phone-otp', authenticate, authLimiter, asyncHandler(AuthController.verifyProfilePhoneOtp));
router.post('/profile/send-alternate-email-otp', authenticate, authLimiter, asyncHandler(AuthController.sendProfileAlternateEmailOtp));
router.post('/profile/verify-alternate-email-otp', authenticate, authLimiter, asyncHandler(AuthController.verifyProfileAlternateEmailOtp));

export default router;
