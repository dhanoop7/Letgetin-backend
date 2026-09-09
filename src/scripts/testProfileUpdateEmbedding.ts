import { connectDatabase } from '../config/database.js';
import { jobService } from '../modules/job/job.service.js';
import { ResumeService } from '../modules/resume/resume.service.js';
const resumeService = new ResumeService();
import { UserModel } from '../modules/user/user.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import { CandidateProfileModel } from '../modules/job/candidateProfile.model.js';
import mongoose from 'mongoose';

async function testUpdate() {
  await connectDatabase();
  const user = await UserModel.findOne({ email: 'testcandidate@resumebuildai.com' });
  const userId = user!._id.toString();

  // 1. Get current candidate profile
  const profileBefore = await CandidateProfileModel.findOne({ userId });
  console.log('Skills Before:', profileBefore?.skills);
  console.log('Embedding status before:', profileBefore?.embeddingStatus);
  console.log('Raw text before:', profileBefore?.rawText?.substring(0, 100));

  // 2. Update resume with new skills (e.g. Kotlin, Rust, GraphQL, Kubernetes)
  const resume = await ResumeModel.findOne({ userId });
  if (resume) {
    const updatedContent: any = {
      ...(resume.content as any),
      skills: [
        { name: 'React' },
        { name: 'Node.js' },
        { name: 'TypeScript' },
        { name: 'Rust' },
        { name: 'Kubernetes' },
        { name: 'GraphQL' },
      ],
    };

    console.log('\n--- Updating resume with new skills (Rust, Kubernetes, GraphQL) ---');
    await resumeService.updateResume(resume._id.toString(), userId, {
      content: updatedContent,
    } as any);

    // Wait a brief moment for async sync to run
    await new Promise(r => setTimeout(r, 500));

    const profileAfter = await CandidateProfileModel.findOne({ userId });
    console.log('\nSkills After Update:', profileAfter?.skills);
    console.log('Embedding status after update:', profileAfter?.embeddingStatus);
    console.log('Raw text after update contains Rust:', profileAfter?.rawText?.includes('Rust'));
  }

  await mongoose.disconnect();
  process.exit(0);
}

testUpdate().catch(e => { console.error(e); process.exit(1); });
