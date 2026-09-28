import { GoogleProvider } from '../providers/google.provider.js';
import { RESUME_PARSER_SYSTEM_PROMPT, getResumeParserUserPrompt } from '../prompts/resume-parser.prompt.js';
import { ResumeValidationService, ValidatedResumeContent } from '../../import/validator.service.js';

export interface ParseResultSuccess {
  success: true;
  rawExtractedText: string;
  structuredResume: ValidatedResumeContent;
  aiParsingStatus: 'success';
}

export interface ParseResultFailure {
  success: true;
  rawExtractedText: string;
  structuredResume: null;
  aiParsingStatus: 'failed';
  error: string;
}

export type ParseResumeResponse = ParseResultSuccess | ParseResultFailure;

export class ResumeParserService {
  private googleProvider: GoogleProvider;
  private validator: ResumeValidationService;

  constructor(googleProvider?: GoogleProvider, validator?: ResumeValidationService) {
    this.googleProvider = googleProvider || GoogleProvider.getInstance();
    this.validator = validator || new ResumeValidationService();
  }

  /**
   * Transforms raw text into a structured JSON Resume.
   * Implements Step 9: Graceful Failure & Step 10: Double JSON Validation.
   */
  public async parseTextToResume(rawText: string): Promise<ParseResumeResponse> {
    if (!rawText || !rawText.trim()) {
      return {
        success: true,
        rawExtractedText: '',
        structuredResume: null,
        aiParsingStatus: 'failed',
        error: 'Extracted text is empty.',
      };
    }

    const userPrompt = getResumeParserUserPrompt(rawText);

    // Attempt 1: Standard AI Parsing
    try {
      const response = await this.googleProvider.generate({
        promptName: 'parse-resume',
        systemInstruction: RESUME_PARSER_SYSTEM_PROMPT,
        prompt: userPrompt,
        jsonMode: true,
      });

      const parsedJson = JSON.parse(response.text);
      const validatedResume = this.validator.validateAndNormalize(parsedJson);

      return {
        success: true,
        rawExtractedText: rawText,
        structuredResume: validatedResume,
        aiParsingStatus: 'success',
      };
    } catch (firstErr: any) {
      console.warn(`[ResumeParserService] First AI parsing attempt failed or returned non-conforming JSON: ${firstErr?.message}. Executing single retry...`);

      // Attempt 2: Single retry with explicit correction instruction
      try {
        const retryPrompt = `${userPrompt}\n\nNOTE: Previous output was invalid. Ensure return value is STRICT valid JSON matching the exact schema above.`;
        const retryResponse = await this.googleProvider.generate({
          promptName: 'parse-resume-retry',
          systemInstruction: RESUME_PARSER_SYSTEM_PROMPT,
          prompt: retryPrompt,
          jsonMode: true,
        });

        const retryJson = JSON.parse(retryResponse.text);
        const validatedResume = this.validator.validateAndNormalize(retryJson);

        return {
          success: true,
          rawExtractedText: rawText,
          structuredResume: validatedResume,
          aiParsingStatus: 'success',
        };
      } catch (secondErr: any) {
        console.error(`[ResumeParserService] AI Parsing failed after retry: ${secondErr?.message}. Returning graceful failure result.`);

        // STEP 9: Graceful Failure - Never discard extracted text!
        return {
          success: true,
          rawExtractedText: rawText,
          structuredResume: null,
          aiParsingStatus: 'failed',
          error: secondErr?.message || 'AI Parsing failed to generate valid resume schema',
        };
      }
    }
  }
}
