import { Request, Response } from 'express';
import { AIService } from './ai.service.js';
import { aiApplyAiService } from './services/aiApplyAi.service.js';
import { writingService } from './services/writing.service.js';

const aiService = new AIService();

export class AIController {
  static generateWriting = async (req: Request, res: Response): Promise<void> => {
    const { action, context, text, instruction, metadata } = req.body;
    const userId = req.user!.userId;
    const isStreamRequested = typeof req.headers.accept === 'string' && req.headers.accept.includes('text/event-stream');

    if (isStreamRequested) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      if (typeof (res as any).flushHeaders === 'function') {
        (res as any).flushHeaders();
      }

      try {
        await writingService.generateStream({ userId, action, context, text, instruction, metadata }, (chunkText: string) => {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunkText })}\n\n`);
        });
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      } catch (err: any) {
        const message = err?.message || "AI couldn't generate a suggestion right now. Please try again.";
        res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
      } finally {
        res.end();
      }
      return;
    }

    const result = await writingService.generate({ userId, action, context, text, instruction, metadata });
    res.status(200).json({
      success: true,
      data: { result },
      timestamp: new Date().toISOString(),
    });
  };

  static improveSummary = async (req: Request, res: Response): Promise<void> => {
    const { currentSummary, targetRole, tone } = req.body;
    const data = await aiService.improveSummary(req.user!.userId, currentSummary, targetRole, tone);
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  };

  static rewriteExperience = async (req: Request, res: Response): Promise<void> => {
    const { position, rawBullet } = req.body;
    const data = await aiService.rewriteExperienceBullet(req.user!.userId, position, rawBullet);
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  };

  static generateSkills = async (req: Request, res: Response): Promise<void> => {
    const { targetJobTitle, existingSkills } = req.body;
    const data = await aiService.generateSkills(req.user!.userId, targetJobTitle, existingSkills);
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  };

  static analyzeAts = async (req: Request, res: Response): Promise<void> => {
    const { resumeContent, targetJobDescription } = req.body;
    const data = await aiService.analyzeAts(req.user!.userId, resumeContent, targetJobDescription);
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  };

  static optimizeSection = async (req: Request, res: Response): Promise<void> => {
    const { sectionName, sectionData } = req.body;
    const data = await aiService.optimizeSection(req.user!.userId, sectionName, sectionData);
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  };

  static chat = async (req: Request, res: Response): Promise<void> => {
    const { message, resumeContext, resumeId, conversationHistory, activeResumeContext, stream } = req.body;
    const userId = req.user!.userId;
    let effectiveResumeContext = resumeContext;

    if (!effectiveResumeContext && resumeId) {
      try {
        const { ResumeService } = await import('../resume/resume.service.js');
        const resumeService = new ResumeService();
        const resumeDoc = await resumeService.getResumeById(resumeId, userId);
        if (resumeDoc) {
          effectiveResumeContext = typeof (resumeDoc as any).toJSON === 'function' ? (resumeDoc as any).toJSON() : resumeDoc;
        }
      } catch (err: any) {
        console.warn(`[AIController.chat] Failed to fetch resume ${resumeId} for user ${userId}:`, err?.message);
      }
    }

    const isStreamRequested = stream === true || (typeof req.headers.accept === 'string' && req.headers.accept.includes('text/event-stream'));

    if (isStreamRequested) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      if (typeof (res as any).flushHeaders === 'function') {
        (res as any).flushHeaders();
      }

      try {
        const data = await aiService.chatWithResumeContextStream(
          userId,
          message,
          effectiveResumeContext,
          {
            resumeId,
            conversationHistory,
            activeResumeContext,
          },
          (chunkText: string) => {
            res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunkText })}\n\n`);
          }
        );

        res.write(`data: ${JSON.stringify({ type: 'done', data })}\n\n`);
        res.end();
      } catch (err: any) {
        console.error('[AIController.chat] Streaming failed:', err?.message || err);
        res.write(`data: ${JSON.stringify({ type: 'error', error: err?.message || 'Chat generation failed' })}\n\n`);
        res.end();
      }
      return;
    }

    const data = await aiService.chatWithResumeContext(userId, message, effectiveResumeContext, {
      resumeId,
      conversationHistory,
      activeResumeContext,
    });
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  };

  static parseResume = async (req: Request, res: Response): Promise<void> => {
    const { rawText } = req.body;
    const userId = req.user!.userId;
    const data = await aiService.parseResumeText(userId, rawText);
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  };

  static matchJob = async (req: Request, res: Response): Promise<void> => {
    const { resumeContent, jobDescription } = req.body;
    const userId = req.user!.userId;
    const data = await aiService.matchJobDescription(userId, resumeContent, jobDescription);
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  };

  static aiApplyAssist = async (req: Request, res: Response): Promise<void> => {
    const { action, seedTitle } = req.body;
    const userId = req.user!.userId;
    const data = await aiApplyAiService.assist(userId, action, seedTitle);
    res.status(200).json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  };
}
