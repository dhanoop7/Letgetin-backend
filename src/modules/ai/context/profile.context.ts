import mongoose from 'mongoose';
import { UserProfileModel } from '../../profile/profile.model.js';
import { VerificationDocumentModel } from '../../profile/verification.model.js';
import { CandidateProfileModel } from '../../job/candidateProfile.model.js';
import { BuiltContext } from './context.types.js';

export async function buildProfileContext(
  userId: string,
  activeProfileContext?: Record<string, unknown>,
  activeProfileSection?: string
): Promise<BuiltContext> {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const [userProfile, verifications, candidateProfile] = await Promise.all([
    UserProfileModel.findOne({ userId: userObjectId }).lean(),
    VerificationDocumentModel.find({ userId: userObjectId }).lean(),
    CandidateProfileModel.findOne({ userId: userObjectId }).lean(),
  ]);

  // Use active client payload or DB profile
  const profile: any = activeProfileContext || userProfile;

  const lines: string[] = [];

  if (!profile && !candidateProfile) {
    return {
      summary:
        'No profile data found yet. The user has not completed onboarding or filled out profile sections.',
      hasData: false,
    };
  }

  // Personal
  const personal = profile?.personal || {};
  const firstName = personal.firstName || '';
  const lastName = personal.lastName || '';
  const fullName = profile?.contact?.fullName || `${firstName} ${lastName}`.trim() || 'Candidate';
  const headline = personal.headline || candidateProfile?.headline || '';
  const bio = personal.bio || candidateProfile?.summary || '';
  const dob = personal.dob || '';

  lines.push(`• Candidate Name: ${fullName}`);
  lines.push(`• Headline / Professional Title: ${headline || '(Not set)'}`);
  lines.push(`• Bio / About Me: ${bio || '(Not set)'}`);
  if (dob) lines.push(`• Date of Birth: ${dob}`);
  if (profile?.track) lines.push(`• Career Track: ${profile.track}`);
  if (profile?.mode) lines.push(`• Profile Mode: ${profile.mode}`);

  // Contact & Location
  const contact = profile?.contact || {};
  const locationParts = [contact.streetAddress, contact.city, contact.state, contact.country, contact.postalCode].filter(Boolean);
  const location = locationParts.join(', ') || candidateProfile?.location || '';
  lines.push(`• Location: ${location || '(Not set)'}`);
  if (contact.email) lines.push(`• Email: ${contact.email}`);
  if (contact.alternateEmail) lines.push(`• Alternate Email: ${contact.alternateEmail} (Verified: ${contact.alternateEmailVerified ? 'Yes' : 'No'})`);
  if (contact.phone) lines.push(`• Phone: ${contact.phone}`);
  if (contact.linkedin) lines.push(`• LinkedIn: ${contact.linkedin}`);

  // Experience
  const experiencesList: any[] = Array.isArray(profile?.experiencesList) && profile.experiencesList.length > 0
    ? profile.experiencesList
    : profile?.experience?.company
    ? [profile.experience]
    : [];

  if (experiencesList.length > 0) {
    lines.push(`• Work Experience (${experiencesList.length} roles recorded):`);
    experiencesList.forEach((exp: any, idx: number) => {
      const duration = `${exp.start || 'N/A'} - ${exp.end || 'Present'}`;
      const highlights = exp.highlights ? ` | Highlights: ${exp.highlights}` : '';
      lines.push(`  ${idx + 1}. ${exp.title || 'Role'} at ${exp.company || 'Company'} (${duration})${highlights}`);
    });
  } else {
    lines.push(`• Work Experience: (No work experience added yet)`);
  }

  // Education
  const educationsList: any[] = Array.isArray(profile?.educationsList) && profile.educationsList.length > 0
    ? profile.educationsList
    : profile?.education?.institution
    ? [profile.education]
    : [];

  if (educationsList.length > 0) {
    lines.push(`• Education (${educationsList.length} degrees/institutions recorded):`);
    educationsList.forEach((edu: any, idx: number) => {
      const years = edu.startYear || edu.endYear ? ` (${edu.startYear || ''} - ${edu.endYear || ''})` : '';
      lines.push(`  ${idx + 1}. ${edu.degree || 'Degree'} from ${edu.institution || 'Institution'}${years}`);
    });
  } else {
    lines.push(`• Education: (No education added yet)`);
  }

  // Skills
  const skills: string[] = Array.isArray(profile?.skills) && profile.skills.length > 0
    ? profile.skills
    : candidateProfile?.skills || [];

  if (skills.length > 0) {
    lines.push(`• Skills (${skills.length}): ${skills.join(', ')}`);
  } else {
    lines.push(`• Skills: (None listed yet)`);
  }

  // Verifications
  if (verifications && verifications.length > 0) {
    lines.push(`• Verification Documents (${verifications.length}):`);
    verifications.forEach((doc: any) => {
      const summary = doc.ai?.summary ? ` [Summary: ${doc.ai.summary}]` : '';
      lines.push(`  - Section: ${doc.section}, Doc Type: ${doc.documentType}, Status: ${doc.status}${summary}`);
    });
  } else {
    lines.push(`• Verification Documents: (No documents uploaded yet)`);
  }

  // Profile Completeness Check
  const completedSections: string[] = [];
  const missingSections: string[] = [];

  if (fullName && headline && bio) completedSections.push('Personal Info');
  else missingSections.push('Personal Info (missing headline or bio)');

  if (contact.email || contact.phone) completedSections.push('Contact Details');
  else missingSections.push('Contact Details (missing email or phone)');

  if (experiencesList.length > 0) completedSections.push('Experience');
  else missingSections.push('Work Experience');

  if (educationsList.length > 0) completedSections.push('Education');
  else missingSections.push('Education');

  if (skills.length > 0) completedSections.push('Skills');
  else missingSections.push('Skills');

  const completenessPercentage = Math.round((completedSections.length / 5) * 100);
  lines.push(`• Profile Completeness: ${completenessPercentage}% (Completed: ${completedSections.join(', ') || 'None'}; Missing: ${missingSections.join(', ') || 'None'})`);

  // Active Section
  if (activeProfileSection) {
    lines.push('');
    lines.push(`• Currently Focused Profile Tab/Section: ${activeProfileSection.toUpperCase()}`);
  }

  return {
    summary: lines.join('\n'),
    hasData: true,
  };
}
