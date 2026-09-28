import { HiringFunnelCalculator, StageCalculationInput } from '../modules/hiringEngine/services/hiringFunnelCalculator.js';
import { ApplicationCollectionService } from '../modules/hiringEngine/services/applicationCollection.service.js';
import { HiringPoolManager } from '../modules/hiringEngine/services/hiringPoolManager.js';
import { HiringEngineService } from '../modules/hiringEngine/services/hiringEngine.service.js';
import { HiringFunnelConfigModel } from '../modules/hiringEngine/hiringFunnelConfig.model.js';
import { CandidateStageHistoryModel } from '../modules/hiringEngine/candidateStageHistory.model.js';
import { JobModel } from '../modules/job/job.model.js';
import { ApplicationModel } from '../modules/application/application.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
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

async function runAdaptiveFunnelTestSuite() {
  console.log('================================================================');
  console.log('🧪 LETGETIN ADAPTIVE HIRING FUNNEL TEST SUITE (18 SCENARIOS)');
  console.log('================================================================\n');

  try {
    await connectDatabase();
  } catch (err: any) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  const createdJobIds: Types.ObjectId[] = [];
  const createdUserIds: Types.ObjectId[] = [];
  const createdResumeIds: Types.ObjectId[] = [];

  const defaultStages: StageCalculationInput[] = [
    {
      stageId: 'stage_resume',
      stageName: 'Resume Match',
      stageType: 'resume_match',
      order: 1,
      expectedAttendanceRate: 1.0,
      expectedPassRate: 0.8,
      deadlineHours: 24,
      autoAdvanceScoreThreshold: 70,
    },
    {
      stageId: 'stage_assessment',
      stageName: 'Technical Assessment',
      stageType: 'assessment',
      order: 2,
      expectedAttendanceRate: 0.9,
      expectedPassRate: 0.6,
      deadlineHours: 48,
      autoAdvanceScoreThreshold: 75,
    },
    {
      stageId: 'stage_interview',
      stageName: 'AI Interview',
      stageType: 'ai_interview',
      order: 3,
      expectedAttendanceRate: 0.9,
      expectedPassRate: 0.5,
      deadlineHours: 48,
      autoAdvanceScoreThreshold: 80,
    },
  ];

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Final=10, Ideal=15, Min=8, Qualified=3 -> Pipeline does NOT start
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 1: Insufficient candidates below minimum intake ---');
    const res1 = HiringFunnelCalculator.calculateAdaptiveFunnel(3, 10, defaultStages, 8);
    assert(res1.canProceed === false, 'Test 1: canProceed is false when qualified (3) < min (8)');
    assert(res1.health === 'starved', 'Test 1: health is starved');
    assert(res1.finalShortlistTarget === 10, 'Test 1: final target remains 10 (not reduced)');

    // ------------------------------------------------------------------------
    // TEST 2: Final=10, Ideal=15, Min=8, Qualified=8 -> Pipeline can start
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 2: Qualified candidates exactly equal minimum intake ---');
    const res2 = HiringFunnelCalculator.calculateAdaptiveFunnel(8, 10, defaultStages, 8);
    assert(res2.canProceed === true, 'Test 2: canProceed is true when qualified (8) >= min (8)');
    assert(res2.health === 'constrained', 'Test 2: health is constrained (8 < ideal)');
    assert(res2.finalShortlistTarget === 10, 'Test 2: final target remains 10');

    // ------------------------------------------------------------------------
    // TEST 3: Final=10, Ideal=15, Min=8, Qualified=11 -> Pipeline starts with 11 candidates, operational funnel recalculated
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 3: Qualified candidates between minimum and ideal ---');
    const res3 = HiringFunnelCalculator.calculateAdaptiveFunnel(11, 10, defaultStages, 8);
    assert(res3.canProceed === true, 'Test 3: canProceed is true with 11 candidates');
    assert(res3.health === 'constrained', 'Test 3: health is constrained');
    assert(res3.operationalFunnelIntakeTarget === 11, 'Test 3: operational funnel intake target is 11');
    assert(res3.stages[0].targetCount === 11, 'Test 3: stage 1 operational target recalculated to 11');
    assert(res3.idealFunnelIntakeTarget > 11, 'Test 3: ideal funnel intake target remains higher');

    // ------------------------------------------------------------------------
    // TEST 4: Qualified=15 (Ideal=15) -> Normal ideal funnel used (healthy)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 4: Ideal candidate volume reached (Healthy) ---');
    const idealIntake4 = HiringFunnelCalculator.calculateFunnel(10, defaultStages).totalFunnelIntakeTarget;
    const res4 = HiringFunnelCalculator.calculateAdaptiveFunnel(idealIntake4, 10, defaultStages, 8);
    assert(res4.canProceed === true, 'Test 4: canProceed is true');
    assert(res4.health === 'healthy', 'Test 4: health is healthy when qualified >= ideal');
    assert(res4.operationalFunnelIntakeTarget === res4.idealFunnelIntakeTarget, 'Test 4: operational intake matches ideal intake');

    // ------------------------------------------------------------------------
    // TEST 5: Qualified=3, Deadline reached, Auto extension enabled -> Deadline extended
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 5: Auto-extension when deadline arrives below minimum ---');
    const recruiter5 = new Types.ObjectId();
    const job5 = await JobModel.create({
      title: 'Senior Backend Engineer T5',
      company: { name: 'LetGetIn Labs' },
      description: 'Node.js and MongoDB test job',
      skills: ['Node.js', 'MongoDB'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      postedBy: recruiter5,
      finalShortlistTarget: 10,
      applicationCollection: {
        idealIntake: 15,
        minimumIntake: 8,
        actualQualifiedCount: 3,
        initialDeadline: new Date(Date.now() - 3600000), // 1 hour in the past
        currentDeadline: new Date(Date.now() - 3600000),
        autoExtensionEnabled: true,
        extensionDurationDays: 3,
        maxExtensions: 2,
        extensionsUsed: 0,
        autoStartEnabled: false,
        status: 'collecting',
      },
    });
    createdJobIds.push(job5._id as Types.ObjectId);

    const deadlineResult5 = await ApplicationCollectionService.processCollectionDeadlineJob(String(job5._id));
    assert(deadlineResult5.action === 'extended', 'Test 5: Deadline action is extended');
    const job5After = await JobModel.findById(job5._id);
    assert(job5After?.applicationCollection?.status === 'extended', 'Test 5: Collection status updated to extended');
    assert(job5After?.applicationCollection?.extensionsUsed === 1, 'Test 5: extensionsUsed incremented to 1');
    assert(
      new Date(job5After!.applicationCollection!.currentDeadline!).getTime() > Date.now(),
      'Test 5: currentDeadline extended into future'
    );

    // ------------------------------------------------------------------------
    // TEST 6: Qualified=3, Deadline reached, Max extensions reached -> Status=insufficient, health=starved
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 6: Deadline reached and max extensions exhausted ---');
    const job6 = await JobModel.create({
      title: 'Senior Backend Engineer T6',
      company: { name: 'LetGetIn Labs' },
      description: 'Node.js test job exhausted extensions',
      skills: ['Node.js'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      postedBy: recruiter5,
      finalShortlistTarget: 10,
      applicationCollection: {
        idealIntake: 15,
        minimumIntake: 8,
        actualQualifiedCount: 3,
        initialDeadline: new Date(Date.now() - 7200000),
        currentDeadline: new Date(Date.now() - 3600000),
        autoExtensionEnabled: true,
        extensionDurationDays: 3,
        maxExtensions: 2,
        extensionsUsed: 2, // Max reached!
        autoStartEnabled: false,
        status: 'extended',
      },
    });
    createdJobIds.push(job6._id as Types.ObjectId);

    // Create config
    await HiringFunnelConfigModel.create({
      jobId: job6._id,
      finalShortlistTarget: 10,
      totalFunnelIntakeTarget: 15,
      stages: defaultStages.map((s) => ({ ...s, targetCount: 10 })),
      funnelHealth: 'constrained',
      status: 'draft',
    });

    const deadlineResult6 = await ApplicationCollectionService.processCollectionDeadlineJob(String(job6._id));
    assert(deadlineResult6.action === 'marked_insufficient', 'Test 6: Action is marked_insufficient');
    const job6After = await JobModel.findById(job6._id);
    assert(job6After?.applicationCollection?.status === 'insufficient', 'Test 6: Status is insufficient');
    const config6After = await HiringFunnelConfigModel.findOne({ jobId: job6._id });
    assert(config6After?.funnelHealth === 'starved', 'Test 6: Funnel health set to starved');

    // ------------------------------------------------------------------------
    // TEST 7: Qualified increases from 3 to 8 before deadline -> Collection becomes ready
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 7: Candidate pool crosses minimum threshold before deadline ---');
    const job7 = await JobModel.create({
      title: 'Frontend Engineer T7',
      company: { name: 'LetGetIn Labs' },
      description: 'React candidate collection job',
      skills: ['React'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      postedBy: recruiter5,
      finalShortlistTarget: 5,
      applicationCollection: {
        idealIntake: 10,
        minimumIntake: 5,
        actualQualifiedCount: 2,
        initialDeadline: new Date(Date.now() + 86400000),
        currentDeadline: new Date(Date.now() + 86400000),
        autoExtensionEnabled: true,
        extensionDurationDays: 3,
        maxExtensions: 2,
        extensionsUsed: 0,
        autoStartEnabled: false,
        status: 'collecting',
      },
    });
    createdJobIds.push(job7._id as Types.ObjectId);

    // Create 5 qualified applicants
    for (let i = 0; i < 5; i++) {
      const user = await UserModel.create({
        fullName: `Candidate T7_${i}`,
        email: `cand_t7_${i}_${Date.now()}@test.com`,
        role: 'user',
      });
      createdUserIds.push(user._id as Types.ObjectId);

      await ApplicationModel.create({
        jobId: job7._id,
        userId: user._id,
        status: 'submitted',
        matchScore: 80 + i,
        compositeRank: 80 + i,
      });
    }

    const evalResult7 = await ApplicationCollectionService.evaluateCollectionReadiness(job7._id);
    assert(evalResult7.actualQualifiedCount === 5, 'Test 7: actualQualifiedCount is 5');
    assert(evalResult7.status === 'ready', 'Test 7: Collection status transitioned to ready');
    assert(evalResult7.pipelineStarted === false, 'Test 7: Pipeline not auto-started (autoStart=false)');

    // ------------------------------------------------------------------------
    // TEST 8: Auto-start enabled -> Pipeline starts automatically when minimum is reached
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 8: Auto-start pipeline immediately on reaching minimum ---');
    const job8 = await JobModel.create({
      title: 'DevOps Engineer T8',
      company: { name: 'LetGetIn Labs' },
      description: 'Kubernetes automation job',
      skills: ['Docker', 'Kubernetes'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      postedBy: recruiter5,
      finalShortlistTarget: 3,
      applicationCollection: {
        idealIntake: 6,
        minimumIntake: 3,
        actualQualifiedCount: 2,
        initialDeadline: new Date(Date.now() + 86400000),
        currentDeadline: new Date(Date.now() + 86400000),
        autoExtensionEnabled: true,
        extensionDurationDays: 3,
        maxExtensions: 2,
        extensionsUsed: 0,
        autoStartEnabled: true, // AUTO START ENABLED!
        status: 'collecting',
      },
    });
    createdJobIds.push(job8._id as Types.ObjectId);

    await HiringFunnelConfigModel.create({
      jobId: job8._id,
      finalShortlistTarget: 3,
      totalFunnelIntakeTarget: 6,
      stages: defaultStages.map((s) => ({ ...s, targetCount: 4 })),
      status: 'draft',
    });

    // Add 3 qualified applicants
    for (let i = 0; i < 3; i++) {
      const user = await UserModel.create({
        fullName: `Candidate T8_${i}`,
        email: `cand_t8_${i}_${Date.now()}@test.com`,
        role: 'user',
      });
      createdUserIds.push(user._id as Types.ObjectId);

      await ApplicationModel.create({
        jobId: job8._id,
        userId: user._id,
        status: 'submitted',
        matchScore: 85,
        compositeRank: 85,
      });
    }

    const evalResult8 = await ApplicationCollectionService.evaluateCollectionReadiness(job8._id);
    assert(evalResult8.status === 'started', 'Test 8: Status transitioned directly to started');
    assert(evalResult8.pipelineStarted === true, 'Test 8: Pipeline started automatically');
    const job8After = await JobModel.findById(job8._id);
    assert(job8After?.applicationCollection?.status === 'started', 'Test 8: Job collection status is started in DB');
    assert(job8After?.hiringEngineEnabled === true, 'Test 8: hiringEngineEnabled is true');

    // ------------------------------------------------------------------------
    // TEST 9: Auto-start disabled -> Pipeline remains ready until recruiter starts it
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 9: Auto-start disabled preserves ready status until recruiter trigger ---');
    const job9 = await JobModel.create({
      title: 'Fullstack Engineer T9',
      company: { name: 'LetGetIn Labs' },
      description: 'Manual start verification job',
      skills: ['TypeScript'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      postedBy: recruiter5,
      finalShortlistTarget: 3,
      applicationCollection: {
        idealIntake: 6,
        minimumIntake: 3,
        actualQualifiedCount: 0,
        initialDeadline: new Date(Date.now() + 86400000),
        currentDeadline: new Date(Date.now() + 86400000),
        autoExtensionEnabled: false,
        extensionDurationDays: 3,
        maxExtensions: 0,
        extensionsUsed: 0,
        autoStartEnabled: false,
        status: 'collecting',
      },
    });
    createdJobIds.push(job9._id as Types.ObjectId);

    await HiringFunnelConfigModel.create({
      jobId: job9._id,
      finalShortlistTarget: 3,
      totalFunnelIntakeTarget: 6,
      stages: defaultStages.map((s) => ({ ...s, targetCount: 4 })),
      status: 'draft',
    });

    for (let i = 0; i < 3; i++) {
      const user = await UserModel.create({
        fullName: `Candidate T9_${i}`,
        email: `cand_t9_${i}_${Date.now()}@test.com`,
        role: 'user',
      });
      createdUserIds.push(user._id as Types.ObjectId);

      await ApplicationModel.create({
        jobId: job9._id,
        userId: user._id,
        status: 'submitted',
        matchScore: 80,
        compositeRank: 80,
      });
    }

    const evalResult9 = await ApplicationCollectionService.evaluateCollectionReadiness(job9._id);
    assert(evalResult9.status === 'ready', 'Test 9: Collection status is ready');
    assert(evalResult9.pipelineStarted === false, 'Test 9: Pipeline not yet started');

    // Now recruiter explicitly starts the pipeline
    const startResult9 = await ApplicationCollectionService.startAdaptiveFunnel(job9._id, String(recruiter5));
    assert(startResult9.started === true, 'Test 9: Recruiter manual start succeeded');
    const job9After = await JobModel.findById(job9._id);
    assert(job9After?.applicationCollection?.status === 'started', 'Test 9: Status transitioned to started');

    // ------------------------------------------------------------------------
    // TEST 10: Candidate applies after pipeline start -> Enters reserve pool
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 10: Late application after pipeline start enters Reserve pool ---');
    const lateUser = await UserModel.create({
      fullName: 'Late Candidate T10',
      email: `late_cand_${Date.now()}@test.com`,
      role: 'user',
    });
    createdUserIds.push(lateUser._id as Types.ObjectId);

    const lateResume = await ResumeModel.create({
      userId: lateUser._id,
      title: 'Late Resume',
      content: { basics: { name: 'Late Candidate' }, skills: ['TypeScript'] },
      parsedData: { skills: ['TypeScript'] },
    });
    createdResumeIds.push(lateResume._id as Types.ObjectId);

    const lateApp = await applicationService.createApplication(String(lateUser._id), {
      jobId: String(job9._id),
      resumeId: String(lateResume._id),
    });

    assert(lateApp.poolType === 'reserve', 'Test 10: Candidate applying after start enters poolType reserve');
    assert(!lateApp.stageDeadline, 'Test 10: Late reserve applicant does NOT have active stageDeadline');
    assert(lateApp.stageStatus !== 'invited', 'Test 10: Late reserve applicant is not yet invited');

    // ------------------------------------------------------------------------
    // TEST 11: Active candidate fails -> Existing reserve refill works
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 11: Active candidate failure triggers automatic reserve refill ---');
    // Find an active primary applicant from job9
    const primaryApp11 = await ApplicationModel.findOne({ jobId: job9._id, poolType: 'primary' });
    assert(!!primaryApp11, 'Test 11: Found active primary candidate');

    // Candidate fails
    primaryApp11!.stageStatus = 'failed';
    primaryApp11!.poolType = 'disqualified';
    await primaryApp11!.save();

    const promotedList11 = await HiringPoolManager.promoteReserveCandidates(
      job9._id,
      defaultStages[0].stageId,
      defaultStages[0].order,
      defaultStages[0].stageName,
      1,
      defaultStages[0].deadlineHours || 24
    );

    assert(promotedList11.length >= 1, 'Test 11: Reserve refill promoted candidate to primary');
    const lateAppAfterRefill = await ApplicationModel.findById(lateApp._id);
    assert(lateAppAfterRefill?.poolType === 'primary', 'Test 11: Late applicant promoted to primary');
    assert(!!lateAppAfterRefill?.stageDeadline, 'Test 11: Promoted candidate assigned stageDeadline');

    // ------------------------------------------------------------------------
    // TEST 12: Active candidate no-shows -> Existing reserve refill works
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 12: Candidate no-show triggers reserve refill ---');
    // Create another reserve candidate
    const reserveUser12 = await UserModel.create({
      fullName: 'Reserve Candidate T12',
      email: `reserve12_${Date.now()}@test.com`,
      role: 'user',
    });
    createdUserIds.push(reserveUser12._id as Types.ObjectId);

    const reserveApp12 = await ApplicationModel.create({
      jobId: job9._id,
      userId: reserveUser12._id,
      status: 'submitted',
      poolType: 'reserve',
      stageStatus: 'invited',
      matchScore: 92,
      compositeRank: 92,
    });

    // Mark current primary candidate as no_show
    lateAppAfterRefill!.stageStatus = 'no_show';
    lateAppAfterRefill!.poolType = 'disqualified';
    await lateAppAfterRefill!.save();

    const promotedList12 = await HiringPoolManager.promoteReserveCandidates(
      job9._id,
      defaultStages[0].stageId,
      defaultStages[0].order,
      defaultStages[0].stageName,
      1,
      defaultStages[0].deadlineHours || 24
    );
    assert(promotedList12.length >= 1, 'Test 12: Reserve candidate promoted after no-show');
    const app12After = await ApplicationModel.findById(reserveApp12._id);
    assert(app12After?.poolType === 'primary', 'Test 12: Reserve candidate is now primary');

    // ------------------------------------------------------------------------
    // TEST 13: Two workers try to start simultaneously -> Only one pipeline starts (CAS test)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 13: Concurrency CAS race condition test ---');
    const job13 = await JobModel.create({
      title: 'Race Condition Test Job T13',
      company: { name: 'LetGetIn Labs' },
      description: 'Testing atomic concurrency CAS',
      skills: ['Concurrency'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      postedBy: recruiter5,
      finalShortlistTarget: 2,
      applicationCollection: {
        idealIntake: 4,
        minimumIntake: 2,
        actualQualifiedCount: 2,
        initialDeadline: new Date(Date.now() + 86400000),
        currentDeadline: new Date(Date.now() + 86400000),
        autoExtensionEnabled: false,
        extensionDurationDays: 3,
        maxExtensions: 0,
        extensionsUsed: 0,
        autoStartEnabled: false,
        status: 'ready',
      },
    });
    createdJobIds.push(job13._id as Types.ObjectId);

    // Create 2 applicants
    for (let i = 0; i < 2; i++) {
      const user = await UserModel.create({
        fullName: `Candidate T13_${i}`,
        email: `cand13_${i}_${Date.now()}@test.com`,
        role: 'user',
      });
      createdUserIds.push(user._id as Types.ObjectId);
      await ApplicationModel.create({
        jobId: job13._id,
        userId: user._id,
        status: 'submitted',
        matchScore: 90,
        compositeRank: 90,
      });
    }

    // Run two simultaneous start requests
    const [startA, startB] = await Promise.all([
      ApplicationCollectionService.startAdaptiveFunnel(job13._id),
      ApplicationCollectionService.startAdaptiveFunnel(job13._id),
    ]);

    const oneStarted = (startA.started && !startB.started) || (!startA.started && startB.started);
    const oneAlreadyStarted = (startA.alreadyStarted && !startB.alreadyStarted) || (!startA.alreadyStarted && startB.alreadyStarted);

    assert(oneStarted, 'Test 13: Exactly one of the concurrent callers started the pipeline');
    assert(oneAlreadyStarted, 'Test 13: The second caller received alreadyStarted = true');

    // ------------------------------------------------------------------------
    // TEST 14: Deadline worker runs twice -> No duplicate extension
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 14: Deadline worker idempotency test ---');
    const job14 = await JobModel.create({
      title: 'Idempotency Job T14',
      company: { name: 'LetGetIn Labs' },
      description: 'Testing duplicate deadline jobs',
      skills: ['Idempotency'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      postedBy: recruiter5,
      finalShortlistTarget: 10,
      applicationCollection: {
        idealIntake: 15,
        minimumIntake: 8,
        actualQualifiedCount: 2,
        initialDeadline: new Date(Date.now() - 3600000),
        currentDeadline: new Date(Date.now() - 3600000),
        autoExtensionEnabled: true,
        extensionDurationDays: 3,
        maxExtensions: 2,
        extensionsUsed: 1, // 1 used already
        autoStartEnabled: false,
        status: 'extended',
      },
    });
    createdJobIds.push(job14._id as Types.ObjectId);

    // Call deadline processor first time -> reaches max extensions (2)
    const run1 = await ApplicationCollectionService.processCollectionDeadlineJob(String(job14._id));
    assert(run1.action === 'extended', 'Test 14: First run extends to maxExtensions (2)');

    // Call deadline processor second time immediately while deadline is in future
    const run2 = await ApplicationCollectionService.processCollectionDeadlineJob(String(job14._id));
    // The deadline has been extended to 3 days in the future, so extensionsUsed should stay 2
    const job14Check = await JobModel.findById(job14._id);
    assert(job14Check?.applicationCollection?.extensionsUsed === 2, 'Test 14: extensionsUsed did NOT double-increment');

    // ------------------------------------------------------------------------
    // TEST 15: Final=10, Qualified=8 -> Pipeline starts if min allows, final target remains 10, reports constrained capacity
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 15: Final target preservation under constrained capacity ---');
    const res15 = HiringFunnelCalculator.calculateAdaptiveFunnel(8, 10, defaultStages, 8);
    assert(res15.canProceed === true, 'Test 15: Pipeline can proceed with 8 qualified when min is 8');
    assert(res15.finalShortlistTarget === 10, 'Test 15: finalShortlistTarget is strictly 10');
    assert(res15.health === 'constrained', 'Test 15: Funnel health is constrained');
    assert(res15.deficit === 2, 'Test 15: Deficit accurately calculated as 2 (10 - 8)');

    // ------------------------------------------------------------------------
    // TEST 16: Final=5, Qualified=3, Min=5 -> Pipeline does not start
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 16: Pipeline rejected when qualified < strict minimum ---');
    const res16 = HiringFunnelCalculator.calculateAdaptiveFunnel(3, 5, defaultStages, 5);
    assert(res16.canProceed === false, 'Test 16: canProceed is false when 3 < 5');
    assert(res16.health === 'starved', 'Test 16: Funnel health is starved');

    // ------------------------------------------------------------------------
    // TEST 17: Candidate rejected by eligibility/matching -> Does not count toward actualQualifiedCount
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 17: Exclude rejected/disqualified/low-score candidates from qualified count ---');
    const job17 = await JobModel.create({
      title: 'Eligibility Filtering Job T17',
      company: { name: 'LetGetIn Labs' },
      description: 'Testing filtering in actualQualifiedCount',
      skills: ['Filtering'],
      employmentType: 'full-time',
      workplaceType: 'remote',
      postedBy: recruiter5,
      finalShortlistTarget: 5,
      applicationCollection: {
        idealIntake: 10,
        minimumIntake: 5,
        actualQualifiedCount: 0,
        initialDeadline: new Date(Date.now() + 86400000),
        currentDeadline: new Date(Date.now() + 86400000),
        status: 'collecting',
      },
    });
    createdJobIds.push(job17._id as Types.ObjectId);

    // 1. Qualified candidate (score 80)
    const u1 = await UserModel.create({ fullName: 'Valid Candidate', email: `valid_${Date.now()}@test.com`, role: 'user' });
    createdUserIds.push(u1._id as Types.ObjectId);
    await ApplicationModel.create({ jobId: job17._id, userId: u1._id, status: 'submitted', matchScore: 80, compositeRank: 80 });

    // 2. Rejected candidate
    const u2 = await UserModel.create({ fullName: 'Rejected Candidate', email: `rej_${Date.now()}@test.com`, role: 'user' });
    createdUserIds.push(u2._id as Types.ObjectId);
    await ApplicationModel.create({ jobId: job17._id, userId: u2._id, status: 'rejected', matchScore: 85, compositeRank: 85 });

    // 3. Disqualified candidate
    const u3 = await UserModel.create({ fullName: 'Disqualified Candidate', email: `disq_${Date.now()}@test.com`, role: 'user' });
    createdUserIds.push(u3._id as Types.ObjectId);
    await ApplicationModel.create({ jobId: job17._id, userId: u3._id, status: 'submitted', poolType: 'disqualified', matchScore: 90, compositeRank: 90 });

    // 4. Below threshold candidate (score 20)
    const u4 = await UserModel.create({ fullName: 'Low Score Candidate', email: `low_${Date.now()}@test.com`, role: 'user' });
    createdUserIds.push(u4._id as Types.ObjectId);
    await ApplicationModel.create({ jobId: job17._id, userId: u4._id, status: 'submitted', matchScore: 20, compositeRank: 20 });

    const count17 = await ApplicationCollectionService.getQualifiedCandidateCount(job17._id);
    assert(count17 === 1, `Test 17: Exactly 1 valid candidate counted out of 4 (got ${count17})`);

    // ------------------------------------------------------------------------
    // TEST 18: Duplicate application -> Candidate counted only once
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 18: Candidate deduplication by userId ---');
    const resume18 = await ResumeModel.create({
      userId: u1._id,
      title: 'Resume U1',
      content: { basics: { name: 'Valid Candidate' }, skills: ['Filtering'] },
    });
    createdResumeIds.push(resume18._id as Types.ObjectId);

    // User u1 submits a duplicate application to the same job
    const dupApp = await applicationService.createApplication(String(u1._id), {
      jobId: String(job17._id),
      resumeId: String(resume18._id),
      matchScore: 88,
    });
    assert(!!dupApp, 'Test 18: Re-application handled idempotently without throwing duplicate key error');

    const count18 = await ApplicationCollectionService.getQualifiedCandidateCount(job17._id);
    assert(count18 === 1, `Test 18: Duplicate application for same user counted only once (got ${count18})`);

    console.log('\n🧹 Cleaning up test artifacts...');
    await JobModel.deleteMany({ _id: { $in: createdJobIds } });
    await ApplicationModel.deleteMany({ jobId: { $in: createdJobIds } });
    await HiringFunnelConfigModel.deleteMany({ jobId: { $in: createdJobIds } });
    await CandidateStageHistoryModel.deleteMany({ jobId: { $in: createdJobIds } });
    await UserModel.deleteMany({ _id: { $in: createdUserIds } });
    await ResumeModel.deleteMany({ _id: { $in: createdResumeIds } });
    console.log('✅ Cleanup complete.');

  } catch (err: any) {
    console.error('💥 Test suite uncaught error:', err);
    failedCount++;
  }

  console.log('\n================================================================');
  console.log(`📊 ADAPTIVE FUNNEL TEST RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(failedCount > 0 ? 1 : 0);
}

runAdaptiveFunnelTestSuite();
