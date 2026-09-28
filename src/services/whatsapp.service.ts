import { env } from '../config/env.js';

export class WhatsAppService {
  static async sendOtpWhatsApp(fullPhoneNumber: string, otpCode: string): Promise<boolean> {
    // Sanitize phone number (strip +, spaces, dashes)
    const cleanPhone = fullPhoneNumber.replace(/[^0-9]/g, '');

    console.log(`[META WHATSAPP SERVICE] 💬 Verification OTP code for +${cleanPhone}: ${otpCode}`);

    if (!env.META_ACCESS_TOKEN || !env.META_PHONE_NUMBER_ID) {
      console.log(
        `[META WHATSAPP SERVICE] ℹ️ META_ACCESS_TOKEN or META_PHONE_NUMBER_ID not set. Simulated WhatsApp delivery to +${cleanPhone}`
      );
      return true;
    }

    try {
      const url = `https://graph.facebook.com/v18.0/${env.META_PHONE_NUMBER_ID}/messages`;
      
      // Attempt 1: Text message format
      const textPayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: {
          preview_url: false,
          body: `Your LetGetIn verification code is: ${otpCode}. Valid for 5 minutes. Do not share this code with anyone.`,
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(textPayload),
      });

      const data = (await response.json()) as { error?: { message: string } };

      if (!response.ok || data.error) {
        console.warn('⚠️ Meta WhatsApp Text API warning, trying template message format:', data.error?.message);
        
        // Attempt 2: Template format (common for Meta WhatsApp Business)
        const templatePayload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanPhone,
          type: 'template',
          template: {
            name: 'otp_code',
            language: { code: 'en_US' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: otpCode }],
              },
              {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: otpCode }],
              },
            ],
          },
        };

        const templateResp = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(templatePayload),
        });

        const templateData = (await templateResp.json()) as { error?: { message: string } };
        if (!templateResp.ok || templateData.error) {
          console.error('❌ Meta WhatsApp API Error:', templateData.error?.message || 'Failed to send WhatsApp OTP');
          return false;
        }
      }

      console.log(`✅ Meta WhatsApp OTP sent successfully to +${cleanPhone}`);
      return true;
    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      console.error('❌ Meta WhatsApp delivery exception:', msg);
      return false;
    }
  }
}
