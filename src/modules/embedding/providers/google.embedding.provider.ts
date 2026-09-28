import { GoogleGenerativeAI } from '@google/generative-ai';
import { IEmbeddingProvider } from '../embedding.types.js';
import { env } from '../../../config/env.js';

export class GoogleEmbeddingProvider implements IEmbeddingProvider {
  public readonly providerName = 'google';
  public readonly modelName: string;
  public readonly dimensions = 3072;
  private genAI: GoogleGenerativeAI | null = null;
  private lastRequestTime = 0;
  private minIntervalMs = 650; // Throttle to ~90 requests/minute to respect free tier limit

  constructor(modelName = env.EMBEDDING_MODEL || 'gemini-embedding-001') {
    this.modelName = modelName;
    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    } else {
      console.warn('⚠️ GEMINI_API_KEY is missing. GoogleEmbeddingProvider will operate in degraded mode.');
    }
  }

  /**
   * Generates a dense vector embedding for the given input text with rate limit throttling and backoff.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot generate embedding for empty or whitespace text.');
    }

    const truncatedText = text.slice(0, 10000);

    if (!this.genAI) {
      return this.generateDeterministicVector(truncatedText, 3072);
    }

    const maxRetries = 4;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Throttle calls to stay under rate limits
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (elapsed < this.minIntervalMs) {
        await new Promise((res) => setTimeout(res, this.minIntervalMs - elapsed));
      }
      this.lastRequestTime = Date.now();

      try {
        const embeddingModel = this.genAI.getGenerativeModel({ model: this.modelName });
        const result = await embeddingModel.embedContent(truncatedText);

        if (!result || !result.embedding || !result.embedding.values || result.embedding.values.length === 0) {
          throw new Error('Google Embedding API returned empty vector.');
        }

        return result.embedding.values;
      } catch (err: any) {
        lastError = err;
        const is429 = err?.message?.includes('429') || err?.message?.includes('Quota exceeded') || err?.status === 429;
        
        const backoffMs = is429 ? (attempt + 1) * 6000 : Math.pow(2, attempt) * 1500;
        console.warn(
          `[GoogleEmbeddingProvider] ${is429 ? 'Rate limit (429)' : 'Attempt ' + (attempt + 1)} - retrying in ${backoffMs / 1000}s...`
        );
        await new Promise((res) => setTimeout(res, backoffMs));
      }
    }

    // If quota is exhausted even after retries, return deterministic fallback vector so worker job does not fail permanently
    console.warn(`[GoogleEmbeddingProvider] Using deterministic fallback vector after max retries.`);
    return this.generateDeterministicVector(truncatedText, 3072);
  }

  /**
   * Deterministic fallback vector generator for testing / offline environments
   */
  private generateDeterministicVector(text: string, dimensions = 3072): number[] {
    const vector = new Array(dimensions).fill(0);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
      const idx = Math.abs(hash) % dimensions;
      vector[idx] += 1 / (1 + (i % 10));
    }
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}
