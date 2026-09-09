import mongoose from 'mongoose';
import { GoogleProvider } from '../providers/google.provider.js';
import { AI_CONFIG } from '../../../config/ai.config.js';
import { UserProfileModel } from '../../profile/profile.model.js';
import {
  getStatusSuggestionPrompt,
  getTitleExpansionPrompt,
  CURRENT_STATUS_OPTIONS,
  ProfileSummary,
} from '../prompts/aiApplyAssist.prompt.js';

export type AiApplyAssistAction = 'status_suggestion' | 'title_expansion';

export interface AiApplyAssistResult {
  action: AiApplyAssistAction;
  suggestedStatus?: string;
  statusReason?: string;
  suggestedTitles?: string[];
  aiUnavailable: boolean;
}

export class AiApplyAiService {
  private provider: GoogleProvider;

  constructor(provider?: GoogleProvider) {
    this.provider = provider || GoogleProvider.getInstance();
  }

  public async assist(userId: string, action: AiApplyAssistAction, seedTitle?: string): Promise<AiApplyAssistResult> {
    const profile = await this.buildProfileSummary(userId);
    const modeConfig = AI_CONFIG.assistant.instant;

    const prompt = action === 'status_suggestion' ? getStatusSuggestionPrompt(profile) : getTitleExpansionPrompt(profile, seedTitle || '');

    try {
      const response = await this.provider.generate({
        promptName: `ai-apply-${action}`,
        prompt,
        jsonMode: true,
        temperature: modeConfig.temperature,
        model: modeConfig.model,
        maxOutputTokens: modeConfig.maxOutputTokens,
      });

      const parsed = JSON.parse(response.text);
      return this.normalize(action, parsed);
    } catch (err: any) {
      console.warn(`[AiApplyAiService] AI call failed for ${action}, falling back: ${err?.message}`);
      return this.fallback(action);
    }
  }

  private normalize(action: AiApplyAssistAction, raw: any): AiApplyAssistResult {
    if (action === 'status_suggestion') {
      const status = typeof raw?.status === 'string' ? raw.status : undefined;
      const validStatus = status && (CURRENT_STATUS_OPTIONS as readonly string[]).includes(status) ? status : undefined;
      return {
        action,
        suggestedStatus: validStatus,
        statusReason: validStatus && typeof raw?.reason === 'string' ? raw.reason : undefined,
        aiUnavailable: false,
      };
    }

    const titles = Array.isArray(raw?.titles) ? raw.titles.map(String).filter(Boolean).slice(0, 5) : [];
    return {
      action,
      suggestedTitles: titles,
      aiUnavailable: false,
    };
  }

  private fallback(action: AiApplyAssistAction): AiApplyAssistResult {
    if (action === 'status_suggestion') {
      return { action, suggestedStatus: undefined, statusReason: undefined, aiUnavailable: true };
    }
    return { action, suggestedTitles: [], aiUnavailable: true };
  }

  private async buildProfileSummary(userId: string): Promise<ProfileSummary> {
    if (!mongoose.Types.ObjectId.isValid(userId)) return {};

    const profile = await UserProfileModel.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
    if (!profile) return {};

    const latestExp = profile.experiencesList?.[0];

    return {
      headline: profile.personal?.headline || profile.experience?.title,
      bio: profile.personal?.bio,
      skills: profile.skills || [],
      latestExperience: latestExp
        ? { title: latestExp.title, company: latestExp.company, start: latestExp.start, end: latestExp.end }
        : undefined,
    };
  }
}

export const aiApplyAiService = new AiApplyAiService();
