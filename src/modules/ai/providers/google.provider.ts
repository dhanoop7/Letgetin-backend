import { GoogleGenAI } from '@google/genai';
import { env } from '../../../config/env.js';
import { AI_CONFIG } from '../../../config/ai.config.js';
import crypto from 'crypto';

export interface GenerateOptions {
  prompt: string;
  promptName: string;
  systemInstruction?: string;
  jsonMode?: boolean;
  timeoutMs?: number;
  retryAttempts?: number;
  temperature?: number;
  model?: string;
  maxOutputTokens?: number;
}

export interface GenerateResponse {
  text: string;
  requestId: string;
  executionTimeMs: number;
  promptTokens: number;
  completionTokens: number;
  retryCount: number;
}

export class GoogleProvider {
  private static instance: GoogleProvider | null = null;
  private ai: GoogleGenAI | null = null;

  private constructor() {
    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    } else {
      console.warn('⚠️ GEMINI_API_KEY is missing. GoogleProvider is uninitialized.');
    }
  }

  /**
   * Singleton instance accessor
   */
  public static getInstance(): GoogleProvider {
    if (!GoogleProvider.instance) {
      GoogleProvider.instance = new GoogleProvider();
    }
    return GoogleProvider.instance;
  }

  /**
   * Primary entrypoint to execute AI generation with retries, timeout, and structured logging.
   */
  public async generate(options: GenerateOptions): Promise<GenerateResponse> {
    const requestId = `req_${crypto.randomBytes(6).toString('hex')}`;
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? AI_CONFIG.timeout;
    const maxRetries = options.retryAttempts ?? AI_CONFIG.retryAttempts;
    const modelName = options.model ?? AI_CONFIG.model;

    if (!this.ai) {
      throw new Error(`Google AI Provider error: GEMINI_API_KEY is not configured.`);
    }

    let lastError: Error | null = null;
    let retryCount = 0;

    for (retryCount = 0; retryCount < maxRetries; retryCount++) {
      if (retryCount > 0) {
        const backoffMs = Math.pow(2, retryCount) * 1000;
        console.warn(`[AI Request ${requestId}] Retrying attempt ${retryCount + 1}/${maxRetries} after ${backoffMs}ms backoff...`);
        await new Promise((res) => setTimeout(res, backoffMs));
      }

      try {
        const responseText = await this.executeWithTimeout(options, modelName, timeoutMs);
        const executionTimeMs = Date.now() - startTime;

        // Structured Logging
        console.log(`\n=========== AI EXECUTION LOG ===========`);
        console.log(`Request ID     : ${requestId}`);
        console.log(`Prompt Name    : ${options.promptName}`);
        console.log(`Model Used     : ${modelName}`);
        console.log(`Execution Time : ${executionTimeMs} ms`);
        console.log(`Retry Count    : ${retryCount}`);
        console.log(`Status         : SUCCESS`);
        console.log(`========================================\n`);

        return {
          text: responseText,
          requestId,
          executionTimeMs,
          promptTokens: Math.ceil(options.prompt.length / 4),
          completionTokens: Math.ceil(responseText.length / 4),
          retryCount,
        };
      } catch (err: any) {
        lastError = err;
        console.error(`[AI Request ${requestId}] Attempt ${retryCount + 1} failed: ${err?.message || err}`);
        // Fail fast on errors a retry can never fix: rate/quota limits (429) and malformed/rejected
        // requests (400/401/403) - retrying an identically invalid request just wastes latency before
        // the caller's fallback kicks in.
        if (
          err?.message?.includes('429') ||
          err?.message?.includes('quota') ||
          err?.message?.includes('RESOURCE_EXHAUSTED') ||
          err?.message?.includes('INVALID_ARGUMENT') ||
          err?.message?.includes('400') ||
          err?.message?.includes('401') ||
          err?.message?.includes('403') ||
          err?.status === 429 ||
          err?.status === 400 ||
          err?.status === 401 ||
          err?.status === 403
        ) {
          break;
        }
      }
    }

    const totalTimeMs = Date.now() - startTime;
    console.error(`\n=========== AI EXECUTION FAILED ===========`);
    console.error(`Request ID     : ${requestId}`);
    console.error(`Prompt Name    : ${options.promptName}`);
    console.error(`Model Used     : ${modelName}`);
    console.error(`Execution Time : ${totalTimeMs} ms`);
    console.error(`Total Retries  : ${retryCount}`);
    console.error(`Final Error    : ${lastError?.message}`);
    console.error(`===========================================\n`);

    throw new Error(`AI Provider failed [${options.promptName}] after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Progressive streaming execution using modern GoogleGenAI generateContentStream.
   */
  public async generateStream(
    options: GenerateOptions,
    onChunk: (chunkText: string) => void
  ): Promise<GenerateResponse> {
    const requestId = `req_stream_${crypto.randomBytes(6).toString('hex')}`;
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? AI_CONFIG.timeout;
    const modelName = options.model ?? AI_CONFIG.model;

    if (!this.ai) {
      throw new Error(`Google AI Provider error: GEMINI_API_KEY is not configured.`);
    }

    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`AI stream timed out after ${timeoutMs / 1000} seconds.`));
      }, timeoutMs);
    });

    try {
      const streamCallPromise = async (): Promise<string> => {
        const responseStream = await this.ai!.models.generateContentStream({
          model: modelName,
          contents: options.prompt,
          config: {
            temperature: options.temperature ?? AI_CONFIG.temperature,
            maxOutputTokens: options.maxOutputTokens ?? AI_CONFIG.maxOutputTokens,
            ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
            ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
          },
        });

        let accumulatedText = '';
        for await (const chunk of responseStream) {
          const text = chunk.text;
          if (text) {
            accumulatedText += text;
            onChunk(text);
          }
        }
        return accumulatedText;
      };

      const rawResult = await Promise.race([streamCallPromise(), timeoutPromise]);
      const cleanedText = this.cleanResponseText(rawResult, !!options.jsonMode);
      const executionTimeMs = Date.now() - startTime;

      console.log(`\n=========== AI STREAM EXECUTION LOG ===========`);
      console.log(`Request ID     : ${requestId}`);
      console.log(`Prompt Name    : ${options.promptName}`);
      console.log(`Model Used     : ${modelName}`);
      console.log(`Execution Time : ${executionTimeMs} ms`);
      console.log(`Status         : STREAM_SUCCESS`);
      console.log(`===============================================\n`);

      return {
        text: cleanedText,
        requestId,
        executionTimeMs,
        promptTokens: Math.ceil(options.prompt.length / 4),
        completionTokens: Math.ceil(cleanedText.length / 4),
        retryCount: 0,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Executes a single Gemini call wrapped in a timeout promise guardian.
   */
  private async executeWithTimeout(options: GenerateOptions, modelName: string, timeoutMs: number): Promise<string> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`AI generation timed out after ${timeoutMs / 1000} seconds.`));
      }, timeoutMs);
    });

    const callPromise = (async () => {
      const response = await this.ai!.models.generateContent({
        model: modelName,
        contents: options.prompt,
        config: {
          temperature: options.temperature ?? AI_CONFIG.temperature,
          maxOutputTokens: options.maxOutputTokens ?? AI_CONFIG.maxOutputTokens,
          ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
          ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
        },
      });
      return response.text || '';
    })();

    try {
      const rawResult = await Promise.race([callPromise, timeoutPromise]);
      return this.cleanResponseText(rawResult, !!options.jsonMode);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private cleanResponseText(text: string, isJsonMode: boolean): string {
    let cleaned = text.trim();
    if (isJsonMode) {
      cleaned = cleaned.replace(/^```json/gi, '').replace(/^```/gi, '').replace(/```$/gi, '').trim();
    }
    return cleaned;
  }
}
