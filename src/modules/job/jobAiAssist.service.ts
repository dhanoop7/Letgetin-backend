import { GoogleProvider } from '../ai/providers/google.provider.js';
import { buildJobContentPrompt, JobContentGenerationInput } from './jobAiAssist.prompt.js';
import { AppError } from '../../utils/appError.js';

export interface GeneratedJobContent {
  description: string;
  skills: string[];
}

const MAX_DESCRIPTION_LENGTH = 6000;
const MAX_SKILLS = 12;
const MAX_SKILL_LENGTH = 40;

class JobAiAssistService {
  /**
   * Generates a job description + skill suggestions from just a title (+ optional context).
   * This is a free, convenience AI assist — never charges hiring-pipeline credits and never
   * throws for AI-side failures (network/parse/quota) so the Create Job page can always fall
   * back to manual entry; only a genuinely invalid request (no title) is a hard error.
   */
  async generateJobContent(input: JobContentGenerationInput): Promise<GeneratedJobContent | null> {
    if (!input.title?.trim()) {
      throw AppError.badRequest('A job title is required to generate content.');
    }

    try {
      const { systemInstruction, prompt } = buildJobContentPrompt(input);
      const response = await GoogleProvider.getInstance().generate({
        promptName: 'job-create-ai-assist',
        systemInstruction,
        prompt,
        jsonMode: true,
      });
      const raw = JSON.parse(response.text);
      return this.sanitize(raw);
    } catch (err) {
      console.warn('[JobAiAssistService] Generation failed, returning null:', (err as Error)?.message);
      return null;
    }
  }

  private sanitize(raw: unknown): GeneratedJobContent | null {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as Record<string, unknown>;

    const description = typeof source.description === 'string' ? source.description.trim().slice(0, MAX_DESCRIPTION_LENGTH) : '';

    const skills = Array.isArray(source.skills)
      ? [
          ...new Set(
            source.skills
              .filter((s): s is string => typeof s === 'string')
              .map((s) => s.trim())
              .filter((s) => s.length > 0 && s.length <= MAX_SKILL_LENGTH)
          ),
        ].slice(0, MAX_SKILLS)
      : [];

    if (!description && skills.length === 0) return null;
    return { description, skills };
  }
}

export const jobAiAssistService = new JobAiAssistService();
