import {
  EducationLevel,
  IJobEducationRequirement,
  IJobRequirements,
  IJobSkillRequirement,
  SkillProficiency,
  SkillRequirementArray,
} from './job.model.js';

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

export const VALID_PROFICIENCIES: SkillProficiency[] = [
  'beginner',
  'intermediate',
  'advanced',
  'expert',
];

export { SkillRequirementArray };

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
 * Normalizes a single skill item (string or object) into structured IJobSkillRequirement.
 * Defaults legacy skills without proficiency to 'intermediate'.
 */
export function normalizeSkillRequirement(item: unknown): IJobSkillRequirement | null {
  if (!item) return null;

  if (typeof item === 'string') {
    const trimmed = item.trim();
    if (!trimmed) return null;
    return { name: trimmed, proficiency: 'intermediate' };
  }

  if (typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    const rawName = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!rawName) return null;

    let prof: SkillProficiency = 'intermediate';
    if (typeof obj.proficiency === 'string') {
      const p = obj.proficiency.toLowerCase().trim() as SkillProficiency;
      if (VALID_PROFICIENCIES.includes(p)) {
        prof = p;
      }
    }
    return { name: rawName, proficiency: prof };
  }

  return null;
}

/**
 * Normalizes and deduplicates an array of skill items (strings or objects) into IJobSkillRequirement[].
 * Case-insensitively deduplicates skills while preserving the first seen readable casing.
 */
export function normalizeSkillRequirementsList(skills: unknown): SkillRequirementArray {
  if (!Array.isArray(skills)) return new SkillRequirementArray();
  const seen = new Set<string>();
  const result: IJobSkillRequirement[] = [];

  for (const item of skills) {
    const normalized = normalizeSkillRequirement(item);
    if (!normalized) continue;

    const lower = normalized.name.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(normalized);
    }
  }

  return new SkillRequirementArray(...result);
}

/**
 * Legacy string extractor: Normalizes and deduplicates an array of skills into plain string[]
 * Supports inputs that are string[] or IJobSkillRequirement[].
 */
export function normalizeSkillsList(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of skills) {
    let name = '';
    if (typeof item === 'string') {
      name = item.trim();
    } else if (item && typeof item === 'object' && 'name' in item && typeof (item as any).name === 'string') {
      name = (item as any).name.trim();
    }
    if (!name) continue;

    const lower = name.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(name);
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
): { requiredSkills: SkillRequirementArray; preferredSkills: string[] } {
  const requiredSkills = normalizeSkillRequirementsList(rawRequired);
  const rawPrefList = normalizeSkillsList(rawPreferred);

  const requiredLowerSet = new Set(requiredSkills.map((s) => s.name.toLowerCase()));
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
