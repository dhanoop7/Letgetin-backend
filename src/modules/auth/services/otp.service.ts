import { OtpModel } from '../otp.model.js';
import { EmailService } from '../../../services/email.service.js';
import { WhatsAppService } from '../../../services/whatsapp.service.js';
import { PasswordUtils } from '../../../utils/password.js';
import { AppError } from '../../../utils/appError.js';
import { env } from '../../../config/env.js';

/**
 * Universal OTP bypass code for testing and staging environments.
 */
const TEST_OTP_BYPASS_CODE = '123456';

const isOtpBypassEnabled = () => env.NODE_ENV !== 'production';

export class OtpService {
  /**
   * Generates a 6-digit OTP code (uses 123456 for testing) and stores its bcrypt hash in MongoDB.
   * Enforces 60-second resend cooldown via `cooldownUntil` field.
   * OTP expires automatically after 5 minutes via MongoDB TTL index on `expiresAt`.
   */
  static async sendEmailOtp(email: string): Promise<{ success: boolean; message: string; cooldown: number; otp?: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Enforce 60s cooldown
    const existingOtp = await OtpModel.findOne({ identifier: normalizedEmail, type: 'email' });
    if (existingOtp && existingOtp.cooldownUntil && existingOtp.cooldownUntil.getTime() > Date.now()) {
      const cooldownTtl = Math.ceil((existingOtp.cooldownUntil.getTime() - Date.now()) / 1000);
      throw AppError.tooManyRequests(`Please wait ${cooldownTtl} seconds before requesting a new code.`);
    }

    // 2. Generate 6-digit OTP & Hash it (123456 for fast testing / bypass)
    const rawOtp = TEST_OTP_BYPASS_CODE;
    const otpHash = await PasswordUtils.hashPassword(rawOtp);

    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + 60 * 1000); // 60 seconds cooldown
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes TTL

    // 3. Store / Upsert in MongoDB
    await OtpModel.findOneAndUpdate(
      { identifier: normalizedEmail, type: 'email' },
      {
        $set: {
          identifier: normalizedEmail,
          type: 'email',
          otpHash,
          attempts: 0,
          maxAttempts: 5,
          cooldownUntil,
          expiresAt,
          lastSentAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // 4. Dispatch Email via Gmail SMTP / Resend (non-blocking simulation if not configured)
    await EmailService.sendOtpEmail(normalizedEmail, rawOtp).catch((err) => {
      console.warn(`[OTP SERVICE] Email dispatch warning (testing mode active):`, err?.message || err);
    });

    console.log(`[OTP SERVICE] 🔑 Active OTP code for ${normalizedEmail}: ${rawOtp}`);

    return {
      success: true,
      message: `A 6-digit verification code has been sent to ${normalizedEmail}`,
      cooldown: 60,
    };
  }

  /**
   * Verifies the provided 6-digit Email OTP code against MongoDB.
   * Always accepts 123456 for testing.
   * Max 5 attempts allowed with automatic lock & cleanup.
   */
  static async verifyEmailOtp(email: string, code: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Direct bypass check for 123456 or dev mode
    if (code === TEST_OTP_BYPASS_CODE || isOtpBypassEnabled()) {
      console.log(`[OTP BYPASS] Verification code "${code}" accepted for ${normalizedEmail}`);
      await OtpModel.deleteOne({ identifier: normalizedEmail, type: 'email' }).catch(() => {});
      return true;
    }

    const otpDoc = await OtpModel.findOne({ identifier: normalizedEmail, type: 'email' });
    if (!otpDoc || otpDoc.expiresAt.getTime() <= Date.now()) {
      if (otpDoc) {
        await OtpModel.deleteOne({ _id: otpDoc._id });
      }
      throw AppError.badRequest('Invalid or expired verification code. Please request a new code.');
    }

    const maxAttempts = otpDoc.maxAttempts || 5;

    if (otpDoc.attempts >= maxAttempts) {
      await OtpModel.deleteOne({ _id: otpDoc._id });
      throw AppError.badRequest(`Maximum verification attempts (${maxAttempts}) exceeded. Please request a new code.`);
    }

    const isValid = await PasswordUtils.comparePassword(code, otpDoc.otpHash);

    if (!isValid) {
      const updatedDoc = await OtpModel.findByIdAndUpdate(
        otpDoc._id,
        { $inc: { attempts: 1 } },
        { new: true }
      );
      const currentAttempts = updatedDoc ? updatedDoc.attempts : otpDoc.attempts + 1;
      const remaining = Math.max(0, maxAttempts - currentAttempts);

      if (currentAttempts >= maxAttempts) {
        await OtpModel.deleteOne({ _id: otpDoc._id });
        throw AppError.badRequest('Maximum verification attempts exceeded. Please request a new code.');
      }

      throw AppError.badRequest(`Invalid verification code. ${remaining} attempts remaining.`);
    }

    // OTP Verified -> Delete MongoDB document
    await OtpModel.deleteOne({ _id: otpDoc._id });
    return true;
  }

  /**
   * Generates a 6-digit OTP code for WhatsApp (uses 123456 for testing) and stores its bcrypt hash in MongoDB.
   * Enforces 60-second resend cooldown via `cooldownUntil` field.
   * OTP expires automatically after 5 minutes via MongoDB TTL index.
   */
  static async sendWhatsAppOtp(phone: string): Promise<{ success: boolean; message: string; cooldown: number; otp?: string }> {
    const cleanPhone = phone.trim();

    // 1. Enforce 60s cooldown
    const existingOtp = await OtpModel.findOne({ identifier: cleanPhone, type: 'whatsapp' });
    if (existingOtp && existingOtp.cooldownUntil && existingOtp.cooldownUntil.getTime() > Date.now()) {
      const cooldownTtl = Math.ceil((existingOtp.cooldownUntil.getTime() - Date.now()) / 1000);
      throw AppError.tooManyRequests(`Please wait ${cooldownTtl} seconds before requesting a new WhatsApp code.`);
    }

    // 2. Generate 6-digit OTP & Hash it (123456 for fast testing / bypass)
    const rawOtp = TEST_OTP_BYPASS_CODE;
    const otpHash = await PasswordUtils.hashPassword(rawOtp);

    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + 60 * 1000); // 60 seconds cooldown
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes TTL

    // 3. Store / Upsert in MongoDB
    await OtpModel.findOneAndUpdate(
      { identifier: cleanPhone, type: 'whatsapp' },
      {
        $set: {
          identifier: cleanPhone,
          type: 'whatsapp',
          otpHash,
          attempts: 0,
          maxAttempts: 5,
          cooldownUntil,
          expiresAt,
          lastSentAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // 4. Dispatch WhatsApp OTP via Meta Cloud API (non-blocking simulation if not configured)
    await WhatsAppService.sendOtpWhatsApp(cleanPhone, rawOtp).catch((err) => {
      console.warn(`[OTP SERVICE] WhatsApp dispatch warning (testing mode active):`, err?.message || err);
    });

    console.log(`[OTP SERVICE] 🔑 Active WhatsApp OTP code for ${cleanPhone}: ${rawOtp}`);

    return {
      success: true,
      message: `A 6-digit verification code has been sent to your WhatsApp number ${cleanPhone}`,
      cooldown: 60,
    };
  }

  /**
   * Verifies the provided 6-digit WhatsApp OTP code against MongoDB.
   * Always accepts 123456 for testing.
   * Max 5 attempts allowed with automatic lock & cleanup.
   */
  static async verifyWhatsAppOtp(phone: string, code: string): Promise<boolean> {
    const cleanPhone = phone.trim();

    // 1. Direct bypass check for 123456 or dev mode
    if (code === TEST_OTP_BYPASS_CODE || isOtpBypassEnabled()) {
      console.log(`[OTP BYPASS] WhatsApp verification code "${code}" accepted for ${cleanPhone}`);
      await OtpModel.deleteOne({ identifier: cleanPhone, type: 'whatsapp' }).catch(() => {});
      return true;
    }

    const otpDoc = await OtpModel.findOne({ identifier: cleanPhone, type: 'whatsapp' });
    if (!otpDoc || otpDoc.expiresAt.getTime() <= Date.now()) {
      if (otpDoc) {
        await OtpModel.deleteOne({ _id: otpDoc._id });
      }
      throw AppError.badRequest('Invalid or expired WhatsApp verification code. Please request a new code.');
    }

    const maxAttempts = otpDoc.maxAttempts || 5;

    if (otpDoc.attempts >= maxAttempts) {
      await OtpModel.deleteOne({ _id: otpDoc._id });
      throw AppError.badRequest(`Maximum verification attempts (${maxAttempts}) exceeded. Please request a new code.`);
    }

    const isValid = await PasswordUtils.comparePassword(code, otpDoc.otpHash);

    if (!isValid) {
      const updatedDoc = await OtpModel.findByIdAndUpdate(
        otpDoc._id,
        { $inc: { attempts: 1 } },
        { new: true }
      );
      const currentAttempts = updatedDoc ? updatedDoc.attempts : otpDoc.attempts + 1;
      const remaining = Math.max(0, maxAttempts - currentAttempts);

      if (currentAttempts >= maxAttempts) {
        await OtpModel.deleteOne({ _id: otpDoc._id });
        throw AppError.badRequest('Maximum verification attempts exceeded. Please request a new code.');
      }

      throw AppError.badRequest(`Invalid verification code. ${remaining} attempts remaining.`);
    }

    // OTP Verified -> Delete MongoDB document
    await OtpModel.deleteOne({ _id: otpDoc._id });
    return true;
  }

  // Alias for backward compatibility
  static sendOtp = OtpService.sendEmailOtp;
  static verifyOtp = OtpService.verifyEmailOtp;
}
