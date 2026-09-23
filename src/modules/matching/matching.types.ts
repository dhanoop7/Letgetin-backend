/**
 * Canonical Job ↔ Candidate Matching Types
 * 
 * Provides unified, industry-neutral data structures for match scoring,
 * component breakdowns, requirement evaluations, and explainability.
 */

export type MatchRecommendation = 'strong_match' | 'potential_match' | 'weak_match';

export type ExperienceMatchStatus =
  | 'within_range'
  | 'below_minimum'
  | 'above_range'
  | 'no_requirement';

export type EducationMatchStatus =
  | 'meets_requirement'
  | 'below_requirement'
  | 'no_requirement'
  | 'unknown';

export interface ISkillsMatchComponent {
  matched: string[];
  missing: string[];
  score: number; // 0-100
}

export interface IExperienceMatchComponent {
  candidateYears: number;
  minimumRequired?: number;
  maximumPreferred?: number;
  score: number; // 0-100
  status: ExperienceMatchStatus;
}

export interface IEducationMatchComponent {
  candidateLevel?: string;
  requiredLevel?: string;
  score: number; // 0-100
  status: EducationMatchStatus;
}

export interface ISemanticMatchComponent {
  score: number; // 0-100
}

export interface IRoleRelevanceComponent {
  score: number; // 0-100
}

export interface IMatchScoreBreakdown {
  requiredSkillsScore: number;
  preferredSkillsScore: number;
  experienceScore: number;
  educationScore: number;
  semanticScore: number;
  roleRelevanceScore: number;
}

export interface JobCandidateMatchResult {
  overallScore: number; // 0-100 integer
  breakdown: IMatchScoreBreakdown;
  requiredSkills: ISkillsMatchComponent;
  preferredSkills: ISkillsMatchComponent;
  experience: IExperienceMatchComponent;
  education: IEducationMatchComponent;
  semantic: ISemanticMatchComponent;
  roleRelevance: IRoleRelevanceComponent;
  recommendation: MatchRecommendation;
  explanations: string[];
}
