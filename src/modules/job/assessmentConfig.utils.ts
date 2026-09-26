import crypto from 'crypto';
import {
  AssessmentRoundType,
  GeneralAssessmentQuestionType,
  IAssessmentRoundConfig,
  IJobAssessmentConfig,
} from './job.model.js';

export const SUPPORTED_ASSESSMENT_TYPES: readonly AssessmentRoundType[] = [
  'general',
  'coding',
] as const;

export const DEFAULT_ASSESSMENT_NAMES: Record<AssessmentRoundType, string> = {
  general: 'General Assessment',
  coding: 'Coding Assessment',
};

export const SUPPORTED_GENERAL_QUESTION_TYPES: readonly GeneralAssessmentQuestionType[] = [
  'mcq',
  'short_answer',
  'scenario',
] as const;

export const DEFAULT_QUESTION_TYPE_NAMES: Record<GeneralAssessmentQuestionType, string> = {
  mcq: 'Multiple Choice',
  short_answer: 'Short Answer',
  scenario: 'Scenario-Based',
};

export function isSupportedAssessmentType(val: unknown): val is AssessmentRoundType {
  return typeof val === 'string' && SUPPORTED_ASSESSMENT_TYPES.includes(val as AssessmentRoundType);
}

export function isSupportedGeneralQuestionType(val: unknown): val is GeneralAssessmentQuestionType {
  return typeof val === 'string' && SUPPORTED_GENERAL_QUESTION_TYPES.includes(val as GeneralAssessmentQuestionType);
}

export interface RawAssessmentRoundInput {
  id?: string;
  type: AssessmentRoundType | string;
  order?: number;
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface RawAssessmentConfigInput {
  enabled?: boolean;
  rounds?: RawAssessmentRoundInput[];
}

/**
 * Normalizes assessment configuration for a job:
 * 1. Validates enabled flag.
 * 2. If disabled, returns canonical inactive state { enabled: false, rounds: [] }.
 * 3. Filters only active/enabled rounds.
 * 4. Only supports assessment round types: 'general' | 'coding'.
 *    (Adapts legacy 'mcq' | 'short_answer' | 'scenario' rounds into 'general' for backward compatibility).
 * 5. Deduplicates rounds by assessment type (at most one 'general', at most one 'coding').
 * 6. For 'general' assessment, normalizes questionTypes ('mcq', 'short_answer', 'scenario').
 * 7. Generates/preserves stable unique round IDs.
 * 8. Normalizes orders sequentially (1, 2).
 * 9. Preserves type-specific config for future extensibility.
 */
export function normalizeAssessmentConfiguration(
  input?: RawAssessmentConfigInput | Partial<IJobAssessmentConfig> | null
): IJobAssessmentConfig {
  if (!input || typeof input !== 'object') {
    return { enabled: false, rounds: [] };
  }

  const enabled = Boolean(input.enabled);
  if (!enabled) {
    return { enabled: false, rounds: [] };
  }

  if (!Array.isArray(input.rounds) || input.rounds.length === 0) {
    return { enabled: true, rounds: [] };
  }

  const seenTypes = new Set<AssessmentRoundType>();
  const validRounds: IAssessmentRoundConfig[] = [];

  for (const rawRound of input.rounds) {
    if (!rawRound || typeof rawRound !== 'object') continue;

    let roundType = (rawRound as any).type;

    // Disabled rounds should not participate in the active assessment pipeline
    if ((rawRound as any).enabled === false) continue;

    // Backward compatibility adaptation: if a legacy round has type 'mcq' | 'short_answer' | 'scenario'
    let legacyQuestionType: GeneralAssessmentQuestionType | null = null;
    if (roundType === 'mcq' || roundType === 'short_answer' || roundType === 'scenario') {
      legacyQuestionType = roundType as GeneralAssessmentQuestionType;
      roundType = 'general';
    }

    if (!isSupportedAssessmentType(roundType)) continue;

    // A job cannot have general + general or coding + coding: deduplicate by type
    if (seenTypes.has(roundType)) {
      // If this was an additional legacy question type for general, add it to existing general round
      if (roundType === 'general' && legacyQuestionType) {
        const existingGeneral = validRounds.find((r) => r.type === 'general');
        if (existingGeneral && existingGeneral.config && Array.isArray((existingGeneral.config as any).questionTypes)) {
          const currentTypes = (existingGeneral.config as any).questionTypes as GeneralAssessmentQuestionType[];
          if (!currentTypes.includes(legacyQuestionType)) {
            currentTypes.push(legacyQuestionType);
          }
        }
      }
      continue;
    }
    seenTypes.add(roundType);

    const rawId = typeof (rawRound as any).id === 'string' ? (rawRound as any).id.trim() : '';
    const stableId = rawId || `round_${roundType}_${crypto.randomUUID().slice(0, 8)}`;

    const rawName = typeof (rawRound as any).name === 'string' ? (rawRound as any).name.trim() : '';
    const name = rawName || DEFAULT_ASSESSMENT_NAMES[roundType];

    const rawOrder = typeof (rawRound as any).order === 'number' && !isNaN((rawRound as any).order)
      ? (rawRound as any).order
      : validRounds.length + 1;

    let config = (rawRound as any).config && typeof (rawRound as any).config === 'object'
      ? { ...(rawRound as any).config }
      : {};

    if (roundType === 'general') {
      // Normalize question types
      let questionTypes: GeneralAssessmentQuestionType[] = [];
      if (Array.isArray(config.questionTypes)) {
        questionTypes = config.questionTypes.filter(isSupportedGeneralQuestionType);
      } else if (legacyQuestionType) {
        questionTypes = [legacyQuestionType];
      }

      // If no valid question types were found, default to all three
      if (questionTypes.length === 0) {
        questionTypes = ['mcq', 'short_answer', 'scenario'];
      }

      const uniqueTypes = Array.from(new Set(questionTypes));

      const durationMinutes =
        typeof config.durationMinutes === 'number' && config.durationMinutes > 0
          ? Math.round(config.durationMinutes)
          : 60;

      const passingScore =
        typeof config.passingScore === 'number' && !isNaN(config.passingScore)
          ? Math.max(0, Math.min(100, Math.round(config.passingScore)))
          : 70;

      const normalizedConfig: Record<string, unknown> = {
        ...config,
        questionTypes: uniqueTypes,
        durationMinutes,
        passingScore,
      };

      if (uniqueTypes.includes('mcq')) {
        normalizedConfig.mcq = {
          questionCount:
            typeof config.mcq?.questionCount === 'number' && config.mcq.questionCount >= 1
              ? Math.round(config.mcq.questionCount)
              : 15,
          difficulty: config.mcq?.difficulty || 'mixed',
          ...(typeof config.mcq === 'object' && config.mcq !== null ? config.mcq : {}),
        };
      } else {
        delete normalizedConfig.mcq;
      }

      if (uniqueTypes.includes('short_answer')) {
        normalizedConfig.shortAnswer = {
          questionCount:
            typeof config.shortAnswer?.questionCount === 'number' && config.shortAnswer.questionCount >= 1
              ? Math.round(config.shortAnswer.questionCount)
              : 5,
          ...(typeof config.shortAnswer === 'object' && config.shortAnswer !== null ? config.shortAnswer : {}),
        };
      } else {
        delete normalizedConfig.shortAnswer;
      }

      if (uniqueTypes.includes('scenario')) {
        normalizedConfig.scenario = {
          questionCount:
            typeof config.scenario?.questionCount === 'number' && config.scenario.questionCount >= 1
              ? Math.round(config.scenario.questionCount)
              : 3,
          ...(typeof config.scenario === 'object' && config.scenario !== null ? config.scenario : {}),
        };
      } else {
        delete normalizedConfig.scenario;
      }

      config = normalizedConfig;
    }

    validRounds.push({
      id: stableId,
      type: roundType,
      order: rawOrder,
      name,
      enabled: true,
      config,
    });
  }

  // Sort rounds by provided order to preserve recruiter's intended arrangement
  validRounds.sort((a, b) => a.order - b.order);

  // Normalize order sequentially: 1, 2 (no gaps like 1, 5)
  const normalizedRounds: IAssessmentRoundConfig[] = validRounds.map((round, idx) => ({
    ...round,
    order: idx + 1,
  }));

  return {
    enabled: true,
    rounds: normalizedRounds,
  };
}
