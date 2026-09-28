import { connectDatabase } from '../config/database.js';
import { JobModel } from '../modules/job/job.model.js';
import { CandidateProfileModel } from '../modules/job/candidateProfile.model.js';
import mongoose from 'mongoose';

async function testAtlas() {
  await connectDatabase();
  const profile = await CandidateProfileModel.findOne().lean();
  console.log('Profile found:', !!profile, 'has embedding:', !!profile?.embedding?.length);

  // Test 1: Vector Search
  const t0 = performance.now();
  try {
    const vectorPipeline: any[] = [
      {
        $vectorSearch: {
          index: 'job_vector_index',
          path: 'embedding',
          queryVector: profile!.embedding!,
          numCandidates: 150,
          limit: 30,
          filter: { status: { $eq: 'active' } },
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
    console.log(`✅ Atlas Vector Search: ${vectorRes.length} jobs in ${(performance.now() - t0).toFixed(2)}ms`);
    if (vectorRes.length > 0) {
      console.log('Top vector score:', vectorRes[0].vectorScore, 'title:', vectorRes[0].title);
    }
  } catch (err: any) {
    console.log(`❌ Atlas Vector Search error (${(performance.now() - t0).toFixed(2)}ms):`, err.message);
  }

  // Test 2: Lean query with projection (no embedding)
  const t1 = performance.now();
  const projectedJobs = await JobModel.find({ status: 'active' })
    .select('title company skills workplaceType experienceLevel location salary publishedAt minimumExperience maximumExperience employmentType benefits applicationUrl')
    .limit(100)
    .lean()
    .exec();
  console.log(`✅ Projected DB Query (100 jobs): ${projectedJobs.length} jobs in ${(performance.now() - t1).toFixed(2)}ms`);

  await mongoose.disconnect();
  process.exit(0);
}

testAtlas().catch(e => { console.error(e); process.exit(1); });
