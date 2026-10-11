import { HiringEngineService } from '../modules/hiringEngine/services/hiringEngine.service.js';
import { HiringFunnelConfigModel } from '../modules/hiringEngine/hiringFunnelConfig.model.js';
import { CandidateStageHistoryModel } from '../modules/hiringEngine/candidateStageHistory.model.js';
import { JobModel } from '../modules/job/job.model.js';
import { ApplicationModel } from '../modules/application/application.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import { UserProfileModel } from '../modules/profile/profile.model.js';
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

async function runShortlistBackendTests() {
  console.log('================================================================');
  console.log('🚀 LETGETIN SHORTLIST BACKEND & API VERIFICATION SUITE');
  console.log('================================================================\n');

  try {
    await connectDatabase();
  } catch (err: any) {
    console.error('Failed to connect to database:', err?.message);
    process.exit(1);
  }

  const runId = Math.floor(Math.random() * 10000);
  const recruiterId = new Types.ObjectId();
  const otherRecruiterId = new Types.ObjectId();

  // Create test recruiter
  const recruiter = await UserModel.create({
    _id: recruiterId,
    email: `recruiter_${runId}@example.com`,
    fullName: `Recruiter Test ${runId}`,
    role: 'recruiter',
    emailVerified: true,
    phoneVerified: true,
  });

  // Create test job owned by recruiter
  const job = await JobModel.create({
    title: `Senior Full Stack Developer #${runId}`,
    description: 'We are seeking an experienced developer to join our team.',
    postedBy: recruiterId,
    company: {
      name: 'LetGetIn Labs',
    },
    location: 'Remote',
    employmentType: 'full-time',
    status: 'active',
    finalShortlistTarget: 5,
    skills: ['React', 'Node.js', 'TypeScript', 'MongoDB'],
    stages: [
      {
        stageId: 'stage_resume_screen',
        stageName: 'Resume Screening',
        stageType: 'resume_match',
        order: 1,
        targetCount: 20,
        passingScore: 70,
        deadlineHours: 24,
      },
      {
        stageId: 'stage_assessment',
        stageName: 'Assessment',
        stageType: 'assessment',
        order: 2,
        targetCount: 15,
        passingScore: 75,
        deadlineHours: 48,
      },
      {
        stageId: 'stage_ai_interview',
        stageName: 'Interview',
        stageType: 'ai_interview',
        order: 3,
        targetCount: 10,
        passingScore: 75,
        deadlineHours: 48,
      },
      {
        stageId: 'stage_final_shortlist',
        stageName: 'Final Shortlist',
        stageType: 'manual_review',
        order: 4,
        targetCount: 5,
        passingScore: 80,
        deadlineHours: 48,
      },
      {
        stageId: 'stage_bgc',
        stageName: 'Background Verification (BGC)',
        stageType: 'manual_review',
        order: 5,
        targetCount: 5,
        passingScore: 80,
        deadlineHours: 72,
      },
    ],
  });

  console.log(`Created test job ${job._id} for recruiter ${recruiter._id}`);

  // Create candidates at various stages
  // Candidate 1: Shortlisted in Stage 1, advanced to Stage 2
  const user1 = await UserModel.create({
    email: `cand1_${runId}@example.com`,
    fullName: `Candidate 1 Passed S1`,
    role: 'user',
  });
  const resume1 = await ResumeModel.create({
    userId: user1._id,
    title: 'Resume Candidate 1',
    atsScore: 92,
    content: { personalInfo: { headline: 'Senior Frontend Dev' } },
  });
  const app1 = await ApplicationModel.create({
    jobId: job._id,
    userId: user1._id,
    resumeId: resume1._id,
    status: 'reviewing',
    currentStageIndex: 2,
    currentStageId: 'stage_assessment',
    stageStatus: 'invited',
    matchScore: 92,
    poolType: 'primary',
  });
  await CandidateStageHistoryModel.create({
    applicationId: app1._id,
    jobId: job._id,
    candidateId: user1._id,
    stageId: 'stage_resume_screen',
    stageName: 'Resume Screening',
    stageIndex: 1,
    status: 'passed',
    score: 92,
  });

  // Candidate 2: Eliminated at Stage 1 (Resume Screening)
  const user2 = await UserModel.create({
    email: `cand2_${runId}@example.com`,
    fullName: `Candidate 2 Failed S1`,
    role: 'user',
  });
  const resume2 = await ResumeModel.create({
    userId: user2._id,
    title: 'Resume Candidate 2',
    atsScore: 45,
    content: { personalInfo: { headline: 'Junior Intern' } },
  });
  const app2 = await ApplicationModel.create({
    jobId: job._id,
    userId: user2._id,
    resumeId: resume2._id,
    status: 'rejected',
    currentStageIndex: 1,
    currentStageId: 'stage_resume_screen',
    stageStatus: 'failed',
    matchScore: 45,
    poolType: 'disqualified',
    notes: 'Low ATS Match Score (45% < 70%)',
  });
  await CandidateStageHistoryModel.create({
    applicationId: app2._id,
    jobId: job._id,
    candidateId: user2._id,
    stageId: 'stage_resume_screen',
    stageName: 'Resume Screening',
    stageIndex: 1,
    status: 'failed',
    score: 45,
    notes: 'Low ATS Match Score',
  });

  // Candidate 3: Shortlisted in Stage 1 & Stage 2, currently in Stage 3 (Interview)
  const user3 = await UserModel.create({
    email: `cand3_${runId}@example.com`,
    fullName: `Candidate 3 In S3 Interview`,
    role: 'user',
  });
  const resume3 = await ResumeModel.create({
    userId: user3._id,
    title: 'Resume Candidate 3',
    atsScore: 88,
    content: { personalInfo: { headline: 'Full Stack Engineer' } },
  });
  const app3 = await ApplicationModel.create({
    jobId: job._id,
    userId: user3._id,
    resumeId: resume3._id,
    status: 'interviewing',
    currentStageIndex: 3,
    currentStageId: 'stage_ai_interview',
    stageStatus: 'invited',
    matchScore: 88,
    assessmentScore: 85,
    poolType: 'primary',
  });
  await CandidateStageHistoryModel.create({
    applicationId: app3._id,
    jobId: job._id,
    candidateId: user3._id,
    stageId: 'stage_resume_screen',
    stageName: 'Resume Screening',
    stageIndex: 1,
    status: 'passed',
    score: 88,
  });
  await CandidateStageHistoryModel.create({
    applicationId: app3._id,
    jobId: job._id,
    candidateId: user3._id,
    stageId: 'stage_assessment',
    stageName: 'Assessment',
    stageIndex: 2,
    status: 'passed',
    score: 85,
  });

  // Candidate 4: Eliminated at Stage 2 (Assessment)
  const user4 = await UserModel.create({
    email: `cand4_${runId}@example.com`,
    fullName: `Candidate 4 Failed S2 Assessment`,
    role: 'user',
  });
  const resume4 = await ResumeModel.create({
    userId: user4._id,
    title: 'Resume Candidate 4',
    atsScore: 82,
    content: { personalInfo: { headline: 'Backend Dev' } },
  });
  const app4 = await ApplicationModel.create({
    jobId: job._id,
    userId: user4._id,
    resumeId: resume4._id,
    status: 'rejected',
    currentStageIndex: 2,
    currentStageId: 'stage_assessment',
    stageStatus: 'failed',
    matchScore: 82,
    assessmentScore: 40,
    poolType: 'disqualified',
    notes: 'Assessment score 40% below 75% threshold',
  });
  await CandidateStageHistoryModel.create({
    applicationId: app4._id,
    jobId: job._id,
    candidateId: user4._id,
    stageId: 'stage_resume_screen',
    stageName: 'Resume Screening',
    stageIndex: 1,
    status: 'passed',
    score: 82,
  });
  await CandidateStageHistoryModel.create({
    applicationId: app4._id,
    jobId: job._id,
    candidateId: user4._id,
    stageId: 'stage_assessment',
    stageName: 'Assessment',
    stageIndex: 2,
    status: 'failed',
    score: 40,
    notes: 'Failed assessment test',
  });

  // Candidate 5: Completed all stages, in Stage 5 BGC passed
  const user5 = await UserModel.create({
    email: `cand5_${runId}@example.com`,
    fullName: `Candidate 5 Top Finalist`,
    role: 'user',
  });
  const resume5 = await ResumeModel.create({
    userId: user5._id,
    title: 'Resume Candidate 5',
    atsScore: 95,
    content: { personalInfo: { headline: 'Principal Architect' } },
  });
  const app5 = await ApplicationModel.create({
    jobId: job._id,
    userId: user5._id,
    resumeId: resume5._id,
    status: 'offered',
    currentStageIndex: 5,
    currentStageId: 'stage_bgc',
    stageStatus: 'passed',
    matchScore: 95,
    assessmentScore: 92,
    aiScore: 94,
    poolType: 'primary',
  });
  for (let i = 1; i <= 5; i++) {
    const stageNames = ['Resume Screening', 'Assessment', 'Interview', 'Final Shortlist', 'Background Verification (BGC)'];
    const stageIds = ['stage_resume_screen', 'stage_assessment', 'stage_ai_interview', 'stage_final_shortlist', 'stage_bgc'];
    await CandidateStageHistoryModel.create({
      applicationId: app5._id,
      jobId: job._id,
      candidateId: user5._id,
      stageId: stageIds[i - 1],
      stageName: stageNames[i - 1],
      stageIndex: i,
      status: 'passed',
      score: 90 + i,
    });
  }

  // --------------------------------------------------------------------------
  // TEST 1: Shortlist Summary Computation
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 1: Shortlist Summary for Job ---');
  const summary = await HiringEngineService.getShortlistSummary(String(job._id), String(recruiter._id));

  assert(Boolean(summary), 'Shortlist summary is returned');
  assert(summary.stages.length === 5, 'Summary contains exactly 5 sequential stages', `Received ${summary.stages.length}`);
  
  // Verify Stage 1 counts: App 1, 3, 4, 5 passed Stage 1 (4 candidates). App 2 failed Stage 1 (1 candidate).
  const s1 = summary.stages[0];
  assert(s1.slug === 'resume-screening', 'Stage 1 slug is resume-screening');
  assert(s1.selectedCount === 4, `Stage 1 selectedCount is 4 (Got ${s1.selectedCount})`);
  assert(s1.eliminatedCount === 1, `Stage 1 eliminatedCount is 1 (Got ${s1.eliminatedCount})`);
  assert(s1.totalCount === 5, `Stage 1 totalCount is 5 (Got ${s1.totalCount})`);
  assert(s1.ratio === '4/5', `Stage 1 ratio is 4/5 (Got ${s1.ratio})`);
  assert(s1.eliminatedRatio === '1/5', `Stage 1 eliminatedRatio is 1/5 (Got ${s1.eliminatedRatio})`);

  // Verify Stage 2 counts: App 3, 5 passed Stage 2 (2 candidates). App 4 failed Stage 2 (1 candidate).
  const s2 = summary.stages[1];
  assert(s2.slug === 'assessment', 'Stage 2 slug is assessment');
  assert(s2.selectedCount === 2, `Stage 2 selectedCount is 2 (Got ${s2.selectedCount})`);
  assert(s2.eliminatedCount === 1, `Stage 2 eliminatedCount is 1 (Got ${s2.eliminatedCount})`);
  assert(s2.totalCount === 3, `Stage 2 totalCount is 3 (Got ${s2.totalCount})`);

  // --------------------------------------------------------------------------
  // TEST 2: Stage 1 Shortlisted Candidates Filtering
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Stage 1 Shortlisted Candidates ---');
  const s1Shortlisted = await HiringEngineService.getShortlistStageCandidates(
    String(job._id),
    'resume-screening',
    'shortlisted',
    String(recruiter._id)
  );

  assert(s1Shortlisted.status === 'shortlisted', 'Status returned is shortlisted');
  assert(s1Shortlisted.count === 4, `Stage 1 shortlisted count is 4 (Got ${s1Shortlisted.count})`);
  const s1ShortlistedIds = s1Shortlisted.candidates.map((c) => c._id);
  assert(s1ShortlistedIds.includes(String(app1._id)), 'Includes candidate 1');
  assert(s1ShortlistedIds.includes(String(app3._id)), 'Includes candidate 3');
  assert(s1ShortlistedIds.includes(String(app4._id)), 'Includes candidate 4 (who passed S1)');
  assert(s1ShortlistedIds.includes(String(app5._id)), 'Includes candidate 5');
  assert(!s1ShortlistedIds.includes(String(app2._id)), 'DOES NOT INCLUDE candidate 2 (who was eliminated at S1)');

  // --------------------------------------------------------------------------
  // TEST 3: Stage 1 Eliminated Candidates Filtering
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Stage 1 Eliminated Candidates ---');
  const s1Eliminated = await HiringEngineService.getShortlistStageCandidates(
    String(job._id),
    'resume-screening',
    'eliminated',
    String(recruiter._id)
  );

  assert(s1Eliminated.status === 'eliminated', 'Status returned is eliminated');
  assert(s1Eliminated.count === 1, `Stage 1 eliminated count is 1 (Got ${s1Eliminated.count})`);
  assert(s1Eliminated.candidates[0]._id === String(app2._id), 'Contains Candidate 2');
  assert(Boolean(s1Eliminated.candidates[0].eliminationReason), 'Contains elimination reason');
  assert(!s1Eliminated.candidates.some((c) => c._id === String(app1._id)), 'DOES NOT INCLUDE Candidate 1');

  // --------------------------------------------------------------------------
  // TEST 4: Stage 2 Shortlisted & Eliminated Candidate Isolation
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Stage 2 Shortlisted vs Eliminated Isolation ---');
  const s2Shortlisted = await HiringEngineService.getShortlistStageCandidates(
    String(job._id),
    'assessment',
    'shortlisted',
    String(recruiter._id)
  );
  const s2Eliminated = await HiringEngineService.getShortlistStageCandidates(
    String(job._id),
    'assessment',
    'eliminated',
    String(recruiter._id)
  );

  assert(s2Shortlisted.count === 2, `Stage 2 shortlisted count is 2 (Got ${s2Shortlisted.count})`);
  assert(s2Eliminated.count === 1, `Stage 2 eliminated count is 1 (Got ${s2Eliminated.count})`);
  assert(s2Eliminated.candidates[0]._id === String(app4._id), 'Candidate 4 is in Stage 2 eliminated list');
  assert(!s2Shortlisted.candidates.some((c) => c._id === String(app4._id)), 'Candidate 4 is NOT in Stage 2 shortlisted list');

  // --------------------------------------------------------------------------
  // TEST 5: Candidate Details & Stage Journey
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: Candidate Details Profile Endpoint ---');
  const candidateDetail = await HiringEngineService.getCandidateDetail(
    String(job._id),
    String(app5._id),
    String(recruiter._id)
  );

  assert(candidateDetail._id === String(app5._id), 'Candidate detail returned correctly');
  assert(candidateDetail.userId.fullName === 'Candidate 5 Top Finalist', 'User name resolved');
  assert(candidateDetail.history.length === 5, 'Full 5-stage transition audit history returned');
  assert(candidateDetail.matchScore === 95, 'Match score populated');

  // --------------------------------------------------------------------------
  // TEST 6: Candidate Resume Retrieval
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Candidate Resume Retrieval Endpoint ---');
  const candidateResume = await HiringEngineService.getCandidateResume(
    String(job._id),
    String(app5._id),
    String(recruiter._id)
  );

  assert(Boolean(candidateResume), 'Resume found for candidate');
  assert(candidateResume.title === 'Resume Candidate 5', 'Resume title matches');
  assert(candidateResume.atsScore === 95, 'Resume atsScore matches');

  // --------------------------------------------------------------------------
  // TEST 7: Recruiter Authorization & Ownership Protection
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: Recruiter Authorization & Access Control ---');
  let authFailed = false;
  try {
    await HiringEngineService.getShortlistSummary(String(job._id), String(otherRecruiterId));
  } catch (err: any) {
    authFailed = true;
  }
  assert(authFailed, 'Unauthorized recruiter access is rejected with error');

  // --------------------------------------------------------------------------
  // CLEANUP TEST DATA
  // --------------------------------------------------------------------------
  console.log('\n--- CLEANUP ---');
  await Promise.all([
    JobModel.deleteOne({ _id: job._id }),
    HiringFunnelConfigModel.deleteOne({ jobId: job._id }),
    UserModel.deleteMany({ _id: { $in: [recruiterId, user1._id, user2._id, user3._id, user4._id, user5._id] } }),
    ResumeModel.deleteMany({ _id: { $in: [resume1._id, resume2._id, resume3._id, resume4._id, resume5._id] } }),
    ApplicationModel.deleteMany({ _id: { $in: [app1._id, app2._id, app3._id, app4._id, app5._id] } }),
    CandidateStageHistoryModel.deleteMany({ jobId: job._id }),
  ]);
  console.log('Cleaned up test data.');

  console.log('\n================================================================');
  console.log(`🏁 TEST RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runShortlistBackendTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
