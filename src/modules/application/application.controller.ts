import { Request, Response } from 'express';
import { applicationService, ApplicationQueryFilters } from './application.service.js';

export class ApplicationController {
  static getApplications = async (req: Request, res: Response): Promise<void> => {
    const filters: ApplicationQueryFilters = {
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
      status: req.query.status as string,
      source: req.query.source as string,
      search: req.query.search as string,
      sort: req.query.sort as any,
    };

    const result = await applicationService.getUserApplications(req.user!.userId, filters);

    res.status(200).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  };

  static createApplication = async (req: Request, res: Response): Promise<void> => {
    const { jobId, resumeId, coverLetterId, notes, source, status, matchScore } = req.body;

    const created = await applicationService.createApplication(req.user!.userId, {
      jobId,
      resumeId,
      coverLetterId,
      notes,
      source,
      status,
      matchScore,
    });

    res.status(201).json({
      success: true,
      data: created,
      message: 'Application recorded successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static updateStatus = async (req: Request, res: Response): Promise<void> => {
    const applicationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { status, notes } = req.body;

    const updated = await applicationService.updateApplicationStatus(
      req.user!.userId,
      String(applicationId),
      status,
      notes
    );

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Application status updated',
      timestamp: new Date().toISOString(),
    });
  };

  static deleteApplication = async (req: Request, res: Response): Promise<void> => {
    const applicationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await applicationService.deleteApplication(req.user!.userId, String(applicationId));

    res.status(200).json({
      success: true,
      data: result,
      message: 'Application removed',
      timestamp: new Date().toISOString(),
    });
  };

  static getAllApplicantsForRecruiter = async (req: Request, res: Response): Promise<void> => {
    const applicants = await applicationService.getAllApplicantsForRecruiter(req.user!.userId);
    res.status(200).json({ success: true, data: applicants, timestamp: new Date().toISOString() });
  };

  static getApplicantsForJob = async (req: Request, res: Response): Promise<void> => {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
    const applicants = await applicationService.getApplicantsForJob(req.user!.userId, String(jobId));

    res.status(200).json({
      success: true,
      data: applicants,
      timestamp: new Date().toISOString(),
    });
  };

  static updateApplicantStatus = async (req: Request, res: Response): Promise<void> => {
    const applicationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { status, notes } = req.body;

    const updated = await applicationService.updateApplicantStatus(
      req.user!.userId,
      String(applicationId),
      status,
      notes
    );

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Applicant status updated',
      timestamp: new Date().toISOString(),
    });
  };
}
