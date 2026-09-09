import { ResumeParserService } from '../ai/services/resume-parser.service';
import { ValidatedResumeContent } from './validator.service';
import { AIParseError } from './import.errors';

export class ResumeAIParserService {
  private resumeParserService: ResumeParserService;

  constructor(resumeParserService?: ResumeParserService) {
    this.resumeParserService = resumeParserService || new ResumeParserService();
  }

  /**
   * Transforms raw resume text into structured JSON matching the application schema contract
   * using the centralized GoogleProvider and ResumeParserService.
   */
  public async transformTextToSchema(rawText: string): Promise<Record<string, any>> {
    const result = await this.resumeParserService.parseTextToResume(rawText);

    if (result.structuredResume) {
      return result.structuredResume;
    }

    // Step 9: Graceful Failure handling
    throw new AIParseError(result.error || 'AI Parsing failed to yield a valid resume schema.');
  }

  // Static convenience method to preserve existing calling signatures
  public static async transformTextToSchema(rawText: string): Promise<Record<string, any>> {
    const service = new ResumeAIParserService();
    return service.transformTextToSchema(rawText);
  }
}
