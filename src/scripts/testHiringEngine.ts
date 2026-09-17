import { HiringFunnelCalculator } from '../modules/hiringEngine/services/hiringFunnelCalculator.js';
import { HiringPoolManager } from '../modules/hiringEngine/services/hiringPoolManager.js';
import { HiringEngineService } from '../modules/hiringEngine/services/hiringEngine.service.js';
import { HiringFunnelConfigModel } from '../modules/hiringEngine/hiringFunnelConfig.model.js';
import { CandidateStageHistoryModel } from '../modules/hiringEngine/candidateStageHistory.model.js';
import { JobModel } from '../modules/job/job.model.js';
import { ApplicationModel } from '../modules/application/application.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { connectDatabase } from '../config/database.js';
import { Interview } from '../modules/interview/interview.model.js';
import mongoose, { Types } from 'mongoose';

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

async function runHiringEngineTestSuite() {
  console.log('================================================================');
  console.log('🚀 LETGETIN HIRING ENGINE PHASE 1 COMPREHENSIVE TEST SUITE');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: Funnel Calculation (Reverse Pass Math)
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: Funnel Calculation (Reverse Pass Mathematics) ---');
  try {
    const stages = [
      {
        stageId: 'resume_screening',
        stageName: 'Resume Screening',
        stageType: 'resume_match' as const,
        order: 1,
        expectedAttendanceRate: 1.0,
        expectedPassRate: 0.4,
        deadlineHours: 48,
      },
      {
        stageId: 'technical_assessment',
        stageName: 'Technical Assessment',
        stageType: 'assessment' as const,
        order: 2,
        expectedAttendanceRate: 0.75,
        expectedPassRate: 0.6,
        deadlineHours: 48,
      },
      {
        stageId: 'ai_video_interview',
        stageName: 'AI Video Interview',
        stageType: 'ai_interview' as const,
        order: 3,
        expectedAttendanceRate: 0.8,
        expectedPassRate: 0.5,
        deadlineHours: 48,
      },
    ];

    const result = HiringFunnelCalculator.calculateFunnel(5, stages);

    console.log(`  Final Shortlist Target: ${result.finalShortlistTarget}`);
    result.stages.forEach((s) => {
      console.log(`  -> Stage ${s.order} (${s.stageName}): Required Target = ${s.targetCount}`);
    });
    console.log(`  Total Top-of-Funnel Intake: ${result.totalFunnelIntakeTarget}`);

    // Verification against formula:
    // Stage 3 (AI Interview): ceil(5 / (0.80 * 0.50)) = ceil(5 / 0.40) = 13
    assert(result.stages[2].targetCount === 13, 'Stage 3 targetCount is exactly 13');

    // Stage 2 (Assessment): ceil(13 / (0.75 * 0.60)) = ceil(13 / 0.45) = 29
    assert(result.stages[1].targetCount === 29, 'Stage 2 targetCount is exactly 29');

    // Stage 1 (Resume Screen): ceil(29 / (1.00 * 0.40)) = ceil(29 / 0.40) = 73
    assert(result.stages[0].targetCount === 73, 'Stage 1 targetCount is exactly 73');

    // Total intake
    assert(result.totalFunnelIntakeTarget === 73, 'Total funnel intake target is 73');
  } catch (err: any) {
    assert(false, 'Test 1 threw error', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Invalid Attendance & Pass Rates Validation
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Invalid Rates & Target Validation ---');
  try {
    let caughtZeroTarget = false;
    try {
      HiringFunnelCalculator.calculateFunnel(0, [
        { stageId: 's1', stageName: 'S1', stageType: 'resume_match', order: 1, expectedAttendanceRate: 1, expectedPassRate: 0.5 },
      ]);
    } catch {
      caughtZeroTarget = true;
    }
    assert(caughtZeroTarget, 'Rejects final shortlist target of 0');

    let caughtNegativeRate = false;
    try {
      HiringFunnelCalculator.calculateFunnel(5, [
        { stageId: 's1', stageName: 'S1', stageType: 'resume_match', order: 1, expectedAttendanceRate: -0.1, expectedPassRate: 0.5 },
      ]);
    } catch {
      caughtNegativeRate = true;
    }
    assert(caughtNegativeRate, 'Rejects negative attendance rate');

    let caughtExcessRate = false;
    try {
      HiringFunnelCalculator.calculateFunnel(5, [
        { stageId: 's1', stageName: 'S1', stageType: 'resume_match', order: 1, expectedAttendanceRate: 1.5, expectedPassRate: 0.5 },
      ]);
    } catch {
      caughtExcessRate = true;
    }
    assert(caughtExcessRate, 'Rejects attendance rate greater than 1.0 (100%)');

    let caughtDuplicateStage = false;
    try {
      HiringFunnelCalculator.calculateFunnel(5, [
        { stageId: 's1', stageName: 'Stage A', stageType: 'resume_match', order: 1, expectedAttendanceRate: 1, expectedPassRate: 0.5 },
        { stageId: 's1', stageName: 'Stage B', stageType: 'assessment', order: 2, expectedAttendanceRate: 1, expectedPassRate: 0.5 },
      ]);
    } catch {
      caughtDuplicateStage = true;
    }
    assert(caughtDuplicateStage, 'Rejects duplicate stageId in same funnel');
  } catch (err: any) {
    assert(false, 'Test 2 threw error', err.message);
  }

  // Connect to DB for end-to-end integration tests
  let hasDb = false;
  try {
    await connectDatabase();
    hasDb = mongoose.connection.readyState === 1;
  } catch {
    console.warn('⚠️ MongoDB connection not available, skipping database integration tests.');
  }

  if (!hasDb) {
    console.log('\n⚠️ Integration tests 3-10 require active MongoDB connection.');
    printSummary();
    return;
  }

  // Set up mock test job and applicants
  const testRecruiterUserId = new mongoose.Types.ObjectId();
  const testJob = await JobModel.create({
    title: 'Hiring Engine Test Lead Engineer',
    company: { name: 'LetGetIn Test Lab' },
    description: 'Testing the Hiring Engine dynamic refill and pipeline stages',
    skills: ['TypeScript', 'Node.js', 'MongoDB'],
    employmentType: 'full-time',
    workplaceType: 'remote',
    location: { country: 'India', remote: true },
    salary: { min: 0, max: 0, currency: 'INR', period: 'yearly' },
    source: 'recruiter',
    status: 'active',
    postedBy: testRecruiterUserId,
  });

  const testCandidateIds: mongoose.Types.ObjectId[] = [];
  const testAppIds: mongoose.Types.ObjectId[] = [];

  // Create 10 test candidates with descending match scores: 95, 90, 85, 80, 75, 70, 65, 60, 55, 50
  for (let i = 0; i < 10; i++) {
    const uId = new mongoose.Types.ObjectId();
    testCandidateIds.push(uId);

    const app = await ApplicationModel.create({
      userId: uId,
      jobId: testJob._id,
      source: 'manual',
      status: 'submitted',
      matchScore: 95 - i * 5,
      appliedAt: new Date(Date.now() - (10 - i) * 60000), // staggered application timestamps
    });
    testAppIds.push(app._id as mongoose.Types.ObjectId);
  }

  try {
    // ------------------------------------------------------------------------
    // TEST 3: Primary vs. Reserve Pool Assignment
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 3: Primary/Reserve Pool Assignment ---');
    // We request 4 primary candidates for Stage 1
    const partitionResult = await HiringPoolManager.partitionInitialPool(
      testJob._id,
      'stage_resume_screen',
      4,
      48
    );

    assert(partitionResult.primaryCandidates.length === 4, 'Assigned exactly 4 primary candidates');
    assert(partitionResult.reserveCandidates.length === 6, 'Assigned remaining 6 candidates to reserve pool');
    assert(partitionResult.initialDeficit === 0, 'Initial deficit is 0 since 10 candidates >= 4 required');

    // Verify primary candidates are the top 4 match scores (95, 90, 85, 80)
    const primaryScores = partitionResult.primaryCandidates.map((c) => c.compositeRank);
    assert(
      primaryScores.every((s) => (s || 0) >= 80),
      'Primary pool strictly contains top-ranked candidates (scores >= 80)'
    );

    // Verify reserve candidates are scores <= 75
    const reserveScores = partitionResult.reserveCandidates.map((c) => c.compositeRank);
    assert(
      reserveScores.every((s) => (s || 0) <= 75),
      'Reserve pool strictly contains lower-ranked candidates (scores <= 75)'
    );

    // ------------------------------------------------------------------------
    // TEST 4: Reserve Promotion (Atomic Deficit Replenishment)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 4: Reserve Promotion ---');
    // Simulate a deficit of 2
    const promoted = await HiringPoolManager.promoteReserveCandidates(
      testJob._id,
      'stage_resume_screen',
      1,
      'Resume Screen',
      2,
      48
    );

    assert(promoted.length === 2, 'Promoted exactly 2 candidates from reserve pool');
    assert(promoted[0].poolType === 'primary', 'First promoted candidate poolType is now primary');
    assert(promoted[0].stageStatus === 'invited', 'Promoted candidate stageStatus is invited');
    assert(promoted[0].compositeRank === 75, 'Highest-ranked reserve candidate (score 75) was promoted first');
    assert(promoted[1].compositeRank === 70, 'Second-highest reserve candidate (score 70) was promoted next');

    // Verify remaining reserve count
    const remainingReserve = await ApplicationModel.countDocuments({
      jobId: testJob._id,
      poolType: 'reserve',
    });
    assert(remainingReserve === 4, 'Remaining reserve count decremented from 6 to 4');

    // ------------------------------------------------------------------------
    // TEST 5: Duplicate Promotion Prevention
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 5: Duplicate Promotion Prevention ---');
    // Try to promote the same candidates again
    const promotedIdSet = new Set(promoted.map((p) => String(p._id)));
    const subsequentPromoted = await HiringPoolManager.promoteReserveCandidates(
      testJob._id,
      'stage_resume_screen',
      1,
      'Resume Screen',
      2,
      48
    );

    const overlap = subsequentPromoted.some((p) => promotedIdSet.has(String(p._id)));
    assert(!overlap, 'Subsequent promotion never returns already-promoted candidates');
    assert(subsequentPromoted.length === 2, 'Promoted next 2 unique candidates from reserve');

    // ------------------------------------------------------------------------
    // TEST 6: Candidate Withdrawal Handling
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 6: Candidate Withdrawal Handling ---');
    const activeCandidate = await ApplicationModel.findOne({
      jobId: testJob._id,
      poolType: 'primary',
      stageStatus: 'invited',
    });
    assert(!!activeCandidate, 'Found active primary candidate for withdrawal test');

    if (activeCandidate) {
      const withdrawResult = await HiringEngineService.handleCandidateWithdrawal(
        String(testJob._id),
        String(activeCandidate._id),
        'Candidate accepted competing offer'
      );

      assert(withdrawResult.application.poolType === 'disqualified', 'Withdrawn candidate is disqualified');
      assert(withdrawResult.application.status === 'rejected', 'Application status updated to rejected in ATS');

      // Check audit history
      const history = await CandidateStageHistoryModel.findOne({
        applicationId: activeCandidate._id,
        status: 'failed',
      });
      assert(!!history && (history.notes?.includes('withdrew') || false), 'Recorded withdrawal in immutable audit log');
    }

    // ------------------------------------------------------------------------
    // TEST 7: Candidate Failure Handling
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 7: Candidate Failure & Dynamic Refill ---');
    // Configure funnel on job
    const pipelineSetup = await HiringEngineService.initializePipeline(
      String(testJob._id),
      String(testRecruiterUserId),
      {
        finalShortlistTarget: 2,
        stages: [
          {
            stageId: 'stage_resume_screen',
            stageName: 'Resume Screen',
            stageType: 'resume_match',
            order: 1,
            expectedAttendanceRate: 1.0,
            expectedPassRate: 0.5,
            deadlineHours: 48,
          },
          {
            stageId: 'stage_interview',
            stageName: 'Final Interview',
            stageType: 'ai_interview',
            order: 2,
            expectedAttendanceRate: 1.0,
            expectedPassRate: 0.5,
            deadlineHours: 48,
          },
        ],
      }
    );
    assert(!!pipelineSetup.config, 'Initialized pipeline on test job');

    const failingCandidate = await ApplicationModel.findOne({
      jobId: testJob._id,
      poolType: 'primary',
      stageStatus: 'invited',
    });

    if (failingCandidate) {
      const failResult = await HiringEngineService.failCandidate(
        String(testJob._id),
        String(failingCandidate._id),
        String(testRecruiterUserId),
        'Failed technical rubric'
      );

      assert(failResult.application.stageStatus === 'failed', 'Candidate stageStatus is failed');
      assert(failResult.application.status === 'rejected', 'ATS status synchronized to rejected');

      // Check immutable history
      const failHistory = await CandidateStageHistoryModel.findOne({
        applicationId: failingCandidate._id,
        status: 'failed',
      });
      assert(!!failHistory, 'Immutable history record logged for candidate failure');
    }

    // ------------------------------------------------------------------------
    // TEST 8: No-Show Handling (Wait for Deadline Expiry)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 8: No-Show Handling (Deadline Enforcement) ---');
    const candidateFutureDeadline = await ApplicationModel.findOne({
      jobId: testJob._id,
      poolType: 'primary',
      stageStatus: 'invited',
    });

    if (candidateFutureDeadline) {
      // 8A. Test with deadline in the future -> MUST NOT mark no-show or refill prematurely
      candidateFutureDeadline.stageDeadline = new Date(Date.now() + 24 * 3600 * 1000);
      await candidateFutureDeadline.save();

      const prematurelyChecked = await HiringEngineService.handleNoShow(
        String(testJob._id),
        String(candidateFutureDeadline._id),
        false // forceCheck = false
      );
      assert(!prematurelyChecked.markedNoShow, 'Candidate with future deadline is NOT prematurely marked no-show');
      assert(prematurelyChecked.promotedCandidates.length === 0, 'No premature refill triggered before deadline');

      // 8B. Test with deadline in the past -> MUST mark no-show and refill
      candidateFutureDeadline.stageDeadline = new Date(Date.now() - 1000); // 1 sec in past
      await candidateFutureDeadline.save();

      const expiredCheck = await HiringEngineService.handleNoShow(
        String(testJob._id),
        String(candidateFutureDeadline._id),
        false
      );
      assert(expiredCheck.markedNoShow, 'Candidate with expired deadline is correctly marked no-show');

      const updatedCandidate = await ApplicationModel.findById(candidateFutureDeadline._id);
      assert(updatedCandidate?.stageStatus === 'no_show', 'Candidate stageStatus updated to no_show');
    }

    // ------------------------------------------------------------------------
    // TEST 9: Insufficient Candidate Pool & Starved Health State
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 9: Insufficient Candidate Pool & Starved Health ---');
    // Create an empty job with target of 50 candidates
    const starvedJob = await JobModel.create({
      title: 'Starved Pipeline Test Role',
      company: { name: 'LetGetIn Test Lab' },
      description: 'Testing starved funnel state',
      skills: ['Rust', 'Zig'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      location: { country: 'India', remote: true },
      salary: { min: 0, max: 0, currency: 'INR', period: 'yearly' },
      source: 'recruiter',
      status: 'active',
      postedBy: testRecruiterUserId,
    });

    const starvedSetup = await HiringEngineService.initializePipeline(
      String(starvedJob._id),
      String(testRecruiterUserId),
      {
        finalShortlistTarget: 10,
        stages: [
          {
            stageId: 's1',
            stageName: 'Screening',
            stageType: 'resume_match',
            order: 1,
            expectedAttendanceRate: 1.0,
            expectedPassRate: 0.5,
          },
        ],
      }
    );

    assert(starvedSetup.initialMetrics.health === 'starved', 'Funnel health is starved when applicants < required target');
    assert(starvedSetup.initialMetrics.primaryPoolSize === 0, 'Primary pool size is 0 (no fake candidates invented)');
    assert(starvedSetup.initialMetrics.stages[0].deficit > 0, 'Stage deficit is accurately detected');

    // ------------------------------------------------------------------------
    // TEST 10: Concurrent Refill Protection
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 10: Concurrent Refill Protection ---');
    // Create a dedicated job with 5 reserve candidates to test high-concurrency race condition
    const concurrencyJob = await JobModel.create({
      title: 'Concurrency Test Role',
      company: { name: 'LetGetIn Test Lab' },
      description: 'Testing race conditions in reserve promotion',
      skills: ['Concurrency', 'Redis', 'MongoDB'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      location: { country: 'India', remote: true },
      salary: { min: 0, max: 0, currency: 'INR', period: 'yearly' },
      source: 'recruiter',
      status: 'active',
      postedBy: testRecruiterUserId,
    });

    // Seed 6 reserve candidates
    for (let i = 1; i <= 6; i++) {
      const uId = new Types.ObjectId();
      await ApplicationModel.create({
        userId: uId,
        candidateId: uId,
        jobId: concurrencyJob._id,
        source: 'manual',
        status: 'submitted',
        poolType: 'reserve',
        currentStageIndex: 1,
        currentStageId: 'stage_resume_screen',
        stageStatus: 'invited',
        compositeRank: i * 10,
        appliedAt: new Date(Date.now() - (10 - i) * 60000),
      });
    }

    // Fire 6 concurrent requests trying to promote 1 candidate each simultaneously
    const concurrentPromotions = await Promise.all([
      HiringPoolManager.promoteReserveCandidates(concurrencyJob._id, 'stage_resume_screen', 1, 'Screen', 1, 48),
      HiringPoolManager.promoteReserveCandidates(concurrencyJob._id, 'stage_resume_screen', 1, 'Screen', 1, 48),
      HiringPoolManager.promoteReserveCandidates(concurrencyJob._id, 'stage_resume_screen', 1, 'Screen', 1, 48),
      HiringPoolManager.promoteReserveCandidates(concurrencyJob._id, 'stage_resume_screen', 1, 'Screen', 1, 48),
      HiringPoolManager.promoteReserveCandidates(concurrencyJob._id, 'stage_resume_screen', 1, 'Screen', 1, 48),
      HiringPoolManager.promoteReserveCandidates(concurrencyJob._id, 'stage_resume_screen', 1, 'Screen', 1, 48),
    ]);

    const flatPromoted = concurrentPromotions.flat();
    const distinctIds = new Set(flatPromoted.map((c) => String(c._id)));

    assert(
      flatPromoted.length === distinctIds.size,
      `Concurrent promotions never produce duplicate candidate promotions across threads (${flatPromoted.length} unique)`
    );
    assert(flatPromoted.length === 6, 'All 6 reserve candidates were claimed exactly once across concurrent workers');

    const remainingReserves = await ApplicationModel.countDocuments({
      jobId: concurrencyJob._id,
      poolType: 'reserve',
    });
    assert(remainingReserves === 0, 'Reserve pool is properly emptied with zero duplicate updates');

    // Clean up concurrency test job
    await JobModel.deleteMany({ _id: concurrencyJob._id });
    await ApplicationModel.deleteMany({ jobId: concurrencyJob._id });
    await CandidateStageHistoryModel.deleteMany({ jobId: concurrencyJob._id });

    // ========================================================================
    // PHASE 2: REAL AUTOMATION TEST SUITE
    // ========================================================================
    console.log('\n================================================================');
    console.log('⚡ LETGETIN HIRING ENGINE PHASE 2 AUTOMATION TEST SUITE');
    console.log('================================================================');

    const autoRecruiterId = new mongoose.Types.ObjectId();
    const autoJob = await JobModel.create({
      title: 'Senior Automation Engineer',
      company: { name: 'LetGetIn Automation Labs' },
      description: 'End-to-end automation testing',
      skills: ['TypeScript', 'BullMQ', 'Redis'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      location: { country: 'India', remote: true },
      salary: { min: 0, max: 0, currency: 'INR', period: 'yearly' },
      source: 'recruiter',
      status: 'active',
      postedBy: autoRecruiterId,
    });

    const autoCandidates: Types.ObjectId[] = [];
    const autoApps: any[] = [];
    for (let i = 0; i < 15; i++) {
      const uId = new Types.ObjectId();
      autoCandidates.push(uId);
      const app = await ApplicationModel.create({
        userId: uId,
        jobId: autoJob._id,
        source: 'manual',
        status: 'submitted',
        matchScore: 95 - i * 3,
        appliedAt: new Date(Date.now() - (20 - i) * 60000),
      });
      autoApps.push(app);
    }

    // Initialize 3-stage pipeline (Screen -> Assessment -> AI Interview -> Shortlist)
    const pipelineInit = await HiringEngineService.initializePipeline(
      String(autoJob._id),
      String(autoRecruiterId),
      {
        finalShortlistTarget: 1,
        stages: [
          {
            stageId: 'p2_screen',
            stageName: 'Resume Screening',
            stageType: 'resume_match',
            order: 1,
            expectedAttendanceRate: 1.0,
            expectedPassRate: 0.5,
            deadlineHours: 24,
            autoAdvanceScoreThreshold: 70,
          },
          {
            stageId: 'p2_assessment',
            stageName: 'Technical Assessment',
            stageType: 'assessment',
            order: 2,
            expectedAttendanceRate: 1.0,
            expectedPassRate: 0.5,
            deadlineHours: 48,
            autoAdvanceScoreThreshold: 75,
          },
          {
            stageId: 'p2_interview',
            stageName: 'AI Video Interview',
            stageType: 'ai_interview',
            order: 3,
            expectedAttendanceRate: 1.0,
            expectedPassRate: 0.5,
            deadlineHours: 48,
            autoAdvanceScoreThreshold: 80,
          },
        ],
      }
    );

    // ------------------------------------------------------------------------
    // P2-TEST 1: Candidate Deadline Scheduling
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 1: Candidate Deadline Scheduling ---');
    const scheduledApp = await ApplicationModel.findOne({ jobId: autoJob._id, poolType: 'primary' });
    assert(!!scheduledApp?.stageDeadline, 'Primary candidate has stageDeadline scheduled');
    assert(
      (scheduledApp?.stageDeadline?.getTime() || 0) > Date.now(),
      'Candidate deadline is set properly in the future'
    );

    // ------------------------------------------------------------------------
    // P2-TEST 2: Expired Candidate Becomes No-Show
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 2: Expired Candidate Becomes No-Show ---');
    const expiredCand = await ApplicationModel.findOne({
      jobId: autoJob._id,
      poolType: 'primary',
      stageStatus: 'invited',
    });
    if (expiredCand) {
      expiredCand.stageDeadline = new Date(Date.now() - 1000);
      await expiredCand.save();

      const deadlineResult = await HiringEngineService.processCandidateDeadlineJob({
        type: 'check-candidate-deadline',
        jobId: String(autoJob._id),
        applicationId: String(expiredCand._id),
        stageId: 'p2_screen',
        deadlineHours: 24,
      });

      assert(deadlineResult.markedNoShow === true, 'Expired candidate is marked no-show by deadline job');
      const reloaded = await ApplicationModel.findById(expiredCand._id);
      assert(reloaded?.stageStatus === 'no_show', 'Candidate stageStatus transitioned to no_show');
      assert(reloaded?.poolType === 'disqualified', 'No-show candidate is disqualified');
    }

    // ------------------------------------------------------------------------
    // P2-TEST 3: Non-Expired Candidate Remains Unchanged
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 3: Non-Expired Candidate Remains Unchanged ---');
    const activeCand = await ApplicationModel.findOne({
      jobId: autoJob._id,
      poolType: 'primary',
      stageStatus: 'invited',
    });
    if (activeCand) {
      activeCand.stageDeadline = new Date(Date.now() + 3600 * 1000);
      await activeCand.save();

      const activeCheck = await HiringEngineService.processCandidateDeadlineJob({
        type: 'check-candidate-deadline',
        jobId: String(autoJob._id),
        applicationId: String(activeCand._id),
        stageId: 'p2_screen',
        deadlineHours: 24,
      });

      assert(activeCheck.markedNoShow === false, 'Non-expired candidate is NOT marked no-show');
      const reloadedActive = await ApplicationModel.findById(activeCand._id);
      assert(reloadedActive?.stageStatus === 'invited', 'Candidate remains in invited status');
    }

    // ------------------------------------------------------------------------
    // P2-TEST 4: Completed Candidate Is Not Marked No-Show
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 4: Completed Candidate Is Not Marked No-Show ---');
    const completedCand = await ApplicationModel.findOne({
      jobId: autoJob._id,
      poolType: 'primary',
      stageStatus: 'invited',
    });
    if (completedCand) {
      completedCand.stageStatus = 'passed';
      completedCand.stageDeadline = new Date(Date.now() - 5000); // Past deadline
      await completedCand.save();

      const completedCheck = await HiringEngineService.processCandidateDeadlineJob({
        type: 'check-candidate-deadline',
        jobId: String(autoJob._id),
        applicationId: String(completedCand._id),
        stageId: 'p2_screen',
        deadlineHours: 24,
      });

      assert(completedCheck.markedNoShow === false, 'Passed/completed candidate is never marked no-show');
      const reloadedPassed = await ApplicationModel.findById(completedCand._id);
      assert(reloadedPassed?.stageStatus === 'passed', 'Candidate remains in passed status');
    }

    // ------------------------------------------------------------------------
    // P2-TEST 5 & 7 & 8: Failed Candidate Triggers Refill & Promotes Exactly Deficit
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 5, 7, 8: Failed Candidate Triggers Automatic Refill ---');
    const candToFail = await ApplicationModel.findOne({
      jobId: autoJob._id,
      poolType: 'primary',
      stageStatus: { $in: ['invited', 'passed'] },
    });
    if (candToFail) {
      candToFail.stageStatus = 'invited';
      await candToFail.save();

      const initialReserves = await ApplicationModel.countDocuments({ jobId: autoJob._id, poolType: 'reserve' });
      const failResult = await HiringEngineService.failCandidate(
        String(autoJob._id),
        String(candToFail._id),
        'system',
        'Failed technical rubric'
      );

      assert(failResult.application.stageStatus === 'failed', 'Candidate stageStatus updated to failed');
      assert(failResult.application.status === 'rejected', 'Application ATS status synchronized to rejected');
      assert(failResult.promotedCandidates.length === 1, 'Exactly 1 reserve candidate promoted to meet deficit of 1');
      assert(failResult.promotedCandidates[0].poolType === 'primary', 'Reserve candidate promoted to primary');
      assert(failResult.promotedCandidates[0].stageStatus === 'invited', 'Promoted candidate status set to invited');

      const afterReserves = await ApplicationModel.countDocuments({ jobId: autoJob._id, poolType: 'reserve' });
      assert(afterReserves === initialReserves - 1, 'Reserve pool count decremented by exactly 1');
    }

    // ------------------------------------------------------------------------
    // P2-TEST 6: Withdrawn Candidate Triggers Refill
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 6: Withdrawn Candidate Triggers Refill ---');
    const candToWithdraw = await ApplicationModel.findOne({
      jobId: autoJob._id,
      poolType: 'primary',
      stageStatus: 'invited',
    });
    if (candToWithdraw) {
      const withdrawResult = await HiringEngineService.handleCandidateWithdrawal(
        String(autoJob._id),
        String(candToWithdraw._id),
        'Accepted competing offer'
      );

      assert(withdrawResult.application.poolType === 'disqualified', 'Withdrawn candidate is disqualified');
      assert(withdrawResult.promotedCandidates.length === 1, 'Withdrawal triggered reserve refill of 1 candidate');
    }

    // ------------------------------------------------------------------------
    // P2-TEST 9: Concurrent Refill Does Not Duplicate Candidates
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 9: Concurrent Refill Safety Verification ---');
    const autoAppsInPrimary = await ApplicationModel.find({ jobId: autoJob._id, poolType: 'primary' }).lean();
    const primaryIdSet = new Set(autoAppsInPrimary.map((a) => String(a._id)));
    assert(
      autoAppsInPrimary.length === primaryIdSet.size,
      'Active primary candidates contain zero duplicate candidate applications'
    );

    // ------------------------------------------------------------------------
    // P2-TEST 10 & 11: Candidate Assessment Integration (Pass & Fail)
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 10 & 11: Candidate Assessment Integration ---');
    // Prepare candidate in stage 2 (p2_assessment, threshold = 75)
    const assessCand = await ApplicationModel.findOne({
      jobId: autoJob._id,
      poolType: 'primary',
      stageStatus: 'invited',
    });
    if (assessCand) {
      assessCand.currentStageIndex = 2;
      assessCand.currentStageId = 'p2_assessment';
      assessCand.stageStatus = 'invited';
      await assessCand.save();

      // 10. Pass assessment (score: 85 >= 75)
      const passAssess = await HiringEngineService.handleAssessmentCompleted(
        String(autoJob._id),
        String(assessCand._id),
        85,
        { codingScore: 90, mcqScore: 80 }
      );
      assert(passAssess.status === 'passed', 'Candidate with score 85 passed assessment threshold 75');
      const advancedCandidate = await ApplicationModel.findById(assessCand._id);
      assert(advancedCandidate?.currentStageId === 'p2_interview', 'Candidate automatically advanced to AI Interview stage');

      // 11. Fail assessment (score: 55 < 75)
      const failAssessCand = await ApplicationModel.findOne({
        jobId: autoJob._id,
        poolType: 'primary',
        stageStatus: 'invited',
        _id: { $ne: assessCand._id },
      });
      if (failAssessCand) {
        failAssessCand.currentStageIndex = 2;
        failAssessCand.currentStageId = 'p2_assessment';
        await failAssessCand.save();

        const failAssess = await HiringEngineService.handleAssessmentCompleted(
          String(autoJob._id),
          String(failAssessCand._id),
          55,
          { codingScore: 40, mcqScore: 70 }
        );
        assert(failAssess.status === 'failed', 'Candidate with score 55 failed assessment threshold 75');
        const reloadedFailCand = await ApplicationModel.findById(failAssessCand._id);
        assert(reloadedFailCand?.stageStatus === 'failed', 'Failed candidate status is failed');
        assert(reloadedFailCand?.poolType === 'disqualified', 'Failed candidate removed from active pool');
      }
    }

    // ------------------------------------------------------------------------
    // P2-TEST 12 & 13 & 14: AI Interview Integration & Final Shortlist
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 12, 13, 14: AI Interview Integration & Final Shortlist ---');
    const interviewCand = await ApplicationModel.findOne({
      jobId: autoJob._id,
      currentStageId: 'p2_interview',
      stageStatus: 'invited',
    });
    if (interviewCand) {
      // 12 & 14. Pass AI Interview (score 88 >= 80) -> Reaches Final Shortlist!
      const passInterview = await HiringEngineService.handleAiInterviewCompleted(String(interviewCand._id), {
        jobId: String(autoJob._id),
        applicationId: String(interviewCand._id),
        score: 88,
        scorecard: { overallScore: 88, recommendation: 'Hire' },
      });
      assert(passInterview.status === 'passed', 'Candidate passed AI interview threshold');

      const shortlistedCandidate = await ApplicationModel.findById(interviewCand._id);
      assert(shortlistedCandidate?.stageStatus === 'passed', 'Candidate stageStatus is passed');
      assert(shortlistedCandidate?.status === 'shortlisted', 'Candidate reached final shortlist in ATS');

      const autoConfig = await HiringFunnelConfigModel.findOne({ jobId: autoJob._id });
      assert(autoConfig?.currentShortlistedCount === 1, 'currentShortlistedCount incremented to 1');
      assert(autoConfig?.status === 'completed', 'Funnel config marked completed when target 1 reached');
    }

    // 13. Fail AI interview (< 80)
    const failInterviewCand = await ApplicationModel.create({
      userId: new Types.ObjectId(),
      jobId: autoJob._id,
      source: 'manual',
      status: 'submitted',
      poolType: 'primary',
      currentStageIndex: 3,
      currentStageId: 'p2_interview',
      stageStatus: 'invited',
      compositeRank: 78,
      appliedAt: new Date(),
    });

    const failInterview = await HiringEngineService.handleAiInterviewCompleted(String(failInterviewCand._id), {
      jobId: String(autoJob._id),
      applicationId: String(failInterviewCand._id),
      score: 65,
    });
    assert(failInterview.status === 'failed', 'Candidate with score 65 failed AI interview threshold 80');

    // ------------------------------------------------------------------------
    // P2-TEST 15: Closed Job Prevents Automation
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 15: Closed Job Prevents Automation ---');
    autoJob.status = 'closed';
    await autoJob.save();

    let closedJobBlocked = false;
    try {
      await HiringEngineService.advanceCandidate(
        String(autoJob._id),
        String(interviewCand?._id || autoApps[0]._id),
        'system'
      );
    } catch {
      closedJobBlocked = true;
    }
    assert(closedJobBlocked, 'Automated advancement is blocked when job is closed');

    const closedRefill = await HiringEngineService.evaluateAndRefillStage(
      autoJob._id,
      'p2_screen',
      1,
      'Screen',
      3,
      24
    );
    assert(closedRefill.length === 0, 'Refill promotes zero candidates when job is closed');

    // Restore job status
    autoJob.status = 'active';
    await autoJob.save();

    // ------------------------------------------------------------------------
    // P2-TEST 16: Paused Pipeline Prevents Automation
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 16: Paused Pipeline Prevents Automation ---');
    await HiringFunnelConfigModel.findOneAndUpdate({ jobId: autoJob._id }, { $set: { status: 'paused' } });

    let pausedPipelineBlocked = false;
    try {
      await HiringEngineService.advanceCandidate(
        String(autoJob._id),
        String(autoApps[0]._id),
        'system'
      );
    } catch {
      pausedPipelineBlocked = true;
    }
    assert(pausedPipelineBlocked, 'Automated advancement is blocked when pipeline is paused');

    const pausedRefill = await HiringEngineService.evaluateAndRefillStage(
      autoJob._id,
      'p2_screen',
      1,
      'Screen',
      3,
      24
    );
    assert(pausedRefill.length === 0, 'Refill promotes zero candidates when pipeline is paused');

    // Restore pipeline
    await HiringFunnelConfigModel.findOneAndUpdate({ jobId: autoJob._id }, { $set: { status: 'active' } });

    // ------------------------------------------------------------------------
    // P2-TEST 17: Starved Funnel Detection
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 17: Starved Funnel Detection ---');
    // Deplete remaining reserves for autoJob
    await ApplicationModel.deleteMany({ jobId: autoJob._id, poolType: 'reserve' });
    const metricsAfterExhaustion = await HiringEngineService.getFunnelMetrics(
      String(autoJob._id),
      String(autoRecruiterId)
    );
    assert(metricsAfterExhaustion.reservePoolSize === 0, 'Reserve pool is 0');

    // ------------------------------------------------------------------------
    // P2-TEST 18: BullMQ Retry & Idempotency
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 18: BullMQ Retry & Idempotency ---');
    const noShowCand = await ApplicationModel.findOne({ jobId: autoJob._id, stageStatus: 'no_show' });
    if (noShowCand) {
      // Execute deadline check on already no-show candidate
      const retryDeadline = await HiringEngineService.processCandidateDeadlineJob({
        type: 'check-candidate-deadline',
        jobId: String(autoJob._id),
        applicationId: String(noShowCand._id),
        stageId: 'p2_screen',
        deadlineHours: 24,
      });
      assert(retryDeadline.markedNoShow === false, 'Duplicate deadline check is a safe no-op');
    }

    // ------------------------------------------------------------------------
    // P2-TEST 19: Over-Performance (Preserve Extra Qualified Candidates)
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 19: Over-Performance Handling ---');
    // Shortlist target is 1, and 1 candidate is already shortlisted.
    // Create another candidate reaching the final stage and passing:
    const extraCandidate = await ApplicationModel.create({
      userId: new Types.ObjectId(),
      jobId: autoJob._id,
      source: 'manual',
      status: 'submitted',
      poolType: 'primary',
      currentStageIndex: 3,
      currentStageId: 'p2_interview',
      stageStatus: 'invited',
      compositeRank: 96,
      appliedAt: new Date(),
    });

    const overPerfResult = await HiringEngineService.advanceCandidate(
      String(autoJob._id),
      String(extraCandidate._id),
      'system',
      { score: 96, notes: 'Exceptional over-performing candidate' }
    );

    assert(overPerfResult.isFinalShortlist === true, 'Extra passing candidate reaches final shortlist');
    const reloadedExtra = await ApplicationModel.findById(extraCandidate._id);
    assert(reloadedExtra?.status === 'shortlisted', 'Extra qualified candidate is shortlisted and not rejected');
    const updatedConfig = await HiringFunnelConfigModel.findOne({ jobId: autoJob._id });
    assert(
      (updatedConfig?.currentShortlistedCount || 0) >= 2,
      'currentShortlistedCount accurately reflects over-performance'
    );

    // ------------------------------------------------------------------------
    // P2-TEST 20: No Duplicate Stage History Transitions
    // ------------------------------------------------------------------------
    console.log('\n--- P2-TEST 20: No Duplicate Stage History Transitions ---');
    const duplicateTestCand = await ApplicationModel.create({
      userId: new Types.ObjectId(),
      jobId: autoJob._id,
      source: 'manual',
      status: 'submitted',
      poolType: 'primary',
      currentStageIndex: 1,
      currentStageId: 'p2_screen',
      stageStatus: 'invited',
      compositeRank: 80,
      appliedAt: new Date(),
    });

    // Record stage history twice in rapid succession
    await HiringEngineService.recordStageHistory({
      applicationId: duplicateTestCand._id,
      jobId: autoJob._id,
      candidateId: duplicateTestCand.userId,
      stageId: 'p2_screen',
      stageName: 'Screen',
      stageIndex: 1,
      status: 'passed',
      score: 80,
    });

    await HiringEngineService.recordStageHistory({
      applicationId: duplicateTestCand._id,
      jobId: autoJob._id,
      candidateId: duplicateTestCand.userId,
      stageId: 'p2_screen',
      stageName: 'Screen',
      stageIndex: 1,
      status: 'passed',
      score: 80,
    });

    const historyCount = await CandidateStageHistoryModel.countDocuments({
      applicationId: duplicateTestCand._id,
      stageId: 'p2_screen',
      status: 'passed',
    });
    assert(historyCount === 1, 'Duplicate stage history transitions prevented by deduplication window');

    // Clean up Phase 2 test job
    await JobModel.deleteMany({ _id: autoJob._id });
    await ApplicationModel.deleteMany({ jobId: autoJob._id });
    await HiringFunnelConfigModel.deleteMany({ jobId: autoJob._id });
    await CandidateStageHistoryModel.deleteMany({ jobId: autoJob._id });
  } finally {
    // Clean up test data
    console.log('\n🧹 Cleaning up test artifacts...');
    await JobModel.deleteMany({ _id: { $in: [testJob._id] } });
    await ApplicationModel.deleteMany({ jobId: testJob._id });
    await HiringFunnelConfigModel.deleteMany({ jobId: testJob._id });
    await CandidateStageHistoryModel.deleteMany({ jobId: testJob._id });
  }

  printSummary();
}

function printSummary() {
  console.log('\n================================================================');
  console.log(`📊 TEST RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runHiringEngineTestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('💥 Unexpected test suite failure:', err);
    process.exit(1);
  });
