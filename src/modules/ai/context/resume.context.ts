import mongoose from 'mongoose';
import { ResumeService } from '../../resume/resume.service.js';
import { ResumeModel } from '../../resume/resume.model.js';
import { filterResumeContext, formatActiveResumeContext } from '../prompts/chat.prompt.js';
import { BuiltContext } from './context.types.js';

const resumeService = new ResumeService();

export async function buildResumeContext(
  userId: string,
  message: string,
  resumeId?: string,
  activeResumeContext?: Record<string, unknown>
): Promise<BuiltContext> {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // If a specific resumeId or activeResumeContext is passed (e.g. inside Resume Builder)
  if (resumeId || (activeResumeContext && Object.keys(activeResumeContext).length > 0)) {
    let resumeJson: any = activeResumeContext;
    if (resumeId && mongoose.Types.ObjectId.isValid(resumeId)) {
      try {
        const resume = await resumeService.getResumeById(resumeId, userId);
        resumeJson = typeof (resume as any).toJSON === 'function' ? (resume as any).toJSON() : resume;
      } catch {
        // Fallback to activeResumeContext if service lookup fails
      }
    }

    if (resumeJson) {
      const { filteredSummary } = filterResumeContext(resumeJson, message);
      const activeSummary = formatActiveResumeContext(activeResumeContext);
      return {
        summary: `${filteredSummary}\n\nCurrently Focused Section / Element:\n${activeSummary}`,
        hasData: true,
      };
    }
  }

  // Otherwise (e.g. on /resume workspace dashboard), fetch all user's resumes
  const resumes = await ResumeModel.find({ userId: userObjectId }).sort({ updatedAt: -1 }).lean();

  if (!resumes || resumes.length === 0) {
    return {
      summary:
        'No resumes found in the user workspace yet. The user has not created any resumes.',
      hasData: false,
    };
  }

  const lines: string[] = [];
  lines.push(`• Total Resumes in Workspace: ${resumes.length}`);

  resumes.forEach((r: any, idx: number) => {
    const content: any = r.content || {};
    const headline = content.personalInfo?.headline || content.personalInfo?.title || 'General';
    const skillsList = Array.isArray(content.skills)
      ? content.skills.map((s: any) => (typeof s === 'string' ? s : s.name)).filter(Boolean)
      : [];
    const expCount = Array.isArray(content.experiences) ? content.experiences.length : 0;
    const ats = r.atsScore !== undefined ? `${r.atsScore}%` : 'N/A';

    lines.push('');
    lines.push(`• Resume #${idx + 1}: "${r.title || 'Untitled Resume'}" (ID: ${r._id})`);
    lines.push(`  - Template: ${r.templateId || 'modern-sleek'}`);
    lines.push(`  - ATS Score: ${ats}`);
    lines.push(`  - Target Role / Headline: ${headline}`);
    lines.push(`  - Experience Count: ${expCount} positions`);
    lines.push(`  - Skills (${skillsList.length}): ${skillsList.slice(0, 10).join(', ') || 'None added'}`);
    if (content.summary) {
      lines.push(`  - Summary: "${content.summary.slice(0, 200)}..."`);
    }
  });

  return {
    summary: lines.join('\n'),
    hasData: true,
  };
}
