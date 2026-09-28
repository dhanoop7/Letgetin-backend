import { connectDatabase } from '../config/database.js';
import { UserModel } from '../modules/user/user.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import { JobModel } from '../modules/job/job.model.js';
import { CandidateProfileModel } from '../modules/job/candidateProfile.model.js';
import { embeddingService } from '../modules/embedding/embedding.service.js';
import mongoose from 'mongoose';

async function benchmark() {
  console.log('⚡ Starting detailed latency measurement...');
  await connectDatabase();

  const testUser = await UserModel.findOne({ email: 'testcandidate@resumebuildai.com' });
  const userId = testUser!._id.toString();

  // 1. Measure candidate profile DB read
  const t1 = performance.now();
  const candidateProfile = await CandidateProfileModel.findOne({ userId }).lean();
  const profileReadTime = performance.now() - t1;

  // 2. Measure sync candidate profile (including resume find, user find, compare, and BullMQ enqueue)
  const t2 = performance.now();
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const [user, latestResume] = await Promise.all([
    UserModel.findById(userObjectId).lean(),
    ResumeModel.findOne({ userId: userObjectId }).sort({ updatedAt: -1 }).lean(),
  ]);
  const syncTime = performance.now() - t2;

  // 3. Measure JobModel DB query for 200 active jobs
  const t3 = performance.now();
  const activeJobs = await JobModel.find({ status: 'active' }).select('-rawText').limit(200).lean();
  const jobQueryTime = performance.now() - t3;

  // 4. Measure in-memory vector search + skill overlap ranking for 200 jobs
  const candidateEmbedding = candidateProfile?.embedding || [];
  const candidateSkills = candidateProfile?.skills || [];
  const t4 = performance.now();
  const ranked = activeJobs.map((job) => {
    const skillAnalysis = embeddingService.calculateSkillsMatch(job.skills, candidateSkills);
    let vectorSim = 0;
    if (candidateEmbedding.length > 0 && job.embedding && job.embedding.length > 0) {
      vectorSim = embeddingService.cosineSimilarity(candidateEmbedding, job.embedding);
    }
    const matchScore = Math.round(vectorSim * 70 + skillAnalysis.score * 0.3);
    return { id: job._id, matchScore, vectorSim };
  });
  ranked.sort((a, b) => b.matchScore - a.matchScore);
  const rankingTime = performance.now() - t4;

  console.log('--------------------------------------------------');
  console.log(`1. Candidate Profile Read (findOne lean):  ${profileReadTime.toFixed(2)}ms`);
  console.log(`2. Full Profile Sync (User+Resume lookup):  ${syncTime.toFixed(2)}ms`);
  console.log(`3. MongoDB Job Retrieval (200 jobs):       ${jobQueryTime.toFixed(2)}ms`);
  console.log(`4. In-Memory Vector Cosine & Skill Ranking:${rankingTime.toFixed(2)}ms`);
  console.log(`👉 Total Current Flow Latency:             ${(profileReadTime + syncTime + jobQueryTime + rankingTime).toFixed(2)}ms`);
  console.log('--------------------------------------------------');

  await mongoose.disconnect();
  process.exit(0);
}

benchmark().catch((e) => {
  console.error(e);
  process.exit(1);
});
