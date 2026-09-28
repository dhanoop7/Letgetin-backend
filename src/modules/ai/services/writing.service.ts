import { AppError } from '../../../utils/appError.js';
import { GoogleProvider } from '../providers/google.provider.js';
import { AIUsageModel } from '../ai_usage.model.js';
import { buildWritingPrompt } from '../prompts/writing.prompt.js';
import { AIWritingAction, AIWritingContext, WRITING_CONTEXTS } from '../config/writingContexts.config.js';

const MAX_TEXT_LENGTH = 6000;
const MAX_INSTRUCTION_LENGTH = 300;

export interface WritingRequest {
  userId: string;
  action: AIWritingAction;
  context: AIWritingContext;
  text?: string;
  instruction?: string;
  metadata?: Record<string, unknown>;
}

export class WritingService {
  private provider: GoogleProvider;

  constructor(provider?: GoogleProvider) {
    this.provider = provider || GoogleProvider.getInstance();
  }

  public async generate(input: WritingRequest): Promise<string> {
    const { systemInstruction, prompt } = this.prepare(input);

    const response = await this.provider.generate({
      promptName: `ai-writing-${input.action}`,
      systemInstruction,
      prompt,
      maxOutputTokens: 1024,
      // Short-field rewrites should feel instant. A stuck first attempt used to silently eat up to
      // 60s before even trying again (with up to 3 attempts + backoff, worst case ~3 minutes). Cap
      // each attempt tighter and retry at most once — a UI "Try Again" is always one click away.
      timeoutMs: 20000,
      retryAttempts: 2,
    });

    this.logUsage(
      input.userId,
      `ai-writing-${input.context}-${input.action}`,
      response.promptTokens,
      response.completionTokens
    );

    const result = response.text?.trim();
    if (!result) {
      throw AppError.internal("AI couldn't generate a suggestion right now. Please try again.");
    }
    return result;
  }

  /**
   * Same validation/prompt-building as generate(), but streams chunks back via onChunk as they
   * arrive instead of waiting for the full response — makes the wait feel far shorter since text
   * starts appearing within ~1s instead of only after the entire generation finishes.
   */
  public async generateStream(input: WritingRequest, onChunk: (chunkText: string) => void): Promise<string> {
    const { systemInstruction, prompt } = this.prepare(input);

    const response = await this.provider.generateStream(
      {
        promptName: `ai-writing-${input.action}`,
        systemInstruction,
        prompt,
        maxOutputTokens: 1024,
        timeoutMs: 20000,
      },
      onChunk
    );

    this.logUsage(
      input.userId,
      `ai-writing-${input.context}-${input.action}`,
      response.promptTokens,
      response.completionTokens
    );

    const result = response.text?.trim();
    if (!result) {
      throw AppError.internal("AI couldn't generate a suggestion right now. Please try again.");
    }
    return result;
  }

  private prepare(input: WritingRequest): { systemInstruction: string; prompt: string } {
    const contextConfig = WRITING_CONTEXTS[input.context];
    if (!contextConfig) {
      throw AppError.badRequest(`Unknown writing context: ${input.context}`);
    }
    if (!contextConfig.allowedActions.includes(input.action)) {
      throw AppError.badRequest(`Action "${input.action}" is not supported for context "${input.context}".`);
    }
    if (input.text && input.text.length > MAX_TEXT_LENGTH) {
      throw AppError.badRequest(
        `Text is too long for AI processing (max ${MAX_TEXT_LENGTH} characters). Please shorten it first.`
      );
    }
    if (input.instruction && input.instruction.length > MAX_INSTRUCTION_LENGTH) {
      throw AppError.badRequest(`Instruction is too long (max ${MAX_INSTRUCTION_LENGTH} characters).`);
    }

    const metadata = this.sanitizeMetadata(input.metadata, contextConfig.allowedMetadataKeys);

    return buildWritingPrompt({
      action: input.action,
      context: input.context,
      text: input.text,
      instruction: input.instruction,
      metadata,
    });
  }

  private sanitizeMetadata(
    metadata: Record<string, unknown> | undefined,
    allowedKeys: string[]
  ): Record<string, string> {
    if (!metadata) return {};
    const clean: Record<string, string> = {};
    for (const key of allowedKeys) {
      const value = metadata[key];
      if (typeof value === 'string' && value.trim()) {
        clean[key] = value.trim().slice(0, 200);
      }
    }
    return clean;
  }

  private logUsage(userId: string, requestType: string, promptTokens: number, completionTokens: number) {
    if (!userId) return;
    AIUsageModel.create({
      userId,
      requestType,
      promptTokens,
      completionTokens,
      modelUsed: 'centralized-provider',
    }).catch((e) => console.error('Failed to log AI usage:', e));
  }
}

export const writingService = new WritingService();
