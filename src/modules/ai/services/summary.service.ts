import { GoogleProvider } from '../providers/google.provider.js';
import { getImproveSummaryPrompt } from '../prompts/summary.prompt.js';
import { AIUsageModel } from '../ai_usage.model.js';

export class SummaryService {
  private provider: GoogleProvider;

  constructor(provider?: GoogleProvider) {
    this.provider = provider || GoogleProvider.getInstance();
  }

  public async improveSummary(
    userId: string,
    currentSummary: string,
    targetRole?: string,
    tone: string = 'impactful'
  ): Promise<{ suggestions: string[] }> {
    const prompt = getImproveSummaryPrompt(currentSummary, targetRole, tone);

    try {
      const response = await this.provider.generate({
        promptName: 'improve-summary',
        prompt,
        jsonMode: true,
      });

      this.logUsage(userId, 'improve-summary', response.promptTokens, response.completionTokens);

      const parsed = JSON.parse(response.text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { suggestions: parsed };
      }
    } catch (err: any) {
      console.warn(`[SummaryService] Improve summary call failed, utilizing fallback: ${err.message}`);
    }

    return {
      suggestions: [
        `Results-oriented ${targetRole || 'Software Professional'} with a proven track record of engineering scalable, high-performance web applications and driving technical excellence.`,
        `Innovative ${targetRole || 'Engineering Leader'} skilled in modern React/TypeScript frameworks, microservices, and distributed systems architecture.`,
        `Accomplished ${targetRole || 'Full Stack Engineer'} with extensive experience designing resilient user-facing platforms and optimizing core metrics.`,
      ],
    };
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
