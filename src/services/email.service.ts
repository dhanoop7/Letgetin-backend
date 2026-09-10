import nodemailer, { Transporter, SendMailOptions, SentMessageInfo } from 'nodemailer';
import { env } from '../config/env.js';

export class EmailService {
  private static transporter: Transporter | null = null;

  /**
   * Returns a singleton instance of the Nodemailer transporter.
   */
  private static getTransporter(): Transporter | null {
    if (this.transporter) {
      return this.transporter;
    }

    if (!env.SMTP_USER || !env.SMTP_PASS) {
      return null;
    }

    // Clean Gmail App Password (strip any accidental spaces)
    const cleanedPass = env.SMTP_PASS.replace(/\s+/g, '');
    const isSecure = env.SMTP_PORT === 465 || env.SMTP_SECURE;

    const transportConfig: any = {
      host: env.SMTP_HOST || 'smtp.gmail.com',
      port: env.SMTP_PORT || 465,
      secure: isSecure,
      auth: {
        user: env.SMTP_USER,
        pass: cleanedPass,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 15000, // 15s timeout
      greetingTimeout: 15000,
      socketTimeout: 20000,
    };

    // If using Gmail or explicitly set service, configure service preset
    if (env.SMTP_SERVICE) {
      transportConfig.service = env.SMTP_SERVICE;
    } else if (env.SMTP_HOST?.includes('gmail')) {
      transportConfig.service = 'gmail';
    }

    this.transporter = nodemailer.createTransport(transportConfig);

    console.log(
      `[EMAIL SERVICE] ℹ️ Gmail SMTP transporter initialized (service: ${transportConfig.service || 'custom'}, host: ${env.SMTP_HOST}, port: ${env.SMTP_PORT}, secure: ${isSecure})`
    );

    return this.transporter;
  }

  /**
   * Verifies SMTP connection and credentials wrapped in a Promise.
   */
  static async verifyConnection(): Promise<boolean> {
    const transporter = this.getTransporter();
    if (!transporter) {
      console.warn('[EMAIL SERVICE] ⚠️ SMTP credentials not configured.');
      return false;
    }

    try {
      await new Promise<boolean>((resolve, reject) => {
        transporter.verify((err: any, success: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(!!success);
          }
        });
      });
      console.log('[EMAIL SERVICE] ✅ Gmail SMTP server connection verified successfully.');
      return true;
    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      console.error('[EMAIL SERVICE] ❌ SMTP verification error:', msg);
      return false;
    }
  }

  /**
   * Generic email sender wrapped in a Promise for reliable execution on cloud containers like Render.
   */
  static async sendMail(mailData: SendMailOptions): Promise<SentMessageInfo> {
    const transporter = this.getTransporter();
    if (!transporter) {
      throw new Error('SMTP transporter not initialized. Please verify SMTP_USER and SMTP_PASS.');
    }

    return new Promise<SentMessageInfo>((resolve, reject) => {
      transporter.sendMail(mailData, (err: any, info: any) => {
        if (err) {
          console.error('[EMAIL SERVICE] ❌ Nodemailer delivery error:', err);
          reject(err);
        } else {
          resolve(info as SentMessageInfo);
        }
      });
    });
  }

  /**
   * Sends a high-priority 6-digit OTP verification email via Gmail SMTP.
   */
  static async sendOtpEmail(toEmail: string, otpCode: string): Promise<boolean> {
    const normalizedEmail = toEmail.toLowerCase().trim();
    const transporter = this.getTransporter();

    console.log(`[EMAIL SERVICE] 📧 Verification OTP code for ${normalizedEmail}: ${otpCode}`);

    if (!transporter || !env.SMTP_USER || !env.SMTP_PASS) {
      console.log(`[EMAIL SERVICE] ℹ️ SMTP credentials not configured. Simulated email delivery to ${normalizedEmail}`);
      return true;
    }

    const fromAddress = env.EMAIL_FROM || `LetGetIn <${env.SMTP_USER}>`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Verification Code</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f8fafc; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" max-width="540px" cellspacing="0" cellpadding="0" border="0" style="max-width: 540px; background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); overflow: hidden;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 32px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">LetGetIn</h1>
              <p style="margin: 6px 0 0 0; color: rgba(255, 255, 255, 0.85); font-size: 13px; font-weight: 500;">Next-Gen AI Career & Recruitment Platform</p>
            </td>
          </tr>

          <!-- Main Content Body -->
          <tr>
            <td style="padding: 36px 32px 28px 32px;">
              <h2 style="margin: 0 0 12px 0; color: #0f172a; font-size: 18px; font-weight: 700;">Account Verification</h2>
              <p style="margin: 0 0 24px 0; color: #475569; font-size: 14px; line-height: 1.6;">
                Use the following 6-digit verification code to complete your sign-in or registration request.
              </p>

              <!-- OTP Code Display Card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td align="center" style="background: #f1f5f9; border-radius: 14px; border: 2px dashed #cbd5e1; padding: 20px;">
                    <div style="font-family: 'SF Mono', Consolas, Menlo, Monaco, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; user-select: all;">
                      ${otpCode}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Expiry & Security Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="background-color: #fffbeb; border-radius: 12px; border: 1px solid #fef3c7; padding: 14px 16px;">
                    <p style="margin: 0; color: #92400e; font-size: 12px; font-weight: 600; line-height: 1.5;">
                      ⏱️ <strong>Expires in 5 minutes:</strong> This one-time code is valid only for 5 minutes.
                    </p>
                    <p style="margin: 6px 0 0 0; color: #b45309; font-size: 11.5px; line-height: 1.5;">
                      🛡️ <strong>Security Tip:</strong> Never share this code with anyone. LetGetIn representatives will never ask for your verification code.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                If you did not request this verification code, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                &copy; ${new Date().getFullYear()} LetGetIn AI Inc. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const textContent = `Your LetGetIn Verification Code is: ${otpCode}\n\nThis code will expire in 5 minutes.\n\nIf you did not request this code, please ignore this email.`;

    const mailData: SendMailOptions = {
      from: fromAddress,
      to: normalizedEmail,
      subject: `${otpCode} is your LetGetIn verification code`,
      text: textContent,
      html: htmlContent,
    };

    try {
      const info = await new Promise<SentMessageInfo>((resolve, reject) => {
        transporter.sendMail(mailData, (err: any, info: any) => {
          if (err) {
            console.error(`[EMAIL SERVICE] ❌ Error sending email to ${normalizedEmail}:`, err);
            reject(err);
          } else {
            resolve(info as SentMessageInfo);
          }
        });
      });

      console.log(
        `[EMAIL SERVICE] ✅ Gmail SMTP OTP email sent successfully to ${normalizedEmail} (MessageId: ${info.messageId})`
      );
      return true;
    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      console.error(`[EMAIL SERVICE] ❌ Gmail SMTP delivery failed to ${normalizedEmail}:`, msg);
      return false;
    }
  }
}
