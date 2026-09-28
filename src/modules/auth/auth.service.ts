import { UserRepository } from '../user/user.repository.js';
import { LoginInput, VerifyOtpInput, VerifyWhatsAppOtpInput } from './auth.validator.js';
import { PasswordUtils } from '../../utils/password.js';
import { JwtUtils, TokenPayload } from '../../utils/jwt.js';
import { AppError } from '../../utils/appError.js';
import { IUserDocument } from '../user/user.model.js';
import { OtpService } from './services/otp.service.js';
import { GoogleService } from './services/google.service.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  private userRepository: UserRepository;

  constructor() {
    this.userRepository = new UserRepository();
  }

  // --- Email OTP ---
  async sendEmailOtp(email: string): Promise<{ success: boolean; message: string; cooldown: number }> {
    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      throw AppError.conflict('An account with this email address already exists. Please log in.');
    }
    return await OtpService.sendEmailOtp(email);
  }

  async verifyEmailOtpAndCreateUser(input: VerifyOtpInput): Promise<{ user: Partial<IUserDocument>; tokens: AuthTokens }> {
    // 1. Verify OTP code in MongoDB
    await OtpService.verifyEmailOtp(input.email, input.otp);

    // 2. Check username availability
    const existingUsername = await this.userRepository.findByUsername(input.username);
    if (existingUsername) {
      throw AppError.conflict('Username is already taken. Please choose another username.');
    }

    // 3. Check email availability
    const existingEmail = await this.userRepository.findByEmail(input.email);
    if (existingEmail) {
      throw AppError.conflict('An account with this email address already exists');
    }

    // 4. Hash password with bcrypt cost factor 12
    const passwordHash = await PasswordUtils.hashPassword(input.password);

    // 5. Create user record
    const user = await this.userRepository.create({
      username: input.username.toLowerCase().trim(),
      email: input.email.toLowerCase().trim(),
      passwordHash,
      fullName: input.username,
      provider: 'email',
      emailVerified: true,
      isEmailVerified: true,
      phoneVerified: false,
      role: input.role || 'user',
      entityType: input.role === 'recruiter' ? input.entityType : undefined,
    });

    // 6. Generate JWT Tokens
    const payload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email || user.username || '',
      role: user.role,
    };

    const accessToken = JwtUtils.generateAccessToken(payload);
    const refreshToken = JwtUtils.generateRefreshToken(payload);

    const refreshTokenHash = await PasswordUtils.hashPassword(refreshToken);
    await this.userRepository.updateRefreshToken(user._id.toString(), refreshTokenHash);

    return {
      user: this.sanitizeUser(user),
      tokens: { accessToken, refreshToken },
    };
  }

  // Alias for backward compatibility
  async sendOtp(email: string) {
    return this.sendEmailOtp(email);
  }
  async verifyOtpAndCreateUser(input: VerifyOtpInput) {
    return this.verifyEmailOtpAndCreateUser(input);
  }

  // --- WhatsApp OTP ---
  async sendWhatsAppOtp(countryCode: string, phone: string): Promise<{ success: boolean; message: string; cooldown: number }> {
    const fullPhone = `${countryCode.trim()}${phone.trim()}`;
    const existingUser = await this.userRepository.findByPhone(fullPhone);
    if (existingUser) {
      throw AppError.conflict('An account with this WhatsApp phone number already exists. Please log in.');
    }
    return await OtpService.sendWhatsAppOtp(fullPhone);
  }

  async verifyWhatsAppOtpAndCreateUser(input: VerifyWhatsAppOtpInput): Promise<{ user: Partial<IUserDocument>; tokens: AuthTokens }> {
    const countryCode = input.countryCode || '';
    const fullPhone = `${countryCode.trim()}${input.phone.trim()}`;

    // 1. Verify OTP code in MongoDB
    await OtpService.verifyWhatsAppOtp(fullPhone, input.otp);

    // 2. Check username availability
    const existingUsername = await this.userRepository.findByUsername(input.username);
    if (existingUsername) {
      throw AppError.conflict('Username is already taken. Please choose another username.');
    }

    // 3. Check phone availability
    const existingPhone = await this.userRepository.findByPhone(fullPhone);
    if (existingPhone) {
      throw AppError.conflict('An account with this WhatsApp phone number already exists');
    }

    // 4. Hash password with bcrypt cost factor 12
    const passwordHash = await PasswordUtils.hashPassword(input.password);

    // 5. Create user record
    const user = await this.userRepository.create({
      username: input.username.toLowerCase().trim(),
      phone: fullPhone,
      passwordHash,
      fullName: input.username,
      provider: 'whatsapp',
      emailVerified: false,
      isEmailVerified: false,
      phoneVerified: true,
      role: input.role || 'user',
      entityType: input.role === 'recruiter' ? input.entityType : undefined,
    });

    // 6. Generate JWT Tokens
    const payload: TokenPayload = {
      userId: user._id.toString(),
      email: user.phone || user.username || '',
      role: user.role,
    };

    const accessToken = JwtUtils.generateAccessToken(payload);
    const refreshToken = JwtUtils.generateRefreshToken(payload);

    const refreshTokenHash = await PasswordUtils.hashPassword(refreshToken);
    await this.userRepository.updateRefreshToken(user._id.toString(), refreshTokenHash);

    return {
      user: this.sanitizeUser(user),
      tokens: { accessToken, refreshToken },
    };
  }

  // --- Login ---
  async login(input: LoginInput): Promise<{ user: Partial<IUserDocument>; tokens: AuthTokens }> {
    const identifier = input.emailOrPhone || input.email || input.phone;
    if (!identifier) {
      throw AppError.badRequest('Email, username or phone number is required');
    }

    const user = await this.userRepository.findByEmailOrPhoneOrUsername(identifier);
    if (!user) {
      throw AppError.unauthorized('Invalid credentials. Please check your email/phone and password.');
    }

    if (!user.passwordHash) {
      throw AppError.badRequest('This account uses Google Sign-In. Please sign in with Google.');
    }

    const isPasswordValid = await PasswordUtils.comparePassword(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw AppError.unauthorized('Invalid credentials. Please check your email/phone and password.');
    }

    const payload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email || user.phone || user.username || '',
      role: user.role,
    };

    const accessToken = JwtUtils.generateAccessToken(payload);
    const refreshToken = JwtUtils.generateRefreshToken(payload);

    const refreshTokenHash = await PasswordUtils.hashPassword(refreshToken);
    await this.userRepository.updateRefreshToken(user._id.toString(), refreshTokenHash);

    return {
      user: this.sanitizeUser(user),
      tokens: { accessToken, refreshToken },
    };
  }

  // --- Google OAuth ---
  async googleAuth(credential: string): Promise<{ user: Partial<IUserDocument>; tokens: AuthTokens }> {
    const googleProfile = await GoogleService.verifyIdToken(credential);
    let user = await this.userRepository.findByEmail(googleProfile.email);

    if (user) {
      if (user.provider !== 'google') {
        user.provider = 'google';
      }
      user.emailVerified = true;
      user.isEmailVerified = true;
      if (!user.avatarUrl && googleProfile.picture) {
        user.avatarUrl = googleProfile.picture;
        user.avatar = googleProfile.picture;
      }
      await user.save();
    } else {
      let baseUsername = googleProfile.email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '');
      if (baseUsername.length < 3) baseUsername = `user_${baseUsername}`;
      
      let username = baseUsername;
      let counter = 1;
      while (await this.userRepository.findByUsername(username)) {
        username = `${baseUsername}_${counter}`;
        counter++;
      }

      user = await this.userRepository.create({
        username: username.toLowerCase(),
        email: googleProfile.email.toLowerCase(),
        fullName: googleProfile.name || username,
        provider: 'google',
        emailVerified: true,
        isEmailVerified: true,
        phoneVerified: false,
        avatar: googleProfile.picture || undefined,
        avatarUrl: googleProfile.picture || undefined,
        role: 'user',
      });
    }

    const payload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email!,
      role: user.role,
    };

    const accessToken = JwtUtils.generateAccessToken(payload);
    const refreshToken = JwtUtils.generateRefreshToken(payload);

    const refreshTokenHash = await PasswordUtils.hashPassword(refreshToken);
    await this.userRepository.updateRefreshToken(user._id.toString(), refreshTokenHash);

    return {
      user: this.sanitizeUser(user),
      tokens: { accessToken, refreshToken },
    };
  }

  async refreshToken(token: string): Promise<{ user: Partial<IUserDocument>; tokens: AuthTokens }> {
    try {
      const payload = JwtUtils.verifyRefreshToken(token);
      const user = await this.userRepository.findById(payload.userId);

      if (!user) {
        throw AppError.unauthorized('User session not found');
      }

      let isMatch = false;

      // 1. Check primary active refresh token
      if (user.refreshTokenHash) {
        isMatch = await PasswordUtils.comparePassword(token, user.refreshTokenHash);
      }

      // 2. If not matched on primary, check previous token if within grace period (multi-tab / concurrent refresh protection)
      if (!isMatch && user.previousRefreshTokenHash && user.previousRefreshTokenExpiresAt) {
        const now = new Date();
        if (now <= new Date(user.previousRefreshTokenExpiresAt)) {
          isMatch = await PasswordUtils.comparePassword(token, user.previousRefreshTokenHash);
        }
      }

      if (!isMatch) {
        // Token reuse or compromised token detected — invalidate stored tokens for security
        await this.userRepository.updateRefreshToken(user._id.toString(), null);
        throw AppError.unauthorized('Invalid or expired refresh token');
      }

      const newPayload: TokenPayload = {
        userId: user._id.toString(),
        email: user.email || user.phone || user.username || '',
        role: user.role,
      };

      const accessToken = JwtUtils.generateAccessToken(newPayload);
      const refreshToken = JwtUtils.generateRefreshToken(newPayload);

      const refreshTokenHash = await PasswordUtils.hashPassword(refreshToken);
      await this.userRepository.rotateRefreshToken(
        user._id.toString(),
        refreshTokenHash,
        user.refreshTokenHash,
        30000 // 30-second grace window for concurrent requests
      );

      return {
        user: this.sanitizeUser(user),
        tokens: { accessToken, refreshToken },
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw AppError.unauthorized('Invalid or expired refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    await this.userRepository.updateRefreshToken(userId, null);
  }

  async getMe(userId: string): Promise<Partial<IUserDocument>> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw AppError.notFound('User not found');
    }
    return this.sanitizeUser(user);
  }

  public sanitizeUser(user: IUserDocument): Partial<IUserDocument> {
    const avatar = (user.avatar || user.avatarUrl) ? String(user.avatar || user.avatarUrl) : undefined;
    return {
      _id: user._id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName || user.username || user.email?.split('@')[0] || user.phone,
      provider: user.provider,
      emailVerified: user.emailVerified ?? user.isEmailVerified ?? false,
      phoneVerified: user.phoneVerified ?? false,
      avatar,
      avatarUrl: avatar,
      role: user.role,
      entityType: user.entityType,
      hasBuiltResume: user.hasBuiltResume ?? false,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
