import { TailoringRepository } from './tailoring.repository.js';
import { ITailoringSessionDocument, ITailoringSuggestion } from './tailoring.model.js';
import { ResumeService } from '../resume/resume.service.js';
import { AtsService } from '../ai/services/ats.service.js';
import { AppError } from '../../utils/appError.js';

interface SuggestionStatusUpdate {
  id: string;
  status: 'pending' | 'accepted' | 'declined' | 'edited';
  proposedText?: string;
  section?: 'summary' | 'experience' | 'skills' | 'projects';
  itemId?: string;
  changeType?: 'addition' | 'replacement' | 'rewrite';
  originalText?: string;
  reason?: string;
  relatedKeywords?: string[];
}

export class TailoringService {
  private repository = new TailoringRepository();
  private resumeService = new ResumeService();
  private atsService = new AtsService();

  async createSession(userId: string, resumeId: string, jobDescription: string): Promise<ITailoringSessionDocument> {
    const resume = await this.resumeService.getResumeById(resumeId, userId);

    // A brand new Tailor Resume entry always starts a fresh journey - clear out any
    // abandoned in-progress session for this resume so it can never leak into this one.
    await this.repository.deleteActiveByResumeAndUser(resumeId, userId);

    const analysis = await this.atsService.matchJobDescription(userId, resume.content, jobDescription);

    // AtsService silently substitutes generic placeholder data (unrelated to this resume/JD,
    // with empty suggestions) when the underlying AI call itself fails - creating a "successful"
    // session from that would look like a real analysis that just found nothing to improve,
    // which is misleading. Surface it as a real, retryable failure instead.
    if (analysis.isFallback) {
      throw AppError.internal(
        'AI analysis is temporarily unavailable (the AI service did not respond). Please try again in a moment.'
      );
    }

    const suggestions: ITailoringSuggestion[] = analysis.suggestions.map((s) => ({
      id: s.id,
      section: s.section,
      itemId: s.itemId,
      changeType: s.changeType,
      originalText: s.originalText,
      proposedText: s.proposedText,
      reason: s.reason,
      relatedKeywords: s.relatedKeywords,
      status: 'pending',
    }));

    return await this.repository.create({
      userId: userId as any,
      sourceResumeId: resumeId as any,
      jobDescription,
      matchScore: analysis.matchScore,
      matchedKeywords: analysis.matchedKeywords,
      missingKeywords: analysis.missingKeywords,
      missingSkills: analysis.missingSkills,
      recommendedImprovements: analysis.recommendedImprovements,
      suggestions,
      missingSections: analysis.missingSections,
      status: 'active',
    });
  }

  async getSession(id: string, userId: string): Promise<ITailoringSessionDocument> {
    const session = await this.repository.findByIdAndUserId(id, userId);
    if (!session) {
      throw AppError.notFound('Tailoring session not found or access denied');
    }
    return session;
  }

  async getActiveSessionForResume(resumeId: string, userId: string): Promise<ITailoringSessionDocument | null> {
    return await this.repository.findActiveByResumeAndUser(resumeId, userId);
  }

  async updateSuggestions(id: string, userId: string, updates: SuggestionStatusUpdate[]): Promise<ITailoringSessionDocument> {
    const session = await this.repository.findByIdAndUserId(id, userId);
    if (!session) {
      throw AppError.notFound('Tailoring session not found or access denied');
    }

    const updatesById = new Map(updates.map((u) => [u.id, u]));
    const existingIds = new Set(session.suggestions.map((s) => s.id));

    session.suggestions = session.suggestions.map((s) => {
      const update = updatesById.get(s.id);
      if (!update) return s;
      return {
        ...s,
        status: update.status,
        proposedText: update.proposedText !== undefined ? update.proposedText : s.proposedText,
      };
    });

    // Upsert brand-new, chat-sourced suggestions (not present in the session yet) - only
    // if the client supplied enough fields to construct a valid suggestion entry.
    for (const update of updates) {
      if (existingIds.has(update.id)) continue;
      if (!update.section || !update.changeType) continue;
      session.suggestions.push({
        id: update.id,
        section: update.section,
        itemId: update.itemId,
        changeType: update.changeType,
        originalText: update.originalText || '',
        proposedText: update.proposedText || '',
        reason: update.reason || '',
        relatedKeywords: update.relatedKeywords || [],
        status: update.status,
      });
    }

    await session.save();
    return session;
  }

  /**
   * Applies all accepted suggestions onto the real resume via the existing Resume update path,
   * then deletes the staging session - the original resume is never touched until this point.
   * If the candidate gave the resume a new title during tailoring, that's treated as an explicit
   * "save as a new resume" signal - the original stays exactly as it was, untouched by name or
   * content, and a new resume is created instead of overwriting it in place.
   */
  async finalizeSession(id: string, userId: string, title?: string): Promise<{ resumeId: string; isNew: boolean }> {
    const session = await this.repository.findByIdAndUserId(id, userId);
    if (!session) {
      throw AppError.notFound('Tailoring session not found or access denied');
    }

    const resume = await this.resumeService.getResumeById(session.sourceResumeId.toString(), userId);
    const content: any = JSON.parse(JSON.stringify(resume.content));

    const accepted = session.suggestions.filter((s) => s.status === 'accepted' || s.status === 'edited');

    for (const suggestion of accepted) {
      if (suggestion.section === 'summary') {
        content.summary = suggestion.proposedText;
      } else if (suggestion.section === 'experience' && suggestion.itemId) {
        const exp = (content.experiences || []).find((e: any) => e.id === suggestion.itemId);
        if (exp) {
          const highlights: string[] = Array.isArray(exp.highlights) ? exp.highlights : [];
          const idx = highlights.findIndex((h) => h === suggestion.originalText);
          if (idx >= 0) {
            highlights[idx] = suggestion.proposedText;
          } else if (suggestion.changeType === 'addition') {
            highlights.push(suggestion.proposedText);
          }
          exp.highlights = highlights;
        }
      } else if (suggestion.section === 'projects' && suggestion.itemId) {
        const proj = (content.projects || []).find((p: any) => p.id === suggestion.itemId);
        if (proj) {
          const highlights: string[] = Array.isArray(proj.highlights) ? proj.highlights : [];
          const idx = highlights.findIndex((h) => h === suggestion.originalText);
          if (idx >= 0) {
            highlights[idx] = suggestion.proposedText;
          } else if (suggestion.changeType === 'addition') {
            highlights.push(suggestion.proposedText);
          }
          proj.highlights = highlights;
        }
      } else if (suggestion.section === 'skills') {
        const skills: any[] = Array.isArray(content.skills) ? content.skills : [];
        const already = skills.some(
          (sk) => (typeof sk === 'string' ? sk : sk?.name)?.trim().toLowerCase() === suggestion.proposedText.trim().toLowerCase()
        );
        if (!already) {
          skills.push({ name: suggestion.proposedText, category: 'General' });
        }
        content.skills = skills;
      }
    }

    const trimmedTitle = title?.trim();
    const isRename = !!trimmedTitle && trimmedTitle !== resume.title;

    let resumeId: string;
    if (isRename) {
      const created = await this.resumeService.createResume(userId, {
        title: trimmedTitle,
        templateId: resume.templateId,
        content,
        settings: resume.settings,
      });
      resumeId = created.id;
    } else {
      await this.resumeService.updateResume(session.sourceResumeId.toString(), userId, { content });
      resumeId = session.sourceResumeId.toString();
    }

    await this.repository.deleteById(session.id);

    return { resumeId, isNew: isRename };
  }

  async discardSession(id: string, userId: string): Promise<void> {
    const session = await this.repository.findByIdAndUserId(id, userId);
    if (!session) {
      throw AppError.notFound('Tailoring session not found or access denied');
    }
    await this.repository.deleteById(id);
  }
}
