import { Request, Response, NextFunction } from 'express';
import { jobService } from './job.service.js';
import { AppError } from '../../utils/appError.js';
import { jobAiAssistService } from './jobAiAssist.service.js';

export class JobController {
  /**
   * GET /api/jobs/recommendations
   * Returns AI-ranked personalized job recommendations for the authenticated user.
   */
  public async getRecommendations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      console.log('User ID for recommendations:', userId);

      const {
        search,
        workplaceType,
        employmentType,
        experienceLevel,
        country,
        minScore,
        page,
        limit,
        sort,
      } = req.query;

      if (!userId) {
        throw AppError.unauthorized('User authentication required for job recommendations');
      }

      const result = await jobService.getRecommendedJobs(userId, {
        search: typeof search === 'string' ? search : undefined,
        workplaceType: typeof workplaceType === 'string' ? (workplaceType as any) : undefined,
        employmentType: typeof employmentType === 'string' ? (employmentType as any) : undefined,
        experienceLevel: typeof experienceLevel === 'string' ? (experienceLevel as any) : undefined,
        country: typeof country === 'string' ? country : undefined,
        minScore: minScore ? parseInt(minScore as string, 10) : undefined,
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 20,
        sort: typeof sort === 'string' ? (sort as any) : undefined,
      });

      res.status(200).json({
        success: true,
        data: result,
        message: 'Personalized job recommendations retrieved successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/jobs
   * Browse all active jobs with optional filtering.
   */
  public async getJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      const {
        search,
        workplaceType,
        employmentType,
        experienceLevel,
        country,
        page,
        limit,
      } = req.query;

      const result = await jobService.getJobs(
        {
          search: typeof search === 'string' ? search : undefined,
          workplaceType: typeof workplaceType === 'string' ? (workplaceType as any) : undefined,
          employmentType: typeof employmentType === 'string' ? (employmentType as any) : undefined,
          experienceLevel: typeof experienceLevel === 'string' ? (experienceLevel as any) : undefined,
          country: typeof country === 'string' ? country : undefined,
          page: page ? parseInt(page as string, 10) : 1,
          limit: limit ? parseInt(limit as string, 10) : 20,
        },
        userId
      );

      res.status(200).json({
        success: true,
        data: result,
        message: 'Jobs retrieved successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/jobs/:id
   * Get single job details with personalized matching metrics.
   */
  public async getJobById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const userId = req.user?.userId;

      const job = await jobService.getJobById(id, userId);
      if (!job) {
        throw AppError.notFound(`Job with ID ${id} not found`);
      }

      res.status(200).json({
        success: true,
        data: job,
        message: 'Job details retrieved successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/jobs/sync-profile
   * Forces candidate profile sync and triggers embedding generation.
   */
  public async syncProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw AppError.unauthorized('User authentication required');
      }

      const profile = await jobService.syncCandidateProfile(userId);
      res.status(200).json({
        success: true,
        data: profile,
        message: 'Candidate job profile synced successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/jobs
   * Create a new recruiter job posting.
   */
  public async createJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const job = await jobService.createRecruiterJob(userId, req.body);

      res.status(201).json({
        success: true,
        data: job,
        message: 'Job created successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/jobs/ai-assist/generate
   * Generates a job description + skill suggestions from a title. Free convenience assist —
   * no hiring-pipeline credits involved. Returns success:true with content:null on AI-side
   * failure rather than erroring, so the frontend can fall back to manual entry gracefully.
   */
  public async generateJobContent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { title, employmentType, workplaceType, location } = req.body;
      const content = await jobAiAssistService.generateJobContent({ title, employmentType, workplaceType, location });

      res.status(200).json({
        success: true,
        data: { content },
        message: content ? 'Content generated successfully' : 'AI generation is temporarily unavailable',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/jobs/mine
   * List jobs posted by the authenticated recruiter.
   */
  public async getMyJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const jobs = await jobService.getJobsForRecruiter(userId);

      res.status(200).json({
        success: true,
        data: jobs,
        message: 'Jobs retrieved successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/jobs/mine/:id
   * Get a single recruiter job (ownership-checked).
   */
  public async getMyJobById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const job = await jobService.getRecruiterJobById(userId, id);

      res.status(200).json({
        success: true,
        data: job,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/jobs/mine/:id
   * Delete a recruiter job (ownership-checked).
   */
  public async deleteMyJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      await jobService.deleteRecruiterJob(userId, id);

      res.status(200).json({
        success: true,
        message: 'Job deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/jobs/:id/stage
   * Update a recruiter job's pipeline stage.
   */
  public async updateJobStage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const { stage } = req.body;
      const job = await jobService.updateJobStage(userId, id, stage);

      res.status(200).json({
        success: true,
        data: job,
        message: 'Job stage updated successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
}

export const jobController = new JobController();
