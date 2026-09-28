import mongoose, { Types } from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { JobModel } from '../modules/job/job.model.js';
import {
  AssessmentQuestionModel,
  IAssessmentQuestion,
} from '../modules/assessment/assessmentQuestion.model.js';
import {
  toCandidateQuestion,
  toCandidateQuestions,
  toRecruiterQuestion,
} from '../modules/assessment/assessmentQuestion.serializer.js';
import {
  createQuestionSchema,
  updateQuestionSchema,
  reorderQuestionsSchema,
  createMcqQuestionSchema,
} from '../modules/assessment/assessmentQuestion.validator.js';
import {
  generalAssessmentConfigSchema,
  assessmentRoundSchema,
  jobAssessmentConfigSchema,
} from '../modules/job/job.validator.js';
import {
  normalizeAssessmentConfiguration,
} from '../modules/job/assessmentConfig.utils.js';
import { assessmentService } from '../modules/assessment/assessment.service.js';
import { AppError } from '../utils/appError.js';

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

async function runGeneralAssessmentFoundationTests() {
  console.log('================================================================');
  console.log('🧪 GENERAL ASSESSMENT FOUNDATION & QUESTION DATA MODEL TEST SUITE');
  console.log('================================================================\n');

  const createdJobIds: Types.ObjectId[] = [];
  const createdQuestionIds: Types.ObjectId[] = [];

  // ============================================================================
  // SECTION 1: GENERAL ASSESSMENT CONFIGURATION (TESTS 1 - 14)
  // ============================================================================
  console.log('--- SECTION 1: General Assessment Configuration ---');

  // 1. General Assessment with MCQ
  const mcqOnlyConfig = {
    questionTypes: ['mcq'],
    mcq: { questionCount: 15, difficulty: 'mixed' },
    durationMinutes: 45,
    passingScore: 70,
  };
  const parsed1 = generalAssessmentConfigSchema.safeParse(mcqOnlyConfig);
  assert(parsed1.success, '1. General Assessment with MCQ config is valid');

  const norm1 = normalizeAssessmentConfiguration({
    enabled: true,
    rounds: [{ id: 'r1', type: 'general', order: 1, name: 'General Assessment', config: mcqOnlyConfig }],
  });
  assert(
    ((norm1.rounds[0].config as any)?.questionTypes as any[])?.length === 1 &&
      (norm1.rounds[0].config as any).questionTypes[0] === 'mcq' &&
      (norm1.rounds[0].config as any).mcq?.questionCount === 15,
    '1. General Assessment with MCQ normalizes questionTypes and retains mcq config'
  );

  // 2. General Assessment with Short Answer
  const saOnlyConfig = {
    questionTypes: ['short_answer'],
    shortAnswer: { questionCount: 5 },
    durationMinutes: 30,
    passingScore: 65,
  };
  const parsed2 = generalAssessmentConfigSchema.safeParse(saOnlyConfig);
  assert(parsed2.success, '2. General Assessment with Short Answer config is valid');

  // 3. General Assessment with Scenario
  const scenarioOnlyConfig = {
    questionTypes: ['scenario'],
    scenario: { questionCount: 3 },
    durationMinutes: 60,
    passingScore: 80,
  };
  const parsed3 = generalAssessmentConfigSchema.safeParse(scenarioOnlyConfig);
  assert(parsed3.success, '3. General Assessment with Scenario config is valid');

  // 4. General Assessment with all three
  const allThreeConfig = {
    questionTypes: ['mcq', 'short_answer', 'scenario'],
    mcq: { questionCount: 15 },
    shortAnswer: { questionCount: 5 },
    scenario: { questionCount: 3 },
    durationMinutes: 90,
    passingScore: 75,
  };
  const parsed4 = generalAssessmentConfigSchema.safeParse(allThreeConfig);
  assert(parsed4.success, '4. General Assessment with all three question types is valid');

  // 5. Invalid question type rejected
  const invalidTypeConfig = {
    questionTypes: ['coding'], // coding is NOT allowed inside General Assessment
    durationMinutes: 60,
  };
  const parsed5 = generalAssessmentConfigSchema.safeParse(invalidTypeConfig);
  assert(!parsed5.success, '5. General Assessment containing "coding" in questionTypes is rejected');

  const randomTypeConfig = {
    questionTypes: ['unknown_type'],
  };
  const parsed5b = generalAssessmentConfigSchema.safeParse(randomTypeConfig);
  assert(!parsed5b.success, '5. General Assessment with unrecognized question type is rejected');

  // 6. Duplicate question type rejected
  const dupTypeConfig = {
    questionTypes: ['mcq', 'mcq'],
  };
  const parsed6 = generalAssessmentConfigSchema.safeParse(dupTypeConfig);
  assert(!parsed6.success, '6. Duplicate question type in General Assessment is rejected');

  // 7. Missing question types rejected
  const emptyTypeConfig = {
    questionTypes: [],
  };
  const parsed7 = generalAssessmentConfigSchema.safeParse(emptyTypeConfig);
  assert(!parsed7.success, '7. Empty questionTypes array is rejected (minimum 1 required)');

  // 8. Valid question counts
  const validCountsRound = assessmentRoundSchema.safeParse({
    type: 'general',
    order: 1,
    name: 'General Assessment',
    config: {
      questionTypes: ['mcq', 'short_answer', 'scenario'],
      mcq: { questionCount: 20 },
      shortAnswer: { questionCount: 8 },
      scenario: { questionCount: 4 },
    },
  });
  assert(validCountsRound.success, '8. Valid question counts accepted in assessment round schema');

  // 9. Invalid question counts
  const invalidCountRound = assessmentRoundSchema.safeParse({
    type: 'general',
    order: 1,
    name: 'General Assessment',
    config: {
      questionTypes: ['mcq'],
      mcq: { questionCount: 0 }, // must be >= 1
    },
  });
  assert(!invalidCountRound.success, '9. Question count < 1 rejected in assessment round schema');

  // 10. Valid duration
  const validDurationConfig = {
    questionTypes: ['mcq'],
    durationMinutes: 60,
  };
  const parsed10 = generalAssessmentConfigSchema.safeParse(validDurationConfig);
  assert(parsed10.success, '10. Valid durationMinutes (60) is accepted');

  // 11. Invalid duration
  const invalidDurationConfig = {
    questionTypes: ['mcq'],
    durationMinutes: -10,
  };
  const parsed11 = generalAssessmentConfigSchema.safeParse(invalidDurationConfig);
  assert(!parsed11.success, '11. Negative durationMinutes is rejected');

  // 12. Passing score 0
  const pass0Config = {
    questionTypes: ['mcq'],
    passingScore: 0,
  };
  const parsed12 = generalAssessmentConfigSchema.safeParse(pass0Config);
  assert(parsed12.success, '12. Passing score 0% is accepted');

  // 13. Passing score 100
  const pass100Config = {
    questionTypes: ['mcq'],
    passingScore: 100,
  };
  const parsed13 = generalAssessmentConfigSchema.safeParse(pass100Config);
  assert(parsed13.success, '13. Passing score 100% is accepted');

  // 14. Passing score > 100 rejected
  const pass101Config = {
    questionTypes: ['mcq'],
    passingScore: 105,
  };
  const parsed14 = generalAssessmentConfigSchema.safeParse(pass101Config);
  assert(!parsed14.success, '14. Passing score > 100% is rejected');


  // ============================================================================
  // SECTION 2: QUESTION MODEL & VALIDATION (TESTS 15 - 25)
  // ============================================================================
  console.log('\n--- SECTION 2: Question Model & Validation ---');

  // 15. Valid MCQ
  const validMcq = {
    type: 'mcq' as const,
    question: 'Which HTTP status code represents resource creation?',
    options: [
      { id: 'opt_1', text: '200 OK' },
      { id: 'opt_2', text: '201 Created' },
      { id: 'opt_3', text: '204 No Content' },
    ],
    correctOptionId: 'opt_2',
    points: 2,
    instructions: 'Select the best answer.',
  };
  const parsed15 = createQuestionSchema.safeParse(validMcq);
  assert(parsed15.success, '15. Valid MCQ question payload is accepted');

  // 16. MCQ with fewer than 2 options rejected
  const mcqOneOption = {
    type: 'mcq' as const,
    question: 'Single option question?',
    options: [{ id: 'opt_1', text: 'Only one option' }],
    correctOptionId: 'opt_1',
    points: 1,
  };
  const parsed16 = createQuestionSchema.safeParse(mcqOneOption);
  assert(!parsed16.success, '16. MCQ with fewer than 2 options is rejected');

  // 17. MCQ with duplicate option IDs rejected
  const mcqDupOptionIds = {
    type: 'mcq' as const,
    question: 'Question with duplicate options?',
    options: [
      { id: 'opt_1', text: 'Option A' },
      { id: 'opt_1', text: 'Option B' },
    ],
    correctOptionId: 'opt_1',
    points: 1,
  };
  const parsed17 = createQuestionSchema.safeParse(mcqDupOptionIds);
  assert(!parsed17.success, '17. MCQ with duplicate option IDs is rejected');

  // 18. MCQ with missing correct option rejected
  const mcqMissingCorrect = {
    type: 'mcq' as const,
    question: 'Question without correct option ID?',
    options: [
      { id: 'opt_1', text: 'Option A' },
      { id: 'opt_2', text: 'Option B' },
    ],
    correctOptionId: '',
    points: 1,
  };
  const parsed18 = createQuestionSchema.safeParse(mcqMissingCorrect);
  assert(!parsed18.success, '18. MCQ with empty/missing correctOptionId is rejected');

  // 19. MCQ with invalid correctOptionId (not in options) rejected
  const mcqInvalidCorrect = {
    type: 'mcq' as const,
    question: 'Question with mismatched correct option ID?',
    options: [
      { id: 'opt_1', text: 'Option A' },
      { id: 'opt_2', text: 'Option B' },
    ],
    correctOptionId: 'opt_99', // not in options!
    points: 1,
  };
  const parsed19 = createQuestionSchema.safeParse(mcqInvalidCorrect);
  assert(!parsed19.success, '19. MCQ with correctOptionId not found in options is rejected');

  // 20. Valid Short Answer
  const validShortAnswer = {
    type: 'short_answer' as const,
    question: 'Explain the difference between optimistic and pessimistic locking.',
    points: 5,
    expectedAnswer: 'Optimistic locking assumes few conflicts and uses version checks...',
    evaluationCriteria: ['Mentions version or timestamp', 'Explains concurrency tradeoffs'],
  };
  const parsed20 = createQuestionSchema.safeParse(validShortAnswer);
  assert(parsed20.success, '20. Valid Short Answer question payload is accepted');

  // 21. Valid Scenario
  const validScenario = {
    type: 'scenario' as const,
    question: 'The primary PostgreSQL database CPU spikes to 100% during peak traffic. Walk through your troubleshooting steps.',
    context: 'Architecture: Next.js frontend, Node.js API with Prisma, PostgreSQL on AWS RDS.',
    points: 10,
    evaluationCriteria: ['Identifies pg_stat_activity', 'Mentions connection pool exhaustion', 'Suggests read replicas'],
  };
  const parsed21 = createQuestionSchema.safeParse(validScenario);
  assert(parsed21.success, '21. Valid Scenario question payload is accepted');

  // 22. Empty question text rejected
  const emptyQuestion = {
    type: 'short_answer' as const,
    question: '   ',
    points: 5,
  };
  const parsed22 = createQuestionSchema.safeParse(emptyQuestion);
  assert(!parsed22.success, '22. Empty question text is rejected');

  // 23. Invalid points rejected
  const invalidPoints = {
    type: 'scenario' as const,
    question: 'Valid question text here',
    points: 0, // points must be >= 1
  };
  const parsed23 = createQuestionSchema.safeParse(invalidPoints);
  assert(!parsed23.success, '23. Points <= 0 is rejected');


  // ============================================================================
  // SECTION 3: DATABASE OPERATIONS, ORDERING & REORDERING (TESTS 24 - 25)
  // ============================================================================
  console.log('\n--- SECTION 3: Database Operations, Ordering & Reordering ---');

  try {
    await connectDatabase();

    const recruiterId = new Types.ObjectId();
    const testJob = new JobModel({
      title: 'Full Stack Engineer - Assessment Test',
      company: { name: 'Acme Corp' },
      description: 'Test job for assessment foundations',
      postedBy: recruiterId,
      assessment: {
        enabled: true,
        rounds: [
          {
            id: 'round_general_test1',
            type: 'general',
            order: 1,
            name: 'General Assessment',
            enabled: true,
            config: {
              questionTypes: ['mcq', 'short_answer', 'scenario'],
              mcq: { questionCount: 15 },
              shortAnswer: { questionCount: 5 },
              scenario: { questionCount: 3 },
              durationMinutes: 60,
              passingScore: 70,
            },
          },
        ],
      },
    });
    await testJob.save();
    createdJobIds.push(testJob._id as Types.ObjectId);

    const jobIdStr = String(testJob._id);
    const roundId = 'round_general_test1';

    // Create 3 questions
    const q1 = await assessmentService.createQuestion(jobIdStr, roundId, String(recruiterId), {
      type: 'mcq',
      question: 'Question 1: What is TypeScript?',
      options: [
        { id: '1', text: 'Typed superset of JavaScript' },
        { id: '2', text: 'A database' },
      ],
      correctOptionId: '1',
      points: 1,
    });
    createdQuestionIds.push(new Types.ObjectId(q1.id));

    const q2 = await assessmentService.createQuestion(jobIdStr, roundId, String(recruiterId), {
      type: 'short_answer',
      question: 'Question 2: What is Event Loop in Node.js?',
      points: 5,
    });
    createdQuestionIds.push(new Types.ObjectId(q2.id));

    const q3 = await assessmentService.createQuestion(jobIdStr, roundId, String(recruiterId), {
      type: 'scenario',
      question: 'Question 3: Database connection pool leak incident.',
      points: 10,
    });
    createdQuestionIds.push(new Types.ObjectId(q3.id));

    // 24. Question order normalization after deletion
    assert(q1.order === 1 && q2.order === 2 && q3.order === 3, '24. Initial questions receive sequential orders 1, 2, 3');

    // Delete question 2 (middle)
    await assessmentService.deleteQuestion(jobIdStr, roundId, q2.id, String(recruiterId));

    const questionsAfterDelete = await assessmentService.getRecruiterQuestions(jobIdStr, roundId, String(recruiterId));
    assert(
      questionsAfterDelete.length === 2 &&
        questionsAfterDelete[0].id === q1.id &&
        questionsAfterDelete[0].order === 1 &&
        questionsAfterDelete[1].id === q3.id &&
        questionsAfterDelete[1].order === 2,
      '24. Deleting question 2 normalizes remaining questions without gaps (1, 2)'
    );

    // 25. Question reorder persistence
    // Add another question
    const q4 = await assessmentService.createQuestion(jobIdStr, roundId, String(recruiterId), {
      type: 'mcq',
      question: 'Question 4: What is React Virtual DOM?',
      options: [
        { id: 'a', text: 'In-memory representation of real DOM' },
        { id: 'b', text: 'Browser API' },
      ],
      correctOptionId: 'a',
      points: 1,
    });
    createdQuestionIds.push(new Types.ObjectId(q4.id));

    // Reorder: q4 first, then q3, then q1
    const reorderedIds = [q4.id, q3.id, q1.id];
    const reorderedList = await assessmentService.reorderQuestions(jobIdStr, roundId, String(recruiterId), reorderedIds);

    assert(
      reorderedList[0].id === q4.id &&
        reorderedList[0].order === 1 &&
        reorderedList[1].id === q3.id &&
        reorderedList[1].order === 2 &&
        reorderedList[2].id === q1.id &&
        reorderedList[2].order === 3,
      '25. Reordering questions persists sequential orders 1, 2, 3 in requested arrangement'
    );


    // ============================================================================
    // SECTION 4: SECURITY & CANDIDATE DATA PROTECTION (TESTS 26 - 29)
    // ============================================================================
    console.log('\n--- SECTION 4: Security & Candidate Data Protection ---');

    const mcqDoc = {
      _id: new Types.ObjectId(),
      type: 'mcq' as const,
      order: 1,
      question: 'Security test MCQ?',
      options: [
        { id: 'a', text: 'Option A' },
        { id: 'b', text: 'Option B' },
      ],
      correctOptionId: 'a',
      points: 1,
      metadata: { aiPrompt: 'Sensitive Gemini Prompt', internalAudit: 'private' },
    };

    const shortAnswerDoc = {
      _id: new Types.ObjectId(),
      type: 'short_answer' as const,
      order: 2,
      question: 'Security test Short Answer?',
      points: 5,
      expectedAnswer: 'SECRET EXPECTED ANSWER',
      evaluationCriteria: ['Criterion 1', 'Criterion 2'],
      metadata: { gradingKey: 'confidential' },
    };

    const scenarioDoc = {
      _id: new Types.ObjectId(),
      type: 'scenario' as const,
      order: 3,
      question: 'Security test Scenario?',
      context: 'Public architectural background context',
      points: 10,
      evaluationCriteria: ['SECRET EVAL CRITERIA'],
      metadata: { rubric: 'internal only' },
    };

    // 26. Candidate serializer removes MCQ correct answer
    const safeMcq = toCandidateQuestion(mcqDoc as any);
    assert(
      (safeMcq as any).correctOptionId === undefined &&
        safeMcq.options?.length === 2 &&
        safeMcq.options[0].id === 'a',
      '26. Candidate serializer completely strips MCQ correctOptionId'
    );

    // 27. Candidate serializer removes Short Answer expected answer
    const safeSa = toCandidateQuestion(shortAnswerDoc as any);
    assert(
      (safeSa as any).expectedAnswer === undefined,
      '27. Candidate serializer completely strips Short Answer expectedAnswer'
    );

    // 28. Candidate serializer removes evaluation criteria
    const safeScenario = toCandidateQuestion(scenarioDoc as any);
    assert(
      (safeSa as any).evaluationCriteria === undefined &&
        (safeScenario as any).evaluationCriteria === undefined &&
        safeScenario.context === 'Public architectural background context',
      '28. Candidate serializer completely strips evaluationCriteria from both Short Answer and Scenario'
    );

    // 29. Candidate serializer does not expose internal AI metadata
    assert(
      (safeMcq as any).metadata === undefined &&
        (safeSa as any).metadata === undefined &&
        (safeScenario as any).metadata === undefined,
      '29. Candidate serializer completely strips internal AI metadata from all question types'
    );


    // ============================================================================
    // SECTION 5: AUTHORIZATION & ACCESS CONTROL (TESTS 30 - 31)
    // ============================================================================
    console.log('\n--- SECTION 5: Authorization & Access Control ---');

    // 30. Recruiter can access own job assessment
    const ownQuestions = await assessmentService.getRecruiterQuestions(jobIdStr, roundId, String(recruiterId));
    assert(ownQuestions.length > 0, '30. Authenticated recruiter can access own job assessment questions');

    // 31. Recruiter cannot modify another recruiter's assessment
    const unauthorizedRecruiterId = new Types.ObjectId();
    let unauthorizedBlocked = false;
    try {
      await assessmentService.createQuestion(jobIdStr, roundId, String(unauthorizedRecruiterId), {
        type: 'short_answer',
        question: 'Unauthorized question attempt',
        points: 5,
      });
    } catch (err: any) {
      if (err.statusCode === 403 || err.message.includes('permission')) {
        unauthorizedBlocked = true;
      }
    }
    assert(unauthorizedBlocked, '31. Unauthorized recruiter is blocked with 403 when trying to modify assessment');


    // ============================================================================
    // SECTION 6: BACKWARD COMPATIBILITY (TESTS 32 - 34)
    // ============================================================================
    console.log('\n--- SECTION 6: Backward Compatibility ---');

    // 32. Existing jobs without assessment continue to load
    const jobWithoutAssessment = new JobModel({
      title: 'Backend Engineer - Legacy Job',
      company: { name: 'Legacy Corp' },
      description: 'Job created before assessment system was introduced',
      postedBy: recruiterId,
    });
    await jobWithoutAssessment.save();
    createdJobIds.push(jobWithoutAssessment._id as Types.ObjectId);

    const loadedLegacy = await JobModel.findById(jobWithoutAssessment._id).lean();
    assert(
      loadedLegacy !== null &&
        loadedLegacy.assessment?.enabled === false &&
        Array.isArray(loadedLegacy.assessment?.rounds) &&
        loadedLegacy.assessment.rounds.length === 0,
      '32. Existing jobs without assessment continue to load safely with default disabled configuration'
    );

    // 33. Existing General Assessment configurations remain valid
    const legacyGeneralConfigNorm = normalizeAssessmentConfiguration({
      enabled: true,
      rounds: [
        {
          id: 'round_gen_legacy',
          type: 'general',
          order: 1,
          name: 'General Assessment',
          enabled: true,
          config: {
            questionTypes: ['mcq', 'short_answer'],
          },
        },
      ],
    });
    assert(
      legacyGeneralConfigNorm.enabled === true &&
        legacyGeneralConfigNorm.rounds.length === 1 &&
        legacyGeneralConfigNorm.rounds[0].type === 'general' &&
        (legacyGeneralConfigNorm.rounds[0].config as any).questionTypes.length === 2 &&
        (legacyGeneralConfigNorm.rounds[0].config as any).durationMinutes === 60,
      '33. Existing General Assessment configurations remain valid and receive clean defaults'
    );

    // 34. Coding Assessment remains unaffected
    const codingRoundNorm = normalizeAssessmentConfiguration({
      enabled: true,
      rounds: [
        {
          id: 'round_coding_1',
          type: 'coding',
          order: 1,
          name: 'Coding Assessment',
          enabled: true,
          config: {
            problemCount: 2,
            durationMinutes: 60,
            languages: ['javascript', 'python'],
          },
        },
      ],
    });
    assert(
      codingRoundNorm.enabled === true &&
        codingRoundNorm.rounds.length === 1 &&
        codingRoundNorm.rounds[0].type === 'coding' &&
        (codingRoundNorm.rounds[0].config as any).problemCount === 2,
      '34. Coding Assessment rounds remain completely unaffected, separate, and valid'
    );

  } catch (err: any) {
    console.error('Database test error:', err.message);
    assert(false, 'Database test execution', err.message);
  } finally {
    if (createdQuestionIds.length > 0) {
      console.log('\n🧹 Cleaning up test questions...');
      await AssessmentQuestionModel.deleteMany({ _id: { $in: createdQuestionIds } });
    }
    if (createdJobIds.length > 0) {
      console.log('🧹 Cleaning up test jobs...');
      await JobModel.deleteMany({ _id: { $in: createdJobIds } });
    }
    await mongoose.disconnect();
    console.log('Database disconnected. Tests finished.\n');
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('================================================================');
  console.log(`General Assessment Foundation Test Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runGeneralAssessmentFoundationTests().catch((err) => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
