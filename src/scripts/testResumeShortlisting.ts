import mongoose, { Types } from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { JobModel } from '../modules/job/job.model.js';
import { ApplicationModel } from '../modules/application/application.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import { resumeScreeningService } from '../modules/resumeScreening/resumeScreening.service.js';
import { ApplicationCollectionService } from '../modules/hiringEngine/services/applicationCollection.service.js';
import { HiringPoolManager } from '../modules/hiringEngine/services/hiringPoolManager.js';
import { HiringFunnelConfigModel } from '../modules/hiringEngine/hiringFunnelConfig.model.js';

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

async function runResumeShortlistingTests() {
  console.log('================================================================');
  console.log('🧪 LETGETIN RESUME SHORTLISTING INTEGRATION TEST SUITE');
  console.log('================================================================\n');

  try {
    await connectDatabase();
  } catch (err: any) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  const testRecruiterId = new Types.ObjectId();
  const unauthorizedRecruiterId = new Types.ObjectId();
  const createdJobIds: Types.ObjectId[] = [];
  const createdAppIds: Types.ObjectId[] = [];
  const createdUserIds: Types.ObjectId[] = [];

  try {
    // Setup test job
    const job = await JobModel.create({
      title: 'Senior Full Stack Engineer - Resume Screening Test',
      description: 'Senior Full Stack Engineer with strong experience in TypeScript and React.',
      company: { name: 'LetGetIn Technologies', country: 'IN', remote: true },
      skills: ['TypeScript', 'Node.js', 'React', 'MongoDB'],
      minimumExperience: 3,
      finalShortlistTarget: 2,
      hiringEngineEnabled: true,
      postedBy: testRecruiterId,
      status: 'active',
      eligibilityMinPercent: 0, // Disable auto-shortlist so decisions stay manual for test
      applicationCollection: {
        idealIntake: 6,
        minimumIntake: 4,
        actualQualifiedCount: 0,
        autoStartEnabled: false,
        status: 'collecting',
      },
    });
    createdJobIds.push(job._id);

    // Setup 1st candidate
    const candAId = new Types.ObjectId();
    createdUserIds.push(candAId);
    await UserModel.create({
      _id: candAId,
      fullName: 'Alice Developer',
      email: `alice_${Date.now()}@example.com`,
      role: 'user',
    });

    // ------------------------------------------------------------------------
    // TEST A: New application starts with resumeDecision = 'pending'
    // ------------------------------------------------------------------------
    console.log('--- TEST A: New application starts with resumeDecision = pending ---');
    const appA = await ApplicationModel.create({
      jobId: job._id,
      userId: candAId,
      status: 'submitted',
      appliedAt: new Date(),
    });
    createdAppIds.push(appA._id);

    assert(appA.resumeDecision === 'pending', 'Test A.1: Default resumeDecision is "pending"');
    assert(appA.resumeScreeningStatus === 'pending', 'Test A.2: Default resumeScreeningStatus is "pending"');
    assert(
      !appA.resumeEvaluation?.overallScore && appA.resumeEvaluation?.isAiEvaluated !== true,
      'Test A.3: resumeEvaluation is not evaluated initially'
    );

    // ------------------------------------------------------------------------
    // TEST B: AI evaluation is stored
    // ------------------------------------------------------------------------
    console.log('\n--- TEST B: AI evaluation is stored ---');
    const evaluatedAppA = await resumeScreeningService.evaluateApplicationResume(appA._id);
    assert(evaluatedAppA.resumeScreeningStatus === 'ai_reviewed', 'Test B.1: resumeScreeningStatus updated to "ai_reviewed"');
    assert(typeof evaluatedAppA.resumeEvaluation?.overallScore === 'number', 'Test B.2: overallScore is computed');
    assert(typeof evaluatedAppA.resumeEvaluation?.skillsMatchScore === 'number', 'Test B.3: skillsMatchScore is computed');
    assert(typeof evaluatedAppA.resumeEvaluation?.experienceMatchScore === 'number', 'Test B.4: experienceMatchScore is computed');
    assert(Array.isArray(evaluatedAppA.resumeEvaluation?.matchedSkills), 'Test B.5: matchedSkills is an array');
    assert(Array.isArray(evaluatedAppA.resumeEvaluation?.missingSkills), 'Test B.6: missingSkills is an array');
    assert(Array.isArray(evaluatedAppA.resumeEvaluation?.strengths), 'Test B.7: strengths array is generated');
    assert(Array.isArray(evaluatedAppA.resumeEvaluation?.weaknesses), 'Test B.8: weaknesses array is generated');
    assert(
      ['strong_match', 'potential_match', 'not_recommended'].includes(evaluatedAppA.resumeEvaluation?.recommendation || ''),
      'Test B.9: recommendation has valid enum value'
    );
    assert(evaluatedAppA.resumeEvaluation?.isAiEvaluated === true, 'Test B.10: isAiEvaluated is true');

    // ------------------------------------------------------------------------
    // TEST C: Recruiter marks candidate needs_review
    // ------------------------------------------------------------------------
    console.log('\n--- TEST C: Recruiter marks candidate needs_review ---');
    const reviewResult = await resumeScreeningService.recordRecruiterDecision(
      appA._id,
      String(testRecruiterId),
      { decision: 'needs_review', notes: 'Need senior engineering lead to verify backend depth' }
    );
    assert(reviewResult.resumeDecision === 'needs_review', 'Test C.1: resumeDecision updated to "needs_review"');
    assert(reviewResult.resumeDecisionNotes === 'Need senior engineering lead to verify backend depth', 'Test C.2: Decision notes persisted');
    assert(String(reviewResult.resumeDecidedBy) === String(testRecruiterId), 'Test C.3: resumeDecidedBy records recruiter ID');
    assert(reviewResult.resumeDecidedAt !== undefined, 'Test C.4: resumeDecidedAt timestamp recorded');

    // ------------------------------------------------------------------------
    // TEST D: Recruiter rejects candidate
    // ------------------------------------------------------------------------
    console.log('\n--- TEST D: Recruiter rejects candidate ---');
    const candBId = new Types.ObjectId();
    createdUserIds.push(candBId);
    const appB = await ApplicationModel.create({
      jobId: job._id,
      userId: candBId,
      status: 'submitted',
      appliedAt: new Date(),
    });
    createdAppIds.push(appB._id);

    const rejectResult = await resumeScreeningService.recordRecruiterDecision(
      appB._id,
      String(testRecruiterId),
      { decision: 'rejected', notes: 'Insufficient core experience for senior role' }
    );
    assert(rejectResult.resumeDecision === 'rejected', 'Test D.1: resumeDecision updated to "rejected"');
    assert(rejectResult.status === 'rejected', 'Test D.2: Application status synced to "rejected"');
    assert(rejectResult.poolType === 'disqualified', 'Test D.3: Candidate poolType set to "disqualified"');

    // ------------------------------------------------------------------------
    // TEST E: Recruiter shortlists candidate
    // ------------------------------------------------------------------------
    console.log('\n--- TEST E: Recruiter shortlists candidate ---');
    const shortlistResult = await resumeScreeningService.recordRecruiterDecision(
      appA._id,
      String(testRecruiterId),
      { decision: 'shortlisted', notes: 'Strong match on TypeScript and backend architecture' }
    );
    assert(shortlistResult.resumeDecision === 'shortlisted', 'Test E.1: resumeDecision updated to "shortlisted"');
    assert(shortlistResult.status === 'submitted', 'Test E.2: Application status is submitted and active');
    assert(shortlistResult.poolType !== 'disqualified', 'Test E.3: Candidate is not disqualified');

    // ------------------------------------------------------------------------
    // TEST F: Shortlisted candidate is counted as qualified
    // ------------------------------------------------------------------------
    console.log('\n--- TEST F: Shortlisted candidate is counted as qualified ---');
    const qualCount = await ApplicationCollectionService.getQualifiedCandidateCount(job._id);
    assert(qualCount === 1, `Test F.1: Exactly 1 shortlisted candidate counted as qualified (got ${qualCount})`);

    // Verify stats API reflects the authoritative count
    const stats = await resumeScreeningService.getScreeningStats(String(job._id), String(testRecruiterId));
    assert(stats.shortlisted === 1, 'Test F.2: Stats shortlisted count is 1');
    assert(stats.actualQualifiedCount === 1, 'Test F.3: Stats actualQualifiedCount is 1');
    assert(stats.rejected === 1, 'Test F.4: Stats rejected count is 1');
    assert(stats.isReadyForFunnel === false, 'Test F.5: isReadyForFunnel is false because 1 < 4 minimumIntake');

    // ------------------------------------------------------------------------
    // TEST G: Qualified candidate can enter the existing collection/funnel
    // ------------------------------------------------------------------------
    console.log('\n--- TEST G: Qualified candidate can enter existing collection/funnel ---');
    // Configure funnel stages for job
    await HiringFunnelConfigModel.create({
      jobId: job._id,
      totalFunnelIntakeTarget: 2,
      finalShortlistTarget: 2,
      stages: [
        {
          stageId: 'stage_test_assessment',
          stageName: 'Technical Assessment',
          stageType: 'assessment',
          order: 1,
          targetCount: 2,
          deadlineHours: 48,
          expectedAttendanceRate: 1.0,
          expectedPassRate: 0.6,
          autoAdvanceScoreThreshold: 70,
          autoRefillEnabled: true,
        },
      ],
      currentStageId: 'stage_test_assessment',
    });

    const poolResult = await HiringPoolManager.partitionInitialPool(
      job._id,
      'stage_test_assessment',
      2,
      48
    );

    assert(poolResult.primaryCandidates.length === 1, 'Test G.1: Shortlisted candidate entered primary pool');
    assert(String(poolResult.primaryCandidates[0]._id) === String(appA._id), 'Test G.2: Candidate A is in primary pool');
    const refreshedAppA = await ApplicationModel.findById(appA._id);
    assert(refreshedAppA?.poolType === 'primary', 'Test G.3: Application poolType set to "primary"');
    assert(refreshedAppA?.currentStageId === 'stage_test_assessment', 'Test G.4: Assigned initial stage_test_assessment');
    assert(refreshedAppA?.stageStatus === 'invited', 'Test G.5: Stage status is "invited"');
    assert(refreshedAppA?.stageDeadline !== undefined, 'Test G.6: Stage deadline was assigned');

    // ------------------------------------------------------------------------
    // TEST H: Rejected / needs_review candidates do NOT enter the funnel
    // ------------------------------------------------------------------------
    console.log('\n--- TEST H: Rejected/needs_review candidates do NOT enter the funnel ---');
    const candCId = new Types.ObjectId();
    createdUserIds.push(candCId);
    const appC = await ApplicationModel.create({
      jobId: job._id,
      userId: candCId,
      status: 'submitted',
      appliedAt: new Date(),
    });
    createdAppIds.push(appC._id);

    await resumeScreeningService.recordRecruiterDecision(
      appC._id,
      String(testRecruiterId),
      { decision: 'needs_review', notes: 'Pending portfolio check' }
    );

    // Re-check partition on new job to test isolation
    const jobIsolation = await JobModel.create({
      title: 'Job Isolation Test',
      description: 'Test job for candidate pool isolation.',
      company: { name: 'Test Org' },
      postedBy: testRecruiterId,
      status: 'active',
    });
    createdJobIds.push(jobIsolation._id);

    // Put appB (rejected) and appC (needs_review) on jobIsolation
    const appB_iso = await ApplicationModel.create({
      jobId: jobIsolation._id,
      userId: candBId,
      resumeDecision: 'rejected',
      status: 'rejected',
      poolType: 'disqualified',
    });
    createdAppIds.push(appB_iso._id);

    const appC_iso = await ApplicationModel.create({
      jobId: jobIsolation._id,
      userId: candCId,
      resumeDecision: 'needs_review',
      status: 'submitted',
    });
    createdAppIds.push(appC_iso._id);

    const isoPool = await HiringPoolManager.partitionInitialPool(
      jobIsolation._id,
      'stage_test',
      5,
      48
    );

    assert(isoPool.primaryCandidates.length === 0, 'Test H.1: Zero candidates entered primary pool (both excluded)');
    assert(isoPool.reserveCandidates.length === 0, 'Test H.2: Zero candidates entered reserve pool');
    const qualCountIso = await ApplicationCollectionService.getQualifiedCandidateCount(jobIsolation._id);
    assert(qualCountIso === 0, 'Test H.3: Authoritative qualified count for job is strictly 0');

    // ------------------------------------------------------------------------
    // TEST I: Duplicate decision requests are handled safely (idempotency)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST I: Duplicate decision requests are handled safely (idempotency) ---');
    // Shortlist candidate A again with identical decision
    const dup1 = await resumeScreeningService.recordRecruiterDecision(
      appA._id,
      String(testRecruiterId),
      { decision: 'shortlisted', notes: 'Repeated shortlist call' }
    );
    assert(dup1.resumeDecision === 'shortlisted', 'Test I.1: Decision remains shortlisted');
    
    // Qualified count remains 1 and is not artificially double-incremented
    const qualCountAfterDup = await ApplicationCollectionService.getQualifiedCandidateCount(job._id);
    assert(qualCountAfterDup === 1, `Test I.2: Authoritative count remains 1 (got ${qualCountAfterDup})`);

    // Bulk decision idempotency test
    const bulkRes = await resumeScreeningService.recordBulkRecruiterDecisions(
      String(job._id),
      String(testRecruiterId),
      { applicationIds: [String(appA._id), String(appB._id)], decision: 'shortlisted' }
    );
    assert(bulkRes.updatedCount === 2, 'Test I.3: Bulk update processed both candidates');
    const qualCountAfterBulk = await ApplicationCollectionService.getQualifiedCandidateCount(job._id);
    assert(qualCountAfterBulk === 2, `Test I.4: Authoritative count accurately reflects both candidates (got ${qualCountAfterBulk})`);

    // ------------------------------------------------------------------------
    // TEST J: Recruiter from another organization cannot access or modify candidate
    // ------------------------------------------------------------------------
    console.log('\n--- TEST J: Cross-organization recruiter isolation ---');
    let unauthorizedBlocked = false;
    try {
      await resumeScreeningService.recordRecruiterDecision(
        appA._id,
        String(unauthorizedRecruiterId),
        { decision: 'rejected', notes: 'Malicious reject from competing recruiter' }
      );
    } catch (err: any) {
      if (err.statusCode === 403 || err.message?.includes('access') || err.message?.includes('forbidden')) {
        unauthorizedBlocked = true;
      }
    }
    assert(unauthorizedBlocked === true, 'Test J.1: Unauthorized recruiter decision blocked with 403 Forbidden');

    let unauthorizedViewBlocked = false;
    try {
      await resumeScreeningService.getApplicationEvaluationDetail(
        String(appA._id),
        String(unauthorizedRecruiterId)
      );
    } catch (err: any) {
      if (err.statusCode === 403 || err.message?.includes('access') || err.message?.includes('forbidden')) {
        unauthorizedViewBlocked = true;
      }
    }
    assert(unauthorizedViewBlocked === true, 'Test J.2: Unauthorized recruiter viewing candidate evaluation blocked with 403');

    let unauthorizedStatsBlocked = false;
    try {
      await resumeScreeningService.getScreeningStats(
        String(job._id),
        String(unauthorizedRecruiterId)
      );
    } catch (err: any) {
      if (err.statusCode === 403 || err.message?.includes('access') || err.message?.includes('forbidden')) {
        unauthorizedStatsBlocked = true;
      }
    }
    assert(unauthorizedStatsBlocked === true, 'Test J.3: Unauthorized recruiter stats access blocked with 403');

  } catch (e: any) {
    console.error('Test Suite encountered an unhandled error:', e);
    failedCount++;
  } finally {
    // Cleanup test records
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
  console.log(`📊 RESUME SHORTLISTING TEST RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(failedCount > 0 ? 1 : 0);
}

runResumeShortlistingTests();
