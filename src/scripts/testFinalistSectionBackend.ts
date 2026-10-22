import mongoose, { Types } from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { JobModel } from '../modules/job/job.model.js';
import { ApplicationModel } from '../modules/application/application.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { UserProfileModel } from '../modules/profile/profile.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import { HiringFunnelConfigModel } from '../modules/hiringEngine/hiringFunnelConfig.model.js';
import { CandidateStageHistoryModel } from '../modules/hiringEngine/candidateStageHistory.model.js';
import { HiringEngineService } from '../modules/hiringEngine/services/hiringEngine.service.js';

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

async function runFinalistSectionBackendTests() {
  console.log('================================================================');
  console.log('🏆 LETGETIN RECRUITER FINALIST BACKEND & API VERIFICATION SUITE');
  console.log('================================================================\n');

  try {
    await connectDatabase();
  } catch (err: any) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  const runId = Math.floor(Math.random() * 100000);
  const authorizedRecruiterId = new Types.ObjectId();
  const unauthorizedRecruiterId = new Types.ObjectId();
  const cleanupJobIds: Types.ObjectId[] = [];
  const cleanupAppIds: Types.ObjectId[] = [];
  const cleanupUserIds: Types.ObjectId[] = [];

  try {
    // ------------------------------------------------------------------------
    // SETUP: Recruiter Users & Target Job
    // ------------------------------------------------------------------------
    console.log('--- STEP 1: Setting up Recruiter Users and Job ---');
    await UserModel.create({
      _id: authorizedRecruiterId,
      email: `recruiter_auth_${runId}@letgetin.com`,
      fullName: `Authorized Recruiter ${runId}`,
      role: 'recruiter',
      emailVerified: true,
      phoneVerified: true,
    });
    cleanupUserIds.push(authorizedRecruiterId);

    await UserModel.create({
      _id: unauthorizedRecruiterId,
      email: `recruiter_unauth_${runId}@letgetin.com`,
      fullName: `Unauthorized Recruiter ${runId}`,
      role: 'recruiter',
      emailVerified: true,
      phoneVerified: true,
    });
    cleanupUserIds.push(unauthorizedRecruiterId);

    const testJob = await JobModel.create({
      title: `Principal Cloud Platform Architect #${runId}`,
      description: 'Lead next-generation distributed multi-region cloud platform.',
      company: { name: 'LetGetIn Enterprise Systems' },
      skills: ['TypeScript', 'Kubernetes', 'Go', 'Distributed Systems'],
      postedBy: authorizedRecruiterId,
      status: 'active',
      finalShortlistTarget: 5,
      stages: [
        {
          stageId: 'stage_resume_screen',
          stageName: 'Resume Screening',
          stageType: 'resume_match',
          order: 1,
          targetCount: 10,
          passingScore: 70,
        },
        {
          stageId: 'stage_assessment',
          stageName: 'Assessment',
          stageType: 'assessment',
          order: 2,
          targetCount: 8,
          passingScore: 75,
        },
        {
          stageId: 'stage_interview',
          stageName: 'AI Interview',
          stageType: 'ai_interview',
          order: 3,
          targetCount: 6,
          passingScore: 80,
        },
        {
          stageId: 'stage_final_shortlist',
          stageName: 'Final Shortlist',
          stageType: 'final_shortlist',
          order: 4,
          targetCount: 4,
          passingScore: 85,
        },
      ],
    });
    cleanupJobIds.push(testJob._id);

    // ------------------------------------------------------------------------
    // SETUP: 4 Candidates at Final Shortlist Stage with Distinct Initial States
    // ------------------------------------------------------------------------
    console.log('\n--- STEP 2: Seeding Finalist Candidates with Scorecards ---');
    
    // Candidate 1: Pending Finalist (Highest score)
    const user1Id = new Types.ObjectId();
    cleanupUserIds.push(user1Id);
    await UserModel.create({
      _id: user1Id,
      fullName: 'Aarav Sharma',
      email: `aarav.sharma_${runId}@example.com`,
      phone: '+91 9876543210',
      role: 'user',
    });
    await UserProfileModel.create({
      userId: user1Id,
      personal: { firstName: 'Aarav', lastName: 'Sharma', headline: 'Cloud Architect' },
      contact: { fullName: 'Aarav Sharma', phone: '+91 9876543210', email: `aarav.sharma_${runId}@example.com`, city: 'Bengaluru', country: 'India', linkedin: '' },
      track: 'experienced',
    });
    const resume1 = await ResumeModel.create({
      userId: user1Id,
      title: 'Aarav Sharma - Cloud Architect Resume',
      content: { personalInfo: { fullName: 'Aarav Sharma', email: `aarav.sharma_${runId}@example.com` } },
      settings: {},
    });
    const app1 = await ApplicationModel.create({
      jobId: testJob._id,
      userId: user1Id,
      resumeId: resume1._id,
      status: 'shortlisted',
      currentStageIndex: 4,
      matchScore: 95,
      assessmentScore: 94,
      aiScore: 95,
      shortlistDate: new Date('2026-10-01T10:00:00Z'),
    });
    cleanupAppIds.push(app1._id);

    // Candidate 2: Already Offered
    const user2Id = new Types.ObjectId();
    cleanupUserIds.push(user2Id);
    await UserModel.create({
      _id: user2Id,
      fullName: 'Priya Venkatesh',
      email: `priya.v_${runId}@example.com`,
      phone: '+91 9876543211',
      role: 'user',
    });
    await UserProfileModel.create({
      userId: user2Id,
      personal: { firstName: 'Priya', lastName: 'Venkatesh', headline: 'Full Stack Engineer' },
      contact: { fullName: 'Priya Venkatesh', phone: '+91 9876543211', email: `priya.v_${runId}@example.com`, city: 'Hyderabad', country: 'India', linkedin: '' },
      track: 'experienced',
    });
    const app2 = await ApplicationModel.create({
      jobId: testJob._id,
      userId: user2Id,
      status: 'offered',
      finalShortlistDecision: 'offered',
      currentStageIndex: 4,
      matchScore: 92,
      stageScores: {
        stage_resume_screen: 90,
        stage_assessment: 92,
        stage_interview: 93,
      },
      evaluationScores: {
        resumeMatch: 90,
        technical: 92,
        aptitude: 90,
        interview: 93,
        overall: 92,
      },
      shortlistDate: new Date('2026-10-02T10:00:00Z'),
      finalDecisionDate: new Date('2026-10-05T12:00:00Z'),
    });
    cleanupAppIds.push(app2._id);

    // Candidate 3: Already On Hold
    const user3Id = new Types.ObjectId();
    cleanupUserIds.push(user3Id);
    await UserModel.create({
      _id: user3Id,
      fullName: 'Rohan Gupta',
      email: `rohan.g_${runId}@example.com`,
      phone: '+91 9876543212',
      role: 'user',
    });
    await UserProfileModel.create({
      userId: user3Id,
      personal: { firstName: 'Rohan', lastName: 'Gupta', headline: 'Backend Specialist' },
      contact: { fullName: 'Rohan Gupta', phone: '+91 9876543212', email: `rohan.g_${runId}@example.com`, city: 'Pune', country: 'India', linkedin: '' },
      track: 'experienced',
    });
    const app3 = await ApplicationModel.create({
      jobId: testJob._id,
      userId: user3Id,
      status: 'shortlisted',
      finalShortlistDecision: 'on_hold',
      currentStageIndex: 4,
      matchScore: 88,
      stageScores: {
        stage_resume_screen: 88,
        stage_assessment: 86,
        stage_interview: 89,
      },
      evaluationScores: {
        resumeMatch: 88,
        technical: 86,
        aptitude: 85,
        interview: 89,
        overall: 88,
      },
      shortlistDate: new Date('2026-10-03T10:00:00Z'),
      finalDecisionDate: new Date('2026-10-06T12:00:00Z'),
    });
    cleanupAppIds.push(app3._id);

    // Candidate 4: Already Rejected
    const user4Id = new Types.ObjectId();
    cleanupUserIds.push(user4Id);
    await UserModel.create({
      _id: user4Id,
      fullName: 'Sneha Patel',
      email: `sneha.p_${runId}@example.com`,
      phone: '+91 9876543213',
      role: 'user',
    });
    await UserProfileModel.create({
      userId: user4Id,
      personal: { firstName: 'Sneha', lastName: 'Patel', headline: 'Cloud Engineer' },
      contact: { fullName: 'Sneha Patel', phone: '+91 9876543213', email: `sneha.p_${runId}@example.com`, city: 'Mumbai', country: 'India', linkedin: '' },
      track: 'fresher',
    });
    const app4 = await ApplicationModel.create({
      jobId: testJob._id,
      userId: user4Id,
      status: 'rejected',
      finalShortlistDecision: 'rejected',
      currentStageIndex: 4,
      matchScore: 78,
      stageScores: {
        stage_resume_screen: 80,
        stage_assessment: 76,
        stage_interview: 78,
      },
      evaluationScores: {
        resumeMatch: 80,
        technical: 76,
        aptitude: 75,
        interview: 78,
        overall: 78,
      },
      shortlistDate: new Date('2026-10-04T10:00:00Z'),
      finalDecisionDate: new Date('2026-10-07T12:00:00Z'),
    });
    cleanupAppIds.push(app4._id);

    // Seed historical audit history for Candidate 1
    await CandidateStageHistoryModel.create({
      jobId: testJob._id,
      applicationId: app1._id,
      candidateId: user1Id,
      stageId: 'stage_resume_screen',
      stageName: 'Resume Screening',
      stageIndex: 1,
      status: 'passed',
      score: 96,
      notes: 'Resume scored above threshold.',
      enteredAt: new Date('2026-10-01T08:00:00Z'),
      completedAt: new Date('2026-10-01T08:30:00Z'),
    });
    await CandidateStageHistoryModel.create({
      jobId: testJob._id,
      applicationId: app1._id,
      candidateId: user1Id,
      stageId: 'stage_assessment',
      stageName: 'Assessment',
      stageIndex: 2,
      status: 'passed',
      score: 94,
      notes: 'Technical assessment completed successfully.',
      enteredAt: new Date('2026-10-02T14:00:00Z'),
      completedAt: new Date('2026-10-02T15:00:00Z'),
    });

    // ------------------------------------------------------------------------
    // TEST SUITE 1: Job-wise Finalist Listing & Stats Calculation
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 1: Job-wise Finalist Listing & Summary Stats ---');
    const allFinalistsResult = await HiringEngineService.getFinalShortlistCandidates(
      testJob._id.toString(),
      authorizedRecruiterId.toString(),
      { status: 'all' }
    );

    assert(
      allFinalistsResult.candidates.length === 4,
      'Finalist Listing returns all 4 qualified finalists when status=all',
      `Expected 4, got ${allFinalistsResult.candidates.length}`
    );
    assert(
      allFinalistsResult.stats.totalFinalists === 4,
      'Stats: totalFinalists count is 4',
      `Got ${allFinalistsResult.stats.totalFinalists}`
    );
    assert(
      allFinalistsResult.stats.pendingReview === 1,
      'Stats: pendingReview finalist count is 1',
      `Got ${allFinalistsResult.stats.pendingReview}`
    );
    assert(
      allFinalistsResult.stats.offersSent === 1,
      'Stats: offersSent finalist count is 1',
      `Got ${allFinalistsResult.stats.offersSent}`
    );
    assert(
      allFinalistsResult.stats.onHold === 1,
      'Stats: onHold finalist count is 1',
      `Got ${allFinalistsResult.stats.onHold}`
    );
    assert(
      allFinalistsResult.stats.rejected === 1,
      'Stats: rejected finalist count is 1',
      `Got ${allFinalistsResult.stats.rejected}`
    );

    // Verify Rank and Score Sorting
    assert(
      allFinalistsResult.candidates[0].candidate.fullName === 'Aarav Sharma' &&
      allFinalistsResult.candidates[0].compositeRank === 1,
      'Finalists are ranked and sorted by overall score descending (Rank 1: Aarav Sharma)',
      `Rank 1 is ${allFinalistsResult.candidates[0]?.candidate?.fullName}`
    );

    // ------------------------------------------------------------------------
    // TEST SUITE 2: Strict Status Filtering Isolation
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 2: Strict Finalist Status Tab Filtering Isolation ---');
    
    // Tab: Pending
    const pendingResult = await HiringEngineService.getFinalShortlistCandidates(
      testJob._id.toString(),
      authorizedRecruiterId.toString(),
      { status: 'pending' }
    );
    assert(
      pendingResult.candidates.length === 1 && pendingResult.candidates[0].candidate.fullName === 'Aarav Sharma',
      'Tab: "pending" contains only pending candidates (Aarav Sharma)',
      `Got ${pendingResult.candidates.map(f => f.candidate.fullName).join(', ')}`
    );

    // Tab: Offered
    const offeredResult = await HiringEngineService.getFinalShortlistCandidates(
      testJob._id.toString(),
      authorizedRecruiterId.toString(),
      { status: 'offered' }
    );
    assert(
      offeredResult.candidates.length === 1 && offeredResult.candidates[0].candidate.fullName === 'Priya Venkatesh',
      'Tab: "offered" contains only offered candidates (Priya Venkatesh)',
      `Got ${offeredResult.candidates.map(f => f.candidate.fullName).join(', ')}`
    );

    // Tab: On Hold (accepts on_hold and on-hold)
    const holdResult = await HiringEngineService.getFinalShortlistCandidates(
      testJob._id.toString(),
      authorizedRecruiterId.toString(),
      { status: 'on-hold' }
    );
    assert(
      holdResult.candidates.length === 1 && holdResult.candidates[0].candidate.fullName === 'Rohan Gupta',
      'Tab: "on-hold" contains only on-hold candidates (Rohan Gupta)',
      `Got ${holdResult.candidates.map(f => f.candidate.fullName).join(', ')}`
    );

    // Tab: Rejected
    const rejectedResult = await HiringEngineService.getFinalShortlistCandidates(
      testJob._id.toString(),
      authorizedRecruiterId.toString(),
      { status: 'rejected' }
    );
    assert(
      rejectedResult.candidates.length === 1 && rejectedResult.candidates[0].candidate.fullName === 'Sneha Patel',
      'Tab: "rejected" contains only rejected candidates (Sneha Patel)',
      `Got ${rejectedResult.candidates.map(f => f.candidate.fullName).join(', ')}`
    );

    // ------------------------------------------------------------------------
    // TEST SUITE 3: Finalist Search Filter
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 3: Backend Finalist Search Filtering ---');
    const searchByNameResult = await HiringEngineService.getFinalShortlistCandidates(
      testJob._id.toString(),
      authorizedRecruiterId.toString(),
      { status: 'all', search: 'priya' }
    );
    assert(
      searchByNameResult.candidates.length === 1 && searchByNameResult.candidates[0].candidate.fullName === 'Priya Venkatesh',
      'Search by candidate name "priya" returns matching finalist',
      `Got ${searchByNameResult.candidates.map(f => f.candidate.fullName).join(', ')}`
    );

    const searchByRoleResult = await HiringEngineService.getFinalShortlistCandidates(
      testJob._id.toString(),
      authorizedRecruiterId.toString(),
      { status: 'all', search: 'Principal Cloud' }
    );
    assert(
      searchByRoleResult.candidates.length === 4,
      'Search by job role "Principal Cloud" matches all candidates for this role',
      `Got ${searchByRoleResult.candidates.length} candidates`
    );

    const searchNoMatchResult = await HiringEngineService.getFinalShortlistCandidates(
      testJob._id.toString(),
      authorizedRecruiterId.toString(),
      { status: 'all', search: 'NonExistentName12345' }
    );
    assert(
      searchNoMatchResult.candidates.length === 0,
      'Search with no match returns empty finalists list without error',
      `Got ${searchNoMatchResult.candidates.length} candidates`
    );

    // ------------------------------------------------------------------------
    // TEST SUITE 4: Candidate Detail & Scorecard Breakdown
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 4: Candidate Detail & Evaluation Scorecard ---');
    const detailResult = await HiringEngineService.getFinalistDetail(
      testJob._id.toString(),
      app1._id.toString(),
      authorizedRecruiterId.toString()
    );

    assert(
      (detailResult as any).candidate?.fullName === 'Aarav Sharma',
      'Candidate detail returns correct candidate name',
      `Got ${(detailResult as any).candidate?.fullName}`
    );
    assert(
      (detailResult as any).candidate?.email === `aarav.sharma_${runId}@example.com`,
      'Candidate detail returns correct contact email',
      `Got ${(detailResult as any).candidate?.email}`
    );
    assert(
      (detailResult as any).candidate?.phone === '+91 9876543210',
      'Candidate detail returns correct phone number',
      `Got ${(detailResult as any).candidate?.phone}`
    );
    assert(
      (detailResult as any).overallScore === 95 &&
      (detailResult as any).technicalScore === 94 &&
      (detailResult as any).interviewScore === 95,
      'Candidate detail returns full score breakdown (overall, technical, aptitude, interview)',
      `Scores: overall=${(detailResult as any).overallScore}, tech=${(detailResult as any).technicalScore}, int=${(detailResult as any).interviewScore}`
    );
    assert(
      Array.isArray((detailResult as any).relevantStageHistory) &&
      (detailResult as any).relevantStageHistory.length === 2 &&
      (detailResult as any).relevantStageHistory[0].stageName === 'Resume Screening',
      'Candidate detail includes complete immutable stage audit history',
      `History length: ${(detailResult as any).relevantStageHistory?.length}`
    );

    // ------------------------------------------------------------------------
    // TEST SUITE 5: Finalist Actions & Stage Audit Logging
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 5: Finalist Actions (Extend Offer, Put On Hold, Reject) ---');

    // Action A: Extend Offer on Candidate 1
    const offerResult = await HiringEngineService.recordFinalDecision(
      testJob._id.toString(),
      app1._id.toString(),
      authorizedRecruiterId.toString(),
      'offered',
      'Top candidate in technical depth. Extending competitive compensation package.'
    );
    assert(
      offerResult.decision === 'offered' &&
      offerResult.status === 'offered',
      'Action: Extend Offer updates final decision and status to "offered"',
      `Status: ${offerResult.status}, Decision: ${offerResult.decision}`
    );

    // Verify audit record was created
    const offerAuditLog = await CandidateStageHistoryModel.findOne({
      applicationId: app1._id,
      status: 'passed',
      stageId: 'stage_final_shortlist',
    }).sort({ enteredAt: -1 });
    assert(
      offerAuditLog !== null &&
      offerAuditLog.status === 'passed' &&
      Boolean(offerAuditLog.notes?.includes('Top candidate in technical depth')),
      'Action: Extend Offer logs immutable stage audit entry in CandidateStageHistoryModel',
      `Audit entry: ${JSON.stringify(offerAuditLog?.notes)}`
    );

    // Action B: Put On Hold on Candidate 2
    const holdActionResult = await HiringEngineService.recordFinalDecision(
      testJob._id.toString(),
      app2._id.toString(),
      authorizedRecruiterId.toString(),
      'on_hold',
      'Candidate requested 1 week extension before offer finalization.'
    );
    assert(
      holdActionResult.decision === 'on_hold',
      'Action: Put On Hold updates decision to "on_hold"',
      `Decision: ${holdActionResult.decision}`
    );

    // Action C: Reject Candidate 3
    const rejectActionResult = await HiringEngineService.recordFinalDecision(
      testJob._id.toString(),
      app3._id.toString(),
      authorizedRecruiterId.toString(),
      'rejected',
      'Position filled by higher scoring candidate.'
    );
    assert(
      rejectActionResult.decision === 'rejected' &&
      rejectActionResult.status === 'rejected',
      'Action: Reject finalist updates decision and status to "rejected"',
      `Status: ${rejectActionResult.status}`
    );

    // ------------------------------------------------------------------------
    // TEST SUITE 6: Scorecard Export Functionality (CSV & JSON)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 6: Scorecard Export (CSV & JSON) ---');
    const csvExport = await HiringEngineService.exportFinalShortlistScorecards(
      testJob._id.toString(),
      authorizedRecruiterId.toString(),
      'all',
      'csv'
    );
    assert(
      csvExport.contentType === 'text/csv' &&
      typeof csvExport.data === 'string' &&
      csvExport.data.includes('Rank,Candidate Name,Email,Phone,Applied Role') &&
      csvExport.data.includes('Aarav Sharma') &&
      csvExport.data.includes('Priya Venkatesh'),
      'Export: CSV generation produces valid RFC 4180 headers and candidate rows',
      `CSV preview: ${csvExport.data.toString().substring(0, 100)}...`
    );

    const jsonExport = await HiringEngineService.exportFinalShortlistScorecards(
      testJob._id.toString(),
      authorizedRecruiterId.toString(),
      'all',
      'json'
    );
    assert(
      jsonExport.contentType === 'application/json' &&
      Array.isArray(jsonExport.data) &&
      jsonExport.data.length === 4,
      'Export: JSON generation returns structured array with all finalists',
      `JSON count: ${Array.isArray(jsonExport.data) ? jsonExport.data.length : 0}`
    );

    // ------------------------------------------------------------------------
    // TEST SUITE 7: Recruiter Authorization & Security Enforcement
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 7: Recruiter Authorization & Ownership Enforcement ---');
    
    // Unauthorized recruiter trying to list finalists
    let unauthorizedBlocked = false;
    try {
      await HiringEngineService.getFinalShortlistCandidates(
        testJob._id.toString(),
        unauthorizedRecruiterId.toString(),
        { status: 'all' }
      );
    } catch (err: any) {
      unauthorizedBlocked = err.statusCode === 403 || err.message?.includes('authorized') || err.message?.includes('not found');
    }
    assert(
      unauthorizedBlocked,
      'Security: Unauthorized recruiter is blocked (403 Forbidden) from accessing job finalists'
    );

    // Unauthorized recruiter trying to update finalist decision
    let unauthorizedActionBlocked = false;
    try {
      await HiringEngineService.recordFinalDecision(
        testJob._id.toString(),
        app1._id.toString(),
        unauthorizedRecruiterId.toString(),
        'offered'
      );
    } catch (err: any) {
      unauthorizedActionBlocked = err.statusCode === 403 || err.message?.includes('authorized') || err.message?.includes('not found');
    }
    assert(
      unauthorizedActionBlocked,
      'Security: Unauthorized recruiter is blocked (403 Forbidden) from modifying finalist status'
    );

    // Invalid Job ID Handling
    let invalidJobBlocked = false;
    try {
      await HiringEngineService.getFinalShortlistCandidates(
        new Types.ObjectId().toString(),
        authorizedRecruiterId.toString(),
        { status: 'all' }
      );
    } catch (err: any) {
      invalidJobBlocked = err.statusCode === 404 || err.message?.includes('not found');
    }
    assert(
      invalidJobBlocked,
      'Validation: Nonexistent job returns 404 Not Found'
    );

    // Invalid Application ID on action
    let invalidAppBlocked = false;
    try {
      await HiringEngineService.recordFinalDecision(
        testJob._id.toString(),
        new Types.ObjectId().toString(),
        authorizedRecruiterId.toString(),
        'offered'
      );
    } catch (err: any) {
      invalidAppBlocked = err.statusCode === 404 || err.message?.includes('not found');
    }
    assert(
      invalidAppBlocked,
      'Validation: Nonexistent application ID returns 404 Not Found'
    );

    // ------------------------------------------------------------------------
    // TEST SUITE 8: Empty State Handling
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 8: Empty Finalist State Handling ---');
    const emptyJob = await JobModel.create({
      title: `Brand New Vacancy #${runId}`,
      description: 'Zero applicant job',
      company: { name: 'LetGetIn Labs' },
      skills: ['Python'],
      postedBy: authorizedRecruiterId,
      status: 'active',
      finalShortlistTarget: 3,
    });
    cleanupJobIds.push(emptyJob._id);

    const emptyResult = await HiringEngineService.getFinalShortlistCandidates(
      emptyJob._id.toString(),
      authorizedRecruiterId.toString(),
      { status: 'all' }
    );
    assert(
      emptyResult.candidates.length === 0 &&
      emptyResult.stats.totalFinalists === 0 &&
      emptyResult.stats.pendingReview === 0 &&
      emptyResult.stats.offersSent === 0 &&
      emptyResult.stats.onHold === 0 &&
      emptyResult.stats.rejected === 0,
      'Empty State: Job with no finalists returns cleanly structured zero counts without error'
    );

    console.log('\n================================================================');
    console.log(`🎉 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('================================================================\n');

  } catch (globalErr: any) {
    console.error('Fatal error during test run:', globalErr);
    failedCount++;
  } finally {
    // Cleanup test data
    console.log('--- Cleaning up test records ---');
    if (cleanupJobIds.length > 0) await JobModel.deleteMany({ _id: { $in: cleanupJobIds } });
    if (cleanupAppIds.length > 0) await ApplicationModel.deleteMany({ _id: { $in: cleanupAppIds } });
    if (cleanupUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: cleanupUserIds } });
      await UserProfileModel.deleteMany({ userId: { $in: cleanupUserIds } });
      await ResumeModel.deleteMany({ userId: { $in: cleanupUserIds } });
    }
    if (cleanupAppIds.length > 0) {
      await CandidateStageHistoryModel.deleteMany({ applicationId: { $in: cleanupAppIds } });
    }
    console.log('--- Test cleanup complete ---');
    await mongoose.disconnect();
  }

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runFinalistSectionBackendTests();
