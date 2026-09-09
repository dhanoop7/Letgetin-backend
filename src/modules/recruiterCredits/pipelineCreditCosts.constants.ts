export const SUB_OPTION_CREDIT_COST = 10;

export type PipelineSection = 'resumeMatch' | 'assessment' | 'aiInterview';

export interface PipelineSubOption {
  key: string;
  label: string;
}

export const PIPELINE_SUB_OPTIONS: Record<PipelineSection, PipelineSubOption[]> = {
  resumeMatch: [
    { key: 'broadAts', label: 'Broad ATS Match' },
    { key: 'strictSkills', label: 'Strict Skills Match' },
    { key: 'semanticAi', label: 'Semantic AI Match' },
  ],
  assessment: [
    { key: 'basicAptitude', label: 'Basic Aptitude' },
    { key: 'coding', label: 'Coding Assessment' },
    { key: 'domain', label: 'Domain Assessment' },
  ],
  aiInterview: [
    { key: 'screening', label: 'Screening' },
    { key: 'technical', label: 'Technical Interview' },
  ],
};

export interface MatchVolumeOption {
  key: string;
  label: string;
  credits: number;
}

// Single-select, unlike the flat-cost multi-select sections above — each tier has its own cost.
export const MATCH_VOLUME_OPTIONS: MatchVolumeOption[] = [
  { key: '1:10', label: '1 : 10', credits: 10 },
  { key: '1:100', label: '1 : 100', credits: 50 },
  { key: '1:1000', label: '1 : 1000', credits: 100 },
];

import { AppError } from '../../utils/appError.js';

const MATCH_VOLUME_COST_BY_KEY = new Map(MATCH_VOLUME_OPTIONS.map((o) => [o.key, o.credits]));

export function parseMatchVolumeRatio(val?: string | null): { isCustom: boolean; ratioNumber: number | null; key: string | null } {
  if (!val) return { isCustom: false, ratioNumber: null, key: null };
  const trimmed = val.trim();
  if (MATCH_VOLUME_COST_BY_KEY.has(trimmed)) {
    return { isCustom: false, ratioNumber: null, key: trimmed };
  }
  const clean = trimmed.replace(/^custom:/i, '').trim();
  const match = clean.match(/^1\s*:\s*(\d+)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    return { isCustom: true, ratioNumber: num, key: `1:${num}` };
  }
  return { isCustom: false, ratioNumber: null, key: null };
}

export function getMatchVolumeCost(matchVolume?: string | null): number {
  if (!matchVolume) return 0;
  if (MATCH_VOLUME_COST_BY_KEY.has(matchVolume)) {
    return MATCH_VOLUME_COST_BY_KEY.get(matchVolume) || 0;
  }
  const parsed = parseMatchVolumeRatio(matchVolume);
  if (parsed.isCustom && parsed.ratioNumber !== null && parsed.ratioNumber >= 1 && parsed.ratioNumber <= 10) {
    return 10;
  }
  return 0;
}

export interface PipelineSelection {
  matchVolume?: string | null;
  resumeMatch?: boolean;
  resumeMatchTypes?: string[];
  assessment?: boolean;
  assessmentTypes?: string[];
  aiInterview?: boolean;
  aiInterviewTypes?: string[];
}

export interface SanitizedPipelineOptions {
  matchVolume: string | null;
  resumeMatch: boolean;
  resumeMatchTypes: string[];
  assessment: boolean;
  assessmentTypes: string[];
  aiInterview: boolean;
  aiInterviewTypes: string[];
}

/**
 * Server-authoritative normalization: a section's sub-options only ever count if that section
 * was explicitly enabled AND the key is a real option for that section — never trust the client
 * to have cleared stale selections when toggling a section off. matchVolume is single-select and
 * defaults to no selection (null) unless it's exactly one of the real tier keys or a valid custom ratio <= 10.
 */
export function sanitizePipelineSelection(input?: PipelineSelection): SanitizedPipelineOptions {
  const filterKeys = (section: PipelineSection, enabled: boolean | undefined, keys?: string[]): string[] => {
    if (!enabled || !keys) return [];
    const valid = new Set(PIPELINE_SUB_OPTIONS[section].map((o) => o.key));
    return [...new Set(keys.filter((k) => valid.has(k)))];
  };

  let matchVolume: string | null = null;
  if (input?.matchVolume) {
    const parsed = parseMatchVolumeRatio(input.matchVolume);
    if (parsed.isCustom) {
      if (parsed.ratioNumber !== null && parsed.ratioNumber > 10) {
        throw AppError.badRequest('Custom ratio cannot exceed 1:10.');
      }
      if (parsed.ratioNumber !== null && parsed.ratioNumber >= 1 && parsed.ratioNumber <= 10) {
        matchVolume = parsed.key;
      }
    } else if (parsed.key) {
      matchVolume = parsed.key;
    }
  }

  const resumeMatchTypes = filterKeys('resumeMatch', input?.resumeMatch, input?.resumeMatchTypes);
  const assessmentTypes = filterKeys('assessment', input?.assessment, input?.assessmentTypes);
  const aiInterviewTypes = filterKeys('aiInterview', input?.aiInterview, input?.aiInterviewTypes);

  return {
    matchVolume,
    resumeMatch: resumeMatchTypes.length > 0,
    resumeMatchTypes,
    assessment: assessmentTypes.length > 0,
    assessmentTypes,
    aiInterview: aiInterviewTypes.length > 0,
    aiInterviewTypes,
  };
}

export function computePipelineCreditsCost(input?: PipelineSelection): number {
  const sanitized = sanitizePipelineSelection(input);
  const matchVolumeCost = getMatchVolumeCost(sanitized.matchVolume);
  const subOptionCount =
    sanitized.resumeMatchTypes.length + sanitized.assessmentTypes.length + sanitized.aiInterviewTypes.length;
  return matchVolumeCost + subOptionCount * SUB_OPTION_CREDIT_COST;
}
