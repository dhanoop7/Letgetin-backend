import { Schema, model, Document } from 'mongoose';
import { AI_CONFIG } from '../../config/ai.config.js';

export interface IAIUsageDocument extends Document {
  userId: Schema.Types.ObjectId;
  requestType: string;
  promptTokens: number;
  completionTokens: number;
  modelUsed: string;
  createdAt: Date;
}

const AIUsageSchema = new Schema<IAIUsageDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requestType: { type: String, required: true },
    promptTokens: { type: Number, required: true, default: 0 },
    completionTokens: { type: Number, required: true, default: 0 },
    modelUsed: { type: String, required: true, default: () => AI_CONFIG.model },
  },
  { timestamps: true }
);

AIUsageSchema.index({ userId: 1, createdAt: -1 });

export const AIUsageModel = model<IAIUsageDocument>('AIUsage', AIUsageSchema);
