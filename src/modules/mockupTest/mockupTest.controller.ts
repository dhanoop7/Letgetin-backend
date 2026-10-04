import { Request, Response } from 'express';
import { MockupTestService } from './mockupTest.service.js';
import { AppError } from '../../utils/appError.js';

export class MockupTestController {
  /**
   * POST /api/mockup-tests/generate
   * Process Job Description & generate question sets
   */
  public static async generateTest(req: Request, res: Response): Promise<void> {
    try {
      const { testType, jobDescription, mode } = req.body;
      const selectedMode = mode || 'objective';
      const userId = req.user?.userId;

      const result = await MockupTestService.generateQuestions(
        testType,
        selectedMode,
        jobDescription,
        userId
      );

      res.status(200).json({
        success: true,
        message: 'Questions generated successfully',
        data: result,
      });
    } catch (err: any) {
      console.error('[MockupTestController.generateTest] Error:', err?.message || err);
      const statusCode = err?.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        message: err?.message || 'Unable to generate AI questions. Please try again.',
      });
    }
  }

  /**
   * POST /api/mockup-tests/session
   * Create and initialize a new test session
   */
  public static async createSession(req: Request, res: Response): Promise<void> {
    try {
      const { testType, mode, jobDescription, assessmentType, interactionMode } = req.body;
      const userId = req.user?.userId;

      const effectiveTestType = testType || (assessmentType?.includes('coding') || assessmentType?.includes('system') || assessmentType?.includes('domain') ? 'technical' : 'aptitude');
      const effectiveMode = mode || 'objective';
      const effectiveInteractionMode = interactionMode || 'text';

      const { session, clientQuestions } = await MockupTestService.createSession(
        effectiveTestType,
        effectiveMode,
        jobDescription,
        userId,
        effectiveInteractionMode,
        assessmentType
      );

      res.status(201).json({
        success: true,
        message: 'Test session created successfully',
        data: {
          sessionId: session.sessionId,
          testType: session.testType,
          mode: session.mode,
          assessmentType: session.assessmentType,
          interactionMode: session.interactionMode,
          jobDescription: session.jobDescription,
          extractedSkills: session.extractedSkills,
          totalQuestions: session.totalPossible,
          startedAt: session.startedAt,
          questions: clientQuestions,
        },
      });
    } catch (err: any) {
      console.error('[MockupTestController.createSession] Error:', err?.message || err);
      const statusCode = err?.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        message: err?.message || 'Unable to generate AI questions. Please try again.',
      });
    }
  }

  /**
   * GET /api/mockup-tests/session/:sessionId
   * Retrieve session state & questions
   */
  public static async getSession(req: Request, res: Response): Promise<void> {
    const sessionId = String(req.params.sessionId);
    const userId = req.user?.userId;

    const result = await MockupTestService.getSession(sessionId, userId);

    res.status(200).json({
      success: true,
      data: result.session,
    });
  }

  /**
   * POST /api/mockup-tests/session/:sessionId/submit
   * Submit candidate answers for scoring and AI evaluation
   */
  public static async submitSession(req: Request, res: Response): Promise<void> {
    const sessionId = String(req.params.sessionId);
    const { answers, durationSeconds } = req.body;
    const userId = req.user?.userId;

    if (!Array.isArray(answers)) {
      throw AppError.badRequest('Answers array is required');
    }

    const result = await MockupTestService.submitSession(
      sessionId,
      answers,
      durationSeconds,
      userId
    );

    res.status(200).json({
      success: true,
      message: 'Assessment completed and evaluated successfully',
      data: result.session,
    });
  }

  /**
   * POST /api/mockup-tests/evaluate-descriptive
   * Evaluate a single descriptive answer on-the-fly with Gemini
   */
  public static async evaluateDescriptive(req: Request, res: Response): Promise<void> {
    const { question, answer, category, testType, jobDescription } = req.body;

    const result = await MockupTestService.evaluateSingleDescriptiveAnswer(
      question,
      answer,
      category,
      testType || 'aptitude',
      jobDescription
    );

    res.status(200).json({
      success: true,
      message: 'Descriptive response evaluated by AI',
      data: result,
    });
  }

  /**
   * POST /api/mockup-tests/generate-assessment
   * Generate tailored assessment questions with Gemini
   */
  public static async generateAssessment(req: Request, res: Response): Promise<void> {
    try {
      const { assessmentType, interactionMode, jobDescription } = req.body;
      const userId = req.user?.userId;

      const result = await MockupTestService.generateAssessmentQuestions({
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
      console.error('[MockupTestController.generateAssessment] Error:', err?.message || err);
      const statusCode = err?.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        message: err?.message || 'Unable to generate AI assessment. Please try again.',
      });
    }
  }

  /**
   * POST /api/mockup-tests/evaluate-assessment-answer
   * Evaluate a candidate's answer for Mockup Assessment using Gemini
   */
  public static async evaluateAssessmentAnswer(req: Request, res: Response): Promise<void> {
    try {
      const { question, answer, category, assessmentType, jobDescription } = req.body;

      const result = await MockupTestService.evaluateSingleDescriptiveAnswer(
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
      console.error('[MockupTestController.evaluateAssessmentAnswer] Error:', err?.message || err);
      const statusCode = err?.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        message: err?.message || 'Unable to evaluate response using AI. Please try again.',
      });
    }
  }

  /**
   * GET /api/mockup-tests/sessions
   * List past test history for authenticated user
   */
  public static async getUserSessions(req: Request, res: Response): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(200).json({ success: true, data: [] });
      return;
    }

    const sessions = await MockupTestService.getUserSessions(userId);

    res.status(200).json({
      success: true,
      data: sessions,
    });
  }
}
