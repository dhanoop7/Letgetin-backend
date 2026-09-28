import { Request, Response } from 'express';
import { ResumeImportService } from './resume-import.service';
import { ResumeImportError } from './import.errors';

export class ResumeImportController {
  private resumeImportService: ResumeImportService;

  constructor(resumeImportService?: ResumeImportService) {
    this.resumeImportService = resumeImportService || new ResumeImportService();
  }

  public importResume = async (req: Request, res: Response): Promise<void> => {
    try {
      const { rawText, fileBufferBase64, fileType } = req.body;

      let result;
      if (fileBufferBase64 && typeof fileBufferBase64 === 'string') {
        const buffer = Buffer.from(fileBufferBase64, 'base64');
        result = await this.resumeImportService.importFromFileBuffer(buffer, fileType);
      } else if (rawText && typeof rawText === 'string') {
        result = await this.resumeImportService.importFromRawText(rawText);
      } else {
        res.status(400).json({
          success: false,
          error: 'Invalid request payload. Please provide either rawText or fileBufferBase64.',
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Resume parsed, validated, and normalized successfully.',
        data: {
          parsedContent: result,
        },
      });
    } catch (error: any) {
      console.error('Resume Import Controller Error:', error?.message || error);

      if (error instanceof ResumeImportError) {
        res.status(error.statusCode).json({
          success: false,
          error: error.message,
          ...(error.name === 'ValidationError' && 'validationErrors' in error
            ? { details: (error as any).validationErrors }
            : {}),
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: error?.message || 'An unexpected error occurred during resume import.',
      });
    }
  };

  public static async importResume(req: Request, res: Response): Promise<void> {
    const controller = new ResumeImportController();
    return controller.importResume(req, res);
  }
}
