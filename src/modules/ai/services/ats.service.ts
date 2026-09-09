import { GoogleProvider } from '../providers/google.provider.js';
import { getAtsAnalysisPrompt, getJobMatchPrompt } from '../prompts/ats.prompt.js';
import { AIUsageModel } from '../ai_usage.model.js';

export interface JobMatchSuggestion {
  id: string;
  section: 'summary' | 'experience' | 'skills' | 'projects';
  itemId?: string;
  changeType: 'addition' | 'replacement' | 'rewrite';
  originalText: string;
  proposedText: string;
  reason: string;
  relatedKeywords: string[];
}

export interface MissingSection {
  section: 'summary' | 'experience' | 'skills' | 'projects';
  reason: string;
}

const ACTION_VERBS = [
  'architected', 'spearheaded', 'developed', 'optimized', 'led', 'designed',
  'streamlined', 'implemented', 'engineered', 'launched', 'built', 'created',
  'managed', 'scaled', 'delivered', 'integrated', 'increased', 'reduced',
  'automated', 'orchestrated', 'transformed', 'executed', 'formulated',
  'mentored', 'revamped', 'secured', 'deployed', 'accelerated', 'established',
  'consolidated', 'negotiated', 'migrated', 'refactored', 'collaborated',
  'generated', 'modernized', 'trained', 'directed', 'authored', 'championed',
];

const METRICS_REGEX = /\b(\d+%\b|\$\d+|\d+\+|\d+\s*(?:k|m|million|billion|users|clients|engineers|team members|requests|ms|qps|stars|x|percent|roi)\b)/i;

export class AtsService {
  private provider: GoogleProvider;

  constructor(provider?: GoogleProvider) {
    this.provider = provider || GoogleProvider.getInstance();
  }

  public async analyzeAts(
    userId: string,
    resumeContent: unknown,
    targetJobDescription?: string
  ): Promise<{ score: number; recommendations: string[]; missingKeywords: string[] }> {
    // 1. Strict check for empty or blank resume content
    if (this.isResumeEmpty(resumeContent)) {
      return {
        score: 0,
        recommendations: [
          'Your resume is currently empty. Start by adding your contact details, professional headline, and summary.',
          'Add at least 1-2 detailed work experience roles with measurable results and percentage outcomes.',
          'List at least 4-6 relevant technical and domain skills to boost ATS keyword visibility.',
        ],
        missingKeywords: ['Target Job Title', 'Core Technical Skills', 'Work Experience', 'Quantifiable Metrics'],
      };
    }

    const prompt = getAtsAnalysisPrompt(resumeContent, targetJobDescription);

    try {
      const response = await this.provider.generate({
        promptName: 'ats-analyze',
        prompt,
        jsonMode: true,
      });

      this.logUsage(userId, 'ats-check', response.promptTokens, response.completionTokens);

      const parsed = JSON.parse(response.text);
      if (typeof parsed.score === 'number') {
        return {
          score: Math.min(100, Math.max(0, Math.round(parsed.score))),
          recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
          missingKeywords: Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords : [],
        };
      }
    } catch (err: any) {
      console.warn(`[AtsService] ATS analysis AI call failed, utilizing safe heuristic fallback: ${err.message}`);
    }

    // 2. High-precision programmatic heuristic fallback (never returns a fake static score)
    return this.calculateServerHeuristic(resumeContent);
  }

  public async matchJobDescription(
    userId: string,
    resumeContent: unknown,
    jobDescription: string
  ): Promise<{
    matchScore: number;
    matchedKeywords: string[];
    missingKeywords: string[];
    missingSkills: string[];
    recommendedImprovements: string[];
    tailoredSummary?: string;
    tailoredBullets?: string[];
    suggestions: JobMatchSuggestion[];
    missingSections: MissingSection[];
    /** True only when the AI call itself failed and this is generic placeholder data, not a
     * real analysis of the caller's resume/JD - callers that need a genuine match (e.g. Tailor
     * Resume) should treat this as a failure rather than silently using the placeholder data. */
    isFallback?: boolean;
  }> {
    if (this.isResumeEmpty(resumeContent) || !jobDescription || !jobDescription.trim()) {
      return {
        matchScore: 0,
        matchedKeywords: [],
        missingKeywords: ['Job Requirements Keywords', 'Core Domain Skills'],
        missingSkills: ['Technical Stack Alignment'],
        recommendedImprovements: [
          'Add content to your resume before matching against a target job description.',
        ],
        suggestions: [],
        missingSections: [
          { section: 'summary', reason: 'No professional summary found.' },
          { section: 'experience', reason: 'No work experience found.' },
          { section: 'skills', reason: 'No skills listed.' },
        ],
      };
    }

    const prompt = getJobMatchPrompt(resumeContent, jobDescription);

    try {
      const response = await this.provider.generate({
        promptName: 'job-match',
        prompt,
        jsonMode: true,
      });

      this.logUsage(userId, 'job-match', response.promptTokens, response.completionTokens);

      const parsed = JSON.parse(response.text);
      if (typeof parsed.matchScore === 'number') {
        return {
          matchScore: parsed.matchScore,
          matchedKeywords: Array.isArray(parsed.matchedKeywords) ? parsed.matchedKeywords : [],
          missingKeywords: Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords : [],
          missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [],
          recommendedImprovements: Array.isArray(parsed.recommendedImprovements) ? parsed.recommendedImprovements : [],
          tailoredSummary: typeof parsed.tailoredSummary === 'string' ? parsed.tailoredSummary : undefined,
          tailoredBullets: Array.isArray(parsed.tailoredBullets) ? parsed.tailoredBullets : undefined,
          suggestions: this.sanitizeSuggestions(parsed.suggestions),
          missingSections: this.sanitizeMissingSections(parsed.missingSections),
        };
      }
    } catch (err: any) {
      console.warn(`[AtsService] Job match AI call failed, utilizing fallback: ${err.message}`);
    }

    return {
      matchScore: 78,
      matchedKeywords: ['TypeScript', 'React', 'Node.js', 'System Design'],
      missingKeywords: ['CI/CD Pipelines', 'Docker', 'AWS', 'GraphQL'],
      missingSkills: ['Kubernetes', 'Redis', 'Unit Testing'],
      recommendedImprovements: [
        'Incorporate cloud deployment keywords (AWS, Docker) in your technical projects.',
        'Add quantitative performance metrics to your recent work experience bullets.',
      ],
      tailoredSummary:
        'Results-driven Full Stack Engineer with expertise in TypeScript, React, and Node.js. Proven track record of architecting scalable applications.',
      tailoredBullets: [
        'Spearheaded full-stack feature development using React and TypeScript, driving a 40% increase in web platform engagement.',
        'Implemented robust API services and automated testing workflows, reducing production bug reports by 25%.',
      ],
      suggestions: [],
      missingSections: [],
      isFallback: true,
    };
  }

  private sanitizeMissingSections(raw: unknown): MissingSection[] {
    if (!Array.isArray(raw)) return [];
    const allowedSections = ['summary', 'experience', 'skills', 'projects'];
    return raw
      .filter((s: any) => s && typeof s === 'object' && allowedSections.includes(s.section))
      .slice(0, 4)
      .map((s: any) => ({
        section: s.section,
        reason: typeof s.reason === 'string' ? s.reason : 'Not enough information for this section yet.',
      }));
  }

  private sanitizeSuggestions(raw: unknown): JobMatchSuggestion[] {
    if (!Array.isArray(raw)) return [];
    const allowedSections = ['summary', 'experience', 'skills', 'projects'];
    const allowedChangeTypes = ['addition', 'replacement', 'rewrite'];

    return raw
      .filter(
        (s: any) =>
          s &&
          typeof s === 'object' &&
          allowedSections.includes(s.section) &&
          allowedChangeTypes.includes(s.changeType) &&
          typeof s.proposedText === 'string' &&
          s.proposedText.trim().length > 0
      )
      .slice(0, 6)
      .map((s: any, idx: number) => ({
        id: `sug-${Date.now()}-${idx}`,
        section: s.section,
        itemId: typeof s.itemId === 'string' && s.itemId.trim() ? s.itemId.trim() : undefined,
        changeType: s.changeType,
        originalText: typeof s.originalText === 'string' ? s.originalText : '',
        proposedText: String(s.proposedText).trim(),
        reason: typeof s.reason === 'string' ? s.reason : '',
        relatedKeywords: Array.isArray(s.relatedKeywords) ? s.relatedKeywords.filter((k: unknown) => typeof k === 'string') : [],
      }));
  }

  private isResumeEmpty(content: any): boolean {
    if (!content || typeof content !== 'object') return true;

    const personal = content.personalInfo || {};
    const name = String(personal.fullName || '').trim();
    const email = String(personal.email || '').trim();
    const headline = String(personal.headline || '').trim();
    const location = String(personal.location || '').trim();

    const summaryText = typeof content.summary === 'string'
      ? content.summary.trim()
      : typeof content.summary === 'object' && content.summary?.summary
      ? String(content.summary.summary).trim()
      : '';

    const experiences = Array.isArray(content.experiences) ? content.experiences : [];
    const hasExp = experiences.some((e: any) =>
      Boolean((e?.company && String(e.company).trim()) || (e?.position && String(e.position).trim()))
    );

    const educations = Array.isArray(content.educations) ? content.educations : [];
    const hasEdu = educations.some((e: any) =>
      Boolean((e?.institution && String(e.institution).trim()) || (e?.degree && String(e.degree).trim()))
    );

    const skills = Array.isArray(content.skills) ? content.skills : [];
    const hasSkills = skills.some((s: any) => Boolean(s?.name && String(s.name).trim()));

    const projects = Array.isArray(content.projects) ? content.projects : [];
    const hasProjects = projects.some((p: any) => Boolean(p?.title && String(p.title).trim()));

    return !(name || email || headline || location || summaryText || hasExp || hasEdu || hasSkills || hasProjects);
  }

  private calculateServerHeuristic(content: any): { score: number; recommendations: string[]; missingKeywords: string[] } {
    if (this.isResumeEmpty(content)) {
      return {
        score: 0,
        recommendations: ['Add contact info, summary, experience, and skills to evaluate ATS score.'],
        missingKeywords: [],
      };
    }

    const personal = content.personalInfo || {};
    const name = String(personal.fullName || '').trim();
    const email = String(personal.email || '').trim();
    const headline = String(personal.headline || '').trim();
    const summary = typeof content.summary === 'string'
      ? content.summary.trim()
      : String(content.summary?.summary || '').trim();

    const experiences = Array.isArray(content.experiences) ? content.experiences : [];
    const educations = Array.isArray(content.educations) ? content.educations : [];
    const skills = Array.isArray(content.skills) ? content.skills : [];

    let completeness = 0;
    if (name.length >= 2) completeness += 15;
    if (/\S+@\S+\.\S+/.test(email)) completeness += 15;
    if (headline.length >= 3) completeness += 10;
    if (summary.length >= 40) completeness += 15;
    if (experiences.length >= 1) completeness += 20;
    if (educations.length >= 1) completeness += 10;
    if (skills.length >= 3) completeness += 15;

    const allBullets = experiences
      .flatMap((e: any) => (Array.isArray(e?.highlights) ? e.highlights : []))
      .map((h: any) => String(h || '').toLowerCase())
      .join(' ');

    const actionVerbMatches = ACTION_VERBS.filter((v) => allBullets.includes(v));
    const hasMetrics = METRICS_REGEX.test(allBullets);

    let impactScore = 0;
    if (experiences.length > 0) {
      impactScore = Math.min(100, actionVerbMatches.length * 15 + (hasMetrics ? 40 : 0));
    }

    let keywordScore = 0;
    if (skills.length >= 8) keywordScore = 95;
    else if (skills.length >= 4) keywordScore = 75;
    else if (skills.length > 0) keywordScore = 40;

    const score = Math.min(
      100,
      Math.max(
        0,
        Math.round(completeness * 0.40 + impactScore * 0.35 + keywordScore * 0.25)
      )
    );

    const recommendations: string[] = [];
    if (!summary || summary.length < 40) {
      recommendations.push('Write a detailed 3-4 sentence professional summary highlighting your core expertise.');
    }
    if (!hasMetrics && experiences.length > 0) {
      recommendations.push('Add quantifiable metrics (% improvements, revenue, scale) to your experience bullet points.');
    }
    if (skills.length < 6) {
      recommendations.push('Add more industry-standard technical skills and tools to boost ATS keyword match.');
    }
    if (actionVerbMatches.length < 2 && experiences.length > 0) {
      recommendations.push('Begin experience bullets with strong action verbs (e.g. Spearheaded, Architected, Optimized).');
    }

    return {
      score,
      recommendations: recommendations.length > 0 ? recommendations : ['Resume has strong ATS foundations. Continue refining metrics.'],
      missingKeywords: skills.length < 4 ? ['CI/CD Pipelines', 'System Architecture', 'Automated Testing'] : [],
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
