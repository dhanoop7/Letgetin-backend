import mongoose, { Types } from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { JobModel } from '../modules/job/job.model.js';
import { ApplicationModel } from '../modules/application/application.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { HiringFunnelConfigModel } from '../modules/hiringEngine/hiringFunnelConfig.model.js';
import { CandidateStageHistoryModel } from '../modules/hiringEngine/candidateStageHistory.model.js';
import { HiringEngineService } from '../modules/hiringEngine/services/hiringEngine.service.js';
import { HiringPoolManager } from '../modules/hiringEngine/services/hiringPoolManager.js';
import { ApplicationCollectionService } from '../modules/hiringEngine/services/applicationCollection.service.js';
import { resumeScreeningService } from '../modules/resumeScreening/resumeScreening.service.js';

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

async function runFinalShortlistTestSuite() {
  console.log('================================================================');
  console.log('🧪 LETGETIN FINAL SHORTLIST & OFFER DECISION TEST SUITE');
  console.log('================================================================\n');

  try {
    await connectDatabase();
  } catch (err: any) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  const testRecruiterId = new Types.ObjectId();
  const foreignRecruiterId = new Types.ObjectId();
  const createdJobIds: Types.ObjectId[] = [];
  const createdAppIds: Types.ObjectId[] = [];
  const createdUserIds: Types.ObjectId[] = [];

  try {
    // ------------------------------------------------------------------------
    // SETUP: Multi-Stage Job (Assessment + AI Interview)
    // ------------------------------------------------------------------------
    console.log('--- SETUP: Multi-Stage Job (Stage 1: Assessment, Stage 2: AI Interview) ---');
    const jobA = await JobModel.create({
      title: 'Senior Distributed Systems Architect - Finalist Test',
      description: 'Architect scalable cloud infrastructure and low-latency microservices.',
      company: { name: 'CloudScale Technologies' },
      skills: ['Go', 'Kubernetes', 'Distributed Systems', 'Kafka'],
      postedBy: testRecruiterId,
      status: 'active',
      finalShortlistTarget: 2,
      hiringEngineEnabled: true,
      applicationCollection: {
        idealIntake: 8,
        minimumIntake: 4,
        actualQualifiedCount: 0,
        status: 'started',
      },
    });
    createdJobIds.push(jobA._id);

    // Dynamic 2-stage config: Stage 1 = assessment, Stage 2 = ai_interview
    await HiringFunnelConfigModel.create({
      jobId: jobA._id,
      finalShortlistTarget: 2,
      totalFunnelIntakeTarget: 8,
      currentShortlistedCount: 0,
      status: 'active',
      stages: [
        {
          stageId: 'stage_tech_eval',
          stageName: 'Technical Coding Assessment',
          stageType: 'assessment',
          order: 1,
          targetCount: 4,
          deadlineHours: 48,
          expectedAttendanceRate: 1.0,
          expectedPassRate: 0.5,
          autoAdvanceScoreThreshold: 75,
          autoRefillEnabled: true,
        },
        {
          stageId: 'stage_ai_depth',
          stageName: 'AI Architectural Depth Interview',
          stageType: 'ai_interview',
          order: 2,
          targetCount: 2,
          deadlineHours: 48,
          expectedAttendanceRate: 1.0,
          expectedPassRate: 0.5,
          autoAdvanceScoreThreshold: 80,
          autoRefillEnabled: true,
        },
      ],
    });

    const user1Id = new Types.ObjectId();
    createdUserIds.push(user1Id);
    await UserModel.create({
      _id: user1Id,
      fullName: 'Devon Systems Architect',
      email: `devon_${Date.now()}@example.com`,
      role: 'user',
    });

    const app1 = await ApplicationModel.create({
      jobId: jobA._id,
      userId: user1Id,
      status: 'submitted',
      matchScore: 92,
      compositeRank: 92,
      resumeDecision: 'shortlisted',
      poolType: 'primary',
      currentStageIndex: 1,
      currentStageId: 'stage_tech_eval',
      stageStatus: 'invited',
      appliedAt: new Date(),
    });
    createdAppIds.push(app1._id);

    // ------------------------------------------------------------------------
    // TEST A: Candidate cannot appear in Final Shortlist before completing final stage
    // ------------------------------------------------------------------------
    console.log('\n--- TEST A: Candidate cannot appear in Final Shortlist before completing final stage ---');
    const initialFinalists = await HiringEngineService.getFinalShortlistCandidates(
      String(jobA._id),
      String(testRecruiterId)
    );
    assert(
      initialFinalists.candidates.length === 0,
      'Test A.1: Candidate in Stage 1 does not appear in Final Shortlist'
    );
    assert(
      initialFinalists.stats.totalFinalists === 0,
      'Test A.2: Total finalists count is 0'
    );

    // ------------------------------------------------------------------------
    // TEST M: Resume-shortlisted but not funnel-completed candidate does NOT appear
    // ------------------------------------------------------------------------
    console.log('\n--- TEST M: Resume-shortlisted candidates do NOT appear as Final Shortlisted ---');
    const userResumeOnlyId = new Types.ObjectId();
    createdUserIds.push(userResumeOnlyId);
    await UserModel.create({
      _id: userResumeOnlyId,
      fullName: 'Early Resume Applicant',
      email: `resume_only_${Date.now()}@example.com`,
      role: 'user',
    });

    const appResumeOnly = await ApplicationModel.create({
      jobId: jobA._id,
      userId: userResumeOnlyId,
      status: 'submitted',
      matchScore: 88,
      compositeRank: 88,
      resumeDecision: 'shortlisted', // Passed qualification only
      appliedAt: new Date(),
    });
    createdAppIds.push(appResumeOnly._id);

    const finalistsCheckM = await HiringEngineService.getFinalShortlistCandidates(
      String(jobA._id),
      String(testRecruiterId)
    );
    const foundResumeOnly = finalistsCheckM.candidates.some(
      (c) => c.applicationId === String(appResumeOnly._id)
    );
    assert(
      foundResumeOnly === false,
      'Test M.1: Candidate who only passed resume shortlisting is strictly excluded from Final Shortlist'
    );

    // ------------------------------------------------------------------------
    // TEST L: Non-final candidate cannot have a final decision recorded
    // ------------------------------------------------------------------------
    console.log('\n--- TEST L: Non-final candidate cannot have a final decision recorded ---');
    let nonFinalDecisionBlocked = false;
    try {
      await HiringEngineService.recordFinalDecision(
        String(jobA._id),
        String(app1._id),
        String(testRecruiterId),
        'offered'
      );
    } catch (err: any) {
      if (err.statusCode === 400 || err.message?.includes('not completed all dynamic funnel stages')) {
        nonFinalDecisionBlocked = true;
      }
    }
    assert(
      nonFinalDecisionBlocked === true,
      'Test L.1: Recording final decision on Stage 1 candidate blocked with 400 Bad Request'
    );

    // ------------------------------------------------------------------------
    // TEST B & D: Advance through Stage 1 -> Stage 2 -> Final Shortlist
    // ------------------------------------------------------------------------
    console.log('\n--- TEST B & D: Dynamic Funnel Progression (Stage 1 -> Stage 2 -> Final Shortlist) ---');
    // Pass Stage 1 (Assessment)
    const adv1 = await HiringEngineService.advanceCandidate(
      String(jobA._id),
      String(app1._id),
      String(testRecruiterId),
      { score: 88, notes: 'Passed algorithms and distributed cache design' }
    );
    assert(adv1.isFinalShortlist === false, 'Test D.1: Stage 1 pass moves to Stage 2 (not final shortlist)');
    assert(adv1.nextStageId === 'stage_ai_depth', 'Test D.2: Advanced to Stage 2 (AI Depth Interview)');

    // Pass Stage 2 (AI Interview - Final Stage)
    const adv2 = await HiringEngineService.advanceCandidate(
      String(jobA._id),
      String(app1._id),
      String(testRecruiterId),
      { score: 94, notes: 'Outstanding performance in AI Architectural Depth Interview' }
    );
    assert(adv2.isFinalShortlist === true, 'Test B.1: Completing final stage triggers isFinalShortlist: true');
    assert(adv2.nextStageId === null, 'Test B.2: No further sequential stages (nextStageId is null)');

    // Query Final Shortlist API
    const finalReport = await HiringEngineService.getFinalShortlistCandidates(
      String(jobA._id),
      String(testRecruiterId)
    );
    assert(finalReport.candidates.length === 1, 'Test B.3: Exactly 1 candidate in Final Shortlist');
    const finalist = finalReport.candidates[0];
    assert(finalist.applicationId === String(app1._id), 'Test B.4: Candidate 1 is the finalist');
    assert(finalist.candidate.fullName === 'Devon Systems Architect', 'Test B.5: Finalist user info populated');
    assert(finalist.finalShortlistDecision === 'pending', 'Test B.6: Initial final decision is "pending"');
    assert(finalist.completedStages.length === 2, 'Test B.7: Completed stages history shows both rounds');
    assert(finalist.stageScores.assessmentScore !== undefined || finalist.resumeScore === 92, 'Test B.8: Finalist scores populated');
    assert(finalReport.stats.pendingReview === 1, 'Test B.9: Stats show 1 pending review');

    // ------------------------------------------------------------------------
    // TEST F: Final shortlist target is respected
    // ------------------------------------------------------------------------
    console.log('\n--- TEST F: Final shortlist target is respected ---');
    assert(finalReport.finalShortlistTarget === 2, 'Test F.1: finalShortlistTarget is 2');
    assert(finalReport.currentShortlistedCount === 1, 'Test F.2: currentShortlistedCount incremented to 1');

    // ------------------------------------------------------------------------
    // TEST G: Final shortlist candidate can be placed on hold
    // ------------------------------------------------------------------------
    console.log('\n--- TEST G: Finalist can be placed on hold ---');
    const holdRes = await HiringEngineService.recordFinalDecision(
      String(jobA._id),
      String(app1._id),
      String(testRecruiterId),
      'on_hold',
      'Placed on hold pending compensation committee review'
    );
    assert(holdRes.decision === 'on_hold', 'Test G.1: Decision updated to "on_hold"');
    const refreshedHold = await ApplicationModel.findById(app1._id);
    assert(refreshedHold?.finalShortlistDecision === 'on_hold', 'Test G.2: DB persisted on_hold');

    const reportAfterHold = await HiringEngineService.getFinalShortlistCandidates(
      String(jobA._id),
      String(testRecruiterId)
    );
    assert(reportAfterHold.stats.onHold === 1, 'Test G.3: Stats onHold is 1');
    assert(reportAfterHold.stats.pendingReview === 0, 'Test G.4: Stats pendingReview is now 0');

    // ------------------------------------------------------------------------
    // TEST I: Finalist can be marked offered
    // ------------------------------------------------------------------------
    console.log('\n--- TEST I: Finalist can be marked offered ---');
    const offerRes = await HiringEngineService.recordFinalDecision(
      String(jobA._id),
      String(app1._id),
      String(testRecruiterId),
      'offered',
      'Formal offer extended: $190,000 base + equity'
    );
    assert(offerRes.decision === 'offered', 'Test I.1: Decision updated to "offered"');
    assert(offerRes.status === 'offered', 'Test I.2: Application status synced to "offered"');
    assert(offerRes.offeredAt !== undefined, 'Test I.3: offeredAt timestamp recorded');

    const reportAfterOffer = await HiringEngineService.getFinalShortlistCandidates(
      String(jobA._id),
      String(testRecruiterId)
    );
    assert(reportAfterOffer.stats.offersSent === 1, 'Test I.4: Stats offersSent is 1');
    assert(reportAfterOffer.stats.onHold === 0, 'Test I.5: Stats onHold is 0');

    // ------------------------------------------------------------------------
    // TEST J: Duplicate final decision is handled safely (idempotent)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST J: Duplicate final decision is handled safely ---');
    const dupOfferRes = await HiringEngineService.recordFinalDecision(
      String(jobA._id),
      String(app1._id),
      String(testRecruiterId),
      'offered',
      'Repeated offer confirmation'
    );
    assert(dupOfferRes.decision === 'offered', 'Test J.1: Duplicate decision remains "offered"');
    const countCheck = await HiringEngineService.getFinalShortlistCandidates(
      String(jobA._id),
      String(testRecruiterId)
    );
    assert(countCheck.stats.offersSent === 1, 'Test J.2: Count does not double-increment (remains 1)');

    // ------------------------------------------------------------------------
    // TEST H: Finalist can be rejected
    // ------------------------------------------------------------------------
    console.log('\n--- TEST H: Finalist can be rejected ---');
    const rejectRes = await HiringEngineService.recordFinalDecision(
      String(jobA._id),
      String(app1._id),
      String(testRecruiterId),
      'rejected',
      'Candidate declined terms or failed background check'
    );
    assert(rejectRes.decision === 'rejected', 'Test H.1: Decision updated to "rejected"');
    assert(rejectRes.status === 'rejected', 'Test H.2: Application status updated to "rejected"');
    const reportAfterReject = await HiringEngineService.getFinalShortlistCandidates(
      String(jobA._id),
      String(testRecruiterId)
    );
    assert(reportAfterReject.stats.rejected === 1, 'Test H.3: Stats rejected is 1');

    // ------------------------------------------------------------------------
    // TEST C: Dynamic Funnel with ONLY Assessment stage
    // ------------------------------------------------------------------------
    console.log('\n--- TEST C: Dynamic Funnel with ONLY Assessment stage ---');
    const jobC = await JobModel.create({
      title: 'Python Data Engineer - Assessment Only Test',
      description: 'Data pipelines and ETL transformations using Python and Spark.',
      company: { name: 'DataStream Inc' },
      skills: ['Python', 'SQL', 'Spark'],
      postedBy: testRecruiterId,
      status: 'active',
      finalShortlistTarget: 1,
      hiringEngineEnabled: true,
    });
    createdJobIds.push(jobC._id);

    await HiringFunnelConfigModel.create({
      jobId: jobC._id,
      finalShortlistTarget: 1,
      totalFunnelIntakeTarget: 2,
      currentShortlistedCount: 0,
      status: 'active',
      stages: [
        {
          stageId: 'stage_single_assessment',
          stageName: 'Data Pipeline Coding Test',
          stageType: 'assessment',
          order: 1,
          targetCount: 2,
          deadlineHours: 48,
          expectedAttendanceRate: 1.0,
          expectedPassRate: 0.5,
          autoAdvanceScoreThreshold: 70,
          autoRefillEnabled: true,
        },
      ],
    });

    const userCId = new Types.ObjectId();
    createdUserIds.push(userCId);
    await UserModel.create({
      _id: userCId,
      fullName: 'Carlos Data Engineer',
      email: `carlos_${Date.now()}@example.com`,
      role: 'user',
    });

    const appC = await ApplicationModel.create({
      jobId: jobC._id,
      userId: userCId,
      status: 'submitted',
      matchScore: 89,
      compositeRank: 89,
      resumeDecision: 'shortlisted',
      poolType: 'primary',
      currentStageIndex: 1,
      currentStageId: 'stage_single_assessment',
      stageStatus: 'invited',
      appliedAt: new Date(),
    });
    createdAppIds.push(appC._id);

    // Candidate passes the single assessment round
    const advC = await HiringEngineService.advanceCandidate(
      String(jobC._id),
      String(appC._id),
      String(testRecruiterId),
      { score: 85 }
    );
    assert(advC.isFinalShortlist === true, 'Test C.1: 1-stage funnel candidate immediately reaches Final Shortlist');
    const reportC = await HiringEngineService.getFinalShortlistCandidates(
      String(jobC._id),
      String(testRecruiterId)
    );
    assert(reportC.candidates.length === 1, 'Test C.2: Final shortlist contains candidate Carlos');

    // ------------------------------------------------------------------------
    // TEST E: Dynamic Funnel with Human Interview ONLY
    // ------------------------------------------------------------------------
    console.log('\n--- TEST E: Dynamic Funnel with Human Interview ONLY ---');
    const jobE = await JobModel.create({
      title: 'Principal Designer - Human Interview Only Test',
      description: 'Lead visual design and user research systems.',
      company: { name: 'Studio Creative' },
      skills: ['Figma', 'Design Systems', 'UX Research'],
      postedBy: testRecruiterId,
      status: 'active',
      finalShortlistTarget: 1,
      hiringEngineEnabled: true,
    });
    createdJobIds.push(jobE._id);

    await HiringFunnelConfigModel.create({
      jobId: jobE._id,
      finalShortlistTarget: 1,
      totalFunnelIntakeTarget: 3,
      currentShortlistedCount: 0,
      status: 'active',
      stages: [
        {
          stageId: 'stage_single_human',
          stageName: 'Executive Panel Portfolio Review',
          stageType: 'human_interview',
          order: 1,
          targetCount: 3,
          deadlineHours: 72,
          expectedAttendanceRate: 0.9,
          expectedPassRate: 0.5,
          autoAdvanceScoreThreshold: 80,
          autoRefillEnabled: true,
        },
      ],
    });

    const userEId = new Types.ObjectId();
    createdUserIds.push(userEId);
    await UserModel.create({
      _id: userEId,
      fullName: 'Elena Principal Designer',
      email: `elena_${Date.now()}@example.com`,
      role: 'user',
    });

    const appE = await ApplicationModel.create({
      jobId: jobE._id,
      userId: userEId,
      status: 'submitted',
      matchScore: 95,
      compositeRank: 95,
      resumeDecision: 'shortlisted',
      poolType: 'primary',
      currentStageIndex: 1,
      currentStageId: 'stage_single_human',
      stageStatus: 'invited',
      appliedAt: new Date(),
    });
    createdAppIds.push(appE._id);

    const advE = await HiringEngineService.advanceCandidate(
      String(jobE._id),
      String(appE._id),
      String(testRecruiterId),
      { score: 92, notes: 'Stunning portfolio walkthrough and typography critique' }
    );
    assert(advE.isFinalShortlist === true, 'Test E.1: Human-interview-only candidate reaches final shortlist');
    const reportE = await HiringEngineService.getFinalShortlistCandidates(
      String(jobE._id),
      String(testRecruiterId)
    );
    assert(reportE.candidates.length === 1, 'Test E.2: Elena in final shortlist for jobE');

    // ------------------------------------------------------------------------
    // TEST K: Unauthorized recruiter cannot access another organization's finalists
    // ------------------------------------------------------------------------
    console.log('\n--- TEST K: Security & Cross-Organization Recruiter Isolation ---');
    let unauthorizedViewBlocked = false;
    try {
      await HiringEngineService.getFinalShortlistCandidates(
        String(jobA._id),
        String(foreignRecruiterId)
      );
    } catch (err: any) {
      if (err.statusCode === 403 || err.message?.includes('access') || err.message?.includes('forbidden')) {
        unauthorizedViewBlocked = true;
      }
    }
    assert(
      unauthorizedViewBlocked === true,
      'Test K.1: Foreign recruiter blocked from viewing finalists with 403 Forbidden'
    );

    let unauthorizedDecisionBlocked = false;
    try {
      await HiringEngineService.recordFinalDecision(
        String(jobA._id),
        String(app1._id),
        String(foreignRecruiterId),
        'offered'
      );
    } catch (err: any) {
      if (err.statusCode === 403 || err.message?.includes('access') || err.message?.includes('forbidden')) {
        unauthorizedDecisionBlocked = true;
      }
    }
    assert(
      unauthorizedDecisionBlocked === true,
      'Test K.2: Foreign recruiter blocked from recording final decision with 403 Forbidden'
    );

  } catch (err: any) {
    console.error('Test Suite encountered an unhandled error:', err);
    failedCount++;
  } finally {
    console.log('\n🧹 Cleaning up test artifacts...');
    if (createdAppIds.length > 0) await ApplicationModel.deleteMany({ _id: { $in: createdAppIds } });
    if (createdJobIds.length > 0) {
      await JobModel.deleteMany({ _id: { $in: createdJobIds } });
      await HiringFunnelConfigModel.deleteMany({ jobId: { $in: createdJobIds } });
    }
    if (createdUserIds.length > 0) await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    console.log('✅ Cleanup complete.');
  }

  console.log('\n================================================================');
  console.log(`📊 FINAL SHORTLIST TEST RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(failedCount > 0 ? 1 : 0);
}

runFinalShortlistTestSuite();
