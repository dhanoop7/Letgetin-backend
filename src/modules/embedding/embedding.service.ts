import { IEmbeddingProvider, EmbeddingResult } from './embedding.types.js';
import { GoogleEmbeddingProvider } from './providers/google.embedding.provider.js';
import { env } from '../../config/env.js';

export class EmbeddingService {
  private static instance: EmbeddingService | null = null;
  private provider: IEmbeddingProvider;
  public readonly version: string;

  private constructor() {
    this.version = env.EMBEDDING_VERSION || 'v1';
    // Provider selection abstraction
    if (env.EMBEDDING_PROVIDER === 'google') {
      this.provider = new GoogleEmbeddingProvider(env.EMBEDDING_MODEL);
    } else {
      this.provider = new GoogleEmbeddingProvider(env.EMBEDDING_MODEL);
    }
  }

  public static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Generates a vector embedding for normalized text
   */
  public async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const startTime = Date.now();
    const embedding = await this.provider.generateEmbedding(text);
    const executionTimeMs = Date.now() - startTime;

    return {
      embedding,
      model: this.provider.modelName,
      version: this.version,
      dimensions: embedding.length,
      executionTimeMs,
    };
  }

  /**
   * Builds a clean, deterministic normalized text representation of a Job
   */
  public buildJobEmbeddingText(job: {
    title: string;
    company?: { name?: string };
    description?: string;
    responsibilities?: string[];
    requirements?: string[];
    preferredQualifications?: string[];
    skills?: string[];
    experienceLevel?: string;
    minimumExperience?: number;
    maximumExperience?: number;
    employmentType?: string;
    workplaceType?: string;
    location?: { city?: string; state?: string; country?: string; remote?: boolean };
    educationRequirements?: string;
  }): string {
    const parts: string[] = [];

    // Title & Company
    parts.push(`Job Title: ${job.title.trim()}`);
    if (job.company?.name) {
      parts.push(`Company: ${job.company.name.trim()}`);
    }

    // Role specifics
    const roleInfo: string[] = [];
    if (job.experienceLevel) roleInfo.push(`Level: ${job.experienceLevel}`);
    if (job.minimumExperience !== undefined && job.maximumExperience !== undefined) {
      roleInfo.push(`Experience: ${job.minimumExperience}-${job.maximumExperience} years`);
    } else if (job.minimumExperience !== undefined) {
      roleInfo.push(`Min Experience: ${job.minimumExperience} years`);
    }
    if (job.employmentType) roleInfo.push(`Type: ${job.employmentType}`);
    if (job.workplaceType) roleInfo.push(`Workplace: ${job.workplaceType}`);
    if (roleInfo.length > 0) parts.push(roleInfo.join(' | '));

    // Location
    if (job.location) {
      const locParts = [job.location.city, job.location.state, job.location.country].filter(Boolean);
      if (locParts.length > 0 || job.location.remote) {
        parts.push(`Location: ${locParts.join(', ')}${job.location.remote ? ' (Remote Eligible)' : ''}`);
      }
    }

    // Skills
    if (job.skills && job.skills.length > 0) {
      parts.push(`Required Skills:\n${job.skills.join(', ')}`);
    }

    // Education
    if (job.educationRequirements) {
      parts.push(`Education:\n${job.educationRequirements}`);
    }

    // Responsibilities
    if (job.responsibilities && job.responsibilities.length > 0) {
      parts.push(`Responsibilities:\n- ${job.responsibilities.join('\n- ')}`);
    }

    // Requirements
    if (job.requirements && job.requirements.length > 0) {
      parts.push(`Requirements:\n- ${job.requirements.join('\n- ')}`);
    }

    // Preferred Qualifications
    if (job.preferredQualifications && job.preferredQualifications.length > 0) {
      parts.push(`Preferred Qualifications:\n- ${job.preferredQualifications.join('\n- ')}`);
    }

    // Description summary
    if (job.description) {
      parts.push(`Description:\n${job.description.trim()}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Builds a clean, deterministic normalized text representation of a candidate / user profile
   */
  public buildCandidateEmbeddingText(
    resumeContent: {
      personalInfo?: { fullName?: string; headline?: string; location?: string };
      summary?: string;
      skills?: Array<{ name: string; level?: number } | string>;
      experiences?: Array<{
        company?: string;
        position?: string;
        highlights?: string[];
        startDate?: string;
        endDate?: string;
      }>;
      educations?: Array<{
        institution?: string;
        degree?: string;
        fieldOfStudy?: string;
      }>;
      projects?: Array<{
        title?: string;
        highlights?: string[];
        technologies?: string[];
      }>;
      certificates?: Array<{ name?: string; issuer?: string }>;
    },
    user?: { fullName?: string; email?: string }
  ): string {
    const parts: string[] = [];

    // Headline / Target Role
    const headline = resumeContent.personalInfo?.headline || '';
    if (headline) {
      parts.push(`Target Role / Headline: ${headline.trim()}`);
    }

    // Summary
    if (resumeContent.summary) {
      parts.push(`Professional Summary:\n${resumeContent.summary.trim()}`);
    }

    // Skills
    if (resumeContent.skills && resumeContent.skills.length > 0) {
      const skillNames = resumeContent.skills
        .map((s) => (typeof s === 'string' ? s : s.name))
        .filter(Boolean);
      if (skillNames.length > 0) {
        parts.push(`Skills & Competencies:\n${skillNames.join(', ')}`);
      }
    }

    // Experience
    if (resumeContent.experiences && resumeContent.experiences.length > 0) {
      const expStrings = resumeContent.experiences.map((exp) => {
        const title = exp.position || '';
        const company = exp.company ? ` at ${exp.company}` : '';
        const highlights = exp.highlights && exp.highlights.length > 0 ? `\n  - ${exp.highlights.join('\n  - ')}` : '';
        return `${title}${company}${highlights}`;
      });
      parts.push(`Professional Experience:\n${expStrings.join('\n\n')}`);
    }

    // Projects
    if (resumeContent.projects && resumeContent.projects.length > 0) {
      const projStrings = resumeContent.projects.map((p) => {
        const title = p.title || 'Project';
        const tech = p.technologies && p.technologies.length > 0 ? ` (Tech: ${p.technologies.join(', ')})` : '';
        const highlights = p.highlights && p.highlights.length > 0 ? `\n  - ${p.highlights.join('\n  - ')}` : '';
        return `${title}${tech}${highlights}`;
      });
      parts.push(`Key Projects:\n${projStrings.join('\n\n')}`);
    }

    // Education
    if (resumeContent.educations && resumeContent.educations.length > 0) {
      const eduStrings = resumeContent.educations.map((edu) => {
        const degree = edu.degree ? `${edu.degree}` : '';
        const field = edu.fieldOfStudy ? ` in ${edu.fieldOfStudy}` : '';
        const inst = edu.institution ? ` from ${edu.institution}` : '';
        return `${degree}${field}${inst}`.trim();
      });
      parts.push(`Education:\n${eduStrings.join(', ')}`);
    }

    // Certifications
    if (resumeContent.certificates && resumeContent.certificates.length > 0) {
      const certNames = resumeContent.certificates
        .map((c) => (c.name ? `${c.name}${c.issuer ? ` (${c.issuer})` : ''}` : ''))
        .filter(Boolean);
      if (certNames.length > 0) {
        parts.push(`Certifications:\n${certNames.join(', ')}`);
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Calculates Cosine Similarity between two vectors: Cos(A, B) = (A . B) / (||A|| * ||B||)
   */
  public cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
    const len = Math.min(vecA.length, vecB.length);
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < len; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return Math.max(0, Math.min(1, similarity));
  }

  /**
   * Calculates skills overlap match score and detailed matched / missing lists
   */
  public calculateSkillsMatch(
    jobSkills: string[] = [],
    candidateSkills: string[] = []
  ): {
    score: number;
    matched: string[];
    missing: string[];
  } {
    if (!jobSkills || jobSkills.length === 0) {
      return { score: 100, matched: [], missing: [] };
    }

    const candidateSkillSet = new Set(
      candidateSkills.map((s) => s.trim().toLowerCase())
    );

    const matched: string[] = [];
    const missing: string[] = [];

    jobSkills.forEach((skill) => {
      const normalized = skill.trim().toLowerCase();
      // Exact match or partial token match (e.g. "React" in "React.js" or "Node.js" in "Node")
      const isMatched =
        candidateSkillSet.has(normalized) ||
        Array.from(candidateSkillSet).some(
          (cs) => cs.includes(normalized) || normalized.includes(cs)
        );

      if (isMatched) {
        matched.push(skill);
      } else {
        missing.push(skill);
      }
    });

    const score = Math.round((matched.length / jobSkills.length) * 100);

    return {
      score,
      matched,
      missing,
    };
  }
}

export const embeddingService = EmbeddingService.getInstance();
