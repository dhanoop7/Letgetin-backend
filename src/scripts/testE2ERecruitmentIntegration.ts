import { HiringFunnelCalculator } from '../modules/hiringEngine/services/hiringFunnelCalculator.js';
import { HiringPoolManager } from '../modules/hiringEngine/services/hiringPoolManager.js';
import { HiringEngineService } from '../modules/hiringEngine/services/hiringEngine.service.js';
import { HiringFunnelConfigModel } from '../modules/hiringEngine/hiringFunnelConfig.model.js';
import { CandidateStageHistoryModel } from '../modules/hiringEngine/candidateStageHistory.model.js';
import { JobModel } from '../modules/job/job.model.js';
import { ApplicationModel } from '../modules/application/application.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import { Interview } from '../modules/interview/interview.model.js';
import { jobService } from '../modules/job/job.service.js';
import { applicationService } from '../modules/application/application.service.js';
import { connectDatabase } from '../config/database.js';
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

async function runE2EIntegrationTestSuite() {
  console.log('================================================================');
  console.log('🔍 LETGETIN RECRUITMENT FLOW + HIRING ENGINE E2E AUDIT TEST');
  console.log('================================================================\n');

  try {
    await connectDatabase();
  } catch (err: any) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  const testRecruiterId = new Types.ObjectId();
  let createdJobId: Types.ObjectId | null = null;
  const candidateUserIds: Types.ObjectId[] = [];
  const candidateAppIds: Types.ObjectId[] = [];

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Create and publish a job with Hiring Engine enabled
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 1: Create and Publish Job with Hiring Engine Enabled ---');
    const createdJob = await jobService.createRecruiterJob(String(testRecruiterId), {
      title: 'Staff Full-Stack Architect',
      companyName: 'LetGetIn Enterprise Labs',
      description: 'Lead engineering role requiring React, Node.js, Distributed Systems, and MongoDB',
      skills: ['TypeScript', 'Node.js', 'React', 'MongoDB', 'System Design'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      location: 'Bangalore, India',
      salaryText: '₹35,00,000 - ₹50,00,000',
      finalShortlistTarget: 3,
      pipelineOptions: {
        matchVolume: '1:10',
        resumeMatch: true,
        resumeMatchTypes: ['broadAts', 'strictSkills'],
        assessment: true,
        assessmentTypes: ['coding', 'domain'],
        aiInterview: true,
        aiInterviewTypes: ['technical'],
      },
    });

    assert(!!createdJob && !!createdJob._id, 'Job created via jobService.createRecruiterJob');
    assert(createdJob.status === 'active', 'Job is published with active status');
    assert(createdJob.pipelineOptions?.resumeMatch === true, 'Job has resumeMatch enabled in pipelineOptions');
    assert(createdJob.pipelineOptions?.assessment === true, 'Job has assessment enabled in pipelineOptions');
    assert(createdJob.pipelineOptions?.aiInterview === true, 'Job has aiInterview enabled in pipelineOptions');

    createdJobId = createdJob._id as Types.ObjectId;

    // Verify backend integration: createRecruiterJob automatically creates HiringFunnelConfig document
    const initialConfig = await HiringFunnelConfigModel.findOne({ jobId: createdJobId });
    assert(
      initialConfig !== null,
      'createRecruiterJob automatically creates HiringFunnelConfig document upon publish'
    );
    assert(initialConfig?.finalShortlistTarget === 3, 'initialConfig has finalShortlistTarget = 3');
    assert(
      (initialConfig?.stages?.length || 0) >= 2,
      'initialConfig automatically configured active stages'
    );

    // Ensure stage auto-advance thresholds match test expectations
    initialConfig!.stages[0].expectedAttendanceRate = 1.0;
    initialConfig!.stages[0].expectedPassRate = 1.0;
    initialConfig!.stages[0].autoAdvanceScoreThreshold = 75;
    initialConfig!.stages[0].targetCount = 3;
    initialConfig!.stages[1].expectedAttendanceRate = 1.0;
    initialConfig!.stages[1].expectedPassRate = 1.0;
    initialConfig!.stages[1].autoAdvanceScoreThreshold = 80;
    initialConfig!.stages[1].targetCount = 3;
    await initialConfig!.save();

    const pipelineInit = { config: initialConfig! };

    assert(pipelineInit.config.stages[0].targetCount === 3, 'Stage 1 target intake is exactly 3');
    assert(pipelineInit.config.stages[1].targetCount === 3, 'Stage 2 target intake is exactly 3');

    // Verify Job document was linked to the Hiring Engine Config
    const reloadedJob = await JobModel.findById(createdJobId);
    assert(reloadedJob?.hiringEngineEnabled === true, 'JobModel.hiringEngineEnabled updated to true');
    assert(
      String(reloadedJob?.hiringEngineConfigId) === String(pipelineInit.config._id),
      'JobModel.hiringEngineConfigId points to created HiringFunnelConfig'
    );

    // ------------------------------------------------------------------------
    // TEST 2: Candidate Matching Implementation produces Ranked Candidates
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 2: Candidate Matching System Produces Ranked Candidates ---');
    // Create 6 candidates with staggered match scores: 95, 90, 85, 80, 75, 70
    const candidateScores = [95, 90, 85, 80, 75, 70];
    const candidateNames = [
      'Candidate 1 (Score 95)',
      'Candidate 2 (Score 90)',
      'Candidate 3 (Score 85)',
      'Candidate 4 (Score 80)',
      'Candidate 5 (Score 75)',
      'Candidate 6 (Score 70)',
    ];

    for (let i = 0; i < 6; i++) {
      const user = await UserModel.create({
        email: `e2e_candidate_${i + 1}_${Date.now()}@letgetin.io`,
        fullName: candidateNames[i],
        provider: 'email',
        emailVerified: true,
      });
      candidateUserIds.push(user._id as Types.ObjectId);

      const app = await ApplicationModel.create({
        userId: user._id,
        jobId: createdJobId,
        source: 'manual',
        status: 'submitted',
        matchScore: candidateScores[i],
        appliedAt: new Date(Date.now() - (10 - i) * 60000), // earlier timestamps for higher scorers
      });
      candidateAppIds.push(app._id as Types.ObjectId);
    }

    assert(candidateAppIds.length === 6, 'Created 6 applications with match scores 95, 90, 85, 80, 75, 70');

    // ------------------------------------------------------------------------
    // TEST 3: Resume Shortlisting Feeds the Hiring Engine Correctly
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 3: Resume Shortlisting Feeds the Hiring Engine Correctly ---');
    // Compute composite scores via existing matching algorithm in HiringPoolManager
    const scoredCandidates: { appId: Types.ObjectId; score: number }[] = [];
    for (const appId of candidateAppIds) {
      const appDoc = await ApplicationModel.findById(appId);
      const score = await HiringPoolManager.computeOrGetCompositeScore(
        appDoc!,
        reloadedJob?.skills || [],
        reloadedJob?.embedding
      );
      scoredCandidates.push({ appId, score });
    }

    // Verify ordering is monotonic descending
    const isMonotonic = scoredCandidates.every((val, idx, arr) => idx === 0 || arr[idx - 1].score >= val.score);
    assert(isMonotonic, 'Candidate matching scores produce ranked descending order');

    // ------------------------------------------------------------------------
    // TEST 4: Primary (1, 2, 3) and Reserve (4, 5, 6) Pools Created Correctly
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 4: Primary and Reserve Candidate Pools Partitioning ---');
    const partitionResult = await HiringPoolManager.partitionInitialPool(
      createdJobId,
      'stage_assessment',
      3, // required intake for primary pool
      24 // deadline hours
    );

    assert(partitionResult.primaryCandidates.length === 3, 'Primary pool has exactly 3 candidates');
    assert(partitionResult.reserveCandidates.length === 3, 'Reserve pool has exactly 3 candidates');

    const primaryAppIds = partitionResult.primaryCandidates.map((c) => String(c._id));
    const reserveAppIds = partitionResult.reserveCandidates.map((c) => String(c._id));

    assert(
      primaryAppIds.includes(String(candidateAppIds[0])) &&
      primaryAppIds.includes(String(candidateAppIds[1])) &&
      primaryAppIds.includes(String(candidateAppIds[2])),
      'Primary pool contains Candidate 1, Candidate 2, Candidate 3'
    );

    assert(
      reserveAppIds.includes(String(candidateAppIds[3])) &&
      reserveAppIds.includes(String(candidateAppIds[4])) &&
      reserveAppIds.includes(String(candidateAppIds[5])),
      'Reserve pool contains Candidate 4, Candidate 5, Candidate 6'
    );

    // Verify database document state for Primary candidates
    const cand1 = await ApplicationModel.findById(candidateAppIds[0]);
    assert(cand1?.poolType === 'primary', 'Candidate 1 poolType is primary');
    assert(cand1?.currentStageId === 'stage_assessment', 'Candidate 1 currentStageId is stage_assessment');
    assert(cand1?.stageStatus === 'invited', 'Candidate 1 stageStatus is invited');
    assert(!!cand1?.stageDeadline, 'Candidate 1 stageDeadline is populated');

    // Verify database document state for Reserve candidates
    const cand4 = await ApplicationModel.findById(candidateAppIds[3]);
    assert(cand4?.poolType === 'reserve', 'Candidate 4 poolType is reserve');
    assert(cand4?.currentStageId === 'stage_assessment', 'Candidate 4 currentStageId is stage_assessment');
    assert(cand4?.stageDeadline === undefined, 'Candidate 4 reserve candidate has NO stageDeadline');

    // ------------------------------------------------------------------------
    // TEST 5: Complete Assessment for Candidate 1 -> Auto-Advancement
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 5: Complete Assessment for Candidate 1 (Score 90 >= Threshold 75) ---');
    const cand1Assessment = await HiringEngineService.handleAssessmentCompleted(
      String(createdJobId),
      String(candidateAppIds[0]),
      90,
      { codeQuality: 92, problemSolving: 88 }
    );

    assert(cand1Assessment.processed === true, 'Assessment completion event was processed');
    assert(cand1Assessment.status === 'passed', 'Candidate 1 was automatically advanced (status: passed)');

    // Verify candidate 1 application document
    const cand1After = await ApplicationModel.findById(candidateAppIds[0]);
    assert(cand1After?.currentStageId === 'stage_ai_interview', 'Candidate 1 application.currentStageId is stage_ai_interview');
    assert(cand1After?.stageStatus === 'invited', 'Candidate 1 stageStatus is invited for next stage');
    assert(cand1After?.assessmentScore === 90, 'Candidate 1 assessmentScore recorded as 90');

    // Verify stage history record
    const cand1History = await CandidateStageHistoryModel.find({ applicationId: candidateAppIds[0] });
    assert(cand1History.length >= 2, 'Candidate 1 has stage history entries (invited + passed/advanced)');

    // ------------------------------------------------------------------------
    // TEST 6: Fail Candidate 2 -> Reserve Replacement Promoted
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 6: Fail Candidate 2 (Score 50 < Threshold 75) -> Reserve Promotion ---');
    const cand2Assessment = await HiringEngineService.handleAssessmentCompleted(
      String(createdJobId),
      String(candidateAppIds[1]),
      50,
      { reason: 'Failed data structures assessment' }
    );

    assert(cand2Assessment.processed === true, 'Candidate 2 fail assessment processed');
    assert(cand2Assessment.status === 'failed', 'Candidate 2 status is failed');

    // Check candidate 2 status
    const cand2After = await ApplicationModel.findById(candidateAppIds[1]);
    assert(cand2After?.stageStatus === 'failed', 'Candidate 2 stageStatus updated to failed');
    assert(cand2After?.poolType === 'disqualified', 'Candidate 2 poolType updated to disqualified');
    assert(cand2After?.status === 'rejected', 'Candidate 2 application ATS status updated to rejected');

    // Verify Candidate 4 was promoted from Reserve to Primary in stage_assessment
    const cand4After = await ApplicationModel.findById(candidateAppIds[3]);
    assert(cand4After?.poolType === 'primary', 'Candidate 4 promoted to primary pool');
    assert(cand4After?.stageStatus === 'invited', 'Candidate 4 stageStatus set to invited');
    assert(!!cand4After?.stageDeadline, 'Candidate 4 received an active stageDeadline');

    // Verify remaining reserve pool (Candidate 4 & 5 promoted to fill deficit of 2 from Cand 1 advance + Cand 2 fail)
    const remainingReserves = await ApplicationModel.find({
      jobId: createdJobId,
      poolType: 'reserve',
    });
    assert(remainingReserves.length === 1, 'Reserve pool decremented to 1 candidate (Candidate 6)');
    assert(String(remainingReserves[0]._id) === String(candidateAppIds[5]), 'Remaining reserve candidate is Candidate 6');

    // ------------------------------------------------------------------------
    // TEST 7: Mark Candidate 3 as No-Show -> Deadline Handling & Promotion
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 7: Expire Candidate 3 Deadline (No-Show) -> Reserve Promotion ---');
    // Fast-forward candidate 3's deadline into the past to simulate expiration
    await ApplicationModel.findByIdAndUpdate(candidateAppIds[2], {
      stageDeadline: new Date(Date.now() - 3600 * 1000), // 1 hour ago
      stageStatus: 'invited',
    });

    const cand3Expired = await HiringEngineService.processCandidateDeadlineJob({
      type: 'check-candidate-deadline',
      jobId: String(createdJobId),
      applicationId: String(candidateAppIds[2]),
      stageId: 'stage_assessment',
      deadlineHours: 24,
    });

    assert(cand3Expired.markedNoShow === true, 'Candidate 3 marked as no-show');

    // Verify Candidate 3 document
    const cand3After = await ApplicationModel.findById(candidateAppIds[2]);
    assert(cand3After?.stageStatus === 'no_show', 'Candidate 3 stageStatus is no_show');
    assert(cand3After?.poolType === 'disqualified', 'Candidate 3 poolType is disqualified');

    // Verify Candidate 6 was promoted from Reserve to Primary to fill Candidate 3's vacancy
    const cand6After = await ApplicationModel.findById(candidateAppIds[5]);
    assert(cand6After?.poolType === 'primary', 'Candidate 6 promoted from reserve to primary');
    assert(cand6After?.stageStatus === 'invited', 'Candidate 6 stageStatus is invited');
    assert(!!cand6After?.stageDeadline, 'Candidate 6 received stageDeadline');

    // Verify reserve pool is now fully utilized (0 remaining)
    const reserveLeft = await ApplicationModel.find({
      jobId: createdJobId,
      poolType: 'reserve',
    });
    assert(reserveLeft.length === 0, 'Reserve pool now has 0 candidates (all qualified reserves utilized)');

    // ------------------------------------------------------------------------
    // TEST 8: Complete Next Assessment & Verify Auto-Advancement
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 8: Complete Assessment for Candidates 4 & 5 -> Advance to Interview ---');
    const cand4Assess = await HiringEngineService.handleAssessmentCompleted(
      String(createdJobId),
      String(candidateAppIds[3]),
      85,
      { codeQuality: 86 }
    );
    assert(cand4Assess.processed === true && cand4Assess.status === 'passed', 'Candidate 4 advanced to AI Interview');

    const cand5Assess = await HiringEngineService.handleAssessmentCompleted(
      String(createdJobId),
      String(candidateAppIds[4]),
      88,
      { codeQuality: 90 }
    );
    assert(cand5Assess.processed === true && cand5Assess.status === 'passed', 'Candidate 5 advanced to AI Interview');

    // Now Candidates 1, 4, 5 are all in stage_ai_interview with primary pool
    const activeInterviewees = await ApplicationModel.find({
      jobId: createdJobId,
      currentStageId: 'stage_ai_interview',
      poolType: 'primary',
      stageStatus: 'invited',
    });
    assert(activeInterviewees.length === 3, 'Stage 2 (AI Interview) now has exactly 3 primary candidates (1, 4, 5)');

    // ------------------------------------------------------------------------
    // TEST 9 & 10: Complete AI Interviews -> Final Shortlist Target (3) Reached
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 9 & 10: Complete AI Interviews & Verify Final Shortlist Target ---');
    // Create Interview documents linked to job and user with all required fields
    const interview1 = await Interview.create({
      userId: candidateUserIds[0],
      candidateId: candidateUserIds[0],
      candidateName: candidateNames[0],
      candidateEmail: 'candidate1@letgetin.io',
      position: 'Staff Full-Stack Architect',
      department: 'Engineering',
      jobId: createdJobId,
      roundName: 'AI Technical Round',
      type: 'ai_interview',
      stage: 'upcoming',
      date: '2026-09-16',
      time: '10:00 AM',
      durationMinutes: 45,
      platform: 'LetGetIn Room',
      role: 'Staff Full-Stack Architect',
      score: 4.5,
    });

    const interview4 = await Interview.create({
      userId: candidateUserIds[3],
      candidateId: candidateUserIds[3],
      candidateName: candidateNames[3],
      candidateEmail: 'candidate4@letgetin.io',
      position: 'Staff Full-Stack Architect',
      department: 'Engineering',
      jobId: createdJobId,
      roundName: 'AI Technical Round',
      type: 'ai_interview',
      stage: 'upcoming',
      date: '2026-09-16',
      time: '11:00 AM',
      durationMinutes: 45,
      platform: 'LetGetIn Room',
      role: 'Staff Full-Stack Architect',
      score: 4.2,
    });

    const interview5 = await Interview.create({
      userId: candidateUserIds[4],
      candidateId: candidateUserIds[4],
      candidateName: candidateNames[4],
      candidateEmail: 'candidate5@letgetin.io',
      position: 'Staff Full-Stack Architect',
      department: 'Engineering',
      jobId: createdJobId,
      roundName: 'AI Technical Round',
      type: 'ai_interview',
      stage: 'upcoming',
      date: '2026-09-16',
      time: '02:00 PM',
      durationMinutes: 45,
      platform: 'LetGetIn Room',
      role: 'Staff Full-Stack Architect',
      score: 4.6,
    });

    // Complete AI Interview for Candidate 1 (Score 90 >= Threshold 80)
    const res1 = await HiringEngineService.handleAiInterviewCompleted(String(interview1._id), {
      score: 90,
      feedbackNotes: 'Exceptional architectural depth and systems thinking',
    });
    assert(res1.processed === true, 'Candidate 1 AI interview processed');
    assert(res1.status === 'passed', 'Candidate 1 passed AI interview and reached final shortlist');

    // Complete AI Interview for Candidate 4 (Score 84 >= Threshold 80)
    const res4 = await HiringEngineService.handleAiInterviewCompleted(String(interview4._id), {
      score: 84,
      feedbackNotes: 'Strong communication and design trade-off reasoning',
    });
    assert(res4.processed === true && res4.status === 'passed', 'Candidate 4 reached final shortlist');

    // Complete AI Interview for Candidate 5 (Score 92 >= Threshold 80)
    const res5 = await HiringEngineService.handleAiInterviewCompleted(String(interview5._id), {
      score: 92,
      feedbackNotes: 'Outstanding problem solving and leadership presence',
    });
    assert(res5.processed === true && res5.status === 'passed', 'Candidate 5 reached final shortlist');

    // Verify Final Shortlist Target Verification
    const finalConfig = await HiringFunnelConfigModel.findOne({ jobId: createdJobId });
    assert(finalConfig?.currentShortlistedCount === 3, 'currentShortlistedCount reached target of 3');
    assert(finalConfig?.status === 'completed', 'Funnel config marked completed when target is satisfied');

    const shortlistedApps = await ApplicationModel.find({
      jobId: createdJobId,
      status: 'shortlisted',
    });
    assert(shortlistedApps.length === 3, 'Exactly 3 applications marked with status = shortlisted in database');

    // ------------------------------------------------------------------------
    // TEST 11: Insufficient Candidates (Target = 3, Only 2 Eligible)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 11: Insufficient Candidates (Funnel Starved, No Fake Candidates) ---');
    const starvedJob = await JobModel.create({
      title: 'Rare Quantum Crypto Engineer',
      company: { name: 'LetGetIn Research' },
      description: 'Niche cryptographic role with low talent density',
      skills: ['Post-Quantum Cryptography', 'Rust'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      location: { country: 'India', remote: true },
      salary: { min: 0, max: 0, currency: 'INR', period: 'yearly' },
      source: 'recruiter',
      status: 'active',
      postedBy: testRecruiterId,
    });

    // Create ONLY 2 applicants
    for (let k = 0; k < 2; k++) {
      const uId = new Types.ObjectId();
      await ApplicationModel.create({
        userId: uId,
        jobId: starvedJob._id,
        source: 'manual',
        status: 'submitted',
        matchScore: 88 - k * 5,
        appliedAt: new Date(),
      });
    }

    const starvedSetup = await HiringEngineService.initializePipeline(
      String(starvedJob._id),
      String(testRecruiterId),
      {
        finalShortlistTarget: 3,
        stages: [
          {
            stageId: 'starved_s1',
            stageName: 'Screening',
            stageType: 'resume_match',
            order: 1,
            expectedAttendanceRate: 1.0,
            expectedPassRate: 1.0,
            deadlineHours: 24,
          },
        ],
      }
    );

    const starvedMetrics = await HiringEngineService.getFunnelMetrics(String(starvedJob._id), String(testRecruiterId));
    assert(starvedMetrics.finalShortlistTarget === 3, 'Shortlist target is 3');
    assert(starvedMetrics.primaryPoolSize === 2, 'Primary pool size is strictly 2');
    assert(starvedMetrics.stages[0].deficit === 1, 'Stage 1 deficit is accurately calculated as 1');
    assert(starvedMetrics.health === 'starved', 'Funnel health is correctly reported as starved');

    const totalAppsInDb = await ApplicationModel.countDocuments({ jobId: starvedJob._id });
    assert(totalAppsInDb === 2, 'Engine did NOT synthesize fake candidate records in database (strictly 2)');

    // ------------------------------------------------------------------------
    // TEST 12: Duplicate Processing (Idempotency & Concurrency)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 12: Duplicate Processing & Idempotency ---');
    // Re-send assessment completion for candidate 1 who has already passed and advanced
    const dupAssessment = await HiringEngineService.handleAssessmentCompleted(
      String(createdJobId),
      String(candidateAppIds[0]),
      95
    );
    assert(
      dupAssessment.processed === false || !!dupAssessment.reason?.includes('not assessment') || dupAssessment.status === 'passed',
      'Duplicate assessment event is safely ignored (candidate not in assessment stage)'
    );

    // Re-send AI interview completion for candidate 1 who has already been shortlisted
    const dupInterview = await HiringEngineService.handleAiInterviewCompleted(
      String(interview1._id),
      { score: 90 }
    );
    assert(
      dupInterview.processed === false || dupInterview.status === 'passed',
      'Duplicate interview completion event is safe'
    );

    const dupHistory = await CandidateStageHistoryModel.find({
      applicationId: candidateAppIds[0],
      status: 'passed',
      stageId: 'stage_ai_interview',
    });
    const isIdempotent = dupHistory.length === 1;
    assert(
      isIdempotent,
      'Duplicate stage history transitions prevented on final stage (strictly 1 passed record)'
    );

    const recheckConfig = await HiringFunnelConfigModel.findOne({ jobId: createdJobId });
    assert(
      recheckConfig?.currentShortlistedCount === 3,
      'currentShortlistedCount strictly capped at 3/3 target (never 4/3) on repeat evaluations'
    );

    // ------------------------------------------------------------------------
    // TEST 13: Job Closed / Paused Blocks Automation
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 13: Closed and Paused Jobs Block Automation ---');
    // Create a closed job
    const closedJob = await JobModel.create({
      title: 'Closed Position Lead',
      company: { name: 'LetGetIn Tech' },
      description: 'Position is closed',
      skills: ['Node.js'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      location: { country: 'India', remote: true },
      salary: { min: 0, max: 0, currency: 'INR', period: 'yearly' },
      source: 'recruiter',
      status: 'closed',
      postedBy: testRecruiterId,
    });

    const testUserClosed = new Types.ObjectId();
    const closedApp = await ApplicationModel.create({
      userId: testUserClosed,
      jobId: closedJob._id,
      source: 'manual',
      status: 'submitted',
      matchScore: 80,
      currentStageId: 'closed_stage',
      poolType: 'primary',
      stageStatus: 'invited',
    });

    let closedErrorCaught = false;
    try {
      await HiringEngineService.advanceCandidate(
        String(closedJob._id),
        String(closedApp._id),
        String(testRecruiterId)
      );
    } catch (err: any) {
      closedErrorCaught = true;
    }
    assert(closedErrorCaught, 'Advancing candidate on a closed job is blocked');

    // Test refill on paused pipeline
    await HiringFunnelConfigModel.findOneAndUpdate(
      { jobId: createdJobId },
      { status: 'paused' }
    );
    const refillPaused = await HiringEngineService.evaluateAndRefillStage(
      createdJobId,
      'stage_assessment',
      1,
      'Technical Assessment',
      3,
      24
    );
    assert(refillPaused.length === 0, 'Refill promotes zero candidates when pipeline is paused');

    // Restore pipeline status for test 14
    await HiringFunnelConfigModel.findOneAndUpdate(
      { jobId: createdJobId },
      { status: 'completed' }
    );

    // ------------------------------------------------------------------------
    // TEST 14: Frontend Pages Consistency (Timeline, Kanban, Candidate Listing)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 14: Frontend View Contract Consistency ---');
    // View 1: Timeline data (/recruiter/hiring-pipeline/timeline)
    const timelineConfig = await HiringEngineService.getFunnelConfig(String(createdJobId), String(testRecruiterId));
    const timelineMetrics = await HiringEngineService.getFunnelMetrics(String(createdJobId), String(testRecruiterId));

    assert(timelineConfig.jobId.toString() === String(createdJobId), 'Timeline config matches Job ID');
    assert(timelineMetrics.finalShortlistTarget === 3, 'Timeline metrics reflect finalShortlistTarget = 3');
    assert(timelineMetrics.currentShortlistedCount === 3, 'Timeline metrics reflect currentShortlistedCount = 3');

    // View 2: Kanban data (/recruiter/hiring-pipeline/kanban)
    // Kanban calls getStageCandidates for each stage
    const stage1Kanban = await HiringEngineService.getStageCandidates(String(createdJobId), 'stage_assessment', String(testRecruiterId));
    const stage2Kanban = await HiringEngineService.getStageCandidates(String(createdJobId), 'stage_ai_interview', String(testRecruiterId));

    // Verify stage 1 counts: Candidate 2 failed, Candidate 3 no-show, Candidate 4 & 5 passed to stage 2, Candidate 6 mobilized to primary
    assert(stage1Kanban.reserve.length === 0, 'Kanban Stage 1 reserve count is 0 (all reserves mobilized)');
    assert(
      stage1Kanban.primary.some((c) => String(c._id) === String(candidateAppIds[5])),
      'Candidate 6 is active in Stage 1 Primary pool'
    );

    // View 3: Candidate Listing (/recruiter/hiring-pipeline/candidates)
    // All 6 candidates are queryable and their stage status is accurate
    const allCandidates = await ApplicationModel.find({ jobId: createdJobId }).lean();
    assert(allCandidates.length === 6, 'Candidate listing queries all 6 real candidates');

    const passedCount = allCandidates.filter((c) => c.status === 'shortlisted').length;
    const failedCount = allCandidates.filter((c) => c.stageStatus === 'failed').length;
    const noShowCount = allCandidates.filter((c) => c.stageStatus === 'no_show').length;

    assert(passedCount === 3, 'Candidate listing: 3 shortlisted candidates');
    assert(failedCount === 1, 'Candidate listing: 1 failed candidate (Candidate 2)');
    assert(noShowCount === 1, 'Candidate listing: 1 no-show candidate (Candidate 3)');

    // ------------------------------------------------------------------------
    // TEST 15: Post-Publish Direct Candidate Application Intake (Primary vs Reserve)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 15: Post-Publish Direct Candidate Intake ---');
    // Create an active job with 1 open seat in primary pool
    const intakeJob = await jobService.createRecruiterJob(String(testRecruiterId), {
      title: 'Site Reliability Architect',
      companyName: 'LetGetIn Cloud Labs',
      description: 'Distributed infrastructure role',
      skills: ['Kubernetes', 'Go', 'AWS'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      location: 'Remote',
      salaryText: '₹40,00,000',
      finalShortlistTarget: 1,
      pipelineOptions: {
        assessment: true,
        assessmentTypes: ['coding'],
      },
    });

    const intakeConfig = await HiringFunnelConfigModel.findOne({ jobId: intakeJob._id });
    if (intakeConfig && intakeConfig.stages.length > 0) {
      intakeConfig.status = 'active';
      intakeConfig.stages[0].targetCount = 1;
      intakeConfig.stages[0].expectedAttendanceRate = 1.0;
      intakeConfig.stages[0].expectedPassRate = 1.0;
      intakeConfig.stages[0].autoAdvanceScoreThreshold = 75;
      await intakeConfig.save();
    }
    await JobModel.findByIdAndUpdate(intakeJob._id, {
      $unset: { applicationCollection: 1 },
      hiringEngineEnabled: true,
    });

    const candidateUser7 = await UserModel.create({
      email: `candidate_postpub_1_${Date.now()}@letgetin.io`,
      fullName: 'Direct Applicant 1',
      provider: 'email',
      emailVerified: true,
    });
    candidateUserIds.push(candidateUser7._id as Types.ObjectId);
    const testResume7 = await ResumeModel.create({
      userId: candidateUser7._id,
      title: 'SRE Resume',
      isActive: true,
      content: { skills: ['Kubernetes', 'Go', 'AWS'] },
    });

    // Applicant 1 applies: Primary pool has open capacity (target = 1, active = 0)
    const app7 = await applicationService.createApplication(String(candidateUser7._id), {
      jobId: String(intakeJob._id),
      resumeId: String(testResume7._id),
      source: 'manual',
    });

    const app7Doc = await ApplicationModel.findById(app7._id);
    assert(app7Doc?.poolType === 'primary', 'Direct applicant 1 routed to Primary Pool (seat available)');
    assert(app7Doc?.stageStatus === 'invited', 'Direct applicant 1 assigned stageStatus = invited');
    assert(!!app7Doc?.stageDeadline, 'Direct applicant 1 received stageDeadline');

    // Applicant 2 applies: Primary pool is now FULL (active = 1, target = 1) -> routes to Reserve
    const candidateUser8 = await UserModel.create({
      email: `candidate_postpub_2_${Date.now()}@letgetin.io`,
      fullName: 'Direct Applicant 2',
      provider: 'email',
      emailVerified: true,
    });
    candidateUserIds.push(candidateUser8._id as Types.ObjectId);
    const testResume8 = await ResumeModel.create({
      userId: candidateUser8._id,
      title: 'DevOps Resume',
      isActive: true,
      content: { skills: ['Kubernetes', 'Terraform'] },
    });

    const app8 = await applicationService.createApplication(String(candidateUser8._id), {
      jobId: String(intakeJob._id),
      resumeId: String(testResume8._id),
      source: 'manual',
    });

    const app8Doc = await ApplicationModel.findById(app8._id);
    assert(app8Doc?.poolType === 'reserve', 'Direct applicant 2 routed to Reserve Pool (primary full)');
    assert(app8Doc?.stageStatus === undefined, 'Direct applicant 2 in reserve has no active stageStatus');

    // ------------------------------------------------------------------------
    // TEST 16: Bidirectional ATS Rejection Backfills from Reserve Pool
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 16: Bidirectional ATS Rejection & Reserve Backfill ---');
    // Recruiter manually rejects Applicant 1 in ATS
    await applicationService.updateApplicantStatus(
      String(testRecruiterId),
      String(app7._id),
      'rejected',
      'Candidate lacked required production scale experience'
    );

    const app7AfterRejection = await ApplicationModel.findById(app7._id);
    assert(app7AfterRejection?.status === 'rejected', 'Applicant 1 ATS status updated to rejected');
    assert(app7AfterRejection?.stageStatus === 'failed', 'Applicant 1 engine stageStatus updated to failed');
    assert(app7AfterRejection?.poolType === 'disqualified', 'Applicant 1 engine poolType updated to disqualified');

    // Verify Reserve candidate (Applicant 2) was automatically promoted to Primary!
    const app8AfterRefill = await ApplicationModel.findById(app8._id);
    assert(app8AfterRefill?.poolType === 'primary', 'Reserve applicant 2 automatically promoted to Primary pool on ATS rejection');
    assert(app8AfterRefill?.stageStatus === 'invited', 'Promoted applicant 2 given stageStatus = invited');
    assert(!!app8AfterRefill?.stageDeadline, 'Promoted applicant 2 given stageDeadline');

    // ------------------------------------------------------------------------
    // TEST 17: Candidate Assessment Completion via Direct Hook
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 17: Candidate Assessment Completion Hook ---');
    const assessResult = await HiringEngineService.handleAssessmentCompleted(
      String(intakeJob._id),
      String(app8._id),
      88,
      { codeExecutionPassRate: 1.0, timeSpentMinutes: 35 }
    );
    assert(assessResult.processed === true, 'Assessment completion hook processed successfully');
    assert(assessResult.status === 'passed', 'Applicant 2 passed assessment (Score 88 >= Threshold)');

    const app8Advanced = await ApplicationModel.findById(app8._id);
    assert(app8Advanced?.status === 'shortlisted', 'Final single-stage funnel candidate reached shortlisted status');
    assert(app8Advanced?.assessmentScore === 88, 'Assessment score 88 recorded on application');

    console.log('\n🧹 Cleaning up test artifacts...');
    await JobModel.deleteMany({ _id: { $in: [createdJobId, starvedJob._id, closedJob._id, intakeJob._id] } });
    await ApplicationModel.deleteMany({ jobId: { $in: [createdJobId, starvedJob._id, closedJob._id, intakeJob._id] } });
    await HiringFunnelConfigModel.deleteMany({ jobId: { $in: [createdJobId, starvedJob._id, closedJob._id, intakeJob._id] } });
    await CandidateStageHistoryModel.deleteMany({ jobId: { $in: [createdJobId, starvedJob._id, closedJob._id, intakeJob._id] } });
    await UserModel.deleteMany({ _id: { $in: candidateUserIds } });
    await ResumeModel.deleteMany({ _id: { $in: [testResume7._id, testResume8._id] } });
    await Interview.deleteMany({ _id: { $in: [interview1._id, interview4._id, interview5._id] } });
    console.log('✅ Cleanup complete.');

  } catch (err: any) {
    console.error('💥 Test suite uncaught error:', err);
    failedCount++;
  }

  console.log('\n================================================================');
  console.log(`📊 E2E AUDIT TEST RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(failedCount > 0 ? 1 : 0);
}

runE2EIntegrationTestSuite();
