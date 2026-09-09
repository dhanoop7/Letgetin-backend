import mongoose from 'mongoose';
import { CandidateProfileModel } from '../../job/candidateProfile.model.js';
import { UserProfileModel } from '../../profile/profile.model.js';
import { JobModel } from '../../job/job.model.js';
import { BuiltContext } from './context.types.js';

export async function buildExploreContext(userId: string, selectedJobId?: string): Promise<BuiltContext> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const [candidateProfile, userProfile] = await Promise.all([
    CandidateProfileModel.findOne({ userId: userObjectId }).lean(),
    UserProfileModel.findOne({ userId: userObjectId }).lean(),
  ]);

  const lines: string[] = [];

  const headline = candidateProfile?.headline || userProfile?.personal?.headline || '';
  const summary = candidateProfile?.summary || userProfile?.personal?.bio || '';
  const skills = candidateProfile?.skills?.length
    ? candidateProfile.skills
    : userProfile?.skills || [];
  const location =
    candidateProfile?.location ||
    [userProfile?.contact?.city, userProfile?.contact?.country].filter(Boolean).join(', ') ||
    '';
  const education =
    candidateProfile?.education ||
    (userProfile?.educationsList && userProfile.educationsList.length > 0
      ? userProfile.educationsList.map((e: any) => `${e.degree} at ${e.institution}`).join('; ')
      : userProfile?.education?.degree
      ? `${userProfile.education.degree} at ${userProfile.education.institution}`
      : '');
  const expSummary =
    candidateProfile?.yearsOfExperience !== undefined
      ? `${candidateProfile.yearsOfExperience} years`
      : userProfile?.experiencesList?.length
      ? `${userProfile.experiencesList.length} positions recorded`
      : '0 years';

  const hasUserData = Boolean(candidateProfile || userProfile);

  if (hasUserData) {
    lines.push(`• Candidate Headline: ${headline || '(not set)'}`);
    lines.push(`• Professional Summary: ${summary || '(not set)'}`);
    lines.push(`• Experience: ${expSummary}`);
    lines.push(`• Skills (${skills.length}): ${skills.join(', ') || '(none)'}`);
    if (location) lines.push(`• Location: ${location}`);
    if (education) lines.push(`• Education: ${education}`);
  } else {
    lines.push('• No candidate profile found yet — the user has not created a profile or synced a resume for job matching.');
  }

  if (selectedJobId && mongoose.Types.ObjectId.isValid(selectedJobId)) {
    const job = await JobModel.findOne({ _id: selectedJobId, status: 'active' }).lean();
    if (job) {
      lines.push('');
      lines.push('• Currently Viewed Job Opportunity:');
      lines.push(`  - Title: ${job.title} at ${job.company?.name || 'Unknown Company'}`);
      lines.push(`  - Requirements: ${(job.requirements || []).join('; ') || 'N/A'}`);
      lines.push(`  - Skills Required: ${(job.skills || []).join(', ') || 'N/A'}`);
      lines.push(`  - Experience Level: ${job.experienceLevel}, Workplace: ${job.workplaceType}`);
      lines.push(`  - Location: ${job.location?.city ? `${job.location.city}, ` : ''}${job.location?.country || 'N/A'}`);
      if (job.description) {
        lines.push(`  - Description: ${job.description.slice(0, 400)}...`);
      }
    }
  }

  return {
    summary: lines.join('\n'),
    hasData: hasUserData,
  };
}
