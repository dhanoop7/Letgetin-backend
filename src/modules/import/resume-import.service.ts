import { TextExtractionService } from './text-extraction.service';
import { ResumeAIParserService } from './ai-parser.service';
import { ResumeValidationService, ValidatedResumeContent } from './validator.service';

export class ResumeImportService {
  private textExtractionService: TextExtractionService;
  private aiParserService: ResumeAIParserService;
  private validationService: ResumeValidationService;

  constructor(
    textExtractionService?: TextExtractionService,
    aiParserService?: ResumeAIParserService,
    validationService?: ResumeValidationService
  ) {
    this.textExtractionService = textExtractionService || new TextExtractionService();
    this.aiParserService = aiParserService || new ResumeAIParserService();
    this.validationService = validationService || new ResumeValidationService();
  }

  /**
   * Orchestrates complete Resume Import from binary buffer:
   * Text Extraction -> AI Parsing -> Validation & Normalization -> Return Structured Resume
   */
  public async importFromFileBuffer(
    buffer: Buffer,
    fileTypeHint?: string
  ): Promise<ValidatedResumeContent> {
    console.log('\n=========== REQUEST RECEIVED ===========');
    console.log(`Buffer Size  : ${buffer ? buffer.length : 0} bytes`);
    console.log(`FileType Hint: ${fileTypeHint || 'N/A'}`);
    console.log('========================================\n');

    // STEP 1 & 2: Text Extraction
    const rawText = await this.textExtractionService.extractTextFromBuffer(buffer, fileTypeHint);

    // STEP 6: Stop pipeline immediately if extracted text is empty or invalid
    if (!rawText || rawText.trim().length < 20) {
      throw new Error('Unable to extract readable text from uploaded resume.');
    }

    // STEP 3: AI Parsing & Validation & Normalization
    return await this.importFromRawText(rawText);
  }

  /**
   * Orchestrates Resume Import from raw text string
   */
  public async importFromRawText(rawText: string): Promise<ValidatedResumeContent> {
    console.log('\n=========== AI PARSER ==================');
    console.log(`AI Input Text Length: ${rawText.length} characters`);
    console.log(`AI Input Preview    :\n${rawText.slice(0, 500)}`);
    console.log('========================================\n');

    let rawJson: Record<string, any> | null = null;
    try {
      // AI Parser step
      rawJson = await this.aiParserService.transformTextToSchema(rawText);
    } catch (err: any) {
      console.warn(`[ResumeImportService] AI Schema transformation encountered issue (${err?.message}). Executing structural text fallback extraction.`);
      rawJson = this.extractBasicFieldsFromText(rawText);
    }

    // Validation & Normalization step
    const validatedResume = this.validationService.validateAndNormalize(rawJson || {});

    console.log('\n=========== PIPELINE SUCCESS ===========');
    console.log(`Parsed Name     : ${validatedResume.personalInfo.fullName}`);
    console.log(`Parsed Headline : ${validatedResume.personalInfo.headline}`);
    console.log(`Experiences Count: ${validatedResume.experiences.length}`);
    console.log(`Skills Count     : ${validatedResume.skills.length}`);
    console.log('========================================\n');

    return validatedResume;
  }

  /**
   * Fallback extractor in case AI service is unavailable or rate-limited.
   * Extracts real text lines from the document without fabricating mock values.
   */
  private extractBasicFieldsFromText(rawText: string): Record<string, any> {
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const emailMatch = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = rawText.match(/(?:\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/);
    const urlMatch = rawText.match(/https?:\/\/[^\s]+|github\.com\/[^\s]+|linkedin\.com\/in\/[^\s]+/i);

    return {
      personalInfo: {
        fullName: lines[0] || '',
        headline: lines.find((l) => /engineer|developer|manager|architect|lead|student|intern/i.test(l)) || '',
        email: emailMatch ? emailMatch[0] : '',
        phone: phoneMatch ? phoneMatch[0] : '',
        location: '',
        websiteUrl: urlMatch ? urlMatch[0] : '',
      },
      summary: lines.slice(1, 4).join(' '),
      experiences: [],
      educations: [],
      projects: [],
      skills: [],
      certificates: [],
      languages: [],
    };
  }

  public static async importFromFileBuffer(
    buffer: Buffer,
    fileTypeHint?: string
  ): Promise<ValidatedResumeContent> {
    const service = new ResumeImportService();
    return service.importFromFileBuffer(buffer, fileTypeHint);
  }

  public static async importFromRawText(rawText: string): Promise<ValidatedResumeContent> {
    const service = new ResumeImportService();
    return service.importFromRawText(rawText);
  }
}
