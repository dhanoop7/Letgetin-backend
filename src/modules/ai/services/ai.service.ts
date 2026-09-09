import { SummaryService } from './summary.service.js';
import { ImproveService } from './improve.service.js';
import { AtsService } from './ats.service.js';
import { ChatService } from './chat.service.js';
import { ResumeParserService } from './resume-parser.service.js';

export class AIService {
  private summaryService: SummaryService;
  private improveService: ImproveService;
  private atsService: AtsService;
  private chatService: ChatService;
  private resumeParserService: ResumeParserService;

  constructor(
    summaryService?: SummaryService,
    improveService?: ImproveService,
    atsService?: AtsService,
    chatService?: ChatService,
    resumeParserService?: ResumeParserService
  ) {
    this.summaryService = summaryService || new SummaryService();
    this.improveService = improveService || new ImproveService();
    this.atsService = atsService || new AtsService();
    this.chatService = chatService || new ChatService();
    this.resumeParserService = resumeParserService || new ResumeParserService();
  }

  public async improveSummary(
    userId: string,
    currentSummary: string,
    targetRole?: string,
    tone: string = 'impactful'
  ) {
    return this.summaryService.improveSummary(userId, currentSummary, targetRole, tone);
  }

  public async rewriteExperienceBullet(userId: string, position: string, rawBullet: string) {
    return this.improveService.rewriteExperienceBullet(userId, position, rawBullet);
  }

  public async generateSkills(userId: string, targetJobTitle: string, existingSkills: string[]) {
    return this.improveService.generateSkills(userId, targetJobTitle, existingSkills);
  }

  public async analyzeAts(userId: string, resumeContent: unknown, targetJobDescription?: string) {
    return this.atsService.analyzeAts(userId, resumeContent, targetJobDescription);
  }

  public async optimizeSection(userId: string, sectionName: string, sectionData: unknown) {
    return this.improveService.optimizeSection(userId, sectionName, sectionData);
  }

  public async chatWithResumeContext(
    userId: string,
    message: string,
    resumeContext?: Record<string, unknown>,
    options?: {
      resumeId?: string;
      conversationHistory?: any[];
      activeResumeContext?: Record<string, unknown>;
    }
  ) {
    return this.chatService.chatWithResumeContext(userId, message, resumeContext, options);
  }

  public async chatWithResumeContextStream(
    userId: string,
    message: string,
    resumeContext: Record<string, unknown> | undefined,
    options: {
      resumeId?: string;
      conversationHistory?: any[];
      activeResumeContext?: Record<string, unknown>;
    } | undefined,
    onChunk: (chunkText: string) => void
  ) {
    return this.chatService.chatWithResumeContextStream(userId, message, resumeContext, options, onChunk);
  }

  public async parseResumeText(userId: string, rawText: string) {
    const result = await this.resumeParserService.parseTextToResume(rawText);
    if (result.structuredResume) {
      return { parsedContent: result.structuredResume };
    }
    return {
      parsedContent: null,
      rawExtractedText: result.rawExtractedText,
      aiParsingStatus: 'failed',
    };
  }

  public async matchJobDescription(userId: string, resumeContent: unknown, jobDescription: string) {
    return this.atsService.matchJobDescription(userId, resumeContent, jobDescription);
  }
}
