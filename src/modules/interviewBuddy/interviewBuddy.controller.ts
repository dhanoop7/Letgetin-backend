import { Request, Response } from 'express';
import { InterviewBuddyService } from './interviewBuddy.service.js';

export class InterviewBuddyController {
  /**
   * POST /api/interviews/buddy/generate
   * Generate tailored Interview Buddy questions via Gemini LLM
   */
  public static async generateBuddyQuestions(req: Request, res: Response): Promise<void> {
    try {
      const { mode, jobDescription, customConfig } = req.body;
      const userId = req.user?.userId;

      const result = await InterviewBuddyService.generateBuddyQuestions({
        mode,
        jobDescription,
        customConfig,
        userId,
      });

      res.status(200).json({
        success: true,
        message: 'AI interview questions generated successfully',
        data: result,
      });
    } catch (err: any) {
      console.error('[InterviewBuddyController.generateBuddyQuestions] Error:', err?.message || err);
      const statusCode = err?.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        message: err?.message || 'Unable to generate AI interview questions. Please try again.',
      });
    }
  }

  /**
   * POST /api/interviews/buddy/evaluate
   * Evaluate a candidate's answer for Interview Buddy via Gemini LLM
   */
  public static async evaluateBuddyAnswer(req: Request, res: Response): Promise<void> {
    try {
      const { question, answer, category, mode, expectedAnswer, jobDescription } = req.body;

      const result = await InterviewBuddyService.evaluateBuddyAnswer({
        question,
        answer,
        category,
        mode,
        expectedAnswer,
        jobDescription,
      });

      res.status(200).json({
        success: true,
        message: 'Candidate response evaluated successfully',
        data: result,
      });
    } catch (err: any) {
      console.error('[InterviewBuddyController.evaluateBuddyAnswer] Error:', err?.message || err);
      const statusCode = err?.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        message: err?.message || 'Unable to evaluate your response with AI. Please try again.',
      });
    }
  }
}
