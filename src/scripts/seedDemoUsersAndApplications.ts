import { connectDatabase } from '../config/database.js';
import { UserModel } from '../modules/user/user.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import { JobModel } from '../modules/job/job.model.js';
import { ApplicationModel } from '../modules/application/application.model.js';
import { HiringFunnelConfigModel } from '../modules/hiringEngine/hiringFunnelConfig.model.js';
import { CandidateStageHistoryModel } from '../modules/hiringEngine/candidateStageHistory.model.js';
import { PasswordUtils } from '../utils/password.js';
import { Types } from 'mongoose';

interface DemoUserSpec {
  username: string;
  fullName: string;
  email: string;
  phone: string;
  stageId: string;
  stageName: string;
  stageIndex: number;
  poolType: 'primary' | 'reserve' | 'disqualified';
  stageStatus: 'invited' | 'started' | 'completed' | 'passed' | 'failed' | 'no_show';
  appStatus: 'submitted' | 'reviewing' | 'shortlisted' | 'interviewing' | 'offered' | 'rejected' | 'failed';
  matchScore: number;
  assessmentScore?: number;
  aiScore?: number;
  atsScore: number;
  skills: string[];
  currentRole: string;
  summary: string;
}

const DEMO_USERS: DemoUserSpec[] = [
  {
    username: 'demouser1',
    fullName: 'Demo User 1 (Alex Carter)',
    email: 'demouser1@example.com',
    phone: '+919876543201',
    stageId: 'stage_resume_screen',
    stageName: 'Resume Screening',
    stageIndex: 1,
    poolType: 'primary',
    stageStatus: 'invited',
    appStatus: 'submitted',
    matchScore: 94,
    atsScore: 92,
    skills: ['TypeScript', 'React', 'Node.js', 'Next.js', 'PostgreSQL'],
    currentRole: 'Senior Frontend Engineer at TechCorp',
    summary: 'Full-stack engineer with 5+ years specializing in modern Next.js and high-performance React applications.',
  },
  {
    username: 'demouser2',
    fullName: 'Demo User 2 (Jordan Chen)',
    email: 'demouser2@example.com',
    phone: '+919876543202',
    stageId: 'stage_resume_screen',
    stageName: 'Resume Screening',
    stageIndex: 1,
    poolType: 'primary',
    stageStatus: 'started',
    appStatus: 'reviewing',
    matchScore: 89,
    atsScore: 87,
    skills: ['Node.js', 'TypeScript', 'MongoDB', 'Docker', 'Redis'],
    currentRole: 'Backend Developer at CloudScale',
    summary: 'Experienced backend developer focusing on scalable microservices, distributed queues, and MongoDB aggregations.',
  },
  {
    username: 'demouser3',
    fullName: 'Demo User 3 (Taylor Morgan)',
    email: 'demouser3@example.com',
    phone: '+919876543203',
    stageId: 'stage_resume_screen',
    stageName: 'Resume Screening',
    stageIndex: 1,
    poolType: 'primary',
    stageStatus: 'passed',
    appStatus: 'reviewing',
    matchScore: 91,
    atsScore: 90,
    skills: ['React', 'TypeScript', 'Tailwind CSS', 'Redux', 'GraphQL'],
    currentRole: 'UI/UX Frontend Specialist at PixelCraft',
    summary: 'Design-oriented frontend developer with a strong focus on pixel-perfect UIs, animations, and clean architectures.',
  },
  {
    username: 'demouser4',
    fullName: 'Demo User 4 (Sam Rivera)',
    email: 'demouser4@example.com',
    phone: '+919876543204',
    stageId: 'stage_resume_screen',
    stageName: 'Resume Screening',
    stageIndex: 1,
    poolType: 'reserve',
    stageStatus: 'invited',
    appStatus: 'submitted',
    matchScore: 82,
    atsScore: 80,
    skills: ['JavaScript', 'Python', 'React', 'FastAPI', 'PostgreSQL'],
    currentRole: 'Full Stack Engineer at DataForge',
    summary: 'Versatile software engineer working across Python backends and React frontends. Ready in reserve pool.',
  },
  {
    username: 'demouser5',
    fullName: 'Demo User 5 (Casey Brooks)',
    email: 'demouser5@example.com',
    phone: '+919876543205',
    stageId: 'stage_resume_screen',
    stageName: 'Resume Screening',
    stageIndex: 1,
    poolType: 'reserve',
    stageStatus: 'invited',
    appStatus: 'submitted',
    matchScore: 78,
    atsScore: 76,
    skills: ['Vue.js', 'Node.js', 'Express', 'MySQL', 'AWS'],
    currentRole: 'Web Developer at Innovatech',
    summary: 'Full-stack web engineer with a passion for robust APIs and streamlined user workflows.',
  },
  {
    username: 'demouser6',
    fullName: 'Demo User 6 (Riley Vance)',
    email: 'demouser6@example.com',
    phone: '+919876543206',
    stageId: 'stage_assessment',
    stageName: 'Technical Assessment',
    stageIndex: 2,
    poolType: 'primary',
    stageStatus: 'invited',
    appStatus: 'reviewing',
    matchScore: 88,
    assessmentScore: 85,
    atsScore: 86,
    skills: ['TypeScript', 'Data Structures', 'System Design', 'Algorithms', 'Node.js'],
    currentRole: 'Software Engineer II at FinEdge',
    summary: 'Solid computer science background with strong algorithms and high-throughput backend services expertise.',
  },
  {
    username: 'demouser7',
    fullName: 'Demo User 7 (Morgan Taylor)',
    email: 'demouser7@example.com',
    phone: '+919876543207',
    stageId: 'stage_assessment',
    stageName: 'Technical Assessment',
    stageIndex: 2,
    poolType: 'primary',
    stageStatus: 'started',
    appStatus: 'reviewing',
    matchScore: 86,
    assessmentScore: 79,
    atsScore: 84,
    skills: ['React Native', 'React', 'TypeScript', 'Node.js', 'GraphQL'],
    currentRole: 'Mobile & Web Engineer at AppFlow',
    summary: 'Cross-platform engineer proficient in React Native and web stacks with clean code practices.',
  },
  {
    username: 'demouser8',
    fullName: 'Demo User 8 (Avery Patel)',
    email: 'demouser8@example.com',
    phone: '+919876543208',
    stageId: 'stage_ai_interview',
    stageName: 'AI Comprehensive Interview',
    stageIndex: 3,
    poolType: 'primary',
    stageStatus: 'invited',
    appStatus: 'interviewing',
    matchScore: 93,
    assessmentScore: 88,
    aiScore: 86,
    atsScore: 91,
    skills: ['System Design', 'Go', 'TypeScript', 'Kubernetes', 'gRPC'],
    currentRole: 'Senior Systems Engineer at InfraScale',
    summary: 'Experienced cloud infrastructure and backend systems engineer with exceptional communication and design skills.',
  },
  {
    username: 'demouser9',
    fullName: 'Demo User 9 (Quinn Jackson)',
    email: 'demouser9@example.com',
    phone: '+919876543209',
    stageId: 'stage_ai_interview',
    stageName: 'AI Comprehensive Interview',
    stageIndex: 3,
    poolType: 'primary',
    stageStatus: 'passed',
    appStatus: 'shortlisted',
    matchScore: 97,
    assessmentScore: 92,
    aiScore: 95,
    atsScore: 96,
    skills: ['Next.js', 'React', 'TypeScript', 'Tailwind', 'AI Integration', 'Node.js'],
    currentRole: 'Principal Fullstack Engineer at NextGen Labs',
    summary: 'Top-tier engineer who scored exceptionally across resume screen, assessment, and AI video interview. Reached Final Shortlist.',
  },
  {
    username: 'demouser10',
    fullName: 'Demo User 10 (Dakota Lee)',
    email: 'demouser10@example.com',
    phone: '+919876543210',
    stageId: 'stage_resume_screen',
    stageName: 'Resume Screening',
    stageIndex: 1,
    poolType: 'disqualified',
    stageStatus: 'failed',
    appStatus: 'rejected',
    matchScore: 45,
    atsScore: 40,
    skills: ['HTML', 'CSS', 'Basic JavaScript'],
    currentRole: 'Junior Web Enthusiast',
    summary: 'Entry-level applicant. Marked as disqualified to verify disqualified candidate filtering in candidate directory.',
  },
];

async function seed() {
  console.log('================================================================');
  console.log('🌱 SEEDING DEMO USERS & APPLICATIONS FOR "NEW TEST JOB"');
  console.log('================================================================\n');

  await connectDatabase();

  // 1. Locate Job
  let job = await JobModel.findOne({ title: /new test job/i });
  if (!job) {
    job = await JobModel.findById('6aabd43aad15c6b1a2481cd4');
  }

  if (!job) {
    console.error('❌ Could not find "new test job" in database.');
    process.exit(1);
  }

  console.log(`✅ Located Job: "${job.title}" (ID: ${job._id})`);

  // 2. Ensure HiringFunnelConfig
  let config = await HiringFunnelConfigModel.findOne({ jobId: job._id });
  if (!config) {
    console.log('Creating Funnel Config for job...');
    config = await HiringFunnelConfigModel.create({
      jobId: job._id,
      orgId: job.orgId,
      finalShortlistTarget: job.finalShortlistTarget || 10,
      stages: [
        {
          stageId: 'stage_resume_screen',
          stageName: 'Resume Screening',
          stageType: 'resume_match',
          order: 1,
          expectedAttendanceRate: 1,
          expectedPassRate: 0.6,
          targetCount: 57,
          deadlineHours: 24,
          autoAdvanceScoreThreshold: 70,
          autoRefillEnabled: true,
        },
        {
          stageId: 'stage_assessment',
          stageName: 'Technical Assessment',
          stageType: 'assessment',
          order: 2,
          expectedAttendanceRate: 1,
          expectedPassRate: 0.6,
          targetCount: 34,
          deadlineHours: 48,
          autoAdvanceScoreThreshold: 75,
          autoRefillEnabled: true,
        },
        {
          stageId: 'stage_ai_interview',
          stageName: 'AI Comprehensive Interview',
          stageType: 'ai_interview',
          order: 3,
          expectedAttendanceRate: 1,
          expectedPassRate: 0.5,
          targetCount: 20,
          deadlineHours: 48,
          autoAdvanceScoreThreshold: 80,
          autoRefillEnabled: true,
        },
      ],
      idealStages: [
        {
          stageId: 'stage_resume_screen',
          stageName: 'Resume Screening',
          stageType: 'resume_match',
          order: 1,
          expectedAttendanceRate: 1,
          expectedPassRate: 0.6,
          targetCount: 57,
          deadlineHours: 24,
          autoAdvanceScoreThreshold: 70,
          autoRefillEnabled: true,
        },
        {
          stageId: 'stage_assessment',
          stageName: 'Technical Assessment',
          stageType: 'assessment',
          order: 2,
          expectedAttendanceRate: 1,
          expectedPassRate: 0.6,
          targetCount: 34,
          deadlineHours: 48,
          autoAdvanceScoreThreshold: 75,
          autoRefillEnabled: true,
        },
        {
          stageId: 'stage_ai_interview',
          stageName: 'AI Comprehensive Interview',
          stageType: 'ai_interview',
          order: 3,
          expectedAttendanceRate: 1,
          expectedPassRate: 0.5,
          targetCount: 20,
          deadlineHours: 48,
          autoAdvanceScoreThreshold: 80,
          autoRefillEnabled: true,
        },
      ],
      idealFunnelIntakeTarget: 57,
      totalFunnelIntakeTarget: 57,
      isAdaptive: false,
      funnelHealth: 'healthy',
      status: 'active',
      currentShortlistedCount: 1,
      lastCalculatedAt: new Date(),
    });
    job.hiringEngineEnabled = true;
    job.hiringEngineConfigId = config._id as Types.ObjectId;
    await job.save();
  }

  // Pre-compute common password hash for testing login: "DemoPassword123!"
  const passwordHash = await PasswordUtils.hashPassword('DemoPassword123!');

  console.log('\n--- Creating / Updating Demo Users & Resumes ---');
  let createdCount = 0;

  for (const spec of DEMO_USERS) {
    // 3. Upsert User
    const user = await UserModel.findOneAndUpdate(
      { username: spec.username },
      {
        $set: {
          username: spec.username,
          fullName: spec.fullName,
          email: spec.email,
          phone: spec.phone,
          passwordHash,
          provider: 'email',
          emailVerified: true,
          isEmailVerified: true,
          phoneVerified: true,
          role: 'user',
          hasBuiltResume: true,
          avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${spec.username}`,
        },
      },
      { upsert: true, new: true }
    );

    // 4. Upsert Resume
    const resume = await ResumeModel.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          userId: user._id,
          title: `${spec.fullName} - Resume`,
          templateId: 'modern-sleek',
          atsScore: spec.atsScore,
          isPublic: true,
          content: {
            personalInfo: {
              fullName: spec.fullName,
              email: spec.email,
              phone: spec.phone,
              summary: spec.summary,
              title: spec.currentRole,
            },
            skills: spec.skills,
            experience: [
              {
                company: 'Tech Innovators Inc.',
                position: spec.currentRole,
                startDate: '2022-01',
                endDate: 'Present',
                current: true,
                description: 'Designed and implemented core architecture, led technical sprints, and improved throughput by 35%.',
              },
              {
                company: 'Alpha Digital Solutions',
                position: 'Software Engineer',
                startDate: '2020-03',
                endDate: '2021-12',
                current: false,
                description: 'Developed RESTful services, maintained frontend components, and worked with cross-functional teams.',
              },
            ],
            education: [
              {
                institution: 'State University of Technology',
                degree: 'Bachelor of Science in Computer Science',
                startDate: '2016-08',
                endDate: '2020-05',
              },
            ],
          },
        },
      },
      { upsert: true, new: true }
    );

    // 5. Upsert Application for "new test job"
    const now = new Date();
    const deadline = new Date(Date.now() + 48 * 3600 * 1000);

    const app = await ApplicationModel.findOneAndUpdate(
      { userId: user._id, jobId: job._id },
      {
        $set: {
          userId: user._id,
          jobId: job._id,
          resumeId: resume._id,
          source: 'manual',
          status: spec.appStatus,
          matchScore: spec.matchScore,
          assessmentScore: spec.assessmentScore,
          aiScore: spec.aiScore,
          poolType: spec.poolType,
          currentStageId: spec.stageId,
          currentStageIndex: spec.stageIndex,
          stageStatus: spec.stageStatus,
          stageDeadline: spec.stageStatus === 'invited' || spec.stageStatus === 'started' ? deadline : undefined,
          compositeRank: spec.matchScore,
          appliedAt: now,
          invitedAt: now,
          stageStartedAt: spec.stageStatus === 'started' || spec.stageStatus === 'passed' ? now : undefined,
          stageCompletedAt: spec.stageStatus === 'passed' || spec.stageStatus === 'failed' ? now : undefined,
        },
      },
      { upsert: true, new: true }
    );

    // 6. Record Stage History
    await CandidateStageHistoryModel.deleteMany({ applicationId: app._id });
    await CandidateStageHistoryModel.create({
      applicationId: app._id,
      jobId: job._id,
      candidateId: user._id,
      stageId: spec.stageId,
      stageName: spec.stageName,
      stageIndex: spec.stageIndex,
      status: spec.stageStatus,
      score: spec.aiScore || spec.assessmentScore || spec.matchScore,
      promotedFromReserve: spec.poolType === 'primary' && spec.stageIndex > 1,
      notes: `Demo seeded candidate in ${spec.stageName} (${spec.poolType} pool).`,
      enteredAt: now,
    });

    createdCount++;
    console.log(`  👤 Seeded [${spec.username}]: ${spec.fullName} -> Stage: ${spec.stageName} | Pool: ${spec.poolType.toUpperCase()} | Status: ${spec.stageStatus} | Score: ${spec.matchScore}`);
  }

  // 7. Update Job & Funnel stats
  const totalApps = await ApplicationModel.countDocuments({ jobId: job._id });
  const qualifiedApps = await ApplicationModel.countDocuments({
    jobId: job._id,
    matchScore: { $gte: 35 },
    status: { $nin: ['rejected', 'failed'] },
    poolType: { $ne: 'disqualified' },
  });
  const shortlistedApps = await ApplicationModel.countDocuments({
    jobId: job._id,
    status: 'shortlisted',
  });

  await JobModel.updateOne(
    { _id: job._id },
    {
      $set: {
        'applicationCollection.actualQualifiedCount': qualifiedApps,
        'applicationCollection.status': 'collecting',
        hiringEngineEnabled: true,
      },
    }
  );

  await HiringFunnelConfigModel.updateOne(
    { jobId: job._id },
    {
      $set: {
        currentShortlistedCount: shortlistedApps,
        lastCalculatedAt: new Date(),
      },
    }
  );

  console.log('\n================================================================');
  console.log(`🎉 SUCCESSFULLY SEEDED ${createdCount} DEMO USERS FOR JOB: "${job.title}"`);
  console.log(`📊 Total Applications for this Job: ${totalApps}`);
  console.log(`⭐ Qualified Candidates: ${qualifiedApps}`);
  console.log(`🏆 Shortlisted Candidates: ${shortlistedApps}`);
  console.log('🔑 Login Credentials for all demo users:');
  console.log('   Password: DemoPassword123!');
  console.log('   Usernames: demouser1 through demouser10');
  console.log('================================================================\n');

  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
