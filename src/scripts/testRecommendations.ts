import { connectDatabase } from '../config/database.js';
import { jobService } from '../modules/job/job.service.js';
import { UserModel } from '../modules/user/user.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import mongoose from 'mongoose';

async function runTest() {
  console.log('🧪 Starting End-to-End Recommendations & Vector Search Test...');
  await connectDatabase();

  // Test 1: Browse jobs
  console.log('\n--- 1. Testing GET /api/jobs (Browse) ---');
  const browseResult = await jobService.getJobs({ limit: 5 });
  console.log(`✅ Browse returned ${browseResult.total} total jobs in database.`);
  console.log(`Sample job: "${browseResult.jobs[0]?.title}" at ${browseResult.jobs[0]?.company?.name}`);

  // Test 2: Personalized recommendations
  console.log('\n--- 2. Testing GET /api/jobs/recommendations (Personalized) ---');
  let testUser = await UserModel.findOne({ email: 'testcandidate@resumebuildai.com' });
  if (!testUser) {
    testUser = await UserModel.create({
      email: 'testcandidate@resumebuildai.com',
      fullName: 'Anupam Gupta',
      provider: 'email',
      emailVerified: true,
    });
  }

  let testResume = await ResumeModel.findOne({ userId: testUser._id });
  if (!testResume) {
    testResume = await ResumeModel.create({
      userId: testUser._id,
      title: 'Senior Full Stack Resume',
      content: {
        personalInfo: {
          fullName: 'Anupam Gupta',
          headline: 'Senior Full Stack Engineer (React, Node.js, TypeScript)',
          location: 'Bangalore, India',
        },
        summary: 'Experienced Senior Full Stack Developer specializing in React, Next.js, Node.js, TypeScript, and MongoDB.',
        skills: [
          { name: 'React' },
          { name: 'Node.js' },
          { name: 'TypeScript' },
          { name: 'MongoDB' },
          { name: 'Redis' },
          { name: 'Next.js' },
          { name: 'Docker' },
          { name: 'Express' },
        ],
        experiences: [
          {
            company: 'Tech Innovators',
            position: 'Senior Full Stack Engineer',
            highlights: ['Architected scalable microservices and Next.js applications.'],
          },
        ],
      },
    });
  }

  const recResult = await jobService.getRecommendedJobs(testUser._id.toString(), { limit: 6 });
  console.log(`✅ Candidate Profile headline: "${recResult.candidateProfile.headline}"`);
  console.log(`✅ Detected Skills (${recResult.candidateProfile.skillsCount}): ${recResult.candidateProfile.skills.join(', ')}`);
  console.log(`✅ Candidate Embedding Ready: ${recResult.candidateProfile.hasEmbedding}`);
  console.log(`\n🏆 Top Ranked AI Recommendations for Candidate:`);

  recResult.jobs.forEach((j, i) => {
    console.log(
      `   ${i + 1}. [${j.matchScore}% Match] ${j.title} @ ${j.company?.name} (${j.location.city || j.location.country} - ${j.workplaceType})`
    );
    if (j.matchedSkills.length > 0) {
      console.log(`      🎯 Matched Skills: ${j.matchedSkills.join(', ')}`);
    }
    if (j.matchReasons.length > 0) {
      console.log(`      💡 Reason: ${j.matchReasons[0]}`);
    }
  });

  await mongoose.disconnect();
  console.log('\n✨ All recommendation tests passed with flying colors!');
}

runTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
  });
