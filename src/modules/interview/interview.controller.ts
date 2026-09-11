import { Request, Response } from 'express';
import { InterviewService } from './interview.service.js';
import { InterviewStage } from './interview.model.js';

export class InterviewController {
  public static async listInterviews(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const { stage, date, search, limit, skip } = req.query;

    const result = await InterviewService.listInterviews(userId, {
      stage: stage as InterviewStage | undefined,
      date: date as string | undefined,
      search: search as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      skip: skip ? parseInt(skip as string, 10) : undefined,
    });

    res.status(200).json({
      success: true,
      data: result.interviews,
      total: result.total,
    });
  }

  public static async getInterviewById(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const id = req.params.id as string;

    const interview = await InterviewService.getInterviewById(id, userId);

    res.status(200).json({
      success: true,
      data: interview,
    });
  }

  public static async createInterview(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const interview = await InterviewService.createInterview(userId, req.body);

    res.status(201).json({
      success: true,
      data: interview,
      message: 'Interview scheduled successfully',
    });
  }

  public static async updateInterview(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const id = req.params.id as string;

    const updated = await InterviewService.updateInterview(id, userId, req.body);

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Interview updated successfully',
    });
  }

  public static async updateStage(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const { stage } = req.body;

    const updated = await InterviewService.updateStage(id, userId, stage);

    res.status(200).json({
      success: true,
      data: updated,
      message: `Interview moved to ${stage}`,
    });
  }

  public static async submitFeedback(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const { score, feedbackNotes } = req.body;

    const updated = await InterviewService.submitFeedback(id, userId, score, feedbackNotes);

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Feedback submitted successfully',
    });
  }

  public static async deleteInterview(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const id = req.params.id as string;

    await InterviewService.deleteInterview(id, userId);

    res.status(200).json({
      success: true,
      message: 'Interview deleted successfully',
    });
  }

  public static async generateQuestions(req: Request, res: Response): Promise<void> {
    const { role, skills, experienceLevel, count } = req.body;

    const questions = await InterviewService.generateQuestions(role, skills, experienceLevel, count);

    res.status(200).json({
      success: true,
      data: questions,
    });
  }

  public static async evaluateSession(req: Request, res: Response): Promise<void> {
    const userId = req.user?.userId;
    const { role, questionsAndAnswers, interviewId } = req.body;

    const scorecard = await InterviewService.evaluateSession(role, questionsAndAnswers, interviewId, userId);

    res.status(200).json({
      success: true,
      data: scorecard,
    });
  }
}
