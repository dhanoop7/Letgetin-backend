import mongoose from 'mongoose';
import { DriveFileModel } from '../../drive/drive.model.js';
import { VerificationDocumentModel } from '../../profile/verification.model.js';
import { ResumeModel } from '../../resume/resume.model.js';
import { BuiltContext } from './context.types.js';

const MAX_FILES_LISTED = 20;
const MAX_EXTRACTED_CHARS = 6000;

export async function buildDriveContext(userId: string, driveFileId?: string): Promise<BuiltContext> {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const [driveFiles, profileDocs, resumes] = await Promise.all([
    DriveFileModel.find({ userId: userObjectId })
      .select('originalName category tags description extractedText extractedTextStatus aiSummary')
      .lean(),
    VerificationDocumentModel.find({ userId: userObjectId }).select('section documentType ai').lean(),
    ResumeModel.find({ userId: userObjectId }).select('title templateId atsScore').lean(),
  ]);

  const totalCount = driveFiles.length + profileDocs.length + resumes.length;
  const lines: string[] = [];
  lines.push(`• Total files in Drive: ${totalCount}`);

  if (driveFiles.length > 0) {
    lines.push(`• Uploaded Files (${driveFiles.length}):`);
    driveFiles.slice(0, MAX_FILES_LISTED).forEach((f: any) => {
      const tagStr = Array.isArray(f.tags) && f.tags.length ? ` [tags: ${f.tags.join(', ')}]` : '';
      const summaryStr = f.aiSummary ? ` — ${f.aiSummary}` : f.description ? ` — ${f.description}` : '';
      lines.push(`  - ${f.originalName} (${f.category})${tagStr}${summaryStr}`);
    });
  }

  if (resumes.length > 0) {
    lines.push(
      `• Resumes (${resumes.length}): ${resumes
        .map((r: any) => `${r.title || 'Untitled Resume'} (ATS ${r.atsScore || 0}%)`)
        .join('; ')}`
    );
  }

  if (profileDocs.length > 0) {
    lines.push(
      `• Profile Verification Documents (${profileDocs.length}): ${profileDocs
        .map((d: any) => `${d.section}/${d.documentType}${d.ai?.summary ? ` — ${d.ai.summary}` : ''}`)
        .join('; ')}`
    );
  }

  // If the user currently has a specific file focused/previewed, pull its extracted text (best-effort;
  // only DriveFileModel entries for pdf/document uploads have this populated today).
  if (driveFileId && mongoose.Types.ObjectId.isValid(driveFileId)) {
    const focused = await DriveFileModel.findOne({ _id: driveFileId, userId: userObjectId })
      .select('originalName extractedText extractedTextStatus')
      .lean();
    if (focused) {
      lines.push('');
      lines.push(`• Focused File: ${focused.originalName}`);
      if (focused.extractedText) {
        const truncated = focused.extractedText.slice(0, MAX_EXTRACTED_CHARS);
        lines.push(
          `  Extracted Content:\n<<<UNTRUSTED_DOCUMENT_CONTENT_START>>>\n${truncated}\n<<<UNTRUSTED_DOCUMENT_CONTENT_END>>>`
        );
      } else if (focused.extractedTextStatus === 'failed') {
        lines.push('  (Text extraction failed for this file.)');
      } else if (focused.extractedTextStatus === 'unsupported') {
        lines.push('  (Text extraction is not supported for this file type.)');
      } else {
        lines.push('  (No extracted text available for this file yet.)');
      }
    }
  }

  return {
    summary: lines.join('\n'),
    hasData: totalCount > 0,
  };
}
