import { env } from './env.js';

export interface AIConfig {
  provider: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeout: number;
  retryAttempts: number;
  assistant: {
    instant: AssistantModeConfig;
    expert: AssistantModeConfig;
  };
}

export interface AssistantModeConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  stream: boolean;
}

export const AI_CONFIG: AIConfig = {
  provider: 'google',
  model: process.env.GEMINI_MODEL || env.GEMINI_MODEL || 'gemini-3.6-flash',
  temperature: process.env.AI_TEMPERATURE ? parseFloat(process.env.AI_TEMPERATURE) : env.AI_TEMPERATURE,
  maxOutputTokens: process.env.AI_MAX_TOKENS ? parseInt(process.env.AI_MAX_TOKENS, 10) : env.AI_MAX_TOKENS,
  timeout: process.env.AI_TIMEOUT ? parseInt(process.env.AI_TIMEOUT, 10) : env.AI_TIMEOUT,
  retryAttempts: process.env.AI_RETRY_ATTEMPTS ? parseInt(process.env.AI_RETRY_ATTEMPTS, 10) : env.AI_RETRY_ATTEMPTS,
  assistant: {
    instant: {
      model: env.GEMINI_INSTANT_MODEL,
      temperature: env.AI_INSTANT_TEMPERATURE,
      maxOutputTokens: env.AI_INSTANT_MAX_TOKENS,
      stream: false,
    },
    expert: {
      model: env.GEMINI_EXPERT_MODEL,
      temperature: env.AI_EXPERT_TEMPERATURE,
      maxOutputTokens: env.AI_EXPERT_MAX_TOKENS,
      stream: true,
    },
  },
};
