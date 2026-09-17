import { AppError } from '../../../utils/appError.js';
import { IFunnelStage } from '../hiringFunnelConfig.model.js';

export interface StageCalculationInput {
  stageId: string;
  stageName: string;
  stageType: 'resume_match' | 'assessment' | 'ai_interview' | 'manual_review';
  order: number;
  expectedAttendanceRate: number; // 0 < rate <= 1
  expectedPassRate: number;       // 0 < rate <= 1
  deadlineHours?: number;
  autoAdvanceScoreThreshold?: number;
  autoRefillEnabled?: boolean;
}

export interface FunnelCalculationResult {
  finalShortlistTarget: number;
  totalFunnelIntakeTarget: number;
  stages: IFunnelStage[];
}

export class HiringFunnelCalculator {
  /**
   * Calculates stage-level candidate target counts backwards from the final shortlist target.
   *
   * Formula for Stage i:
   *   requiredAtStage_i = ceil(requiredAtStage_{i+1} / (attendanceRate_i * passRate_i))
   *
   * Base Case (Final Stage M):
   *   yields target N (finalShortlistTarget)
   */
  public static calculateFunnel(
    finalShortlistTarget: number,
    stagesInput: StageCalculationInput[]
  ): FunnelCalculationResult {
    // 1. Validate final target
    if (!Number.isInteger(finalShortlistTarget) || finalShortlistTarget < 1) {
      throw AppError.badRequest(
        `Final shortlist target must be a positive integer greater than or equal to 1. Received: ${finalShortlistTarget}`
      );
    }

    if (!Array.isArray(stagesInput) || stagesInput.length === 0) {
      throw AppError.badRequest('At least one hiring stage is required to calculate the hiring funnel.');
    }

    // 2. Sort stages ascending by order
    const sortedStages = [...stagesInput].sort((a, b) => a.order - b.order);

    // 3. Validate rates and identifiers for each stage
    const seenStageIds = new Set<string>();
    for (let i = 0; i < sortedStages.length; i++) {
      const stage = sortedStages[i];

      if (!stage.stageId?.trim()) {
        throw AppError.badRequest(`Stage at index ${i} is missing a valid stageId.`);
      }
      if (seenStageIds.has(stage.stageId.trim())) {
        throw AppError.badRequest(`Duplicate stageId '${stage.stageId}' detected. Each stage must have a unique identifier.`);
      }
      seenStageIds.add(stage.stageId.trim());

      if (
        typeof stage.expectedAttendanceRate !== 'number' ||
        isNaN(stage.expectedAttendanceRate) ||
        stage.expectedAttendanceRate <= 0 ||
        stage.expectedAttendanceRate > 1.0
      ) {
        throw AppError.badRequest(
          `Stage '${stage.stageName || stage.stageId}' has invalid expectedAttendanceRate: ${stage.expectedAttendanceRate}. Must be between 0.01 and 1.0 (e.g. 0.80 for 80%).`
        );
      }

      if (
        typeof stage.expectedPassRate !== 'number' ||
        isNaN(stage.expectedPassRate) ||
        stage.expectedPassRate <= 0 ||
        stage.expectedPassRate > 1.0
      ) {
        throw AppError.badRequest(
          `Stage '${stage.stageName || stage.stageId}' has invalid expectedPassRate: ${stage.expectedPassRate}. Must be between 0.01 and 1.0 (e.g. 0.50 for 50%).`
        );
      }
    }

    // 4. Backward Pass Calculation
    // Working backwards from the last stage to the first stage
    const calculatedStages: IFunnelStage[] = new Array(sortedStages.length);
    let nextStageRequired = finalShortlistTarget;

    for (let i = sortedStages.length - 1; i >= 0; i--) {
      const stage = sortedStages[i];
      const efficiency = stage.expectedAttendanceRate * stage.expectedPassRate;

      // Calculate required candidates who must enter this stage
      const targetCount = Math.ceil(nextStageRequired / efficiency);

      calculatedStages[i] = {
        stageId: stage.stageId.trim(),
        stageName: stage.stageName?.trim() || stage.stageId.trim(),
        stageType: stage.stageType,
        order: i + 1, // Normalized 1-based order
        expectedAttendanceRate: stage.expectedAttendanceRate,
        expectedPassRate: stage.expectedPassRate,
        targetCount,
        deadlineHours: stage.deadlineHours && stage.deadlineHours > 0 ? stage.deadlineHours : 48,
        autoAdvanceScoreThreshold:
          typeof stage.autoAdvanceScoreThreshold === 'number'
            ? Math.max(0, Math.min(100, stage.autoAdvanceScoreThreshold))
            : 70,
        autoRefillEnabled: stage.autoRefillEnabled !== undefined ? stage.autoRefillEnabled : true,
      };

      // For the preceding stage, its output must satisfy this stage's required intake
      nextStageRequired = targetCount;
    }

    const totalFunnelIntakeTarget = calculatedStages[0].targetCount;

    return {
      finalShortlistTarget,
      totalFunnelIntakeTarget,
      stages: calculatedStages,
    };
  }
}
