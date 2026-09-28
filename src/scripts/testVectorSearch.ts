import { connectDatabase } from '../config/database.js';
import { JobModel } from '../modules/job/job.model.js';
import { CandidateProfileModel } from '../modules/job/candidateProfile.model.js';
import mongoose from 'mongoose';

async function testVectorSearch() {
  await connectDatabase();
  const profile = await CandidateProfileModel.findOne().lean();

  // Test 1: $vectorSearch without filter inside index
  const t0 = performance.now();
  try {
    const vectorPipeline: any[] = [
      {
        $vectorSearch: {
          index: 'job_vector_index',
          path: 'embedding',
          queryVector: profile!.embedding!,
          numCandidates: 150,
          limit: 50,
        },
      },
      {
        $match: {
          status: 'active',
        },
      },
      {
        $project: {
          title: 1,
          company: 1,
          skills: 1,
          workplaceType: 1,
          experienceLevel: 1,
          location: 1,
          salary: 1,
          publishedAt: 1,
          status: 1,
          vectorScore: { $meta: 'vectorSearchScore' },
        },
      },
    ];
    const vectorRes = await JobModel.aggregate(vectorPipeline).exec();
    console.log(`✅ Atlas Vector Search ($vectorSearch without filter): ${vectorRes.length} jobs in ${(performance.now() - t0).toFixed(2)}ms`);
    if (vectorRes.length > 0) {
      console.log('Sample vector match:', vectorRes[0].title, 'score:', vectorRes[0].vectorScore);
    }
  } catch (err: any) {
    console.log(`❌ Atlas Vector Search error:`, err.message);
  }

  await mongoose.disconnect();
  process.exit(0);
}

testVectorSearch().catch(e => { console.error(e); process.exit(1); });
