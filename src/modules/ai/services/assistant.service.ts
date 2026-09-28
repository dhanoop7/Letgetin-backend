import { GoogleProvider } from '../providers/google.provider.js';
import { AI_CONFIG, AssistantModeConfig } from '../../../config/ai.config.js';
import { getAssistantPrompt } from '../prompts/assistant.prompt.js';
import { buildExploreContext } from '../context/explore.context.js';
import { buildProfileContext } from '../context/profile.context.js';
import { buildResumeContext } from '../context/resume.context.js';
import { buildDriveContext } from '../context/drive.context.js';
import { AssistantContextType, AssistantContextPayload, AssistantMode } from '../context/context.types.js';
import { ASSISTANT_CONTEXT_CONFIG } from '../config/assistant-context.config.js';
import { ConversationMessage } from '../prompts/chat.prompt.js';
import { AIUsageModel } from '../ai_usage.model.js';


export interface AssistantResponse {
  relevant: boolean;
  reply: string;
  suggestions: string[];
  mode: AssistantMode;
  intent: string;
}

export interface AssistantChatOptions {
  contextPayload?: AssistantContextPayload;
  conversationHistory?: ConversationMessage[];
}

export class AssistantService {
  private provider: GoogleProvider;

  constructor(provider?: GoogleProvider) {
    this.provider = provider || GoogleProvider.getInstance();
  }

  public async chat(
    userId: string,
    message: string,
    context: AssistantContextType,
    mode: AssistantMode,
    options?: AssistantChatOptions
  ): Promise<AssistantResponse> {
    const contextSummary = await this.buildContext(userId, context, message, options?.contextPayload);
    const prompt = getAssistantPrompt(message, context, mode, contextSummary, options?.conversationHistory);
    const modeConfig = this.getModeConfig(mode);

    let responseText: string | undefined;
    try {
      const response = await this.provider.generate({
        promptName: `assistant-${context}-${mode}`,
        prompt,
        jsonMode: true,
        temperature: modeConfig.temperature,
        model: modeConfig.model,
        maxOutputTokens: modeConfig.maxOutputTokens,
      });
      responseText = response.text;

      this.logUsage(userId, `assistant-${mode}`, response.promptTokens, response.completionTokens);

      const parsed = JSON.parse(response.text);
      return this.normalize(parsed, mode);
    } catch (err: any) {
      console.warn(`[AssistantService] AI call failed, falling back: ${err?.message}`);
      if (responseText) {
        console.warn(`[AssistantService] Raw response (first 300 chars): ${responseText.slice(0, 300)}`);
      }
      return this.recoverPartialOrFallback(responseText, context, mode);
    }
  }

  public async chatStream(
    userId: string,
    message: string,
    context: AssistantContextType,
    mode: AssistantMode,
    options: AssistantChatOptions | undefined,
    onChunk: (chunkText: string) => void
  ): Promise<AssistantResponse> {
    const contextSummary = await this.buildContext(userId, context, message, options?.contextPayload);
    const prompt = getAssistantPrompt(message, context, mode, contextSummary, options?.conversationHistory);
    const modeConfig = this.getModeConfig(mode);

    let responseText: string | undefined;
    try {
      const response = await this.provider.generateStream(
        {
          promptName: `assistant-${context}-${mode}-stream`,
          prompt,
          jsonMode: true,
          temperature: modeConfig.temperature,
          model: modeConfig.model,
          maxOutputTokens: modeConfig.maxOutputTokens,
        },
        onChunk
      );
      responseText = response.text;

      this.logUsage(userId, `assistant-${mode}-stream`, response.promptTokens, response.completionTokens);

      const parsed = JSON.parse(response.text);
      return this.normalize(parsed, mode);
    } catch (err: any) {
      console.warn(`[AssistantService] AI stream call failed, falling back: ${err?.message}`);
      if (responseText) {
        console.warn(`[AssistantService] Raw response (first 300 chars): ${responseText.slice(0, 300)}`);
      }
      return this.recoverPartialOrFallback(responseText, context, mode);
    }
  }

  private async buildContext(
    userId: string,
    context: AssistantContextType,
    message: string,
    payload?: AssistantContextPayload
  ): Promise<string> {
    switch (context) {
      case 'explore':
        return (await buildExploreContext(userId, payload?.selectedJobId)).summary;
      case 'profile':
        return (await buildProfileContext(userId, payload?.activeProfileContext, payload?.activeProfileSection)).summary;
      case 'resume':
        return (await buildResumeContext(userId, message, payload?.resumeId, payload?.activeResumeContext)).summary;
      case 'drive':
        return (await buildDriveContext(userId, payload?.driveFileId)).summary;
      default:
        return 'No context available.';
    }
  }

  private getModeConfig(mode: AssistantMode): AssistantModeConfig {
    return mode === 'expert' ? AI_CONFIG.assistant.expert : AI_CONFIG.assistant.instant;
  }

  private normalize(raw: any, mode: AssistantMode): AssistantResponse {
    return {
      relevant: typeof raw?.relevant === 'boolean' ? raw.relevant : true,
      reply:
        typeof raw?.reply === 'string' && raw.reply.trim().length > 0
          ? raw.reply
          : 'I was unable to generate a response. Please try rephrasing your question.',
      suggestions: Array.isArray(raw?.suggestions)
        ? raw.suggestions.map(String).filter(Boolean).slice(0, 4)
        : [],
      mode,
      intent: typeof raw?.intent === 'string' && raw.intent ? raw.intent : 'general',
    };
  }

  /**
   * If the raw model output was valid enough to have started (but not finished) its "reply" string —
   * e.g. cut off mid-sentence by a token limit — extract that partial text instead of discarding it,
   * so a truncated response still surfaces a real (if shortened) answer rather than the generic fallback.
   */
  private recoverPartialOrFallback(
    responseText: string | undefined,
    context: AssistantContextType,
    mode: AssistantMode
  ): AssistantResponse {
    if (responseText) {
      const match = responseText.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (match && match[1]) {
        const partial = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
        if (partial.length > 0) {
          return { relevant: true, reply: partial, suggestions: [], mode, intent: 'partial' };
        }
      }
    }
    return this.fallback(context, mode);
  }

  private fallback(context: AssistantContextType, mode: AssistantMode): AssistantResponse {
    const cfg = ASSISTANT_CONTEXT_CONFIG[context];
    return {
      relevant: true,
      reply: `I'm having trouble generating a detailed answer right now. Please try again in a moment, or rephrase your question about ${cfg.label}.`,
      suggestions: [],
      mode,
      intent: 'fallback',
    };
  }

  private logUsage(userId: string, requestType: string, promptTokens: number, completionTokens: number) {
    if (!userId || !/^[0-9a-fA-F]{24}$/.test(userId)) return;
    AIUsageModel.create({
      userId,
      requestType,
      promptTokens,
      completionTokens,
      modelUsed: 'centralized-provider',
    }).catch((e) => console.error('Failed to log AI usage:', e));
  }
}
