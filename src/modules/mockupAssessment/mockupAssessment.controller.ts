import { Request, Response } from 'express';
import { MockupAssessmentService } from './mockupAssessment.service.js';

export class MockupAssessmentController {
  /**
   * POST /api/mockup-assessments/generate or POST /api/mockup-tests/generate-assessment
   * Generate tailored assessment questions with Gemini
   */
  public static async generateAssessment(req: Request, res: Response): Promise<void> {
    try {
      const { assessmentType, interactionMode, jobDescription } = req.body;
      const userId = req.user?.userId;

      const result = await MockupAssessmentService.generateAssessmentQuestions({
        assessmentType,
        interactionMode: interactionMode || 'text',
        jobDescription: String(jobDescription || '').trim(),
        userId,
      });

      res.status(200).json({
        success: true,
        message: 'AI Assessment generated successfully',
        data: result,
      });
    } catch (err: any) {
      console.error('[MockupAssessmentController.generateAssessment] Error:', err?.message || err);
      const statusCode = err?.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        message: err?.message || 'Unable to generate AI assessment. Please try again.',
      });
    }
  }

  /**
   * POST /api/mockup-assessments/evaluate-answer or POST /api/mockup-tests/evaluate-assessment-answer
   * Evaluate a candidate's answer for Mockup Assessment using Gemini
   */
  public static async evaluateAssessmentAnswer(req: Request, res: Response): Promise<void> {
    try {
      const { question, answer, category, assessmentType, jobDescription } = req.body;

      const result = await MockupAssessmentService.evaluateAssessmentAnswer(
        question,
        answer,
        category,
        assessmentType?.includes('coding') || assessmentType?.includes('system') || assessmentType?.includes('domain') ? 'technical' : 'aptitude',
        jobDescription
      );

      res.status(200).json({
        success: true,
        message: 'Assessment answer evaluated by AI',
        data: result,
      });
    } catch (err: any) {
      console.error('[MockupAssessmentController.evaluateAssessmentAnswer] Error:', err?.message || err);
      const statusCode = err?.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        message: err?.message || 'Unable to evaluate response using AI. Please try again.',
      });
    }
  }
}
