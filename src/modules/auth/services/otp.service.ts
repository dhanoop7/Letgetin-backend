import crypto from 'crypto';
import { OtpModel } from '../otp.model.js';
import { EmailService } from '../../../services/email.service.js';
import { WhatsAppService } from '../../../services/whatsapp.service.js';
import { PasswordUtils } from '../../../utils/password.js';
import { AppError } from '../../../utils/appError.js';
import { env } from '../../../config/env.js';

/**
 * OTP used for local development and WhatsApp testing.
 *
 * IMPORTANT:
 * - Email OTP uses this only in development.
 * - WhatsApp OTP continues to use this for testing.
 */
const TEST_OTP_BYPASS_CODE = '123456';

/**
 * Returns true only for local development.
 *
 * This is intentionally NOT:
 * env.NODE_ENV !== 'production'
 *
 * because staging/non-production environments should use real OTPs.
 */
const isLocalDevelopment = () => env.NODE_ENV === 'development';

/**
 * Returns true when the WhatsApp testing bypass is enabled.
 *
 * WhatsApp behavior is intentionally kept as it was before.
 */
const isOtpBypassEnabled = () => env.NODE_ENV !== 'production';

export class OtpService {
  /**
   * Sends Email OTP.
   *
   * Development:
   * - OTP is always 123456
   * - No real email delivery is required
   *
   * Staging / Production:
   * - OTP is randomly generated
   * - OTP is hashed and stored in MongoDB
   * - OTP is sent through Resend via EmailService
   * - User must enter the OTP received in email
   *
   * OTP expires after 5 minutes.
   * Resend cooldown is 60 seconds.
   */
  static async sendEmailOtp(
    email: string
  ): Promise<{
    success: boolean;
    message: string;
    cooldown: number;
    otp?: string;
  }> {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Enforce 60-second cooldown
    const existingOtp = await OtpModel.findOne({
      identifier: normalizedEmail,
      type: 'email',
    });

    if (
      existingOtp &&
      existingOtp.cooldownUntil &&
      existingOtp.cooldownUntil.getTime() > Date.now()
    ) {
      const cooldownTtl = Math.ceil(
        (existingOtp.cooldownUntil.getTime() - Date.now()) / 1000
      );

      throw AppError.tooManyRequests(
        `Please wait ${cooldownTtl} seconds before requesting a new code.`
      );
    }

    // 2. Generate OTP
    //
    // Local development:
    //     123456
    //
    // Staging / Production:
    //     Random 6-digit OTP
    const rawOtp = isLocalDevelopment()
      ? TEST_OTP_BYPASS_CODE
      : crypto.randomInt(100000, 1000000).toString();

    // Hash OTP before storing it in MongoDB
    const otpHash = await PasswordUtils.hashPassword(rawOtp);

    const now = new Date();

    const cooldownUntil = new Date(
      now.getTime() + 60 * 1000
    );

    const expiresAt = new Date(
      now.getTime() + 5 * 60 * 1000
    );

    // 3. Store / Upsert OTP in MongoDB
    await OtpModel.findOneAndUpdate(
      {
        identifier: normalizedEmail,
        type: 'email',
      },
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
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    // 4. Send Email OTP
    //
    // EmailService now uses:
    // - Local development -> no real email required
    // - Staging/Production -> Resend
    try {
      const emailSent = await EmailService.sendOtpEmail(
        normalizedEmail,
        rawOtp
      );

      if (!emailSent) {
        // Do not leave an OTP in the database if email delivery failed.
        await OtpModel.deleteOne({
          identifier: normalizedEmail,
          type: 'email',
        }).catch(() => {});

        throw AppError.internal(
          'Unable to send verification email. Please try again later.'
        );
      }
    } catch (error) {
      // If AppError was already thrown, pass it through.
      if (error instanceof AppError) {
        throw error;
      }

      await OtpModel.deleteOne({
        identifier: normalizedEmail,
        type: 'email',
      }).catch(() => {});

      console.error(
        '[OTP SERVICE] ❌ Email dispatch failed:',
        error
      );

      throw AppError.internal(
        'Unable to send verification email. Please try again later.'
      );
    }

    // Log OTP only in local development.
    //
    // DO NOT log real production OTPs.
    if (isLocalDevelopment()) {
      console.log(
        `[OTP SERVICE] 🔑 Development OTP for ${normalizedEmail}: ${rawOtp}`
      );
    } else {
      console.log(
        `[OTP SERVICE] 📧 Email OTP sent to ${normalizedEmail}`
      );
    }

    return {
      success: true,
      message: `A 6-digit verification code has been sent to ${normalizedEmail}`,
      cooldown: 60,
    };
  }

  /**
   * Verifies Email OTP.
   *
   * Development:
   * - 123456 is accepted as the local testing OTP.
   *
   * Staging / Production:
   * - No bypass.
   * - OTP must match the hashed OTP stored in MongoDB.
   * - Maximum 5 attempts.
   * - OTP expires after 5 minutes.
   */
  static async verifyEmailOtp(
    email: string,
    code: string
  ): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Local development bypass ONLY.
    //
    // IMPORTANT:
    // 123456 will NOT bypass verification in staging/production.
    if (
      isLocalDevelopment() &&
      code === TEST_OTP_BYPASS_CODE
    ) {
      console.log(
        `[OTP BYPASS] Development email verification code accepted for ${normalizedEmail}`
      );

      await OtpModel.deleteOne({
        identifier: normalizedEmail,
        type: 'email',
      }).catch(() => {});

      return true;
    }

    // 2. Find OTP document
    const otpDoc = await OtpModel.findOne({
      identifier: normalizedEmail,
      type: 'email',
    });

    // 3. Check existence and expiry
    if (
      !otpDoc ||
      otpDoc.expiresAt.getTime() <= Date.now()
    ) {
      if (otpDoc) {
        await OtpModel.deleteOne({
          _id: otpDoc._id,
        });
      }

      throw AppError.badRequest(
        'Invalid or expired verification code. Please request a new code.'
      );
    }

    // 4. Check maximum attempts
    const maxAttempts = otpDoc.maxAttempts || 5;

    if (otpDoc.attempts >= maxAttempts) {
      await OtpModel.deleteOne({
        _id: otpDoc._id,
      });

      throw AppError.badRequest(
        `Maximum verification attempts (${maxAttempts}) exceeded. Please request a new code.`
      );
    }

    // 5. Compare entered OTP against bcrypt hash
    const isValid = await PasswordUtils.comparePassword(
      code,
      otpDoc.otpHash
    );

    // 6. Invalid OTP
    if (!isValid) {
      const updatedDoc = await OtpModel.findByIdAndUpdate(
        otpDoc._id,
        {
          $inc: {
            attempts: 1,
          },
        },
        {
          new: true,
        }
      );

      const currentAttempts = updatedDoc
        ? updatedDoc.attempts
        : otpDoc.attempts + 1;

      const remaining = Math.max(
        0,
        maxAttempts - currentAttempts
      );

      // Maximum attempts reached
      if (currentAttempts >= maxAttempts) {
        await OtpModel.deleteOne({
          _id: otpDoc._id,
        });

        throw AppError.badRequest(
          'Maximum verification attempts exceeded. Please request a new code.'
        );
      }

      throw AppError.badRequest(
        `Invalid verification code. ${remaining} attempts remaining.`
      );
    }

    // 7. OTP verified successfully.
    // Delete it so it cannot be reused.
    await OtpModel.deleteOne({
      _id: otpDoc._id,
    });

    return true;
  }

  /**
   * Sends WhatsApp OTP.
   *
   * Existing behavior is intentionally preserved:
   * - Uses 123456 for testing
   * - Existing bypass behavior remains
   * - 60-second cooldown
   * - 5-minute expiry
   */
  static async sendWhatsAppOtp(
    phone: string
  ): Promise<{
    success: boolean;
    message: string;
    cooldown: number;
    otp?: string;
  }> {
    const cleanPhone = phone.trim();

    // 1. Enforce 60-second cooldown
    const existingOtp = await OtpModel.findOne({
      identifier: cleanPhone,
      type: 'whatsapp',
    });

    if (
      existingOtp &&
      existingOtp.cooldownUntil &&
      existingOtp.cooldownUntil.getTime() > Date.now()
    ) {
      const cooldownTtl = Math.ceil(
        (existingOtp.cooldownUntil.getTime() - Date.now()) / 1000
      );

      throw AppError.tooManyRequests(
        `Please wait ${cooldownTtl} seconds before requesting a new WhatsApp code.`
      );
    }

    // 2. Generate WhatsApp OTP
    // Existing behavior preserved.
    const rawOtp = TEST_OTP_BYPASS_CODE;

    const otpHash = await PasswordUtils.hashPassword(
      rawOtp
    );

    const now = new Date();

    const cooldownUntil = new Date(
      now.getTime() + 60 * 1000
    );

    const expiresAt = new Date(
      now.getTime() + 5 * 60 * 1000
    );

    // 3. Store / Upsert in MongoDB
    await OtpModel.findOneAndUpdate(
      {
        identifier: cleanPhone,
        type: 'whatsapp',
      },
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
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    // 4. Dispatch WhatsApp OTP
    await WhatsAppService.sendOtpWhatsApp(
      cleanPhone,
      rawOtp
    ).catch((err) => {
      console.warn(
        `[OTP SERVICE] WhatsApp dispatch warning (testing mode active):`,
        err?.message || err
      );
    });

    console.log(
      `[OTP SERVICE] 🔑 Active WhatsApp OTP code for ${cleanPhone}: ${rawOtp}`
    );

    return {
      success: true,
      message: `A 6-digit verification code has been sent to your WhatsApp number ${cleanPhone}`,
      cooldown: 60,
    };
  }

  /**
   * Verifies WhatsApp OTP.
   *
   * Existing behavior is intentionally preserved.
   */
  static async verifyWhatsAppOtp(
    phone: string,
    code: string
  ): Promise<boolean> {
    const cleanPhone = phone.trim();

    // Existing WhatsApp bypass behavior.
    if (
      code === TEST_OTP_BYPASS_CODE ||
      isOtpBypassEnabled()
    ) {
      console.log(
        `[OTP BYPASS] WhatsApp verification code "${code}" accepted for ${cleanPhone}`
      );

      await OtpModel.deleteOne({
        identifier: cleanPhone,
        type: 'whatsapp',
      }).catch(() => {});

      return true;
    }

    const otpDoc = await OtpModel.findOne({
      identifier: cleanPhone,
      type: 'whatsapp',
    });

    if (
      !otpDoc ||
      otpDoc.expiresAt.getTime() <= Date.now()
    ) {
      if (otpDoc) {
        await OtpModel.deleteOne({
          _id: otpDoc._id,
        });
      }

      throw AppError.badRequest(
        'Invalid or expired WhatsApp verification code. Please request a new code.'
      );
    }

    const maxAttempts = otpDoc.maxAttempts || 5;

    if (otpDoc.attempts >= maxAttempts) {
      await OtpModel.deleteOne({
        _id: otpDoc._id,
      });

      throw AppError.badRequest(
        `Maximum verification attempts (${maxAttempts}) exceeded. Please request a new code.`
      );
    }

    const isValid = await PasswordUtils.comparePassword(
      code,
      otpDoc.otpHash
    );

    if (!isValid) {
      const updatedDoc = await OtpModel.findByIdAndUpdate(
        otpDoc._id,
        {
          $inc: {
            attempts: 1,
          },
        },
        {
          new: true,
        }
      );

      const currentAttempts = updatedDoc
        ? updatedDoc.attempts
        : otpDoc.attempts + 1;

      const remaining = Math.max(
        0,
        maxAttempts - currentAttempts
      );

      if (currentAttempts >= maxAttempts) {
        await OtpModel.deleteOne({
          _id: otpDoc._id,
        });

        throw AppError.badRequest(
          'Maximum verification attempts exceeded. Please request a new code.'
        );
      }

      throw AppError.badRequest(
        `Invalid verification code. ${remaining} attempts remaining.`
      );
    }

    // OTP verified -> delete MongoDB document
    await OtpModel.deleteOne({
      _id: otpDoc._id,
    });

    return true;
  }

  // Aliases for backward compatibility
  static sendOtp = OtpService.sendEmailOtp;
  static verifyOtp = OtpService.verifyEmailOtp;
}