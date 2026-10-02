import { Request, Response, NextFunction } from 'express';
import { domainAssessmentService } from './domainAssessment.service.js';

const getParamId = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || '';
  return param || '';
};

export class DomainAssessmentController {
  /**
   * AI Auto-Configure test parameters based on role and job description
   */
  public async autoConfigure(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const config = await domainAssessmentService.autoConfigure(req.body);
      res.status(200).json({
        success: true,
        data: config,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * AI Question Generation tailored to domain and testing modes
   */
  public async generateQuestions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const questions = await domainAssessmentService.generateQuestions(req.body);
      res.status(200).json({
        success: true,
        count: questions.length,
        data: questions,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * AI Question Generation tailored to specific assessment round types (General Aptitude, Technical Test, Rapid Round, etc.)
   */
  public async generateRoundQuestions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const questions = await domainAssessmentService.generateRoundQuestions(req.body);
      res.status(200).json({
        success: true,
        count: questions.length,
        data: questions,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Create a new Domain Specific Assessment (Draft)
   */
  public async createAssessment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recruiterId = req.user?.userId;
      const assessment = await domainAssessmentService.createAssessment(req.body, recruiterId);
      res.status(201).json({
        success: true,
        message: 'Domain Assessment created successfully',
        data: assessment,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * List assessments with search, filtering, and pagination
   */
  public async getAssessments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recruiterId = req.user?.userId;
      const { status, domain, search, page, limit } = req.query as Record<string, string>;
      const result = await domainAssessmentService.getAssessments({
        recruiterId,
        status,
        domain,
        search,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get single assessment by ID or assessmentId
   */
  public async getAssessmentById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getParamId(req.params.id);
      const assessment = await domainAssessmentService.getAssessmentById(id);
      res.status(200).json({
        success: true,
        data: assessment,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update assessment configuration or questions
   */
  public async updateAssessment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getParamId(req.params.id);
      const updated = await domainAssessmentService.updateAssessment(id, req.body);
      res.status(200).json({
        success: true,
        message: 'Assessment updated successfully',
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Delete or archive an assessment
   */
  public async deleteAssessment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getParamId(req.params.id);
      await domainAssessmentService.deleteAssessment(id);
      res.status(200).json({
        success: true,
        message: 'Assessment deleted or archived successfully',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Publish an assessment
   */
  public async publishAssessment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getParamId(req.params.id);
      const published = await domainAssessmentService.publishAssessment(id);
      res.status(200).json({
        success: true,
        message: 'Assessment published successfully',
        data: published,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Archive an assessment
   */
  public async archiveAssessment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getParamId(req.params.id);
      const archived = await domainAssessmentService.archiveAssessment(id);
      res.status(200).json({
        success: true,
        message: 'Assessment archived successfully',
        data: archived,
      });
    } catch (err) {
      next(err);
    }
  }

  // ==========================================
  // CANDIDATE TEST ATTEMPT CONTROLLERS
  // ==========================================

  /**
   * Candidate or Recruiter: Start a test attempt
   */
  public async startAttempt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const assessmentId = getParamId(req.params.id);
      const candidateId = req.user?.userId;
      const candidateData = {
        candidateName: req.body.candidateName || (req.user ? `Candidate ${req.user.email.split('@')[0]}` : 'Anonymous Candidate'),
        candidateEmail: req.body.candidateEmail || req.user?.email || 'candidate@example.com',
        candidateId,
      };
      const attempt = await domainAssessmentService.startAttempt(assessmentId, candidateData);
      res.status(201).json({
        success: true,
        message: 'Assessment session started',
        data: attempt,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Candidate: Get test session data and questions
   */
  public async getAttempt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const attemptId = getParamId(req.params.id);
      const data = await domainAssessmentService.getAttempt(attemptId);
      res.status(200).json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Candidate: Auto-save single answer or partial progress
   */
  public async saveAnswer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const attemptId = getParamId(req.params.id);
      await domainAssessmentService.saveAnswer(attemptId, req.body);
      res.status(200).json({
        success: true,
        message: 'Answer saved',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Candidate: Submit test and trigger automated evaluation
   */
  public async submitAttempt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const attemptId = getParamId(req.params.id);
      const evaluation = await domainAssessmentService.submitAttempt(attemptId);
      res.status(200).json({
        success: true,
        message: 'Assessment submitted and evaluated successfully',
        data: evaluation,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Candidate: Get assessment results / scorecard
   */
  public async getAttemptResult(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const attemptId = getParamId(req.params.id);
      const result = await domainAssessmentService.getAttemptResult(attemptId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Recruiter: Get all candidate results and summary analytics for an assessment
   */
  public async getAssessmentResults(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = getParamId(req.params.id);
      const results = await domainAssessmentService.getAssessmentResults(id);
      res.status(200).json({
        success: true,
        data: results,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const domainAssessmentController = new DomainAssessmentController();
