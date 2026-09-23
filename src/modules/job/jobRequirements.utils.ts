import { EducationLevel, IJobEducationRequirement, IJobRequirements } from './job.model.js';

export const VALID_EDUCATION_LEVELS: EducationLevel[] = [
  'none',
  'high_school',
  'associate',
  'diploma',
  'bachelor',
  'master',
  'doctorate',
  'other',
];

/**
 * Normalizes user-supplied education level string into standard EducationLevel enum
 */
export function normalizeEducationLevel(val?: string | null): EducationLevel {
  if (!val) return 'none';
  const clean = val.toLowerCase().trim().replace(/[-\s]/g, '_');
  if (clean === 'highschool' || clean === 'high_school') return 'high_school';
  if (clean === 'associate' || clean === 'associates') return 'associate';
  if (clean === 'diploma') return 'diploma';
  if (clean === 'bachelor' || clean === 'bachelors' || clean === 'undergraduate') return 'bachelor';
  if (clean === 'master' || clean === 'masters' || clean === 'postgraduate') return 'master';
  if (clean === 'doctorate' || clean === 'phd' || clean === 'ph_d' || clean === 'doctoral') return 'doctorate';
  if (clean === 'other') return 'other';
  if (clean === 'none' || clean === 'no_requirement' || clean === 'not_specified') return 'none';
  return 'other';
}

/**
 * Normalizes and deduplicates an array of skill strings case-insensitively
 */
export function normalizeSkillsList(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of skills) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * Resolves required and preferred skills with deterministic conflict handling:
 * If a skill is listed in both required and preferred, it belongs in requiredSkills
 * and is stripped from preferredSkills.
 */
export function resolveRequiredAndPreferredSkills(
  rawRequired: unknown,
  rawPreferred: unknown
): { requiredSkills: string[]; preferredSkills: string[] } {
  const requiredSkills = normalizeSkillsList(rawRequired);
  const rawPrefList = normalizeSkillsList(rawPreferred);

  const requiredLowerSet = new Set(requiredSkills.map((s) => s.toLowerCase()));
  const preferredSkills = rawPrefList.filter((s) => !requiredLowerSet.has(s.toLowerCase()));

  return { requiredSkills, preferredSkills };
}

export interface NormalizeJobRequirementsInput {
  requiredSkills?: unknown;
  preferredSkills?: unknown;
  minimumExperienceYears?: unknown;
  maximumExperienceYears?: unknown;
  education?: {
    minimumLevel?: unknown;
    fields?: unknown;
  };
  // Legacy fields for backward compatibility
  skills?: unknown;
  minimumExperience?: unknown;
  maximumExperience?: unknown;
  educationRequirements?: unknown;
}

/**
 * Authoritative normalizer for job requirements across Create Job and Update flows.
 * Handles both new structured inputs and legacy fallback fields seamlessly.
 */
export function normalizeJobRequirements(input: NormalizeJobRequirementsInput): IJobRequirements {
  // 1. Skills
  let rawRequired = input.requiredSkills;
  let rawPreferred = input.preferredSkills;

  // Fallback to legacy skills array if structured skills are not supplied
  if (!rawRequired && !rawPreferred && input.skills) {
    rawRequired = input.skills;
    rawPreferred = [];
  }

  const { requiredSkills, preferredSkills } = resolveRequiredAndPreferredSkills(rawRequired, rawPreferred);

  // 2. Experience
  let minExp: number | undefined;
  if (typeof input.minimumExperienceYears === 'number' && !isNaN(input.minimumExperienceYears)) {
    minExp = Math.max(0, input.minimumExperienceYears);
  } else if (typeof input.minimumExperience === 'number' && !isNaN(input.minimumExperience)) {
    minExp = Math.max(0, input.minimumExperience);
  }

  let maxExp: number | undefined;
  if (typeof input.maximumExperienceYears === 'number' && !isNaN(input.maximumExperienceYears)) {
    maxExp = Math.max(0, input.maximumExperienceYears);
  } else if (typeof input.maximumExperience === 'number' && !isNaN(input.maximumExperience)) {
    maxExp = Math.max(0, input.maximumExperience);
  }

  // Validate maximum >= minimum if both provided
  if (minExp !== undefined && maxExp !== undefined && maxExp < minExp) {
    throw new Error(`Maximum experience (${maxExp} yrs) cannot be less than minimum experience (${minExp} yrs).`);
  }

  // 3. Education
  let education: IJobEducationRequirement = { minimumLevel: 'none', fields: [] };
  if (input.education && typeof input.education === 'object') {
    const rawLevel = typeof input.education.minimumLevel === 'string' ? input.education.minimumLevel : undefined;
    const minimumLevel = normalizeEducationLevel(rawLevel);
    const fields = normalizeSkillsList(input.education.fields);
    education = { minimumLevel, fields };
  }

  return {
    requiredSkills,
    preferredSkills,
    minimumExperienceYears: minExp,
    maximumExperienceYears: maxExp,
    education,
  };
}
