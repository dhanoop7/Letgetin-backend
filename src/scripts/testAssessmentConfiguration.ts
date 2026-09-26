import {
  AssessmentRoundType,
  GeneralAssessmentQuestionType,
  IAssessmentRoundConfig,
  IJobAssessmentConfig,
} from '../modules/job/job.model.js';
import {
  SUPPORTED_ASSESSMENT_TYPES,
  DEFAULT_ASSESSMENT_NAMES,
  SUPPORTED_GENERAL_QUESTION_TYPES,
  isSupportedAssessmentType,
  isSupportedGeneralQuestionType,
  normalizeAssessmentConfiguration,
} from '../modules/job/assessmentConfig.utils.js';
import {
  assessmentRoundTypeSchema,
  generalAssessmentQuestionTypeSchema,
  generalAssessmentConfigSchema,
  assessmentRoundSchema,
  jobAssessmentConfigSchema,
  createJobSchema,
} from '../modules/job/job.validator.js';
import { HiringFunnelCalculator } from '../modules/hiringEngine/services/hiringFunnelCalculator.js';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${testName} - ${detail || 'Assertion failed'}`);
    failedCount++;
  }
}

async function runAssessmentConfigurationTests() {
  console.log('================================================================');
  console.log('🧪 TWO-STAGE ASSESSMENT CONFIGURATION ARCHITECTURE TEST SUITE');
  console.log('================================================================\n');

  // ============================================================================
  // 1. ASSESSMENT DISABLED
  // ============================================================================
  console.log('--- 1. Assessment Disabled ---');

  const disabledNorm1 = normalizeAssessmentConfiguration({ enabled: false, rounds: [] });
  assert(
    disabledNorm1.enabled === false && disabledNorm1.rounds.length === 0,
    'Disabled assessment returns canonical inactive state { enabled: false, rounds: [] }'
  );

  const disabledNorm2 = normalizeAssessmentConfiguration({
    enabled: false,
    rounds: [{ id: 'r1', type: 'general', order: 1, name: 'General Assessment', enabled: true }],
  });
  assert(
    disabledNorm2.enabled === false && disabledNorm2.rounds.length === 0,
    'Disabled assessment rounds are cleared / treated as inactive when enabled is false'
  );

  const disabledValidation = jobAssessmentConfigSchema.safeParse({ enabled: false, rounds: [] });
  assert(disabledValidation.success === true, 'Validation passes for disabled assessment');

  // ============================================================================
  // 2. GENERAL ASSESSMENT SELECTED
  // ============================================================================
  console.log('\n--- 2. General Assessment Selected ---');

  const generalNorm = normalizeAssessmentConfiguration({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        enabled: true,
        config: { questionTypes: ['mcq', 'short_answer', 'scenario'] },
      },
    ],
  });
  assert(generalNorm.enabled === true, 'Assessment enabled is true');
  assert(generalNorm.rounds.length === 1, 'Contains exactly 1 round');
  assert(generalNorm.rounds[0].type === 'general', 'Round type is general');
  assert(generalNorm.rounds[0].order === 1, 'Round order is 1');
  assert(typeof generalNorm.rounds[0].id === 'string' && generalNorm.rounds[0].id.length > 0, 'Generated stable round ID');
  assert(
    Array.isArray((generalNorm.rounds[0].config as any)?.questionTypes) &&
    (generalNorm.rounds[0].config as any).questionTypes.length === 3,
    'General assessment contains all 3 question types'
  );

  const generalValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        enabled: true,
        config: { questionTypes: ['mcq', 'short_answer', 'scenario'] },
      },
    ],
  });
  assert(generalValidation.success === true, 'Validation passes for General Assessment');

  // ============================================================================
  // 3. CODING ASSESSMENT SELECTED
  // ============================================================================
  console.log('\n--- 3. Coding Assessment Selected ---');

  const codingNorm = normalizeAssessmentConfiguration({
    enabled: true,
    rounds: [
      {
        type: 'coding',
        order: 1,
        name: 'Coding Assessment',
        enabled: true,
        config: {
          problemCount: 2,
          durationMinutes: 60,
          languages: ['javascript', 'typescript', 'python', 'java'],
          passingScore: 70,
        },
      },
    ],
  });
  assert(codingNorm.rounds.length === 1, 'Contains exactly 1 round');
  assert(codingNorm.rounds[0].type === 'coding', 'Round type is coding');
  assert(codingNorm.rounds[0].order === 1, 'Round order is 1');

  const codingValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'coding',
        order: 1,
        name: 'Coding Assessment',
        enabled: true,
        config: { problemCount: 2, durationMinutes: 60 },
      },
    ],
  });
  assert(codingValidation.success === true, 'Validation passes for Coding Assessment');

  // ============================================================================
  // 4. BOTH SELECTED (GENERAL + CODING)
  // ============================================================================
  console.log('\n--- 4. Both Selected (General + Coding) ---');

  const bothNorm = normalizeAssessmentConfiguration({
    enabled: true,
    rounds: [
      {
        id: 'round_general_1',
        type: 'general',
        order: 1,
        name: 'General Assessment',
        enabled: true,
        config: { questionTypes: ['mcq', 'short_answer'] },
      },
      {
        id: 'round_coding_2',
        type: 'coding',
        order: 2,
        name: 'Coding Assessment',
        enabled: true,
        config: { problemCount: 2 },
      },
    ],
  });
  assert(bothNorm.rounds.length === 2, 'Contains both General and Coding rounds');
  assert(bothNorm.rounds[0].type === 'general' && bothNorm.rounds[0].order === 1, 'General is 1st round');
  assert(bothNorm.rounds[1].type === 'coding' && bothNorm.rounds[1].order === 2, 'Coding is 2nd round');

  const bothValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        config: { questionTypes: ['mcq'] },
      },
      {
        type: 'coding',
        order: 2,
        name: 'Coding Assessment',
      },
    ],
  });
  assert(bothValidation.success === true, 'Validation passes when both General and Coding are selected');

  // ============================================================================
  // 5. DUPLICATE GENERAL ASSESSMENT REJECTED
  // ============================================================================
  console.log('\n--- 5. Duplicate General Assessment Rejected ---');

  const dupGeneralValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      { type: 'general', order: 1, name: 'General 1', config: { questionTypes: ['mcq'] } },
      { type: 'general', order: 2, name: 'General 2', config: { questionTypes: ['short_answer'] } },
    ],
  });
  assert(dupGeneralValidation.success === false, 'Duplicate General Assessment rejected by validator');

  const dedupGeneralNorm = normalizeAssessmentConfiguration({
    enabled: true,
    rounds: [
      { type: 'general', order: 1, name: 'General 1', config: { questionTypes: ['mcq'] } },
      { type: 'general', order: 2, name: 'General 2', config: { questionTypes: ['short_answer'] } },
    ],
  });
  assert(dedupGeneralNorm.rounds.length === 1, 'Normalization deduplicates general + general to 1 General round');

  // ============================================================================
  // 6. DUPLICATE CODING ASSESSMENT REJECTED
  // ============================================================================
  console.log('\n--- 6. Duplicate Coding Assessment Rejected ---');

  const dupCodingValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      { type: 'coding', order: 1, name: 'Coding 1' },
      { type: 'coding', order: 2, name: 'Coding 2' },
    ],
  });
  assert(dupCodingValidation.success === false, 'Duplicate Coding Assessment rejected by validator');

  const dedupCodingNorm = normalizeAssessmentConfiguration({
    enabled: true,
    rounds: [
      { type: 'coding', order: 1, name: 'Coding 1' },
      { type: 'coding', order: 2, name: 'Coding 2' },
    ],
  });
  assert(dedupCodingNorm.rounds.length === 1, 'Normalization deduplicates coding + coding to 1 Coding round');

  // ============================================================================
  // 7. INVALID ASSESSMENT TYPE REJECTED
  // ============================================================================
  console.log('\n--- 7. Invalid Assessment Type Rejected ---');

  const invalidType1 = assessmentRoundTypeSchema.safeParse('mcq');
  assert(invalidType1.success === false, 'Legacy type "mcq" rejected as assessment stage type');

  const invalidType2 = assessmentRoundTypeSchema.safeParse('short_answer');
  assert(invalidType2.success === false, 'Legacy type "short_answer" rejected as assessment stage type');

  const invalidType3 = assessmentRoundTypeSchema.safeParse('scenario');
  assert(invalidType3.success === false, 'Legacy type "scenario" rejected as assessment stage type');

  const invalidType4 = assessmentRoundTypeSchema.safeParse('essay');
  assert(invalidType4.success === false, 'Arbitrary type "essay" rejected');

  assert(isSupportedAssessmentType('general'), 'Type "general" is supported');
  assert(isSupportedAssessmentType('coding'), 'Type "coding" is supported');
  assert(!isSupportedAssessmentType('mcq'), 'Type "mcq" is NOT supported as stage type');

  // ============================================================================
  // 8. GENERAL ASSESSMENT WITH MCQ ONLY
  // ============================================================================
  console.log('\n--- 8. General Assessment With MCQ Only ---');

  const mcqOnlyValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        config: { questionTypes: ['mcq'] },
      },
    ],
  });
  assert(mcqOnlyValidation.success === true, 'General Assessment with MCQ only is valid');

  const mcqOnlyNorm = normalizeAssessmentConfiguration({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        config: { questionTypes: ['mcq'] },
      },
    ],
  });
  assert(
    (mcqOnlyNorm.rounds[0].config as any).questionTypes.length === 1 &&
    (mcqOnlyNorm.rounds[0].config as any).questionTypes[0] === 'mcq',
    'Normalized questionTypes contains only mcq'
  );

  // ============================================================================
  // 9. GENERAL ASSESSMENT WITH SHORT ANSWER ONLY
  // ============================================================================
  console.log('\n--- 9. General Assessment With Short Answer Only ---');

  const shortAnswerValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        config: { questionTypes: ['short_answer'] },
      },
    ],
  });
  assert(shortAnswerValidation.success === true, 'General Assessment with Short Answer only is valid');

  // ============================================================================
  // 10. GENERAL ASSESSMENT WITH SCENARIO ONLY
  // ============================================================================
  console.log('\n--- 10. General Assessment With Scenario Only ---');

  const scenarioValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        config: { questionTypes: ['scenario'] },
      },
    ],
  });
  assert(scenarioValidation.success === true, 'General Assessment with Scenario only is valid');

  // ============================================================================
  // 11. GENERAL ASSESSMENT WITH MCQ + SHORT ANSWER
  // ============================================================================
  console.log('\n--- 11. General Assessment With MCQ + Short Answer ---');

  const mcqShortValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        config: { questionTypes: ['mcq', 'short_answer'] },
      },
    ],
  });
  assert(mcqShortValidation.success === true, 'General Assessment with MCQ + Short Answer is valid');

  // ============================================================================
  // 12. GENERAL ASSESSMENT WITH MCQ + SCENARIO
  // ============================================================================
  console.log('\n--- 12. General Assessment With MCQ + Scenario ---');

  const mcqScenarioValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        config: { questionTypes: ['mcq', 'scenario'] },
      },
    ],
  });
  assert(mcqScenarioValidation.success === true, 'General Assessment with MCQ + Scenario is valid');

  // ============================================================================
  // 13. GENERAL ASSESSMENT WITH ALL THREE (MCQ + SHORT ANSWER + SCENARIO)
  // ============================================================================
  console.log('\n--- 13. General Assessment With All Three ---');

  const allThreeValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        config: { questionTypes: ['mcq', 'short_answer', 'scenario'] },
      },
    ],
  });
  assert(allThreeValidation.success === true, 'General Assessment with all three question types is valid');

  // ============================================================================
  // 14. GENERAL ASSESSMENT WITH NO QUESTION TYPES REJECTED
  // ============================================================================
  console.log('\n--- 14. General Assessment With No Question Types Rejected ---');

  const emptyQuestionsValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        config: { questionTypes: [] },
      },
    ],
  });
  assert(emptyQuestionsValidation.success === false, 'General Assessment with empty questionTypes is rejected');

  const noConfigValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
      },
    ],
  });
  assert(noConfigValidation.success === false, 'General Assessment with missing questionTypes config is rejected by validator');

  // ============================================================================
  // 15. GENERAL ASSESSMENT CONTAINING CODING REJECTED
  // ============================================================================
  console.log('\n--- 15. General Assessment Containing Coding Rejected ---');

  const codingInGeneralValidation = jobAssessmentConfigSchema.safeParse({
    enabled: true,
    rounds: [
      {
        type: 'general',
        order: 1,
        name: 'General Assessment',
        config: { questionTypes: ['mcq', 'coding'] },
      },
    ],
  });
  assert(codingInGeneralValidation.success === false, 'General Assessment containing "coding" as a question type is rejected');

  // ============================================================================
  // 16. ORDER NORMALIZATION
  // ============================================================================
  console.log('\n--- 16. Order Normalization ---');

  const gappedOrdersNorm = normalizeAssessmentConfiguration({
    enabled: true,
    rounds: [
      { type: 'general', order: 1, config: { questionTypes: ['mcq'] } },
      { type: 'coding', order: 8 },
    ],
  });
  assert(
    gappedOrdersNorm.rounds[0].order === 1 && gappedOrdersNorm.rounds[1].order === 2,
    'Non-consecutive orders (1, 8) normalized to sequential 1, 2'
  );

  // ============================================================================
  // 17. REORDERING PERSISTS
  // ============================================================================
  console.log('\n--- 17. Reordering Persists Correctly ---');

  // Coding first, then General
  const reorderedNorm = normalizeAssessmentConfiguration({
    enabled: true,
    rounds: [
      { id: 'r_coding', type: 'coding', order: 1, name: 'Coding Assessment' },
      { id: 'r_general', type: 'general', order: 2, name: 'General Assessment', config: { questionTypes: ['mcq'] } },
    ],
  });
  assert(reorderedNorm.rounds[0].type === 'coding' && reorderedNorm.rounds[0].order === 1, 'Coding persisted as 1st round');
  assert(reorderedNorm.rounds[1].type === 'general' && reorderedNorm.rounds[1].order === 2, 'General persisted as 2nd round');

  // ============================================================================
  // 18. REMOVAL WORKS
  // ============================================================================
  console.log('\n--- 18. Removal Works ---');

  const availableRoundTypes: AssessmentRoundType[] = ['general', 'coding'];
  const selectedBeforeRemoval: AssessmentRoundType[] = ['general', 'coding'];
  // Recruiter removes 'general'
  const afterRemoval = selectedBeforeRemoval.filter((t): t is AssessmentRoundType => t !== 'general');
  assert(!afterRemoval.includes('general'), 'General is removed');
  const availableNow = availableRoundTypes.filter((t) => !afterRemoval.includes(t));
  assert(availableNow.includes('general'), 'General is available to add again');
  assert(!availableNow.includes('coding'), 'Coding remains selected and not available');

  // ============================================================================
  // 19. EXISTING JOBS WITHOUT ASSESSMENT REMAIN VALID
  // ============================================================================
  console.log('\n--- 19. Existing Jobs Without Assessment Remain Valid ---');

  const legacyJob = {
    body: {
      title: 'Senior Software Engineer',
      description: 'Job description without assessment',
      skills: ['React', 'Node.js'],
    },
  };
  const legacyValidation = createJobSchema.safeParse(legacyJob);
  assert(legacyValidation.success === true, 'Existing job creation without assessment passes validation');

  const emptyNorm = normalizeAssessmentConfiguration(undefined);
  assert(emptyNorm.enabled === false && emptyNorm.rounds.length === 0, 'Undefined assessment defaults safely to disabled');

  // ============================================================================
  // 20. LEGACY ASSESSMENT CONFIGURATION DOES NOT CORRUPT
  // ============================================================================
  console.log('\n--- 20. Legacy Assessment Configuration Compatibility ---');

  // If a legacy record exists with type: 'mcq' or 'coding', normalizer safely maps 'mcq' into general
  const legacyNormResult = normalizeAssessmentConfiguration({
    enabled: true,
    rounds: [
      { id: 'leg_1', type: 'mcq', order: 1, name: 'Legacy MCQ' },
      { id: 'leg_2', type: 'coding', order: 2, name: 'Coding' },
    ],
  });
  assert(legacyNormResult.rounds.length === 2, 'Legacy record converted safely to 2 rounds');
  assert(legacyNormResult.rounds[0].type === 'general', 'Legacy mcq converted to General Assessment');
  assert(
    (legacyNormResult.rounds[0].config as any).questionTypes.includes('mcq'),
    'Converted general round contains mcq question type'
  );
  assert(legacyNormResult.rounds[1].type === 'coding', 'Coding round preserved');

  // ============================================================================
  // 21 & 22 & 23. HIRING ENGINE STAGES INTEGRATION
  // ============================================================================
  console.log('\n--- 21, 22, 23. Hiring Engine Integration (General vs Coding) ---');

  // Simulate pipeline stages generated from assessment configuration:
  // Resume Screening -> General Assessment -> Coding Assessment -> AI Interview
  const funnelCalculation = HiringFunnelCalculator.calculateFunnel(10, [
    {
      stageId: 'stage_resume_screen',
      stageName: 'Resume Screening',
      stageType: 'resume_match',
      order: 1,
      expectedAttendanceRate: 1.0,
      expectedPassRate: 0.6,
      deadlineHours: 24,
    },
    {
      stageId: 'stage_assessment_general',
      stageName: 'General Assessment',
      stageType: 'assessment',
      assessmentType: 'general',
      order: 2,
      expectedAttendanceRate: 1.0,
      expectedPassRate: 0.6,
      deadlineHours: 48,
    },
    {
      stageId: 'stage_assessment_coding',
      stageName: 'Coding Assessment',
      stageType: 'assessment',
      assessmentType: 'coding',
      order: 3,
      expectedAttendanceRate: 1.0,
      expectedPassRate: 0.6,
      deadlineHours: 48,
    },
    {
      stageId: 'stage_ai_interview',
      stageName: 'AI Comprehensive Interview',
      stageType: 'ai_interview',
      order: 4,
      expectedAttendanceRate: 1.0,
      expectedPassRate: 0.5,
      deadlineHours: 48,
    },
  ]);

  assert(funnelCalculation.stages.length === 4, 'Hiring funnel calculator produced 4 stages');

  // Requirement 21: Hiring Engine receives assessmentType = general for General Assessment
  assert(
    funnelCalculation.stages[1].stageType === 'assessment' &&
    funnelCalculation.stages[1].assessmentType === 'general',
    'Requirement 21: Stage 2 has stageType "assessment" and assessmentType "general"'
  );

  // Requirement 22: Hiring Engine receives assessmentType = coding for Coding Assessment
  assert(
    funnelCalculation.stages[2].stageType === 'assessment' &&
    funnelCalculation.stages[2].assessmentType === 'coding',
    'Requirement 22: Stage 3 has stageType "assessment" and assessmentType "coding"'
  );

  // Requirement 23: Hiring Engine NEVER receives assessmentType = mcq, short_answer, or scenario
  const allAssessmentSubtypes = funnelCalculation.stages
    .filter((s) => s.stageType === 'assessment')
    .map((s) => s.assessmentType);

  assert(
    !allAssessmentSubtypes.includes('mcq' as any),
    'Requirement 23: Hiring Engine never receives assessmentType = mcq'
  );
  assert(
    !allAssessmentSubtypes.includes('short_answer' as any),
    'Requirement 23: Hiring Engine never receives assessmentType = short_answer'
  );
  assert(
    !allAssessmentSubtypes.includes('scenario' as any),
    'Requirement 23: Hiring Engine never receives assessmentType = scenario'
  );

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n================================================================');
  console.log(`RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAssessmentConfigurationTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
