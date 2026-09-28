import { Schema, model, Document } from 'mongoose';

export type OtpType = 'email' | 'whatsapp';

export interface IOtpDocument extends Document {
  identifier: string; // Normalized email or phone number
  type: OtpType;
  otpHash: string;
  attempts: number;
  maxAttempts: number;
  cooldownUntil: Date;
  expiresAt: Date;
  lastSentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OtpSchema = new Schema<IOtpDocument>(
  {
    identifier: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['email', 'whatsapp'],
      default: 'email',
      required: true,
      index: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    cooldownUntil: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 60 * 1000), // 60 seconds cooldown
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    lastSentAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// TTL index: MongoDB automatically purges expired OTP documents when expiresAt is reached
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound unique index: guarantees single active OTP document per identifier + channel type
OtpSchema.index({ identifier: 1, type: 1 }, { unique: true });

export const OtpModel = model<IOtpDocument>('Otp', OtpSchema);
