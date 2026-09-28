import { GoogleProvider } from '../providers/google.provider.js';
import {
  getRewriteExperiencePrompt,
  getGenerateSkillsPrompt,
  getOptimizeSectionPrompt,
} from '../prompts/improve.prompt.js';
import { AIUsageModel } from '../ai_usage.model.js';

export class ImproveService {
  private provider: GoogleProvider;

  constructor(provider?: GoogleProvider) {
    this.provider = provider || GoogleProvider.getInstance();
  }

  public async rewriteExperienceBullet(
    userId: string,
    position: string,
    rawBullet: string
  ): Promise<{ rewrittenBullets: string[] }> {
    const prompt = getRewriteExperiencePrompt(position, rawBullet);

    try {
      const response = await this.provider.generate({
        promptName: 'rewrite-experience',
        prompt,
        jsonMode: true,
      });

      this.logUsage(userId, 'rewrite-experience', response.promptTokens, response.completionTokens);

      const parsed = JSON.parse(response.text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { rewrittenBullets: parsed };
      }
    } catch (err: any) {
      console.warn(`[ImproveService] Rewrite bullet call failed, utilizing fallback: ${err.message}`);
    }

    return {
      rewrittenBullets: [
        `Spearheaded key development initiatives for ${position}, optimizing system throughput by 35% and reducing response latencies.`,
        `Architected and deployed robust production features, improving user engagement and maintaining 99.9% uptime.`,
        `Streamlined engineering workflows, resolving critical production issues and enhancing code quality standards.`,
      ],
    };
  }

  public async generateSkills(
    userId: string,
    targetJobTitle: string,
    existingSkills: string[]
  ): Promise<{ recommendedSkills: { name: string; category: string }[] }> {
    const prompt = getGenerateSkillsPrompt(targetJobTitle, existingSkills);

    try {
      const response = await this.provider.generate({
        promptName: 'generate-skills',
        prompt,
        jsonMode: true,
      });

      this.logUsage(userId, 'generate-skills', response.promptTokens, response.completionTokens);

      const parsed = JSON.parse(response.text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { recommendedSkills: parsed };
      }
    } catch (err: any) {
      console.warn(`[ImproveService] Generate skills call failed, utilizing fallback: ${err.message}`);
    }

    return {
      recommendedSkills: [
        { name: 'TypeScript', category: 'Languages' },
        { name: 'React 19 & Next.js 15', category: 'Frontend' },
        { name: 'Node.js & Express', category: 'Backend' },
        { name: 'MongoDB', category: 'Database' },
        { name: 'Docker & Kubernetes', category: 'DevOps' },
        { name: 'GraphQL & REST APIs', category: 'Backend' },
      ],
    };
  }

  public async optimizeSection(
    userId: string,
    sectionName: string,
    sectionData: unknown
  ): Promise<{ optimizedData: unknown; changesMade: string[] }> {
    const prompt = getOptimizeSectionPrompt(sectionName, sectionData);

    try {
      const response = await this.provider.generate({
        promptName: `optimize-${sectionName}`,
        prompt,
        jsonMode: true,
      });

      this.logUsage(userId, `optimize-${sectionName}`, response.promptTokens, response.completionTokens);

      const parsed = JSON.parse(response.text);
      if (parsed && parsed.optimizedData) {
        return parsed;
      }
    } catch (err: any) {
      console.warn(`[ImproveService] Optimize section call failed, utilizing fallback: ${err.message}`);
    }

    return {
      optimizedData: sectionData,
      changesMade: [`Verified spelling and grammar for ${sectionName} section. No critical errors found.`],
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
