import { Schema, model, Document } from 'mongoose';

export interface IUserDocument extends Document {
  username?: string;
  email?: string;
  phone?: string;
  passwordHash?: string;
  fullName?: string;
  avatar?: string;
  avatarUrl?: string;
  provider: 'email' | 'google' | 'local' | 'whatsapp';
  emailVerified: boolean;
  isEmailVerified?: boolean;
  phoneVerified: boolean;
  role: 'user' | 'admin' | 'recruiter' | 'Super Admin' | 'Admin' | 'Staff' | 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'USER' | string;
  entityType?: 'company' | 'institution' | 'startup';
  hasBuiltResume?: boolean;
  refreshTokenHash?: string | null;
  previousRefreshTokenHash?: string | null;
  previousRefreshTokenExpiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    username: { type: String, unique: true, sparse: true, lowercase: true, trim: true, index: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true, index: true },
    phone: { type: String, unique: true, sparse: true, trim: true, index: true },
    passwordHash: { type: String, required: false },
    fullName: { type: String, required: false, trim: true },
    avatar: { type: String, default: undefined },
    avatarUrl: { type: String, default: undefined },
    provider: { type: String, enum: ['email', 'google', 'local', 'whatsapp'], default: 'email' },
    emailVerified: { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },
    role: { type: String, default: 'user' },
    entityType: { type: String, enum: ['company', 'institution', 'startup'], required: false },
    hasBuiltResume: { type: Boolean, default: false },
    refreshTokenHash: { type: String, default: null },
    previousRefreshTokenHash: { type: String, default: null },
    previousRefreshTokenExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

UserSchema.index({ email: 1, provider: 1 });
UserSchema.index({ phone: 1, provider: 1 });

export const UserModel = model<IUserDocument>('User', UserSchema);
