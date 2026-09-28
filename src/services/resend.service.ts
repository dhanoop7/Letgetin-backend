import { EmailService } from './email.service.js';

/**
 * @deprecated Use EmailService directly (Gmail SMTP powered by Nodemailer).
 */
export class ResendService {
  static async sendOtpEmail(toEmail: string, otpCode: string): Promise<boolean> {
    return EmailService.sendOtpEmail(toEmail, otpCode);
  }
}
