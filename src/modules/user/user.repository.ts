import { BaseRepository } from '../shared/base.repository.js';
import { IUserDocument, UserModel } from './user.model.js';

export class UserRepository extends BaseRepository<IUserDocument> {
  constructor() {
    super(UserModel);
  }

  async findByEmail(email: string): Promise<IUserDocument | null> {
    return await this.findOne({ email: email.toLowerCase().trim() });
  }

  async findByUsername(username: string): Promise<IUserDocument | null> {
    return await this.findOne({ username: username.toLowerCase().trim() });
  }

  async findByPhone(phone: string): Promise<IUserDocument | null> {
    return await this.findOne({ phone: phone.trim() });
  }

  async findByEmailOrPhoneOrUsername(identifier: string): Promise<IUserDocument | null> {
    const clean = identifier.trim();
    const lower = clean.toLowerCase();
    return await this.findOne({
      $or: [
        { email: lower },
        { username: lower },
        { phone: clean },
      ],
    });
  }

  async updateRefreshToken(userId: string, refreshTokenHash: string | null): Promise<void> {
    await this.updateById(userId, {
      refreshTokenHash,
      previousRefreshTokenHash: null,
      previousRefreshTokenExpiresAt: null,
    });
  }

  async rotateRefreshToken(
    userId: string,
    newRefreshTokenHash: string,
    previousRefreshTokenHash?: string | null,
    gracePeriodMs: number = 30000
  ): Promise<void> {
    await this.updateById(userId, {
      refreshTokenHash: newRefreshTokenHash,
      previousRefreshTokenHash: previousRefreshTokenHash || null,
      previousRefreshTokenExpiresAt: previousRefreshTokenHash ? new Date(Date.now() + gracePeriodMs) : null,
    });
  }
}
