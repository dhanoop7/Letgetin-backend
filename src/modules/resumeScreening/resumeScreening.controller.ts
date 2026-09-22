import { Request, Response, NextFunction } from 'express';
import { resumeScreeningService } from './resumeScreening.service.js';
import { AppError } from '../../utils/appError.js';

export class ResumeScreeningController {
  /**
   * GET /api/resume-screening/jobs/:jobId/candidates
   * Lists candidates for a job in the Resume Shortlisting stage with scorecards.
   */
  public async getCandidates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
      const recruiterUserId = req.user?.userId;

      if (!recruiterUserId) {
        throw AppError.unauthorized('Recruiter authentication required.');
      }

      const {
        decision,
        screeningStatus,
        search,
        minScore,
        page,
        limit,
        sortBy,
        sortOrder,
      } = req.query as any;

      const result = await resumeScreeningService.getJobScreeningCandidates(jobId, recruiterUserId, {
        decision: decision && decision !== 'all' ? decision : undefined,
        screeningStatus: screeningStatus && screeningStatus !== 'all' ? screeningStatus : undefined,
        search: typeof search === 'string' ? search : undefined,
        minScore: typeof minScore === 'number' ? minScore : undefined,
        page: typeof page === 'number' ? page : 1,
        limit: typeof limit === 'number' ? limit : 20,
        sortBy: sortBy || 'score',
        sortOrder: sortOrder || 'desc',
      });

      res.status(200).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/resume-screening/jobs/:jobId/stats
   * Retrieves summary statistics for the Resume Shortlisting pipeline header.
   */
  public async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
      const recruiterUserId = req.user?.userId;

      if (!recruiterUserId) {
        throw AppError.unauthorized('Recruiter authentication required.');
      }

      const stats = await resumeScreeningService.getScreeningStats(jobId, recruiterUserId);

      res.status(200).json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/resume-screening/applications/:id
   * Retrieves candidate details, parsed resume, and full AI scorecard for the detail drawer.
   */
  public async getApplicationDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const applicationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const recruiterUserId = req.user?.userId;

      if (!recruiterUserId) {
        throw AppError.unauthorized('Recruiter authentication required.');
      }

      const detail = await resumeScreeningService.getApplicationEvaluationDetail(
        applicationId,
        recruiterUserId
      );

      res.status(200).json({
        success: true,
        data: detail,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/resume-screening/applications/:id/decision
   * Records a recruiter decision: 'shortlisted' | 'rejected' | 'needs_review'
   */
  public async recordDecision(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const applicationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const recruiterUserId = req.user?.userId;
      const { decision, notes } = req.body;

      if (!recruiterUserId) {
        throw AppError.unauthorized('Recruiter authentication required.');
      }

      const updated = await resumeScreeningService.recordRecruiterDecision(
        applicationId,
        recruiterUserId,
        { decision, notes }
      );

      res.status(200).json({
        success: true,
        data: updated,
        message: `Candidate resume decision updated to '${decision}' successfully.`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/resume-screening/jobs/:jobId/bulk-decision
   * Records bulk recruiter decisions for multiple applications.
   */
  public async recordBulkDecision(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
      const recruiterUserId = req.user?.userId;
      const { applicationIds, decision, notes } = req.body;

      if (!recruiterUserId) {
        throw AppError.unauthorized('Recruiter authentication required.');
      }

      const result = await resumeScreeningService.recordBulkRecruiterDecisions(
        jobId,
        recruiterUserId,
        { applicationIds, decision, notes }
      );

      res.status(200).json({
        success: true,
        data: result,
        message: `Successfully updated ${result.updatedCount} candidates to '${decision}'.`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/resume-screening/applications/:id/evaluate
   * Triggers or retries AI resume evaluation on demand.
   */
  public async evaluateApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const applicationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const recruiterUserId = req.user?.userId;

      if (!recruiterUserId) {
        throw AppError.unauthorized('Recruiter authentication required.');
      }

      // Verify ownership first
      await resumeScreeningService.getApplicationEvaluationDetail(applicationId, recruiterUserId);

      const evaluated = await resumeScreeningService.evaluateApplicationResume(applicationId);

      res.status(200).json({
        success: true,
        data: evaluated,
        message: 'Resume evaluated successfully.',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
}

export const resumeScreeningController = new ResumeScreeningController();
