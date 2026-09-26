import { Request, Response, NextFunction } from 'express';
import { assessmentService } from './assessment.service.js';

export class AssessmentController {
  /**
   * Recruiter: Get all questions for an assessment round
   */
  public async getRecruiterQuestions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = req.params.jobId as string;
      const roundId = req.params.roundId as string;
      const recruiterUserId = req.user!.userId;
      const questions = await assessmentService.getRecruiterQuestions(jobId, roundId, recruiterUserId);
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
   * Candidate: Get safe questions stripped of answers and evaluation criteria
   */
  public async getCandidateQuestions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = req.params.jobId as string;
      const roundId = req.params.roundId as string;
      const questions = await assessmentService.getCandidateQuestions(jobId, roundId);
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
   * Recruiter: Create a new assessment question
   */
  public async createQuestion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = req.params.jobId as string;
      const roundId = req.params.roundId as string;
      const recruiterUserId = req.user!.userId;
      const question = await assessmentService.createQuestion(jobId, roundId, recruiterUserId, req.body);
      res.status(201).json({
        success: true,
        data: question,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Recruiter: Update an existing question
   */
  public async updateQuestion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = req.params.jobId as string;
      const roundId = req.params.roundId as string;
      const questionId = req.params.questionId as string;
      const recruiterUserId = req.user!.userId;
      const question = await assessmentService.updateQuestion(jobId, roundId, questionId, recruiterUserId, req.body);
      res.status(200).json({
        success: true,
        data: question,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Recruiter: Delete an existing question
   */
  public async deleteQuestion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = req.params.jobId as string;
      const roundId = req.params.roundId as string;
      const questionId = req.params.questionId as string;
      const recruiterUserId = req.user!.userId;
      const result = await assessmentService.deleteQuestion(jobId, roundId, questionId, recruiterUserId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Recruiter: Reorder questions
   */
  public async reorderQuestions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = req.params.jobId as string;
      const roundId = req.params.roundId as string;
      const recruiterUserId = req.user!.userId;
      const questions = await assessmentService.reorderQuestions(
        jobId,
        roundId,
        recruiterUserId,
        req.body.questionIds
      );
      res.status(200).json({
        success: true,
        data: questions,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const assessmentController = new AssessmentController();
