import { embeddingService } from '../embedding/embedding.service.js';
import { IResolvedCandidateData } from '../profile/candidateDataResolver.js';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were', 'will',
  'with', 'the', 'this', 'but', 'they', 'have', 'had', 'what', 'when', 'where',
  'who', 'which', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now', 'or'
]);

function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function calculateTextCosine(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const freqA = new Map<string, number>();
  const freqB = new Map<string, number>();

  for (const t of tokensA) freqA.set(t, (freqA.get(t) || 0) + 1);
  for (const t of tokensB) freqB.set(t, (freqB.get(t) || 0) + 1);

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const count of freqA.values()) normA += count * count;
  for (const count of freqB.values()) normB += count * count;

  for (const [term, countA] of freqA.entries()) {
    const countB = freqB.get(term);
    if (countB) {
      dotProduct += countA * countB;
    }
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class SemanticRoleMatcher {
  /**
   * Evaluates semantic alignment between candidate and job.
   * Prefers precomputed vector embeddings; falls back gracefully to deterministic text similarity.
   */
  public static evaluateSemanticMatch(
    candidate: IResolvedCandidateData,
    job: any,
    candidateEmbedding?: number[],
    jobEmbedding?: number[]
  ): {
    score: number;
    explanation: string;
  } {
    // 1. Vector Cosine Similarity (if both embeddings available)
    if (
      Array.isArray(candidateEmbedding) &&
      candidateEmbedding.length > 0 &&
      Array.isArray(jobEmbedding) &&
      jobEmbedding.length > 0
    ) {
      const cosine = embeddingService.cosineSimilarity(candidateEmbedding, jobEmbedding);
      // Cosine similarity for Gemini text embeddings usually spans 0.45 to 0.95 for related text
      // Normalize cleanly to 0-100 scale:
      const normalizedScore = Math.max(0, Math.min(100, Math.round(cosine * 100)));
      return {
        score: normalizedScore,
        explanation: this.getSemanticExplanation(normalizedScore),
      };
    }

    // 2. Deterministic Contextual Fallback
    const jobDescriptionText = [
      job.title,
      job.description,
      Array.isArray(job.responsibilities) ? job.responsibilities.join(' ') : (job.responsibilities || ''),
      Array.isArray(job.requirements) ? job.requirements.join(' ') : (job.requirements || ''),
      Array.isArray(job.skills) ? job.skills.join(' ') : '',
    ].filter(Boolean).join(' ');

    const candidateProfileText = [
      candidate.headline,
      candidate.summary,
      (candidate.skills || []).join(' '),
      (candidate.experiences || []).map((e) => `${e.position} ${e.company} ${(e.highlights || []).join(' ')}`).join(' '),
      (candidate.projects || []).map((p) => `${p.title} ${(p.highlights || []).join(' ')}`).join(' '),
    ].filter(Boolean).join(' ');

    const jobTokens = tokenize(jobDescriptionText);
    const candidateTokens = tokenize(candidateProfileText);

    const textCosine = calculateTextCosine(jobTokens, candidateTokens);
    // Scale text cosine: full overlap gives ~85-95, partial gives 50-70
    const fallbackScore = Math.min(95, Math.max(25, Math.round(textCosine * 100 * 1.25)));

    return {
      score: fallbackScore,
      explanation: this.getSemanticExplanation(fallbackScore),
    };
  }

  /**
   * Evaluates role relevance (alignment between Job Title/Responsibilities and Candidate Headline/Positions).
   */
  public static evaluateRoleRelevance(
    candidate: IResolvedCandidateData,
    job: any
  ): {
    score: number;
    explanation: string;
  } {
    const jobTitle = (job.title || '').trim().toLowerCase();
    const candidateHeadline = (candidate.headline || '').trim().toLowerCase();
    const pastPositions = (candidate.experiences || [])
      .map((e) => (e.position || '').trim().toLowerCase())
      .filter(Boolean);

    // Case 1: Exact or near-identical Title match
    if (jobTitle && candidateHeadline && (candidateHeadline.includes(jobTitle) || jobTitle.includes(candidateHeadline))) {
      return {
        score: 95,
        explanation: `Strong title alignment with current profile headline (${candidate.headline})`,
      };
    }

    const pastExactMatch = pastPositions.find((pos) => pos.includes(jobTitle) || jobTitle.includes(pos));
    if (pastExactMatch) {
      return {
        score: 90,
        explanation: `Strong role alignment with previous position (${pastExactMatch})`,
      };
    }

    // Case 2: Token-level overlap between Title and Candidate Titles
    const jobTitleTokens = tokenize(jobTitle);
    const candidateRoleTokens = new Set([
      ...tokenize(candidateHeadline),
      ...pastPositions.flatMap((p) => tokenize(p)),
    ]);

    if (jobTitleTokens.length > 0 && candidateRoleTokens.size > 0) {
      const matchedTokens = jobTitleTokens.filter((t) => candidateRoleTokens.has(t));
      const overlapRatio = matchedTokens.length / jobTitleTokens.length;

      if (overlapRatio >= 0.75) {
        return {
          score: 88,
          explanation: `Strong role match across core functional domain (${matchedTokens.join(', ')})`,
        };
      } else if (overlapRatio >= 0.5) {
        return {
          score: 75,
          explanation: `Solid functional role alignment (${matchedTokens.join(', ')})`,
        };
      } else if (overlapRatio > 0) {
        return {
          score: 62,
          explanation: `Related background with shared role elements (${matchedTokens.join(', ')})`,
        };
      }
    }

    // Case 3: Responsibility & Experience alignment
    const responsibilitiesText = Array.isArray(job.responsibilities)
      ? job.responsibilities.join(' ')
      : (job.responsibilities || '');
    const candidateExpText = (candidate.experiences || [])
      .map((e) => `${e.position} ${(e.highlights || []).join(' ')}`)
      .join(' ');

    const respTokens = tokenize(responsibilitiesText);
    const expTokens = tokenize(candidateExpText);
    const respCosine = calculateTextCosine(respTokens, expTokens);

    if (respCosine > 0.3) {
      const respScore = Math.min(85, Math.max(55, Math.round(respCosine * 100 * 1.5)));
      return {
        score: respScore,
        explanation: 'Relevant operational background aligned with core job responsibilities',
      };
    }

    // Baseline if candidate has general experience vs fresher without specific headline
    if ((candidate.isFresher || candidate.totalExperienceYears === 0) && !candidate.headline && pastPositions.length === 0) {
      return {
        score: 50,
        explanation: 'Entry-level candidate evaluated on foundational competencies',
      };
    }

    return {
      score: 35,
      explanation: 'Candidate career trajectory differs from target role',
    };
  }

  private static getSemanticExplanation(score: number): string {
    if (score >= 80) {
      return 'High semantic relevance to job description and core responsibilities';
    } else if (score >= 65) {
      return 'Solid contextual alignment with key role objectives';
    } else if (score >= 50) {
      return 'Moderate contextual overlap with position responsibilities';
    } else {
      return 'Limited semantic alignment with specified responsibilities';
    }
  }
}
