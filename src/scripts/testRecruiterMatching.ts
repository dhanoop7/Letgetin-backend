import mongoose, { Types } from 'mongoose';
import { ApplicationModel } from '../modules/application/application.model.js';
import { JobModel } from '../modules/job/job.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { UserProfileModel } from '../modules/profile/profile.model.js';
import { CandidateProfileModel } from '../modules/job/candidateProfile.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import { resumeScreeningService } from '../modules/resumeScreening/resumeScreening.service.js';
import { HiringPoolManager } from '../modules/hiringEngine/services/hiringPoolManager.js';
import { recruiterCreditsService } from '../modules/recruiterCredits/recruiterCredits.service.js';
import { RecruiterOrganizationModel } from '../modules/recruiterOrg/recruiterOrg.model.js';
import { RecruiterCreditsModel } from '../modules/recruiterCredits/recruiterCredits.model.js';
import { connectDatabase } from '../config/database.js';

let passed = 0;
let failed = 0;

function assert(condition: any, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} - ${detail || 'Assertion failed'}`);
    failed++;
  }
}

async function runRecruiterMatchingTests() {
  console.log('================================================================');
  console.log('🧪 LETGETIN PHASE 4.1: RECRUITER MATCHING INTEGRATION TEST SUITE');
  console.log('================================================================\n');

  await connectDatabase();

  const createdUserIds: Types.ObjectId[] = [];
  const createdJobIds: Types.ObjectId[] = [];
  const createdAppIds: Types.ObjectId[] = [];
  const createdResumeIds: Types.ObjectId[] = [];
  const createdOrgIds: Types.ObjectId[] = [];

  try {
    const recruiterAId = new Types.ObjectId();
    const recruiterBId = new Types.ObjectId();
    createdUserIds.push(recruiterAId, recruiterBId);

    await UserModel.create([
      { _id: recruiterAId, fullName: 'Recruiter Alpha', email: 'recruiter.alpha@test.com', role: 'recruiter' },
      { _id: recruiterBId, fullName: 'Recruiter Beta', email: 'recruiter.beta@test.com', role: 'recruiter' },
    ]);

    const orgAId = new Types.ObjectId();
    createdOrgIds.push(orgAId);
    await RecruiterOrganizationModel.create({
      _id: orgAId,
      ownerUserId: recruiterAId,
      entity: 'company',
      name: 'TechCorp Recruiter',
    });
    await RecruiterCreditsModel.create({
      orgId: orgAId,
      balance: 100,
    });

    // Helper to create test candidate with profile and resume
    async function createCandidate(options: {
      fullName: string;
      email: string;
      headline?: string;
      skills?: string[];
      experiences?: Array<{ title: string; company: string; start: string; end?: string; isCurrent?: boolean }>;
      educations?: Array<{ institution: string; degree: string }>;
      embedding?: number[];
    }) {
      const userId = new Types.ObjectId();
      createdUserIds.push(userId);

      await UserModel.create({
        _id: userId,
        fullName: options.fullName,
        email: options.email,
        role: 'user',
      });

      const resumeId = new Types.ObjectId();
      createdResumeIds.push(resumeId);
      await ResumeModel.create({
        _id: resumeId,
        userId,
        title: `${options.fullName} Resume`,
        isActive: true,
        content: {
          personalInfo: { fullName: options.fullName, headline: options.headline },
          skills: options.skills || [],
          experiences: (options.experiences || []).map((e, idx) => ({
            id: `exp-${idx}`,
            company: e.company,
            position: e.title,
            startDate: e.start,
            endDate: e.end || '',
            isCurrent: !!e.isCurrent,
          })),
          educations: (options.educations || []).map((edu, idx) => ({
            id: `edu-${idx}`,
            institution: edu.institution,
            degree: edu.degree,
          })),
        },
      });

      await CandidateProfileModel.create({
        userId,
        headline: options.headline,
        skills: options.skills || [],
        embedding: options.embedding,
        embeddingStatus: options.embedding ? 'completed' : 'pending',
      });

      return { userId, resumeId };
    }

    // ------------------------------------------------------------------------
    // SCENARIO 1 & 2: Exact required skills match vs missing required skills
    // ------------------------------------------------------------------------
    console.log('--- 1 & 2: Exact Required Skills vs Missing Required Skills ---');
    const job1 = await JobModel.create({
      title: 'Full Stack Engineer',
      company: { name: 'TechCorp' },
      description: 'Looking for an experienced Node.js and TypeScript developer',
      postedBy: recruiterAId,
      skills: ['Node.js', 'TypeScript', 'MongoDB'],
      structuredRequirements: {
        requiredSkills: ['Node.js', 'TypeScript', 'MongoDB'],
        preferredSkills: ['Redis', 'Docker'],
        minimumExperienceYears: 3,
        maximumExperienceYears: 6,
        education: { minimumLevel: 'bachelor' },
      },
    });
    createdJobIds.push(job1._id);

    const cand1Exact = await createCandidate({
      fullName: 'Alice Exact',
      email: 'alice.exact@test.com',
      headline: 'Full Stack Engineer',
      skills: ['Node.js', 'TypeScript', 'MongoDB', 'Redis'],
      experiences: [{ title: 'Full Stack Engineer', company: 'Acme', start: '2020-01-01', end: '2024-01-01' }], // 4 yrs
      educations: [{ institution: 'State University', degree: 'Bachelor of Science' }],
    });

    const app1 = await ApplicationModel.create({
      jobId: job1._id,
      userId: cand1Exact.userId,
      resumeId: cand1Exact.resumeId,
      status: 'submitted',
    });
    createdAppIds.push(app1._id);

    const evaluated1 = await resumeScreeningService.evaluateApplicationResume(app1._id);

    assert(evaluated1.resumeEvaluation?.skillsMatchScore === 100, 'Scenario 1: Exact required skills yields 100 skillsMatchScore');
    assert(evaluated1.resumeEvaluation?.matchedSkills.length === 3, 'Scenario 1: All 3 required skills matched');
    assert(evaluated1.resumeEvaluation?.missingSkills.length === 0, 'Scenario 1: missingSkills is empty');
    assert(
      evaluated1.resumeEvaluation?.breakdown?.requiredSkillsScore === 100,
      'Scenario 1: Canonical breakdown.requiredSkillsScore is 100'
    );

    // Missing skills
    const cand2Missing = await createCandidate({
      fullName: 'Bob Missing',
      email: 'bob.missing@test.com',
      headline: 'Junior Developer',
      skills: ['HTML', 'CSS'],
      experiences: [{ title: 'Developer', company: 'Beta Corp', start: '2022-01-01', end: '2024-01-01' }],
      educations: [{ institution: 'College', degree: 'Bachelor of Arts' }],
    });

    const app2 = await ApplicationModel.create({
      jobId: job1._id,
      userId: cand2Missing.userId,
      resumeId: cand2Missing.resumeId,
      status: 'submitted',
    });
    createdAppIds.push(app2._id);

    const evaluated2 = await resumeScreeningService.evaluateApplicationResume(app2._id);

    assert(evaluated2.resumeEvaluation?.skillsMatchScore === 0, 'Scenario 2: Missing all required skills yields 0 skills score');
    assert(evaluated2.resumeEvaluation?.missingSkills.length === 3, 'Scenario 2: missingSkills includes all 3 required skills');
    assert(
      evaluated2.resumeEvaluation?.weaknesses.some((w: string) => w.toLowerCase().includes('missing core skills')),
      'Scenario 2: Weaknesses highlights missing core skills'
    );

    // ------------------------------------------------------------------------
    // SCENARIO 3: Preferred skill matching
    // ------------------------------------------------------------------------
    console.log('\n--- 3: Preferred Skill Matching ---');
    assert(
      evaluated1.resumeEvaluation?.breakdown?.preferredSkillsScore === 50,
      'Scenario 3: 1 of 2 preferred skills (Redis) matched yields 50% preferredSkillsScore'
    );
    assert(
      evaluated1.resumeEvaluation?.matchedPreferredSkills?.includes('Redis') === true,
      'Scenario 3: matchedPreferredSkills contains Redis'
    );
    assert(
      evaluated2.resumeEvaluation?.breakdown?.preferredSkillsScore === 0,
      'Scenario 3: 0 preferred skills matched yields 0 preferredSkillsScore'
    );

    // ------------------------------------------------------------------------
    // SCENARIO 4, 5, 6: Experience within range, below minimum, above maximum
    // ------------------------------------------------------------------------
    console.log('\n--- 4, 5, 6: Experience Range Matching ---');
    // Alice had 4 years (min 3, max 6) -> within_range
    assert(
      evaluated1.resumeEvaluation?.experienceMatchScore === 100,
      'Scenario 4: 4 years exp inside [3, 6] range gives 100 experienceMatchScore'
    );
    assert(
      evaluated1.resumeEvaluation?.breakdown?.experienceScore === 100,
      'Scenario 4: Canonical breakdown.experienceScore is 100'
    );

    // Below minimum: 1 year experience for min 3 years
    const candBelowExp = await createCandidate({
      fullName: 'Charlie Junior',
      email: 'charlie.junior@test.com',
      skills: ['Node.js', 'TypeScript', 'MongoDB'],
      experiences: [{ title: 'Intern', company: 'Startup', start: '2023-01-01', end: '2024-01-01' }], // 1 yr
      educations: [{ institution: 'University', degree: 'Bachelor' }],
    });
    const appBelowExp = await ApplicationModel.create({
      jobId: job1._id,
      userId: candBelowExp.userId,
      resumeId: candBelowExp.resumeId,
      status: 'submitted',
    });
    createdAppIds.push(appBelowExp._id);
    const evaluatedBelowExp = await resumeScreeningService.evaluateApplicationResume(appBelowExp._id);

    assert(
      evaluatedBelowExp.resumeEvaluation!.experienceMatchScore < 70,
      'Scenario 5: 1 year exp below minimum 3 years receives graduated score below 70'
    );
    assert(
      evaluatedBelowExp.resumeEvaluation?.weaknesses.some((w: string) => w.toLowerCase().includes('below target minimum experience')),
      'Scenario 5: Weaknesses notes below target minimum experience'
    );

    // Above maximum: 10 years experience for max 6 years
    const candAboveExp = await createCandidate({
      fullName: 'Dave Veteran',
      email: 'dave.veteran@test.com',
      skills: ['Node.js', 'TypeScript', 'MongoDB'],
      experiences: [{ title: 'Principal Engineer', company: 'BigTech', start: '2014-01-01', end: '2024-01-01' }], // 10 yrs
      educations: [{ institution: 'University', degree: 'Bachelor' }],
    });
    const appAboveExp = await ApplicationModel.create({
      jobId: job1._id,
      userId: candAboveExp.userId,
      resumeId: candAboveExp.resumeId,
      status: 'submitted',
    });
    createdAppIds.push(appAboveExp._id);
    const evaluatedAboveExp = await resumeScreeningService.evaluateApplicationResume(appAboveExp._id);

    assert(
      evaluatedAboveExp.resumeEvaluation!.experienceMatchScore >= 85,
      'Scenario 6: 10 years exp exceeding max 6 years receives score >= 85 (not harshly penalized)'
    );

    // ------------------------------------------------------------------------
    // SCENARIO 7: Education matching
    // ------------------------------------------------------------------------
    console.log('\n--- 7: Education Matching ---');
    assert(
      evaluated1.resumeEvaluation?.breakdown?.educationScore === 100,
      'Scenario 7.1: Bachelor candidate for Bachelor requirement gives 100 education score'
    );

    const candAssociate = await createCandidate({
      fullName: 'Emma Associate',
      email: 'emma.associate@test.com',
      skills: ['Node.js', 'TypeScript', 'MongoDB'],
      experiences: [{ title: 'Engineer', company: 'Corp', start: '2020-01-01', end: '2024-01-01' }],
      educations: [{ institution: 'Community College', degree: 'Associate of Science' }],
    });
    const appAssociate = await ApplicationModel.create({
      jobId: job1._id,
      userId: candAssociate.userId,
      resumeId: candAssociate.resumeId,
      status: 'submitted',
    });
    createdAppIds.push(appAssociate._id);
    const evaluatedAssociate = await resumeScreeningService.evaluateApplicationResume(appAssociate._id);

    assert(
      evaluatedAssociate.resumeEvaluation?.breakdown?.educationScore === 75,
      'Scenario 7.2: Associate candidate for Bachelor requirement receives graduated score 75'
    );

    // ------------------------------------------------------------------------
    // SCENARIO 8: Semantic relevance
    // ------------------------------------------------------------------------
    console.log('\n--- 8: Semantic Relevance Matching ---');
    const embeddingMock = Array(768).fill(0.1);
    const jobWithEmbedding = await JobModel.create({
      title: 'AI Research Engineer',
      description: 'Research and development of cutting-edge neural architectures and AI applications',
      company: { name: 'TechCorp' },
      postedBy: recruiterAId,
      embedding: embeddingMock,
      structuredRequirements: {
        requiredSkills: ['Python', 'PyTorch'],
        minimumExperienceYears: 2,
      },
    });
    createdJobIds.push(jobWithEmbedding._id);

    const candWithEmbedding = await createCandidate({
      fullName: 'Frank Semantic',
      email: 'frank.semantic@test.com',
      headline: 'AI Research Engineer',
      skills: ['Python', 'PyTorch'],
      embedding: embeddingMock,
      experiences: [{ title: 'AI Researcher', company: 'Lab', start: '2021-01-01', end: '2024-01-01' }],
    });
    const appSemantic = await ApplicationModel.create({
      jobId: jobWithEmbedding._id,
      userId: candWithEmbedding.userId,
      resumeId: candWithEmbedding.resumeId,
      status: 'submitted',
    });
    createdAppIds.push(appSemantic._id);
    const evaluatedSemantic = await resumeScreeningService.evaluateApplicationResume(appSemantic._id);

    assert(
      evaluatedSemantic.resumeEvaluation?.breakdown?.semanticScore === 100,
      'Scenario 8.1: Identical vector embeddings yield 100 semantic score'
    );
    assert(
      evaluatedSemantic.resumeEvaluation?.strengths.some((s: string) => s.toLowerCase().includes('semantic relevance')),
      'Scenario 8.2: High semantic score generates strengths explanation'
    );

    // ------------------------------------------------------------------------
    // SCENARIO 9: Role relevance
    // ------------------------------------------------------------------------
    console.log('\n--- 9: Role Relevance Matching ---');
    assert(
      evaluatedSemantic.resumeEvaluation?.breakdown?.roleRelevanceScore! >= 80,
      'Scenario 9: Candidate headline "AI Research Engineer" matches job title yields high role relevance (>= 80)'
    );

    // ------------------------------------------------------------------------
    // SCENARIO 10: Candidate with no embedding
    // ------------------------------------------------------------------------
    console.log('\n--- 10: Candidate With No Embedding ---');
    const candNoEmbedding = await createCandidate({
      fullName: 'Grace NoVector',
      email: 'grace.novector@test.com',
      skills: ['Python', 'PyTorch'],
      experiences: [{ title: 'Researcher', company: 'Tech', start: '2021-01-01', end: '2024-01-01' }],
    });
    const appNoEmbedding = await ApplicationModel.create({
      jobId: jobWithEmbedding._id,
      userId: candNoEmbedding.userId,
      resumeId: candNoEmbedding.resumeId,
      status: 'submitted',
    });
    createdAppIds.push(appNoEmbedding._id);
    const evaluatedNoEmbedding = await resumeScreeningService.evaluateApplicationResume(appNoEmbedding._id);

    assert(
      typeof evaluatedNoEmbedding.resumeEvaluation?.overallScore === 'number' &&
        !isNaN(evaluatedNoEmbedding.resumeEvaluation.overallScore),
      'Scenario 10.1: Candidate without embedding computes valid numeric overallScore'
    );
    assert(
      typeof evaluatedNoEmbedding.resumeEvaluation?.breakdown?.semanticScore === 'number',
      'Scenario 10.2: semanticScore computes contextual fallback without NaN'
    );

    // ------------------------------------------------------------------------
    // SCENARIO 11: Job with no optional requirements (Dynamic Rebalancing)
    // ------------------------------------------------------------------------
    console.log('\n--- 11: Candidate With No Optional Requirements (Dynamic Rebalancing) ---');
    const jobBareMinimum = await JobModel.create({
      title: 'Warehouse Specialist',
      description: 'Warehouse inventory operations, material handling and forklift logistics',
      company: { name: 'TechCorp' },
      postedBy: recruiterAId,
      structuredRequirements: {
        requiredSkills: ['Inventory Management', 'Forklift'],
        minimumExperienceYears: 1,
      },
    });
    createdJobIds.push(jobBareMinimum._id);

    const candWarehouse = await createCandidate({
      fullName: 'Hank Logistics',
      email: 'hank.logistics@test.com',
      headline: 'Warehouse Specialist',
      skills: ['Inventory Management', 'Forklift'],
      experiences: [{ title: 'Warehouse Associate', company: 'Supply Co', start: '2022-01-01', end: '2024-01-01' }],
    });
    const appWarehouse = await ApplicationModel.create({
      jobId: jobBareMinimum._id,
      userId: candWarehouse.userId,
      resumeId: candWarehouse.resumeId,
      status: 'submitted',
    });
    createdAppIds.push(appWarehouse._id);
    const evaluatedWarehouse = await resumeScreeningService.evaluateApplicationResume(appWarehouse._id);

    assert(
      evaluatedWarehouse.resumeEvaluation?.overallScore! >= 90,
      'Scenario 11: Rebalanced weights without preferred skills or education produces accurate high score (>= 90)'
    );

    // ------------------------------------------------------------------------
    // SCENARIO 12: Candidate with profile + resume merged
    // ------------------------------------------------------------------------
    console.log('\n--- 12: Candidate with Profile and Resume Merged ---');
    const candMergedUser = new Types.ObjectId();
    createdUserIds.push(candMergedUser);
    await UserModel.create({
      _id: candMergedUser,
      fullName: 'Iris Merged',
      email: 'iris.merged@test.com',
      role: 'user',
    });
    await UserProfileModel.create({
      userId: candMergedUser,
      personal: { headline: 'Senior Systems Architect' },
      skills: ['Linux', 'Kubernetes'],
    });
    const mergedResumeId = new Types.ObjectId();
    createdResumeIds.push(mergedResumeId);
    await ResumeModel.create({
      _id: mergedResumeId,
      userId: candMergedUser,
      title: 'Iris Resume',
      content: {
        skills: ['Terraform', 'Go'],
        experiences: [{ position: 'DevOps Lead', company: 'Cloud Inc', startDate: '2019-01-01', endDate: '2024-01-01' }],
        educations: [{ institution: 'Tech Institute', degree: 'Bachelor of Computer Science' }],
      },
    });

    const jobDevOps = await JobModel.create({
      title: 'Cloud Systems Architect',
      description: 'Design and deploy scalable cloud infrastructure and CI/CD pipelines',
      company: { name: 'TechCorp' },
      postedBy: recruiterAId,
      structuredRequirements: {
        requiredSkills: ['Linux', 'Terraform'],
        preferredSkills: ['Kubernetes', 'Go'],
        minimumExperienceYears: 4,
        education: { minimumLevel: 'bachelor' },
      },
    });
    createdJobIds.push(jobDevOps._id);

    const appMerged = await ApplicationModel.create({
      jobId: jobDevOps._id,
      userId: candMergedUser,
      resumeId: mergedResumeId,
      status: 'submitted',
    });
    createdAppIds.push(appMerged._id);
    const evaluatedMerged = await resumeScreeningService.evaluateApplicationResume(appMerged._id);

    assert(
      evaluatedMerged.resumeEvaluation?.matchedSkills.includes('Linux') &&
        evaluatedMerged.resumeEvaluation?.matchedSkills.includes('Terraform'),
      'Scenario 12.1: Skills merged across profile ("Linux") and resume ("Terraform") both matched required skills'
    );
    assert(
      evaluatedMerged.resumeEvaluation?.matchedPreferredSkills?.includes('Kubernetes') &&
        evaluatedMerged.resumeEvaluation?.matchedPreferredSkills?.includes('Go'),
      'Scenario 12.2: Preferred skills merged across profile and resume both matched'
    );

    // ------------------------------------------------------------------------
    // SCENARIO 13: Recruiter ownership & security
    // ------------------------------------------------------------------------
    console.log('\n--- 13: Recruiter Ownership & Security ---');
    let unauthorizedBlocked = false;
    try {
      await resumeScreeningService.recordRecruiterDecision(
        app1._id,
        String(recruiterBId), // Recruiter B does not own Job 1
        { decision: 'shortlisted' }
      );
    } catch (err: any) {
      unauthorizedBlocked = err?.statusCode === 403 || err?.message?.includes('denied') || err?.message?.includes('ownership');
    }
    assert(unauthorizedBlocked, 'Scenario 13: Recruiter B blocked with 403 when modifying Recruiter A application');

    // ------------------------------------------------------------------------
    // SCENARIO 14: Existing Resume Screening Business Logic Preserved
    // ------------------------------------------------------------------------
    console.log('\n--- 14: Existing Resume Screening Business Logic Preserved ---');
    // Recruiter A makes authoritative shortlist decision
    const shortlistedApp = await resumeScreeningService.recordRecruiterDecision(
      app1._id,
      String(recruiterAId),
      { decision: 'shortlisted', notes: 'Top candidate' }
    );
    assert(shortlistedApp.resumeDecision === 'shortlisted', 'Scenario 14.1: resumeDecision updated to "shortlisted"');
    assert(shortlistedApp.resumeDecisionNotes === 'Top candidate', 'Scenario 14.2: Notes saved properly');

    const stats = await resumeScreeningService.getScreeningStats(String(job1._id), String(recruiterAId));
    assert(stats.shortlisted >= 1, 'Scenario 14.3: Screening stats accurately reflect shortlisted candidate');
    assert(stats.actualQualifiedCount >= 1, 'Scenario 14.4: Authoritative qualified count tracks shortlisted candidate');

    // ------------------------------------------------------------------------
    // SCENARIO 15: Existing Hiring Pool Behavior Preserved
    // ------------------------------------------------------------------------
    console.log('\n--- 15: Existing Hiring Pool Behavior Preserved ---');
    const compScore = await HiringPoolManager.computeOrGetCompositeScore(app1, job1.skills || [], job1.embedding);
    assert(
      compScore === evaluated1.resumeEvaluation?.overallScore,
      'Scenario 15.1: computeOrGetCompositeScore reuses authoritative canonical matchScore'
    );

    // Initial pool partition respects compositeRank order
    const partitionResult = await HiringPoolManager.partitionInitialPool(
      job1._id,
      'stage_initial_screen',
      1, // 1 primary seat
      48
    );
    assert(partitionResult.primaryCandidates.length === 1, 'Scenario 15.2: Exactly 1 candidate placed in Primary pool');
    assert(
      String(partitionResult.primaryCandidates[0]._id) === String(app1._id),
      'Scenario 15.3: Highest-ranked candidate (Alice, exact match) placed in Primary pool'
    );
    assert(
      partitionResult.primaryCandidates[0].poolType === 'primary',
      'Scenario 15.4: Primary candidate poolType is "primary"'
    );
    assert(
      partitionResult.primaryCandidates[0].stageStatus === 'invited',
      'Scenario 15.5: Stage status set to "invited" with deadline'
    );

    // Recruiter talent search uses canonical matching
    const searchResults = await recruiterCreditsService.searchCandidates(
      String(recruiterAId),
      { jobId: String(job1._id), limit: 5 }
    );
    assert(Array.isArray(searchResults) && searchResults.length > 0, 'Scenario 15.6: Recruiter searchCandidates returns ranked list');
    assert(
      searchResults[0].matchScore >= 80,
      'Scenario 15.7: Top candidate has high canonical matchScore in recruiter search'
    );

  } finally {
    console.log('\n🧹 Cleaning up test database records...');
    await Promise.all([
      ApplicationModel.deleteMany({ _id: { $in: createdAppIds } }),
      JobModel.deleteMany({ _id: { $in: createdJobIds } }),
      UserModel.deleteMany({ _id: { $in: createdUserIds } }),
      UserProfileModel.deleteMany({ userId: { $in: createdUserIds } }),
      CandidateProfileModel.deleteMany({ userId: { $in: createdUserIds } }),
      ResumeModel.deleteMany({ _id: { $in: createdResumeIds } }),
      RecruiterOrganizationModel.deleteMany({ _id: { $in: createdOrgIds } }),
      RecruiterCreditsModel.deleteMany({ orgId: { $in: createdOrgIds } }),
    ]);
    await mongoose.disconnect();
  }

  console.log('\n================================================================');
  console.log(`📊 RECRUITER MATCHING TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRecruiterMatchingTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
