import { EducationLevel } from '../job/job.model.js';
import { INormalizedEducation } from '../profile/candidateDataResolver.js';
import { IEducationMatchComponent, EducationMatchStatus } from './matching.types.js';

const EDUCATION_RANK: Record<EducationLevel, number> = {
  none: 0,
  other: 1,
  high_school: 1,
  associate: 2,
  diploma: 2,
  bachelor: 3,
  master: 4,
  doctorate: 5,
};

const DISPLAY_NAMES: Record<EducationLevel, string> = {
  none: 'No requirement',
  high_school: 'High School',
  associate: 'Associate Degree',
  diploma: 'Diploma',
  bachelor: "Bachelor's Degree",
  master: "Master's Degree",
  doctorate: 'Doctorate / PhD',
  other: 'Other Qualification',
};

export class EducationMatcher {
  /**
   * Infers standard generic EducationLevel from candidate degrees.
   */
  public static inferCandidateLevel(educations?: INormalizedEducation[]): EducationLevel | undefined {
    if (!educations || educations.length === 0) {
      return undefined;
    }

    let highestLevel: EducationLevel = 'other';
    let highestRank = 0;

    for (const edu of educations) {
      const text = `${edu.degree || ''} ${edu.fieldOfStudy || ''}`.toLowerCase().trim();
      if (!text) continue;

      let detected: EducationLevel = 'other';

      if (/\b(ph\.?d|doctorate|doctoral|m\.?d|d\.?d\.?s)\b/i.test(text)) {
        detected = 'doctorate';
      } else if (/\b(master|m\.?s|m\.?tech|m\.?b\.?a|m\.?c\.?a|m\.?a|m\.?com|m\.?sc|postgraduate)\b/i.test(text)) {
        detected = 'master';
      } else if (/\b(bachelor|b\.?s|b\.?tech|b\.?b\.?a|b\.?c\.?a|b\.?a|b\.?com|b\.?sc|b\.?e|undergraduate)\b/i.test(text)) {
        detected = 'bachelor';
      } else if (/\b(associate|a\.?s|a\.?a)\b/i.test(text)) {
        detected = 'associate';
      } else if (/\b(diploma|polytechnic|vocational)\b/i.test(text)) {
        detected = 'diploma';
      } else if (/\b(high\s*school|secondary|higher\s*secondary|12th|ged|matriculation)\b/i.test(text)) {
        detected = 'high_school';
      }

      const rank = EDUCATION_RANK[detected] ?? 1;
      if (rank > highestRank) {
        highestRank = rank;
        highestLevel = detected;
      }
    }

    return highestRank > 0 ? highestLevel : undefined;
  }

  /**
   * Formats level for human-readable display.
   */
  public static formatLevel(level?: string): string {
    if (!level) return 'Unspecified';
    return DISPLAY_NAMES[level as EducationLevel] || level;
  }

  /**
   * Evaluates candidate education against job education requirement.
   */
  public static evaluateEducation(
    candidateEducations?: INormalizedEducation[],
    requiredLevelInput?: EducationLevel | string
  ): {
    component: IEducationMatchComponent;
    explanation: string;
  } {
    const requiredLevel: EducationLevel = (requiredLevelInput as EducationLevel) || 'none';
    const candidateLevel = this.inferCandidateLevel(candidateEducations);

    // Case 1: Job has no education requirement
    if (!requiredLevel || requiredLevel === 'none') {
      return {
        component: {
          candidateLevel,
          requiredLevel: 'none',
          score: 100,
          status: 'no_requirement',
        },
        explanation: 'No specific education requirement',
      };
    }

    // Case 2: Candidate education is unknown/unspecified
    if (!candidateLevel) {
      return {
        component: {
          candidateLevel: undefined,
          requiredLevel,
          score: 60,
          status: 'unknown',
        },
        explanation: `Candidate education level is unspecified against requirement (${this.formatLevel(requiredLevel)})`,
      };
    }

    // Case 3: Required level is "other" and candidate has some education
    if (requiredLevel === 'other') {
      return {
        component: {
          candidateLevel,
          requiredLevel: 'other',
          score: 100,
          status: 'meets_requirement',
        },
        explanation: `Candidate possesses relevant qualification (${this.formatLevel(candidateLevel)})`,
      };
    }

    const candidateRank = EDUCATION_RANK[candidateLevel] ?? 1;
    const requiredRank = EDUCATION_RANK[requiredLevel] ?? 1;

    // Case 4: Candidate meets or exceeds requirement
    if (candidateRank >= requiredRank) {
      return {
        component: {
          candidateLevel,
          requiredLevel,
          score: 100,
          status: 'meets_requirement',
        },
        explanation: `Meets education requirement (${this.formatLevel(candidateLevel)} satisfies ${this.formatLevel(requiredLevel)})`,
      };
    }

    // Case 5: Candidate is below requirement (graduated scoring, non-dominant)
    const rankDiff = requiredRank - candidateRank;
    let score = 50;
    if (rankDiff === 1) {
      score = 75; // e.g. Associate for Bachelor, or Bachelor for Master
    } else if (rankDiff === 2) {
      score = 55; // e.g. High School for Bachelor
    } else {
      score = 40;
    }

    return {
      component: {
        candidateLevel,
        requiredLevel,
        score,
        status: 'below_requirement',
      },
      explanation: `Education level (${this.formatLevel(candidateLevel)}) is below stated requirement (${this.formatLevel(requiredLevel)})`,
    };
  }
}
