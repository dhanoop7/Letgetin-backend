import { AppError } from '../../../utils/appError.js';
import { IFunnelStage, FunnelHealth } from '../hiringFunnelConfig.model.js';

export interface StageCalculationInput {
  stageId: string;
  stageName: string;
  stageType: 'resume_match' | 'assessment' | 'ai_interview' | 'manual_review' | 'human_interview';
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

export interface AdaptiveFunnelCalculationResult {
  finalShortlistTarget: number;
  actualQualifiedCount: number;
  idealFunnelIntakeTarget: number;
  operationalFunnelIntakeTarget: number;
  stages: IFunnelStage[];
  idealStages: IFunnelStage[];
  canProceed: boolean;
  health: FunnelHealth;
  estimatedFinalYield: number;
  deficit: number;
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

  /**
   * Calculates an operational adaptive funnel using the actual qualified candidate pool
   * while strictly preserving the recruiter's configured finalShortlistTarget and stage criteria.
   */
  public static calculateAdaptiveFunnel(
    actualQualifiedCount: number,
    finalShortlistTarget: number,
    stagesInput: StageCalculationInput[],
    minimumIntake?: number
  ): AdaptiveFunnelCalculationResult {
    // 1. Calculate the ideal/planned funnel first
    const ideal = this.calculateFunnel(finalShortlistTarget, stagesInput);
    const idealStages = ideal.stages;
    const idealFunnelIntakeTarget = ideal.totalFunnelIntakeTarget;

    const minRequired =
      typeof minimumIntake === 'number' && minimumIntake > 0
        ? minimumIntake
        : Math.ceil(idealFunnelIntakeTarget * 0.6);

    const safeActualCount = Math.max(0, Math.floor(actualQualifiedCount));

    // 2. Health & proceed determination
    let health: FunnelHealth;
    let canProceed = false;

    if (safeActualCount < minRequired || safeActualCount === 0) {
      health = 'starved';
      canProceed = false;
    } else if (safeActualCount < idealFunnelIntakeTarget) {
      health = 'constrained';
      canProceed = true;
    } else {
      health = 'healthy';
      canProceed = true;
    }

    // 3. Operational stage target calculation based on actual pool and pass/attendance rates
    const operationalStages: IFunnelStage[] = new Array(idealStages.length);

    if (safeActualCount === 0) {
      for (let i = 0; i < idealStages.length; i++) {
        operationalStages[i] = { ...idealStages[i], targetCount: 0 };
      }
      return {
        finalShortlistTarget,
        actualQualifiedCount: safeActualCount,
        idealFunnelIntakeTarget,
        operationalFunnelIntakeTarget: 0,
        stages: operationalStages,
        idealStages,
        canProceed: false,
        health: 'starved',
        estimatedFinalYield: 0,
        deficit: finalShortlistTarget,
      };
    }

    // Stage 0 intake is bounded by actual available qualified candidates and ideal intake
    const initialIntake = Math.min(safeActualCount, idealStages[0].targetCount);
    operationalStages[0] = {
      ...idealStages[0],
      targetCount: Math.max(1, initialIntake),
    };

    // Forward pass calculation for subsequent stages based on configured efficiency
    for (let i = 1; i < idealStages.length; i++) {
      const prevStage = operationalStages[i - 1];
      const prevEfficiency = prevStage.expectedAttendanceRate * prevStage.expectedPassRate;
      const expectedFromPrev = Math.round(prevStage.targetCount * prevEfficiency);

      // Operational target cannot exceed ideal target nor drop below 1 if previous stage had candidates
      const stageTarget = Math.min(idealStages[i].targetCount, Math.max(1, expectedFromPrev));

      operationalStages[i] = {
        ...idealStages[i],
        targetCount: stageTarget,
      };
    }

    // Estimated yield at final stage
    const lastStage = operationalStages[operationalStages.length - 1];
    const lastEfficiency = lastStage.expectedAttendanceRate * lastStage.expectedPassRate;
    const estimatedFinalYield = Math.min(
      finalShortlistTarget,
      Math.max(1, Math.round(lastStage.targetCount * lastEfficiency))
    );

    const deficit = Math.max(0, finalShortlistTarget - safeActualCount);

    return {
      finalShortlistTarget,
      actualQualifiedCount: safeActualCount,
      idealFunnelIntakeTarget,
      operationalFunnelIntakeTarget: operationalStages[0].targetCount,
      stages: operationalStages,
      idealStages,
      canProceed,
      health,
      estimatedFinalYield,
      deficit,
    };
  }
}
