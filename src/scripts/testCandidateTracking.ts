import mongoose, { Types } from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { JobModel } from '../modules/job/job.model.js';
import { ApplicationModel } from '../modules/application/application.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { HiringFunnelConfigModel } from '../modules/hiringEngine/hiringFunnelConfig.model.js';
import { CandidateStageHistoryModel } from '../modules/hiringEngine/candidateStageHistory.model.js';
import { applicationService } from '../modules/application/application.service.js';

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

async function runCandidateTrackingTestSuite() {
  console.log('================================================================');
  console.log('🧪 LETGETIN CANDIDATE TRACKING & DYNAMIC TIMELINE TEST SUITE');
  console.log('================================================================\n');

  try {
    await connectDatabase();
  } catch (err: any) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  const testRecruiterId = new Types.ObjectId();
  const candidateAId = new Types.ObjectId();
  const candidateBId = new Types.ObjectId();
  const createdJobIds: Types.ObjectId[] = [];
  const createdAppIds: Types.ObjectId[] = [];
  const createdUserIds: Types.ObjectId[] = [candidateAId, candidateBId];

  try {
    // ------------------------------------------------------------------------
    // SETUP: Users & Multi-Stage Job
    // ------------------------------------------------------------------------
    console.log('--- SETUP: Candidate Accounts & Dynamic Funnel Job ---');
    await UserModel.create([
      {
        _id: candidateAId,
        email: `candidate_a_${Date.now()}@example.com`,
        passwordHash: 'dummyhash',
        fullName: 'Alice Candidate',
        role: 'user',
      },
      {
        _id: candidateBId,
        email: `candidate_b_${Date.now()}@example.com`,
        passwordHash: 'dummyhash',
        fullName: 'Bob Candidate',
        role: 'user',
      },
    ]);

    const testJob = await JobModel.create({
      title: 'Senior Frontend Engineer - Tracking Test',
      description: 'Build modern UI architectures with Next.js and Tailwind.',
      company: { name: 'Acme Frontend Corp' },
      skills: ['TypeScript', 'React', 'Next.js'],
      postedBy: testRecruiterId,
      status: 'active',
      hiringEngineEnabled: true,
      applicationCollection: {
        idealIntake: 6,
        minimumIntake: 3,
        status: 'collecting',
        currentDeadline: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    createdJobIds.push(testJob._id);

    // Create 3-stage dynamic funnel configuration
    const stage1Id = 'stage_coding_101';
    const stage2Id = 'stage_sysdesign_102';
    const stage3Id = 'stage_execinterview_103';

    await HiringFunnelConfigModel.create({
      jobId: testJob._id,
      finalShortlistTarget: 1,
      totalFunnelIntakeTarget: 6,
      status: 'active',
      currentShortlistedCount: 1,
      lastCalculatedAt: new Date(),
      stages: [
        {
          stageId: stage1Id,
          stageName: 'Technical Coding Assessment',
          stageType: 'assessment',
          order: 1,
          deadlineHours: 48,
          targetCount: 4,
          expectedAttendanceRate: 0.8,
          expectedPassRate: 0.5,
          autoAdvanceScoreThreshold: 70,
          autoRefillEnabled: true,
        },
        {
          stageId: stage2Id,
          stageName: 'System Architecture Interview',
          stageType: 'ai_interview',
          order: 2,
          deadlineHours: 72,
          targetCount: 2,
          expectedAttendanceRate: 0.8,
          expectedPassRate: 0.5,
          autoAdvanceScoreThreshold: 70,
          autoRefillEnabled: true,
        },
        {
          stageId: stage3Id,
          stageName: 'Executive Cultural Fit',
          stageType: 'manual_review',
          order: 3,
          deadlineHours: 24,
          targetCount: 1,
          expectedAttendanceRate: 0.9,
          expectedPassRate: 0.5,
          autoAdvanceScoreThreshold: 70,
          autoRefillEnabled: true,
        },
      ],
    });

    // Create candidate A application
    const appA = await ApplicationModel.create({
      userId: candidateAId,
      jobId: testJob._id,
      status: 'submitted',
      source: 'manual',
      appliedAt: new Date(),
      resumeScreeningStatus: 'ai_reviewed',
      resumeDecision: 'shortlisted',
      poolType: 'primary',
      currentStageIndex: 0,
      currentStageId: stage1Id,
      stageStatus: 'invited',
      stageDeadline: new Date(Date.now() + 48 * 3600 * 1000),
      invitedAt: new Date(),
      compositeRank: 1, // sensitive internal score
    });
    createdAppIds.push(appA._id);

    // Create stage history for candidate A
    await CandidateStageHistoryModel.create({
      applicationId: appA._id,
      jobId: testJob._id,
      candidateId: candidateAId,
      stageId: stage1Id,
      stageName: 'Technical Coding Assessment',
      stageIndex: 0,
      status: 'invited',
      enteredAt: new Date(),
    });

    // ------------------------------------------------------------------------
    // TEST 1: Enriched getUserApplications includes authoritative fields
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 1: Candidate Application List Contains Authoritative Funnel Fields ---');
    const userAppsResult = await applicationService.getUserApplications(candidateAId.toString(), {});
    assert(userAppsResult.applications.length === 1, 'Candidate A has 1 application in list');

    const appSummary = userAppsResult.applications[0];
    assert(appSummary._id === String(appA._id), 'Application ID matches');
    assert(appSummary.resumeDecision === 'shortlisted', 'resumeDecision field is exposed in list');
    assert(appSummary.poolType === 'primary', 'poolType is exposed in list');
    assert(appSummary.currentStageIndex === 0, 'currentStageIndex is exposed in list');
    assert(appSummary.stageStatus === 'invited', 'stageStatus is exposed in list');
    assert(!!appSummary.stageDeadline, 'stageDeadline is present in list');

    // ------------------------------------------------------------------------
    // TEST 2: Ownership Security & Isolation
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 2: Ownership Security & Unauthorized Access Checks ---');
    let forbiddenError = false;
    try {
      await applicationService.getApplicationTracking(candidateBId.toString(), appA._id.toString());
    } catch (err: any) {
      if (err.statusCode === 403 || err.message.toLowerCase().includes('permission')) {
        forbiddenError = true;
      }
    }
    assert(forbiddenError, 'Candidate B cannot access Candidate A tracking (403 Forbidden)');

    let notFoundError = false;
    try {
      await applicationService.getApplicationTracking(candidateAId.toString(), new Types.ObjectId().toString());
    } catch (err: any) {
      if (err.statusCode === 404 || err.message.toLowerCase().includes('not found')) {
        notFoundError = true;
      }
    }
    assert(notFoundError, 'Non-existent application throws 404 Not Found');

    // ------------------------------------------------------------------------
    // TEST 3: Dynamic Tracking Payload & Sanitization
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 3: Candidate Tracking Payload Sanitization & Dynamic Stages ---');
    const trackingData = await applicationService.getApplicationTracking(candidateAId.toString(), appA._id.toString());

    assert(!!trackingData.application, 'Tracking payload contains application object');
    assert(!!trackingData.funnelStages, 'Tracking payload contains funnelStages array');
    assert(trackingData.funnelStages.length === 3, 'All 3 dynamic job stages are returned');
    assert(trackingData.funnelStages[0].stageName === 'Technical Coding Assessment', 'Stage 1 name is accurate');
    assert(trackingData.funnelStages[1].stageName === 'System Architecture Interview', 'Stage 2 name is accurate');
    assert(trackingData.funnelStages[2].stageName === 'Executive Cultural Fit', 'Stage 3 name is accurate');

    // Verify sensitive data is NOT leaked
    assert((trackingData.application as any).compositeRank === undefined, 'compositeRank is not leaked to candidate');
    assert((trackingData.funnelStages[0] as any).targetCount === undefined, 'Recruiter targetCount is not leaked to candidate');
    assert((trackingData.funnelStages[0] as any).reserveCount === undefined, 'Recruiter reserveCount is not leaked to candidate');

    // Verify stage history
    assert(trackingData.stageHistory.length === 1, 'Stage history contains 1 entry');
    assert(trackingData.stageHistory[0].stageId === stage1Id, 'Stage history entry matches stage 1');
    assert(trackingData.stageHistory[0].status === 'invited', 'Stage history status is invited');

    // ------------------------------------------------------------------------
    // TEST 4: Reserve Pool (Standby) State
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 4: Reserve Pool (Standby) Candidate State ---');
    const appReserve = await ApplicationModel.create({
      userId: candidateBId,
      jobId: testJob._id,
      status: 'submitted',
      source: 'manual',
      appliedAt: new Date(),
      resumeScreeningStatus: 'ai_reviewed',
      resumeDecision: 'shortlisted',
      poolType: 'reserve',
      currentStageIndex: 0,
      currentStageId: stage1Id,
    });
    createdAppIds.push(appReserve._id);

    const reserveTracking = await applicationService.getApplicationTracking(candidateBId.toString(), appReserve._id.toString());
    assert(reserveTracking.application.poolType === 'reserve', 'Reserve candidate has poolType = reserve');
    assert(reserveTracking.application.resumeDecision === 'shortlisted', 'Reserve candidate has resumeDecision = shortlisted');

    // ------------------------------------------------------------------------
    // TEST 5: Progression to Final Shortlist, Offer & Hired
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 5: Progression to Final Shortlist, Offer & Hired ---');
    // Progress Candidate A to final shortlist & offer
    await ApplicationModel.findByIdAndUpdate(appA._id, {
      currentStageIndex: 2,
      currentStageId: stage3Id,
      stageStatus: 'passed',
      status: 'offered',
      finalShortlistDecision: 'offered',
      offeredAt: new Date(),
    });

    await CandidateStageHistoryModel.create([
      {
        applicationId: appA._id,
        jobId: testJob._id,
        candidateId: candidateAId,
        stageId: stage1Id,
        stageName: 'Technical Coding Assessment',
        stageIndex: 0,
        status: 'passed',
        enteredAt: new Date(Date.now() - 3600000),
        completedAt: new Date(Date.now() - 1800000),
      },
      {
        applicationId: appA._id,
        jobId: testJob._id,
        candidateId: candidateAId,
        stageId: stage2Id,
        stageName: 'System Architecture Interview',
        stageIndex: 1,
        status: 'passed',
        enteredAt: new Date(Date.now() - 1800000),
        completedAt: new Date(),
      },
    ]);

    const finalTracking = await applicationService.getApplicationTracking(candidateAId.toString(), appA._id.toString());
    assert(finalTracking.application.finalShortlistDecision === 'offered', 'Candidate has finalShortlistDecision = offered');
    assert(!!finalTracking.application.offeredAt, 'Candidate has offeredAt timestamp');
    assert(finalTracking.stageHistory.length >= 2, 'Candidate has multiple stage history entries');

    // Candidate Hired
    await ApplicationModel.findByIdAndUpdate(appA._id, {
      finalShortlistDecision: 'hired',
      hiredAt: new Date(),
    });

    const hiredTracking = await applicationService.getApplicationTracking(candidateAId.toString(), appA._id.toString());
    assert(hiredTracking.application.finalShortlistDecision === 'hired', 'Candidate application finalShortlistDecision is hired');
    assert(!!hiredTracking.application.hiredAt, 'Candidate has hiredAt timestamp');

    console.log('\n================================================================');
    console.log(`Candidate Tracking Test Results: ${passedCount} passed, ${failedCount} failed`);
    console.log('================================================================\n');

  } finally {
    // Cleanup created test records
    console.log('🧹 Cleaning up test database records...');
    if (createdAppIds.length > 0) {
      await ApplicationModel.deleteMany({ _id: { $in: createdAppIds } });
      await CandidateStageHistoryModel.deleteMany({ applicationId: { $in: createdAppIds } });
    }
    if (createdJobIds.length > 0) {
      await JobModel.deleteMany({ _id: { $in: createdJobIds } });
      await HiringFunnelConfigModel.deleteMany({ jobId: { $in: createdJobIds } });
    }
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    }
    await mongoose.disconnect();
    console.log('Database disconnected. Tests finished.');
  }

  if (failedCount > 0) {
    process.exit(1);
  }
}

runCandidateTrackingTestSuite().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
