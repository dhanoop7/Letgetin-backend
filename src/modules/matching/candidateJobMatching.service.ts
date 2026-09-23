import mongoose from 'mongoose';
import { embeddingService } from '../embedding/embedding.service.js';
import {
  CandidateDataResolver,
  IResolvedCandidateData,
  ResolveCandidateInput,
} from '../profile/candidateDataResolver.js';
import { EducationMatcher } from './educationMatcher.js';
import { SemanticRoleMatcher } from './semanticRoleMatcher.js';
import {
  JobCandidateMatchResult,
  MatchRecommendation,
  ExperienceMatchStatus,
  ISkillsMatchComponent,
  IExperienceMatchComponent,
  IMatchScoreBreakdown,
} from './matching.types.js';
import { JobModel } from '../job/job.model.js';
import { CandidateProfileModel } from '../job/candidateProfile.model.js';
import { UserModel } from '../user/user.model.js';
import { UserProfileModel } from '../profile/profile.model.js';
import { ResumeModel } from '../resume/resume.model.js';
import { normalizeSkillsList } from '../job/jobRequirements.utils.js';

export class CandidateJobMatchingService {
  private static instance: CandidateJobMatchingService;

  public static getInstance(): CandidateJobMatchingService {
    if (!CandidateJobMatchingService.instance) {
      CandidateJobMatchingService.instance = new CandidateJobMatchingService();
    }
    return CandidateJobMatchingService.instance;
  }

  /**
   * Evaluates match between any candidate and any job across any industry.
   * Completely industry-neutral: supports software, healthcare, finance, trades, education, sales, etc.
   */
  public matchCandidateToJob(
    candidateInput: IResolvedCandidateData | ResolveCandidateInput,
    jobInput: any,
    options?: {
      candidateEmbedding?: number[];
      jobEmbedding?: number[];
    }
  ): JobCandidateMatchResult {
    // 1. Resolve normalized candidate data
    const candidate: IResolvedCandidateData = this.ensureResolvedCandidate(candidateInput);

    // 2. Extract structured job requirements with legacy fallback
    const jobRequirements = this.extractJobRequirements(jobInput);

    // 3. Required Skills Matching
    const requiredSkillsResult = this.evaluateSkills(
      jobRequirements.requiredSkills,
      candidate.skills
    );

    // 4. Preferred Skills Matching
    const preferredSkillsResult = this.evaluateSkills(
      jobRequirements.preferredSkills,
      candidate.skills
    );

    // 5. Experience Matching
    const experienceResult = this.evaluateExperience(
      candidate.totalExperienceYears,
      jobRequirements.minimumExperienceYears,
      jobRequirements.maximumExperienceYears
    );

    // 6. Education Matching
    const educationResult = EducationMatcher.evaluateEducation(
      candidate.educations,
      jobRequirements.educationMinimumLevel
    );

    // 7. Semantic & Role Relevance Matching
    const candidateEmbedding = options?.candidateEmbedding;
    const jobEmbedding = options?.jobEmbedding || jobInput.embedding;

    const semanticResult = SemanticRoleMatcher.evaluateSemanticMatch(
      candidate,
      jobInput,
      candidateEmbedding,
      jobEmbedding
    );

    const roleResult = SemanticRoleMatcher.evaluateRoleRelevance(
      candidate,
      jobInput
    );

    // 8. Dynamic Weight Allocation & Composite Score
    const breakdown: IMatchScoreBreakdown = {
      requiredSkillsScore: requiredSkillsResult.score,
      preferredSkillsScore: preferredSkillsResult.score,
      experienceScore: experienceResult.score,
      educationScore: educationResult.component.score,
      semanticScore: semanticResult.score,
      roleRelevanceScore: roleResult.score,
    };

    const overallScore = this.computeWeightedScore(breakdown, {
      hasRequiredSkills: jobRequirements.requiredSkills.length > 0,
      hasPreferredSkills: jobRequirements.preferredSkills.length > 0,
      hasExperienceReq: jobRequirements.minimumExperienceYears !== undefined || jobRequirements.maximumExperienceYears !== undefined,
      hasEducationReq: jobRequirements.educationMinimumLevel !== undefined && jobRequirements.educationMinimumLevel !== 'none',
    });

    // 9. Classify Recommendation
    let recommendation: MatchRecommendation = 'potential_match';
    if (overallScore >= 75 && (jobRequirements.requiredSkills.length === 0 || requiredSkillsResult.score >= 50)) {
      recommendation = 'strong_match';
    } else if (overallScore < 50) {
      recommendation = 'weak_match';
    }

    // 10. Generate Deterministic Explanations
    const explanations = this.generateExplanations({
      candidate,
      jobRequirements,
      requiredSkillsResult,
      preferredSkillsResult,
      experienceResult,
      educationExplanation: educationResult.explanation,
      semanticExplanation: semanticResult.explanation,
      roleExplanation: roleResult.explanation,
    });

    return {
      overallScore,
      breakdown,
      requiredSkills: requiredSkillsResult,
      preferredSkills: preferredSkillsResult,
      experience: experienceResult,
      education: educationResult.component,
      semantic: { score: semanticResult.score },
      roleRelevance: { score: roleResult.score },
      recommendation,
      explanations,
    };
  }

  /**
   * Helper to load database documents and perform match without N+1 queries.
   */
  public async matchCandidateIdToJobId(
    userId: string,
    jobId: string
  ): Promise<JobCandidateMatchResult | null> {
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(jobId)) {
      return null;
    }

    const [job, user, userProfile, resume, candidateProfile] = await Promise.all([
      JobModel.findById(jobId).lean(),
      UserModel.findById(userId).select('fullName email').lean(),
      UserProfileModel.findOne({ userId }).lean(),
      ResumeModel.findOne({ userId }).sort({ updatedAt: -1 }).lean(),
      CandidateProfileModel.findOne({ userId }).lean(),
    ]);

    if (!job) return null;

    const resolved = CandidateDataResolver.resolve({
      userId,
      user,
      userProfile,
      resume,
      candidateProfile,
    });

    return this.matchCandidateToJob(resolved, job, {
      candidateEmbedding: candidateProfile?.embedding,
      jobEmbedding: job.embedding,
    });
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  private ensureResolvedCandidate(
    input: IResolvedCandidateData | ResolveCandidateInput
  ): IResolvedCandidateData {
    if ('totalExperienceMonths' in input && Array.isArray((input as any).detailedSkills)) {
      return input as IResolvedCandidateData;
    }
    return CandidateDataResolver.resolve(input as ResolveCandidateInput);
  }

  private extractJobRequirements(job: any): {
    requiredSkills: string[];
    preferredSkills: string[];
    minimumExperienceYears?: number;
    maximumExperienceYears?: number;
    educationMinimumLevel?: string;
  } {
    const structured = job.structuredRequirements;

    let requiredSkills: string[] = [];
    let preferredSkills: string[] = [];
    let minimumExperienceYears: number | undefined;
    let maximumExperienceYears: number | undefined;
    let educationMinimumLevel: string | undefined;

    if (structured) {
      requiredSkills = normalizeSkillsList(structured.requiredSkills || []);
      preferredSkills = normalizeSkillsList(structured.preferredSkills || []);
      minimumExperienceYears = structured.minimumExperienceYears;
      maximumExperienceYears = structured.maximumExperienceYears;
      educationMinimumLevel = structured.education?.minimumLevel;
    }

    // Fallback to legacy fields if structured requirements are empty/missing
    if (requiredSkills.length === 0 && Array.isArray(job.skills) && job.skills.length > 0) {
      requiredSkills = normalizeSkillsList(job.skills);
    } else if (requiredSkills.length === 0 && Array.isArray(job.requirements) && job.requirements.length > 0) {
      requiredSkills = normalizeSkillsList(job.requirements);
    }

    if (preferredSkills.length === 0 && Array.isArray(job.preferredQualifications) && job.preferredQualifications.length > 0) {
      preferredSkills = normalizeSkillsList(job.preferredQualifications);
    }

    if (minimumExperienceYears === undefined && typeof job.minimumExperience === 'number') {
      minimumExperienceYears = job.minimumExperience;
    }

    if (maximumExperienceYears === undefined && typeof job.maximumExperience === 'number') {
      maximumExperienceYears = job.maximumExperience;
    }

    if (!educationMinimumLevel && typeof job.educationRequirements === 'string') {
      const eduStr = job.educationRequirements.toLowerCase();
      if (eduStr.includes('none') || eduStr.includes('no formal') || eduStr.includes('not required')) {
        educationMinimumLevel = 'none';
      } else if (eduStr.includes('doctorate') || eduStr.includes('phd')) {
        educationMinimumLevel = 'doctorate';
      } else if (eduStr.includes('master')) {
        educationMinimumLevel = 'master';
      } else if (eduStr.includes('bachelor') || eduStr.includes('degree')) {
        educationMinimumLevel = 'bachelor';
      } else if (eduStr.includes('associate')) {
        educationMinimumLevel = 'associate';
      } else if (eduStr.includes('diploma')) {
        educationMinimumLevel = 'diploma';
      } else if (eduStr.includes('high school')) {
        educationMinimumLevel = 'high_school';
      }
    }

    return {
      requiredSkills,
      preferredSkills,
      minimumExperienceYears,
      maximumExperienceYears,
      educationMinimumLevel,
    };
  }

  private evaluateSkills(
    targetSkills: string[],
    candidateSkills: string[]
  ): ISkillsMatchComponent {
    if (!targetSkills || targetSkills.length === 0) {
      return {
        matched: [],
        missing: [],
        score: 100,
      };
    }

    const analysis = embeddingService.calculateSkillsMatch(targetSkills, candidateSkills || []);
    return {
      matched: analysis.matched,
      missing: analysis.missing,
      score: analysis.score,
    };
  }

  private evaluateExperience(
    candidateYears: number,
    minYears?: number,
    maxYears?: number
  ): IExperienceMatchComponent {
    // Case 1: No requirement stated
    if (minYears === undefined && maxYears === undefined) {
      return {
        candidateYears,
        minimumRequired: undefined,
        maximumPreferred: undefined,
        score: 100,
        status: 'no_requirement',
      };
    }

    const effectiveMin = minYears ?? 0;

    // Case 2: Within range
    if (candidateYears >= effectiveMin && (maxYears === undefined || candidateYears <= maxYears)) {
      return {
        candidateYears,
        minimumRequired: minYears,
        maximumPreferred: maxYears,
        score: 100,
        status: 'within_range',
      };
    }

    // Case 3: Below minimum
    if (candidateYears < effectiveMin) {
      const deficit = effectiveMin - candidateYears;
      let score = 50;
      if (deficit <= 1) {
        score = 80;
      } else if (deficit <= 2) {
        score = 65;
      } else if (deficit <= 3) {
        score = 50;
      } else {
        score = Math.max(15, Math.round(50 - (deficit - 3) * 10));
      }

      return {
        candidateYears,
        minimumRequired: minYears,
        maximumPreferred: maxYears,
        score,
        status: 'below_minimum',
      };
    }

    // Case 4: Exceeds maximum (never harshly penalize experienced candidates)
    return {
      candidateYears,
      minimumRequired: minYears,
      maximumPreferred: maxYears,
      score: 90,
      status: 'above_range',
    };
  }

  private computeWeightedScore(
    breakdown: IMatchScoreBreakdown,
    context: {
      hasRequiredSkills: boolean;
      hasPreferredSkills: boolean;
      hasExperienceReq: boolean;
      hasEducationReq: boolean;
    }
  ): number {
    // Baseline Weights:
    // Required: 35%
    // Preferred: 10%
    // Experience: 20%
    // Education: 5%
    // Semantic: 20%
    // Role Relevance: 10%
    let wRequired = 0.35;
    let wPreferred = 0.10;
    let wExperience = 0.20;
    let wEducation = 0.05;
    let wSemantic = 0.20;
    let wRole = 0.10;

    // Dynamic Rebalancing:
    // If no preferred skills, reallocate 10% to required (5%) and semantic (5%)
    if (!context.hasPreferredSkills) {
      wPreferred = 0;
      wRequired += 0.05;
      wSemantic += 0.05;
    }

    // If no required skills, reallocate to semantic (20%) and role (15%)
    if (!context.hasRequiredSkills) {
      wRequired = 0;
      wSemantic += 0.20;
      wRole += 0.15;
    }

    const totalWeight = wRequired + wPreferred + wExperience + wEducation + wSemantic + wRole;

    const weightedScore = (
      breakdown.requiredSkillsScore * wRequired +
      breakdown.preferredSkillsScore * wPreferred +
      breakdown.experienceScore * wExperience +
      breakdown.educationScore * wEducation +
      breakdown.semanticScore * wSemantic +
      breakdown.roleRelevanceScore * wRole
    ) / totalWeight;

    return Math.max(1, Math.min(100, Math.round(weightedScore)));
  }

  private generateExplanations(input: {
    candidate: IResolvedCandidateData;
    jobRequirements: any;
    requiredSkillsResult: ISkillsMatchComponent;
    preferredSkillsResult: ISkillsMatchComponent;
    experienceResult: IExperienceMatchComponent;
    educationExplanation: string;
    semanticExplanation: string;
    roleExplanation: string;
  }): string[] {
    const explanations: string[] = [];

    // Required Skills
    if (input.jobRequirements.requiredSkills.length > 0) {
      const matchedCount = input.requiredSkillsResult.matched.length;
      const totalCount = input.jobRequirements.requiredSkills.length;
      if (matchedCount === totalCount) {
        explanations.push(`Matches all ${totalCount} required skills: ${input.requiredSkillsResult.matched.join(', ')}`);
      } else if (matchedCount > 0) {
        explanations.push(
          `Matches ${matchedCount} of ${totalCount} required skills: ${input.requiredSkillsResult.matched.join(', ')} (Missing: ${input.requiredSkillsResult.missing.join(', ')})`
        );
      } else {
        explanations.push(`Missing required skills: ${input.requiredSkillsResult.missing.join(', ')}`);
      }
    }

    // Preferred Skills
    if (input.jobRequirements.preferredSkills.length > 0 && input.preferredSkillsResult.matched.length > 0) {
      explanations.push(
        `Possesses ${input.preferredSkillsResult.matched.length} preferred skill${input.preferredSkillsResult.matched.length > 1 ? 's' : ''}: ${input.preferredSkillsResult.matched.join(', ')}`
      );
    }

    // Experience
    const exp = input.experienceResult;
    if (exp.status === 'within_range') {
      const reqText = exp.minimumRequired !== undefined && exp.maximumPreferred !== undefined
        ? `${exp.minimumRequired}–${exp.maximumPreferred} yrs`
        : (exp.minimumRequired !== undefined ? `${exp.minimumRequired}+ yrs` : 'Entry-level');
      explanations.push(`Meets experience requirement (${exp.candidateYears} yrs vs ${reqText} expected)`);
    } else if (exp.status === 'below_minimum') {
      explanations.push(
        `Experience level (${exp.candidateYears} yrs) is below target minimum (${exp.minimumRequired} yrs)`
      );
    } else if (exp.status === 'above_range') {
      explanations.push(
        `Highly experienced candidate (${exp.candidateYears} yrs) exceeds target range (${exp.maximumPreferred} yrs)`
      );
    }

    // Education
    if (input.educationExplanation) {
      explanations.push(input.educationExplanation);
    }

    // Semantic Alignment
    if (input.semanticExplanation) {
      explanations.push(input.semanticExplanation);
    }

    // Role Relevance
    if (input.roleExplanation) {
      explanations.push(input.roleExplanation);
    }

    return explanations;
  }
}

export const candidateJobMatchingService = CandidateJobMatchingService.getInstance();
