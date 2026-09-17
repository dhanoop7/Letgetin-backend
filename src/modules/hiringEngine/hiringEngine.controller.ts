import { Request, Response, NextFunction } from 'express';
import { HiringEngineService } from './services/hiringEngine.service.js';
import { AppError } from '../../utils/appError.js';

export class HiringEngineController {
  /**
   * POST /api/recruiter/jobs/:jobId/hiring-engine/config
   * Initializes or updates the hiring funnel configuration and starts stage 1 intake.
   */
  public static async configurePipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recruiterUserId = req.user?.userId;
      if (!recruiterUserId) throw AppError.unauthorized('Authentication required');

      const jobId = req.params.jobId as string;
      const { finalShortlistTarget, stages, status } = req.body;

      const result = await HiringEngineService.initializePipeline(jobId, recruiterUserId, {
        finalShortlistTarget,
        stages,
        status,
      });

      res.status(200).json({
        success: true,
        data: result,
        message: 'Hiring pipeline configured and candidate intake initialized successfully.',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/recruiter/jobs/:jobId/hiring-engine/config
   * Retrieves the current pipeline configuration and stage definitions.
   */
  public static async getPipelineConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recruiterUserId = req.user?.userId;
      if (!recruiterUserId) throw AppError.unauthorized('Authentication required');

      const jobId = req.params.jobId as string;
      const config = await HiringEngineService.getFunnelConfig(jobId, recruiterUserId);

      res.status(200).json({
        success: true,
        data: config,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/recruiter/jobs/:jobId/hiring-engine/funnel-metrics
   * Retrieves real-time funnel health, target vs active candidates, deficit, and stage breakdowns.
   */
  public static async getFunnelMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recruiterUserId = req.user?.userId;
      if (!recruiterUserId) throw AppError.unauthorized('Authentication required');

      const jobId = req.params.jobId as string;
      const metrics = await HiringEngineService.getFunnelMetrics(jobId, recruiterUserId);

      res.status(200).json({
        success: true,
        data: metrics,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/recruiter/jobs/:jobId/hiring-engine/stages/:stageId/candidates
   * Lists primary and reserve candidates for a specific stage.
   */
  public static async getStageCandidates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recruiterUserId = req.user?.userId;
      if (!recruiterUserId) throw AppError.unauthorized('Authentication required');

      const jobId = req.params.jobId as string;
      const stageId = req.params.stageId as string;

      const candidates = await HiringEngineService.getStageCandidates(jobId, stageId, recruiterUserId);

      res.status(200).json({
        success: true,
        data: candidates,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/recruiter/jobs/:jobId/hiring-engine/candidates/:applicationId/advance
   * Advances a candidate to the next sequential stage (or final shortlist).
   */
  public static async advanceCandidate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recruiterUserId = req.user?.userId;
      if (!recruiterUserId) throw AppError.unauthorized('Authentication required');

      const jobId = req.params.jobId as string;
      const applicationId = req.params.applicationId as string;
      const { score, notes, evaluationDetails } = req.body;

      const result = await HiringEngineService.advanceCandidate(jobId, applicationId, recruiterUserId, {
        score,
        notes,
        evaluationDetails,
      });

      res.status(200).json({
        success: true,
        data: result,
        message: result.isFinalShortlist
          ? 'Candidate has achieved final shortlist target!'
          : `Candidate advanced to stage '${result.nextStageId}'.`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/recruiter/jobs/:jobId/hiring-engine/candidates/:applicationId/fail
   * Rejects/fails a candidate and automatically triggers reserve pool refill if deficit exists.
   */
  public static async failCandidate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recruiterUserId = req.user?.userId;
      if (!recruiterUserId) throw AppError.unauthorized('Authentication required');

      const jobId = req.params.jobId as string;
      const applicationId = req.params.applicationId as string;
      const { reason } = req.body;

      const result = await HiringEngineService.failCandidate(jobId, applicationId, recruiterUserId, reason);

      res.status(200).json({
        success: true,
        data: {
          application: result.application,
          promotedCount: result.promotedCandidates.length,
          promotedCandidates: result.promotedCandidates,
        },
        message:
          result.promotedCandidates.length > 0
            ? `Candidate marked as failed. Automatically promoted ${result.promotedCandidates.length} candidate(s) from reserve pool.`
            : 'Candidate marked as failed.',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/recruiter/jobs/:jobId/hiring-engine/stages/:stageId/refill
   * Manually pulls from reserve candidates into primary pool for a stage.
   */
  public static async refillStage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recruiterUserId = req.user?.userId;
      if (!recruiterUserId) throw AppError.unauthorized('Authentication required');

      const jobId = req.params.jobId as string;
      const stageId = req.params.stageId as string;
      const { count } = req.body;

      const promoted = await HiringEngineService.manualRefill(jobId, stageId, recruiterUserId, count);

      res.status(200).json({
        success: true,
        data: {
          promotedCount: promoted.length,
          promotedCandidates: promoted,
        },
        message:
          promoted.length > 0
            ? `Successfully promoted ${promoted.length} candidate(s) from reserve pool.`
            : 'No reserve candidates were available or needed for promotion.',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/recruiter/jobs/:jobId/hiring-engine/candidates/:applicationId/history
   * Retrieves the immutable audit log for a candidate's journey.
   */
  public static async getCandidateHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recruiterUserId = req.user?.userId;
      if (!recruiterUserId) throw AppError.unauthorized('Authentication required');

      const jobId = req.params.jobId as string;
      const applicationId = req.params.applicationId as string;

      const history = await HiringEngineService.getCandidateStageHistory(jobId, applicationId, recruiterUserId);

      res.status(200).json({
        success: true,
        data: history,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/recruiter/jobs/:jobId/hiring-engine/candidates/:applicationId/assessment
   * Submits or records candidate assessment score, triggering automated stage progression or refill.
   */
  public static async submitAssessmentResult(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = req.params.jobId as string;
      const applicationId = req.params.applicationId as string;
      const { score, assessmentDetails } = req.body;

      if (typeof score !== 'number' || score < 0 || score > 100) {
        throw AppError.badRequest('Score must be a number between 0 and 100');
      }

      const result = await HiringEngineService.handleAssessmentCompleted(
        jobId,
        applicationId,
        score,
        assessmentDetails
      );

      res.status(200).json({
        success: true,
        data: result,
        message: result.processed
          ? `Assessment result processed: status is ${result.status || 'updated'}.`
          : `Assessment not processed: ${result.reason || 'Safety check failed'}.`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
}
