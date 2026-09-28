import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { AuthService } from './auth.service.js';
import { env } from '../../config/env.js';
import { UserModel } from '../user/user.model.js';
import { UserProfileModel } from '../profile/profile.model.js';
import { OtpService } from './services/otp.service.js';
import { JwtUtils } from '../../utils/jwt.js';

const authService = new AuthService();

const isProduction = env.NODE_ENV === 'production';

// Helper to convert time strings like '15m', '30d', '24h', '7d' to milliseconds
const parseDurationToMs = (durationStr: string | undefined, defaultMs: number): number => {
  if (!durationStr) return defaultMs;
  const match = durationStr.trim().match(/^(\d+)([smhd])$/i);
  if (!match) return defaultMs;
  const val = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's': return val * 1000;
    case 'm': return val * 60 * 1000;
    case 'h': return val * 60 * 60 * 1000;
    case 'd': return val * 24 * 60 * 60 * 1000;
    default: return defaultMs;
  }
};

const ACCESS_TOKEN_MAX_AGE = parseDurationToMs(env.JWT_ACCESS_EXPIRES_IN, 15 * 60 * 1000);
const REFRESH_TOKEN_MAX_AGE = parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN, 30 * 24 * 60 * 60 * 1000);

const isCrossSite =
  env.NODE_ENV === 'production' ||
  process.env.RENDER === 'true' ||
  Boolean(process.env.RENDER) ||
  (Boolean(env.CLIENT_URL) && env.CLIENT_URL.includes('vercel.app')) ||
  (Boolean(env.CLIENT_URL) && env.CLIENT_URL.startsWith('https://'));

export const COOKIE_OPTIONS_REFRESH = {
  httpOnly: true,
  secure: isCrossSite,
  sameSite: isCrossSite ? ('none' as const) : ('lax' as const),
  maxAge: REFRESH_TOKEN_MAX_AGE,
  path: '/',
};

export const COOKIE_OPTIONS_ACCESS = {
  httpOnly: true,
  secure: isCrossSite,
  sameSite: isCrossSite ? ('none' as const) : ('lax' as const),
  maxAge: ACCESS_TOKEN_MAX_AGE,
  path: '/',
};

export const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isCrossSite,
  sameSite: isCrossSite ? ('none' as const) : ('lax' as const),
  path: '/',
};

export class AuthController {
  // --- Email OTP ---
  static sendEmailOtp = async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body;
    const result = await authService.sendEmailOtp(email);
    res.status(200).json({
      success: true,
      message: result.message,
      data: { cooldown: result.cooldown },
    });
  };

  static verifyEmailOtp = async (req: Request, res: Response): Promise<void> => {
    const { user, tokens } = await authService.verifyEmailOtpAndCreateUser(req.body);

    res.cookie('accessToken', tokens.accessToken, COOKIE_OPTIONS_ACCESS);
    res.cookie('refreshToken', tokens.refreshToken, COOKIE_OPTIONS_REFRESH);

    res.status(201).json({
      success: true,
      message: 'Account created and verified successfully via Email OTP',
      data: {
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  };

  // Backward compatibility aliases
  static sendOtp = AuthController.sendEmailOtp;
  static verifyOtp = AuthController.verifyEmailOtp;
  static signup = AuthController.verifyEmailOtp;

  // --- WhatsApp OTP ---
  static sendWhatsAppOtp = async (req: Request, res: Response): Promise<void> => {
    const { countryCode = '+1', phone } = req.body;
    const result = await authService.sendWhatsAppOtp(countryCode, phone);
    res.status(200).json({
      success: true,
      message: result.message,
      data: { cooldown: result.cooldown },
    });
  };

  static verifyWhatsAppOtp = async (req: Request, res: Response): Promise<void> => {
    const { user, tokens } = await authService.verifyWhatsAppOtpAndCreateUser(req.body);

    res.cookie('accessToken', tokens.accessToken, COOKIE_OPTIONS_ACCESS);
    res.cookie('refreshToken', tokens.refreshToken, COOKIE_OPTIONS_REFRESH);

    res.status(201).json({
      success: true,
      message: 'Account created and verified successfully via WhatsApp OTP',
      data: {
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  };

  // --- Login & OAuth ---
  static login = async (req: Request, res: Response): Promise<void> => {
    const { user, tokens } = await authService.login(req.body);

    res.cookie('accessToken', tokens.accessToken, COOKIE_OPTIONS_ACCESS);
    res.cookie('refreshToken', tokens.refreshToken, COOKIE_OPTIONS_REFRESH);

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      data: {
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  };

  static google = async (req: Request, res: Response): Promise<void> => {
    const { credential } = req.body;
    const { user, tokens } = await authService.googleAuth(credential);

    res.cookie('accessToken', tokens.accessToken, COOKIE_OPTIONS_ACCESS);
    res.cookie('refreshToken', tokens.refreshToken, COOKIE_OPTIONS_REFRESH);

    res.status(200).json({
      success: true,
      message: 'Google authentication successful',
      data: {
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  };

  static refresh = async (req: Request, res: Response): Promise<void> => {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      res.clearCookie('accessToken', CLEAR_COOKIE_OPTIONS);
      res.clearCookie('refreshToken', CLEAR_COOKIE_OPTIONS);
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Refresh token is required',
        },
      });
      return;
    }

    try {
      const { user, tokens } = await authService.refreshToken(refreshToken);

      res.cookie('accessToken', tokens.accessToken, COOKIE_OPTIONS_ACCESS);
      res.cookie('refreshToken', tokens.refreshToken, COOKIE_OPTIONS_REFRESH);

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          user,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      });
    } catch (error) {
      res.clearCookie('accessToken', CLEAR_COOKIE_OPTIONS);
      res.clearCookie('refreshToken', CLEAR_COOKIE_OPTIONS);
      throw error;
    }
  };

  static logout = async (req: Request, res: Response): Promise<void> => {
    let targetUserId = req.user?.userId;

    if (!targetUserId && req.cookies?.refreshToken) {
      try {
        const payload = JwtUtils.verifyRefreshToken(req.cookies.refreshToken);
        if (payload?.userId) {
          targetUserId = payload.userId;
        }
      } catch {
        // Ignore token verification errors during logout
      }
    }

    if (targetUserId) {
      await authService.logout(targetUserId);
    }

    res.clearCookie('accessToken', CLEAR_COOKIE_OPTIONS);
    res.clearCookie('refreshToken', CLEAR_COOKIE_OPTIONS);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  };

  static getMe = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const user = await authService.getMe(userId);
    res.status(200).json({
      success: true,
      data: { user },
    });
  };

  // --- Authenticated Profile OTP Verification ---
  static sendProfileEmailOtp = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const user = await UserModel.findById(userId);
    if (!user || !user.email) {
      res.status(400).json({ success: false, error: { message: 'No registered email found for this user' } });
      return;
    }
    const result = await OtpService.sendEmailOtp(user.email);
    res.status(200).json({
      success: true,
      message: result.message,
      data: { cooldown: result.cooldown },
    });
  };

  static verifyProfileEmailOtp = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { otp } = req.body;
    if (!otp) {
      res.status(400).json({ success: false, error: { message: 'OTP is required' } });
      return;
    }
    const user = await UserModel.findById(userId);
    if (!user || !user.email) {
      res.status(400).json({ success: false, error: { message: 'No registered email found for this user' } });
      return;
    }

    await OtpService.verifyEmailOtp(user.email, otp);
    user.emailVerified = true;
    user.isEmailVerified = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Email verified successfully via OTP',
      data: { user: authService.sanitizeUser(user) },
    });
  };

  static sendProfilePhoneOtp = async (req: Request, res: Response): Promise<void> => {
    const { phone, countryCode = '+91' } = req.body;
    if (!phone) {
      res.status(400).json({ success: false, error: { message: 'Phone number is required' } });
      return;
    }
    const fullPhone = `${countryCode.trim()}${phone.trim()}`;
    const result = await OtpService.sendWhatsAppOtp(fullPhone);
    res.status(200).json({
      success: true,
      message: result.message,
      data: { cooldown: result.cooldown },
    });
  };

  static verifyProfilePhoneOtp = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { phone, otp, countryCode = '+91' } = req.body;
    if (!phone || !otp) {
      res.status(400).json({ success: false, error: { message: 'Phone and OTP are required' } });
      return;
    }
    const fullPhone = `${countryCode.trim()}${phone.trim()}`;
    await OtpService.verifyWhatsAppOtp(fullPhone, otp);

    const user = await UserModel.findByIdAndUpdate(
      userId,
      { phone: fullPhone, phoneVerified: true },
      { new: true }
    );
    if (!user) {
      res.status(404).json({ success: false, error: { message: 'User not found' } });
      return;
    }

    await UserProfileModel.findOneAndUpdate(
      { userId: user._id },
      { $set: { 'contact.phone': fullPhone } }
    );

    res.status(200).json({
      success: true,
      message: 'Phone verified successfully via WhatsApp OTP',
      data: { user: authService.sanitizeUser(user) },
    });
  };

  static sendProfileAlternateEmailOtp = async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      res.status(400).json({ success: false, error: { message: 'A valid alternate email address is required' } });
      return;
    }
    const result = await OtpService.sendEmailOtp(email.trim());
    res.status(200).json({
      success: true,
      message: result.message,
      data: { cooldown: result.cooldown },
    });
  };

  static verifyProfileAlternateEmailOtp = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { email, otp } = req.body;
    if (!email || !otp) {
      res.status(400).json({ success: false, error: { message: 'Email and OTP code are required' } });
      return;
    }
    const normalizedEmail = email.trim();
    await OtpService.verifyEmailOtp(normalizedEmail, otp.trim());

    const updatedProfile = await UserProfileModel.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId) },
      {
        $set: {
          'contact.alternateEmail': normalizedEmail,
          'contact.resumeEmail': normalizedEmail,
          'contact.alternateEmailVerified': true,
          'contact.resumeEmailVerified': true,
        },
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Alternate / Resume email verified successfully via OTP',
      data: { profile: updatedProfile },
    });
  };

  static completeOnboarding = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { $set: { hasBuiltResume: true } },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Onboarding completed and resume build status marked successfully in database',
      data: { user: user ? authService.sanitizeUser(user) : null },
    });
  };
}
