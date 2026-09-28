import { OAuth2Client } from 'google-auth-library';
import { env } from '../../../config/env.js';
import { AppError } from '../../../utils/appError.js';

export interface VerifiedGoogleProfile {
  email: string;
  name?: string;
  picture?: string;
  googleId: string;
  emailVerified: boolean;
}

export class GoogleService {
  /**
   * Verifies the Google ID token using google-auth-library.
   * Extracts email, name, picture, sub (googleId), email_verified.
   */
  static async verifyIdToken(idToken: string): Promise<VerifiedGoogleProfile> {
    if (!idToken || typeof idToken !== 'string') {
      throw AppError.badRequest('Google ID token (credential) is required');
    }

    try {
      const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID || undefined,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        throw AppError.unauthorized('Invalid Google ID token payload');
      }

      return {
        email: payload.email.toLowerCase(),
        name: payload.name || payload.given_name || payload.email.split('@')[0],
        picture: payload.picture,
        googleId: payload.sub,
        emailVerified: Boolean(payload.email_verified),
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      console.error('Google ID Token Verification Error:', error.message || error);
      throw AppError.unauthorized(`Google ID token verification failed: ${error.message || 'Invalid credential'}`);
    }
  }
}
