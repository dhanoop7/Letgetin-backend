import { HiringFunnelCalculator } from '../modules/hiringEngine/services/hiringFunnelCalculator.js';
import { HiringPoolManager } from '../modules/hiringEngine/services/hiringPoolManager.js';
import { HiringEngineService } from '../modules/hiringEngine/services/hiringEngine.service.js';
import { HiringFunnelConfigModel } from '../modules/hiringEngine/hiringFunnelConfig.model.js';
import { CandidateStageHistoryModel } from '../modules/hiringEngine/candidateStageHistory.model.js';
import { JobModel } from '../modules/job/job.model.js';
import { ApplicationModel } from '../modules/application/application.model.js';
import { jobService } from '../modules/job/job.service.js';
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

async function runDynamicRoundsTestSuite() {
  console.log('================================================================');
  console.log('🧪 LETGETIN DYNAMIC ROUNDS & STAGE ISOLATION TEST SUITE');
  console.log('================================================================\n');

  try {
    await connectDatabase();
  } catch (err: any) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  const testRecruiterId = new Types.ObjectId();
  const createdJobIds: Types.ObjectId[] = [];
  const createdAppIds: Types.ObjectId[] = [];

  try {
    // ------------------------------------------------------------------------
    // TEST A: Final = 10, Rounds = Assessment only -> No AI Interview stage
    // ------------------------------------------------------------------------
    console.log('\n--- TEST A: Final = 10, Rounds = Assessment only -> No AI Interview stage ---');
    const jobA = await jobService.createRecruiterJob(String(testRecruiterId), {
      title: 'Backend Engineer - Assessment Only',
      companyName: 'LetGetIn Labs',
      description: 'Assessment only hiring pipeline',
      skills: ['TypeScript', 'Node.js'],
      finalShortlistTarget: 10,
      rounds: ['assessment'],
    });
    createdJobIds.push(jobA._id);

    const configA = await HiringFunnelConfigModel.findOne({ jobId: jobA._id }).lean();
    assert(!!configA, 'Test A: HiringFunnelConfig created for job');
    assert(configA?.stages.length === 1, 'Test A: Funnel contains strictly 1 stage (Assessment only)', `Expected 1 stage, got ${configA?.stages.length}`);
    assert(configA?.stages[0].stageType === 'assessment', 'Test A: Stage 1 is assessment');
    assert(configA?.stages[0].stageId === 'stage_assessment', 'Test A: Stage 1 stageId is stage_assessment');
    
    // Strict isolation: AI Interview must NOT exist
    const hasAiInterviewA = configA?.stages.some((s) => s.stageType === 'ai_interview' || s.stageId.includes('ai_interview'));
    assert(!hasAiInterviewA, 'Test A: AI Interview stage does NOT exist in stages');

    // Funnel calculations: 10 / 0.6 = 16.66 -> ceil = 17
    assert(configA?.stages[0].targetCount === 17, 'Test A: Assessment targetCount is 17 (ceil(10 / 0.6))', `Got ${configA?.stages[0].targetCount}`);
    assert(configA?.totalFunnelIntakeTarget === 17, 'Test A: totalFunnelIntakeTarget is 17', `Got ${configA?.totalFunnelIntakeTarget}`);

    // Create candidate application and partition into Stage 1
    const candAUserId = new Types.ObjectId();
    const appA = await ApplicationModel.create({
      jobId: jobA._id,
      userId: candAUserId,
      matchScore: 85,
      compositeRank: 85,
      status: 'submitted',
      appliedAt: new Date(),
    });
    createdAppIds.push(appA._id);

    await HiringPoolManager.partitionInitialPool(jobA._id, configA!.stages[0].stageId, configA!.stages[0].targetCount, configA!.stages[0].deadlineHours);
    const refreshedAppA = await ApplicationModel.findById(appA._id);
    assert(refreshedAppA?.currentStageId === 'stage_assessment', 'Test A: Candidate invited to stage_assessment');
    assert(refreshedAppA?.currentStageIndex === 1, 'Test A: Candidate stage index is 1');

    // Candidate passes Assessment -> should advance directly to final shortlist
    const advA = await HiringEngineService.advanceCandidate(String(jobA._id), String(appA._id), 'system', {
      score: 90,
      notes: 'Passed assessment with distinction',
    });
    assert(advA.isFinalShortlist === true, 'Test A: Candidate directly reaches final shortlist after Assessment');
    assert(advA.nextStageId === null, 'Test A: nextStageId is null (no further stages)');
    assert(advA.application.status === 'shortlisted', 'Test A: Candidate status is shortlisted');
    assert(advA.application.stageStatus === 'passed', 'Test A: Candidate stageStatus is passed');

    // ------------------------------------------------------------------------
    // TEST B: Final = 10, Rounds = Assessment + AI Interview -> Both stages
    // ------------------------------------------------------------------------
    console.log('\n--- TEST B: Final = 10, Rounds = Assessment + AI Interview -> Both stages ---');
    const jobB = await jobService.createRecruiterJob(String(testRecruiterId), {
      title: 'Fullstack Engineer - Assessment + AI Interview',
      companyName: 'LetGetIn Labs',
      description: 'Two round pipeline',
      skills: ['React', 'Node.js'],
      finalShortlistTarget: 10,
      rounds: ['assessment', 'ai_interview'],
    });
    createdJobIds.push(jobB._id);

    const configB = await HiringFunnelConfigModel.findOne({ jobId: jobB._id }).lean();
    assert(!!configB, 'Test B: HiringFunnelConfig created for job');
    assert(configB?.stages.length === 2, 'Test B: Funnel contains exactly 2 stages', `Expected 2, got ${configB?.stages.length}`);
    assert(configB?.stages[0].stageType === 'assessment', 'Test B: Stage 1 is assessment');
    assert(configB?.stages[1].stageType === 'ai_interview', 'Test B: Stage 2 is ai_interview');

    // Backward pass targets:
    // Stage 2 (AI Interview, eff=0.5): ceil(10 / 0.5) = 20
    // Stage 1 (Assessment, eff=0.6): ceil(20 / 0.6) = 34
    assert(configB?.stages[1].targetCount === 20, 'Test B: AI Interview targetCount is 20 (ceil(10 / 0.5))', `Got ${configB?.stages[1].targetCount}`);
    assert(configB?.stages[0].targetCount === 34, 'Test B: Assessment targetCount is 34 (ceil(20 / 0.6))', `Got ${configB?.stages[0].targetCount}`);
    assert(configB?.totalFunnelIntakeTarget === 34, 'Test B: totalFunnelIntakeTarget is 34', `Got ${configB?.totalFunnelIntakeTarget}`);

    // Create candidate application and advance through both stages
    const candBUserId = new Types.ObjectId();
    const appB = await ApplicationModel.create({
      jobId: jobB._id,
      userId: candBUserId,
      matchScore: 88,
      compositeRank: 88,
      status: 'submitted',
      appliedAt: new Date(),
    });
    createdAppIds.push(appB._id);

    await HiringPoolManager.partitionInitialPool(jobB._id, configB!.stages[0].stageId, configB!.stages[0].targetCount, configB!.stages[0].deadlineHours);
    const refreshedAppB = await ApplicationModel.findById(appB._id);
    assert(refreshedAppB?.currentStageId === 'stage_assessment', 'Test B: Candidate starts in stage_assessment');

    // Pass Stage 1 (Assessment) -> moves to Stage 2 (AI Interview)
    const advB1 = await HiringEngineService.advanceCandidate(String(jobB._id), String(appB._id), 'system', { score: 85 });
    assert(advB1.isFinalShortlist === false, 'Test B: Candidate not yet at final shortlist after Stage 1');
    assert(advB1.nextStageId === 'stage_ai_interview', 'Test B: Candidate advanced to stage_ai_interview');
    assert(advB1.application.currentStageIndex === 2, 'Test B: Candidate currentStageIndex is 2');
    assert(advB1.application.status === 'interviewing', 'Test B: Candidate status updated to interviewing');

    // Pass Stage 2 (AI Interview) -> reaches final shortlist
    const advB2 = await HiringEngineService.advanceCandidate(String(jobB._id), String(appB._id), 'system', { score: 92 });
    assert(advB2.isFinalShortlist === true, 'Test B: Candidate reaches final shortlist after Stage 2');
    assert(advB2.application.status === 'shortlisted', 'Test B: Candidate status is shortlisted');

    // ------------------------------------------------------------------------
    // TEST C: Final = 10, Rounds = Human Interview only -> No Assessment/AI Interview
    // ------------------------------------------------------------------------
    console.log('\n--- TEST C: Final = 10, Rounds = Human Interview only -> No Assessment/AI Interview ---');
    const jobC = await jobService.createRecruiterJob(String(testRecruiterId), {
      title: 'Design Lead - Human Interview Only',
      companyName: 'LetGetIn Labs',
      description: 'Direct human interview pipeline',
      skills: ['Figma', 'UI/UX'],
      finalShortlistTarget: 10,
      rounds: ['human_interview'],
    });
    createdJobIds.push(jobC._id);

    const configC = await HiringFunnelConfigModel.findOne({ jobId: jobC._id }).lean();
    assert(!!configC, 'Test C: HiringFunnelConfig created for job');
    assert(configC?.stages.length === 1, 'Test C: Funnel contains strictly 1 stage', `Expected 1, got ${configC?.stages.length}`);
    assert(configC?.stages[0].stageType === 'human_interview', 'Test C: Stage 1 is human_interview');

    // Strict isolation: Assessment and AI Interview must NOT exist
    const hasAssessmentC = configC?.stages.some((s) => s.stageType === 'assessment');
    const hasAiInterviewC = configC?.stages.some((s) => s.stageType === 'ai_interview');
    assert(!hasAssessmentC, 'Test C: Assessment stage does NOT exist in stages');
    assert(!hasAiInterviewC, 'Test C: AI Interview stage does NOT exist in stages');

    // Calculation: attendance=0.9, pass=0.5 -> eff=0.45. ceil(10 / 0.45) = 23
    assert(configC?.stages[0].targetCount === 23, 'Test C: Human Interview targetCount is 23 (ceil(10 / 0.45))', `Got ${configC?.stages[0].targetCount}`);
    assert(configC?.totalFunnelIntakeTarget === 23, 'Test C: totalFunnelIntakeTarget is 23', `Got ${configC?.totalFunnelIntakeTarget}`);

    // Create candidate application and advance
    const candCUserId = new Types.ObjectId();
    const appC = await ApplicationModel.create({
      jobId: jobC._id,
      userId: candCUserId,
      matchScore: 90,
      compositeRank: 90,
      status: 'submitted',
      appliedAt: new Date(),
    });
    createdAppIds.push(appC._id);

    await HiringPoolManager.partitionInitialPool(jobC._id, configC!.stages[0].stageId, configC!.stages[0].targetCount, configC!.stages[0].deadlineHours);
    const refreshedAppC = await ApplicationModel.findById(appC._id);
    assert(refreshedAppC?.currentStageId === 'stage_human_interview', 'Test C: Candidate invited to stage_human_interview');

    // Candidate passes Human Interview -> reaches final shortlist directly
    const advC = await HiringEngineService.advanceCandidate(String(jobC._id), String(appC._id), 'system', { score: 95 });
    assert(advC.isFinalShortlist === true, 'Test C: Candidate directly reaches final shortlist after Human Interview');
    assert(advC.nextStageId === null, 'Test C: nextStageId is null (no assessment or AI interview)');
    assert(advC.application.status === 'shortlisted', 'Test C: Candidate status is shortlisted');

    // ------------------------------------------------------------------------
    // TEST D: Different round order -> Funnel follows recruiter-selected order
    // ------------------------------------------------------------------------
    console.log('\n--- TEST D: Different round order -> Funnel follows recruiter-selected order ---');
    // Order: AI Interview FIRST, then Assessment SECOND
    const jobD = await jobService.createRecruiterJob(String(testRecruiterId), {
      title: 'DevOps Lead - AI Interview first then Assessment',
      companyName: 'LetGetIn Labs',
      description: 'Reverse round order',
      skills: ['Kubernetes', 'Docker'],
      finalShortlistTarget: 10,
      rounds: ['ai_interview', 'assessment'],
    });
    createdJobIds.push(jobD._id);

    const configD = await HiringFunnelConfigModel.findOne({ jobId: jobD._id }).lean();
    assert(!!configD, 'Test D: HiringFunnelConfig created for job');
    assert(configD?.stages.length === 2, 'Test D: Funnel contains 2 stages');
    assert(configD?.stages[0].stageType === 'ai_interview', 'Test D: Stage 1 is AI Interview (recruiter specified order 1)');
    assert(configD?.stages[0].order === 1, 'Test D: Stage 1 order is 1');
    assert(configD?.stages[1].stageType === 'assessment', 'Test D: Stage 2 is Assessment (recruiter specified order 2)');
    assert(configD?.stages[1].order === 2, 'Test D: Stage 2 order is 2');

    // Backward calculation follows the custom order:
    // Last stage (Stage 2, Assessment, eff=0.6): ceil(10 / 0.6) = 17
    // First stage (Stage 1, AI Interview, eff=0.5): ceil(17 / 0.5) = 34
    assert(configD?.stages[1].targetCount === 17, 'Test D: Assessment targetCount is 17 (last stage)', `Got ${configD?.stages[1].targetCount}`);
    assert(configD?.stages[0].targetCount === 34, 'Test D: AI Interview targetCount is 34 (first stage)', `Got ${configD?.stages[0].targetCount}`);
    assert(configD?.totalFunnelIntakeTarget === 34, 'Test D: totalFunnelIntakeTarget is 34', `Got ${configD?.totalFunnelIntakeTarget}`);

    // Create candidate application and verify transition order
    const candDUserId = new Types.ObjectId();
    const appD = await ApplicationModel.create({
      jobId: jobD._id,
      userId: candDUserId,
      matchScore: 92,
      compositeRank: 92,
      status: 'submitted',
      appliedAt: new Date(),
    });
    createdAppIds.push(appD._id);

    await HiringPoolManager.partitionInitialPool(jobD._id, configD!.stages[0].stageId, configD!.stages[0].targetCount, configD!.stages[0].deadlineHours);
    const refreshedAppD = await ApplicationModel.findById(appD._id);
    assert(refreshedAppD?.currentStageId === 'stage_ai_interview', 'Test D: Candidate starts in stage_ai_interview (Stage 1)');
    assert(refreshedAppD?.currentStageIndex === 1, 'Test D: Candidate currentStageIndex is 1');

    // Advance candidate from Stage 1 (AI Interview) -> moves to Stage 2 (Assessment)
    const advD1 = await HiringEngineService.advanceCandidate(String(jobD._id), String(appD._id), 'system', { score: 88 });
    assert(advD1.isFinalShortlist === false, 'Test D: Candidate not at final shortlist after Stage 1');
    assert(advD1.nextStageId === 'stage_assessment', 'Test D: Candidate advanced to stage_assessment (Stage 2)');
    assert(advD1.application.currentStageIndex === 2, 'Test D: Candidate currentStageIndex is 2');
    assert(advD1.application.status === 'reviewing', 'Test D: Candidate status updated to reviewing');

    // Advance candidate from Stage 2 (Assessment) -> reaches final shortlist
    const advD2 = await HiringEngineService.advanceCandidate(String(jobD._id), String(appD._id), 'system', { score: 94 });
    assert(advD2.isFinalShortlist === true, 'Test D: Candidate reaches final shortlist after Assessment');
    assert(advD2.application.status === 'shortlisted', 'Test D: Candidate status is shortlisted');

    // ------------------------------------------------------------------------
    // TEST E: Unselected round -> Never appears in calculation, targets, invitations, transitions, UI
    // ------------------------------------------------------------------------
    console.log('\n--- TEST E: Unselected round strict isolation verification ---');
    // For jobA (Assessment only), verify that AI Interview and Human Interview NEVER appear anywhere
    
    // 1. Funnel calculation
    const unselectedInCalculation = configA?.stages.filter((s) => s.stageType === 'ai_interview' || s.stageType === 'human_interview');
    assert(unselectedInCalculation?.length === 0, 'Test E.1: Unselected rounds NEVER appear in funnel calculation stages');

    // 2. Target counts
    const unselectedTargets = configA?.stages.filter((s) => s.stageType !== 'assessment');
    assert(unselectedTargets?.length === 0, 'Test E.2: Target counts calculated ONLY for selected stage (no target count for unselected rounds)');

    // 3. Invitations
    const allStageHistoryA = await CandidateStageHistoryModel.find({ jobId: jobA._id }).lean();
    const invitationsForUnselected = allStageHistoryA.filter((h) => h.stageId.includes('ai_interview') || h.stageId.includes('human_interview'));
    assert(invitationsForUnselected.length === 0, 'Test E.3: ZERO invitations issued for unselected rounds');

    // 4. Candidate transitions
    const transitionsForUnselected = allStageHistoryA.filter((h) => h.stageName.includes('AI') || h.stageName.includes('Human'));
    assert(transitionsForUnselected.length === 0, 'Test E.4: Candidate transitions NEVER touch unselected rounds');

    // 5. Candidate UI / stage history
    const candidateAHistory = await HiringEngineService.getCandidateStageHistory(String(jobA._id), String(appA._id), String(testRecruiterId));
    const uiStagesForCandidateA = candidateAHistory.map((h) => h.stageId);
    const unselectedInHistory = uiStagesForCandidateA.filter((id) => id !== 'stage_assessment');
    assert(unselectedInHistory.length === 0, 'Test E.5: Candidate history/UI strictly contains ONLY selected stages (stage_assessment)');
    assert(refreshedAppA?.currentStageId !== 'stage_ai_interview', 'Test E.5: Candidate currentStageId is never an unselected round');

  } catch (error: any) {
    console.error('💥 Test suite crashed with unhandled error:', error);
    failedCount++;
  } finally {
    // ------------------------------------------------------------------------
    // Clean up test data
    // ------------------------------------------------------------------------
    console.log('\n🧹 Cleaning up test artifacts...');
    if (createdJobIds.length > 0) {
      await JobModel.deleteMany({ _id: { $in: createdJobIds } });
      await HiringFunnelConfigModel.deleteMany({ jobId: { $in: createdJobIds } });
      await CandidateStageHistoryModel.deleteMany({ jobId: { $in: createdJobIds } });
    }
    if (createdAppIds.length > 0) {
      await ApplicationModel.deleteMany({ _id: { $in: createdAppIds } });
    }
    console.log('✅ Cleanup complete.');
  }

  console.log('\n================================================================');
  console.log(`📊 DYNAMIC ROUNDS TEST RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runDynamicRoundsTestSuite();
