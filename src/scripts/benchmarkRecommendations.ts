import { connectDatabase } from '../config/database.js';
import { jobService } from '../modules/job/job.service.js';
import { UserModel } from '../modules/user/user.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import { JobModel } from '../modules/job/job.model.js';
import { CandidateProfileModel } from '../modules/job/candidateProfile.model.js';
import mongoose from 'mongoose';

async function runBenchmark() {
  console.log('🚀 Starting Recommendations Benchmark & Latency Instrumentation...');
  await connectDatabase();

  const testUser = await UserModel.findOne({ email: 'testcandidate@resumebuildai.com' });
  if (!testUser) {
    console.error('Test user not found');
    process.exit(1);
  }

  const userId = testUser._id.toString();

  console.log('\n--- 1. Baseline getRecommendedJobs() Measurement (Current Implementation) ---');
  const runs = 5;
  const latencies: number[] = [];

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const result = await jobService.getRecommendedJobs(userId, { limit: 12 });
    const elapsed = performance.now() - start;
    latencies.push(elapsed);
    console.log(`Run ${i + 1}: ${elapsed.toFixed(2)}ms (Returned ${result.jobs.length} jobs, total: ${result.total})`);
  }

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`\n📊 Average Baseline Latency: ${avgLatency.toFixed(2)}ms (Min: ${Math.min(...latencies).toFixed(2)}ms, Max: ${Math.max(...latencies).toFixed(2)}ms)`);

  console.log('\n--- 2. Breakdown of Components in Current Flow ---');

  // Measure Candidate Profile Sync
  const syncStart = performance.now();
  const candidateProfile = await jobService.syncCandidateProfile(userId);
  const syncElapsed = performance.now() - syncStart;
  console.log(`• Candidate Profile Sync & DB write: ${syncElapsed.toFixed(2)}ms`);

  // Measure Candidate Profile Read-Only
  const readStart = performance.now();
  const profileOnly = await CandidateProfileModel.findOne({ userId }).lean();
  const readElapsed = performance.now() - readStart;
  console.log(`• Candidate Profile DB Read Only: ${readElapsed.toFixed(2)}ms`);

  // Measure Job Query + Ranking
  const queryStart = performance.now();
  const activeJobs = await JobModel.find({ status: 'active' }).select('-rawText').limit(250).lean().exec();
  const queryElapsed = performance.now() - queryStart;
  console.log(`• Job Model DB Query (250 jobs): ${queryElapsed.toFixed(2)}ms`);

  console.log('\n✅ Benchmark Completed.');
  await mongoose.disconnect();
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
