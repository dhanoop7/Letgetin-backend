import ExcelJS from 'exceljs';
import { DocumentParserService } from '../../../services/documentParser.service.js';
import { GoogleProvider } from '../../ai/providers/google.provider.js';
import { env } from '../../../config/env.js';
import { AppError } from '../../../utils/appError.js';
import { createChildLogger } from '../../../infrastructure/logging/logger.js';

const logger = createChildLogger({ component: 'QuestionBankParserService' });

export interface ParsedQuestionItem {
  id: string;
  section?: 'mcq' | 'descriptive' | 'rapid';
  type: 'mcq' | 'coding' | 'short_answer' | 'descriptive' | 'rapid';
  question: string;
  options?: Array<{ id: string; text: string }>;
  correctOptionId?: string;
  points: number;
  timeLimitSeconds?: number;
  explanation?: string;
  sampleAnswer?: string;
  evaluationRubric?: string;
}

export interface ParseResult {
  success: boolean;
  totalQuestions: number;
  questions: ParsedQuestionItem[];
  filename: string;
  format: 'xlsx' | 'csv' | 'json' | 'pdf' | 'docx' | 'unknown';
}

function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export class QuestionBankParserService {
  /**
   * Main entrypoint: parses an uploaded file buffer into a validated array of questions.
   */
  public static async parseFile(
    fileBuffer: Buffer,
    originalFilename: string,
    mimeType: string
  ): Promise<ParseResult> {
    const ext = originalFilename.split('.').pop()?.toLowerCase() || '';

    if (ext === 'xlsx' || ext === 'xls' || mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      const questions = await this.parseExcel(fileBuffer);
      return {
        success: true,
        totalQuestions: questions.length,
        questions,
        filename: originalFilename,
        format: 'xlsx',
      };
    }

    if (ext === 'csv' || mimeType === 'text/csv') {
      const questions = await this.parseCsv(fileBuffer);
      return {
        success: true,
        totalQuestions: questions.length,
        questions,
        filename: originalFilename,
        format: 'csv',
      };
    }

    if (ext === 'json' || mimeType === 'application/json') {
      const questions = this.parseJson(fileBuffer);
      return {
        success: true,
        totalQuestions: questions.length,
        questions,
        filename: originalFilename,
        format: 'json',
      };
    }

    if (ext === 'pdf' || mimeType === 'application/pdf') {
      const questions = await this.parseDocumentWithAi(fileBuffer, 'application/pdf', originalFilename);
      return {
        success: true,
        totalQuestions: questions.length,
        questions,
        filename: originalFilename,
        format: 'pdf',
      };
    }

    if (
      ext === 'docx' ||
      ext === 'doc' ||
      mimeType.includes('word') ||
      mimeType.includes('officedocument') ||
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const questions = await this.parseDocumentWithAi(
        fileBuffer,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        originalFilename
      );
      return {
        success: true,
        totalQuestions: questions.length,
        questions,
        filename: originalFilename,
        format: 'docx',
      };
    }

    throw AppError.badRequest(
      `Unsupported file format for question bank (.${ext}). Supported formats: .xlsx, .csv, .json, .pdf, .docx`
    );
  }

  /**
   * Parses Excel spreadsheet (.xlsx, .xls) into MCQ questions.
   */
  private static async parseExcel(buffer: Buffer): Promise<ParsedQuestionItem[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];

    return this.extractRowsFromSheet(sheet);
  }

  /**
   * Parses CSV format into MCQ questions.
   */
  private static async parseCsv(buffer: Buffer): Promise<ParsedQuestionItem[]> {
    const csvContent = buffer.toString('utf-8');
    const workbook = new ExcelJS.Workbook();
    const stream = require('stream');
    const readable = new stream.Readable();
    readable._read = () => {};
    readable.push(csvContent);
    readable.push(null);

    const sheet = await workbook.csv.read(readable);
    return this.extractRowsFromSheet(sheet);
  }

  /**
   * Extracts question items from an ExcelJS Worksheet.
   */
  private static extractRowsFromSheet(sheet: ExcelJS.Worksheet): ParsedQuestionItem[] {
    const headerRow = sheet.getRow(1);
    const colMap: Record<string, number> = {};

    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const normalized = normalizeHeader(String(cell.value ?? ''));
      if (normalized.includes('question') || normalized.includes('prompt')) {
        colMap['question'] = colNumber;
      } else if (normalized === 'type' || normalized === 'question type' || normalized === 'format') {
        colMap['type'] = colNumber;
      } else if (normalized === 'option a' || normalized === 'choice a' || normalized === 'a') {
        colMap['option_a'] = colNumber;
      } else if (normalized === 'option b' || normalized === 'choice b' || normalized === 'b') {
        colMap['option_b'] = colNumber;
      } else if (normalized === 'option c' || normalized === 'choice c' || normalized === 'c') {
        colMap['option_c'] = colNumber;
      } else if (normalized === 'option d' || normalized === 'choice d' || normalized === 'd') {
        colMap['option_d'] = colNumber;
      } else if (
        normalized.includes('sample') ||
        normalized.includes('model answer') ||
        normalized.includes('expected')
      ) {
        colMap['sample_answer'] = colNumber;
      } else if (normalized.includes('rubric') || normalized.includes('criteria')) {
        colMap['rubric'] = colNumber;
      } else if (
        normalized.includes('correct') ||
        normalized.includes('answer') ||
        normalized === 'key'
      ) {
        colMap['correct'] = colNumber;
      } else if (normalized.includes('point') || normalized.includes('mark') || normalized.includes('score')) {
        colMap['points'] = colNumber;
      } else if (normalized.includes('explanation') || normalized.includes('reason')) {
        colMap['explanation'] = colNumber;
      }
    });

    // Default column fallback if exact headers weren't named: col 1=Q, 2=A, 3=B, 4=C, 5=D, 6=Correct
    if (!colMap['question']) colMap['question'] = 1;
    if (!colMap['option_a']) colMap['option_a'] = 2;
    if (!colMap['option_b']) colMap['option_b'] = 3;
    if (!colMap['option_c']) colMap['option_c'] = 4;
    if (!colMap['option_d']) colMap['option_d'] = 5;
    if (!colMap['correct']) colMap['correct'] = 6;

    const questions: ParsedQuestionItem[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      const getVal = (col?: number) => (col ? String(row.getCell(col).value ?? '').trim() : '');
      const questionText = getVal(colMap['question']);

      // Ignore empty question lines
      if (!questionText || questionText.length < 3) return;

      const optA = getVal(colMap['option_a']);
      const optB = getVal(colMap['option_b']);
      const optC = getVal(colMap['option_c']);
      const optD = getVal(colMap['option_d']);

      const rawCorrect = getVal(colMap['correct']).trim();
      const rawCorrectUpper = rawCorrect.toUpperCase();
      let correctOptionId = 'A';
      if (rawCorrectUpper.includes('B') || rawCorrectUpper === optB.toUpperCase()) correctOptionId = 'B';
      else if (rawCorrectUpper.includes('C') || rawCorrectUpper === optC.toUpperCase()) correctOptionId = 'C';
      else if (rawCorrectUpper.includes('D') || rawCorrectUpper === optD.toUpperCase()) correctOptionId = 'D';

      const pointsRaw = getVal(colMap['points']);
      const points = parseInt(pointsRaw, 10) > 0 ? parseInt(pointsRaw, 10) : 10;
      const explanation = getVal(colMap['explanation']) || undefined;
      const sampleAnswer = getVal(colMap['sample_answer']) || undefined;
      const rubric = getVal(colMap['rubric']) || undefined;

      const rowType = (getVal(colMap['type']) || '').toLowerCase();
      const isExplicitRapid = rowType.includes('rapid') || rowType.includes('speed');
      const isExplicitDescriptive =
        rowType.includes('descriptive') ||
        rowType.includes('subjective') ||
        rowType.includes('short');

      const options: Array<{ id: string; text: string }> = [];
      if (optA) options.push({ id: 'A', text: optA });
      if (optB) options.push({ id: 'B', text: optB });
      if (optC) options.push({ id: 'C', text: optC });
      if (optD) options.push({ id: 'D', text: optD });

      if (isExplicitRapid) {
        questions.push({
          id: `bank_q_${questions.length + 1}_${Math.random().toString(36).substring(2, 6)}`,
          section: 'rapid',
          type: 'rapid',
          question: questionText,
          options,
          correctOptionId,
          points,
          timeLimitSeconds: 30,
          explanation,
        });
      } else if (options.length >= 2 && !isExplicitDescriptive) {
        questions.push({
          id: `bank_q_${questions.length + 1}_${Math.random().toString(36).substring(2, 6)}`,
          section: 'mcq',
          type: 'mcq',
          question: questionText,
          options,
          correctOptionId,
          points,
          explanation,
        });
      } else if (isExplicitDescriptive || options.length < 2) {
        // Descriptive or open-ended analytical question
        const resolvedSampleAnswer =
          sampleAnswer ||
          (rawCorrect && !['A', 'B', 'C', 'D'].includes(rawCorrectUpper) ? rawCorrect : '') ||
          explanation ||
          undefined;

        questions.push({
          id: `bank_q_${questions.length + 1}_${Math.random().toString(36).substring(2, 6)}`,
          section: 'descriptive',
          type: 'descriptive',
          question: questionText,
          sampleAnswer: resolvedSampleAnswer,
          evaluationRubric: rubric || explanation || undefined,
          points,
          explanation,
        });
      }
    });

    return questions;
  }

  /**
   * Parses JSON file buffer.
   */
  private static parseJson(buffer: Buffer): ParsedQuestionItem[] {
    try {
      const raw = JSON.parse(buffer.toString('utf-8'));
      const list = Array.isArray(raw) ? raw : raw.questions || raw.items || [];
      const parsed: ParsedQuestionItem[] = [];

      list.forEach((item: any, idx: number) => {
        const questionText = item.question || item.prompt || item.text;
        if (!questionText) return;

        let options: Array<{ id: string; text: string }> = [];
        if (Array.isArray(item.options)) {
          options = item.options.map((opt: any, oIdx: number) => {
            if (typeof opt === 'string') {
              const letter = String.fromCharCode(65 + oIdx);
              return { id: letter, text: opt };
            }
            return {
              id: opt.id || String.fromCharCode(65 + oIdx),
              text: opt.text || opt.label || '',
            };
          });
        }

        const correct = String(item.correctOptionId || item.correctAnswer || item.answer || 'A').toUpperCase();
        let correctOptionId = 'A';
        if (['A', 'B', 'C', 'D'].includes(correct)) {
          correctOptionId = correct;
        }

        parsed.push({
          id: `bank_json_${idx + 1}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'mcq',
          question: questionText,
          options,
          correctOptionId,
          points: typeof item.points === 'number' ? item.points : 10,
          explanation: item.explanation || undefined,
        });
      });

      return parsed;
    } catch (err: any) {
      throw AppError.badRequest(`Failed to parse JSON question bank: ${err?.message}`);
    }
  }

  /**
   * Normalizes raw AI output (which can be array or object, string options or object options)
   * into clean, strongly-typed MCQ items.
   */
  private static normalizeAiQuestionsList(rawJson: any): ParsedQuestionItem[] {
    let list: any[] = [];
    if (Array.isArray(rawJson)) {
      list = rawJson;
    } else if (rawJson && typeof rawJson === 'object') {
      list = rawJson.questions || rawJson.mcqs || rawJson.items || rawJson.data || [];
    }

    const parsed: ParsedQuestionItem[] = [];

    list.forEach((item: any, idx: number) => {
      const questionText = item.question || item.prompt || item.text;
      if (!questionText || typeof questionText !== 'string' || questionText.trim().length === 0) {
        return;
      }

      // Normalize options
      let options: Array<{ id: string; text: string }> = [];
      if (Array.isArray(item.options)) {
        options = item.options.map((opt: any, oIdx: number) => {
          const defaultLetter = String.fromCharCode(65 + oIdx);
          if (typeof opt === 'string') {
            const match = opt.match(/^([A-Da-d])[\)\.\:\-]\s*(.*)$/);
            if (match) {
              return { id: match[1].toUpperCase(), text: match[2].trim() };
            }
            return { id: defaultLetter, text: opt.trim() };
          }
          return {
            id: String(opt.id || defaultLetter).toUpperCase().trim(),
            text: String(opt.text || opt.label || opt.value || '').trim(),
          };
        });
      }

      // Normalize correct answer key
      const rawKey = String(
        item.correctOptionId ||
        item.correct_answer ||
        item.correctAnswer ||
        item.answer ||
        item.key ||
        'A'
      ).trim().toUpperCase();

      let correctOptionId = 'A';
      if (['A', 'B', 'C', 'D', 'E'].includes(rawKey)) {
        correctOptionId = rawKey;
      } else {
        const matchedOpt = options.find((o) => o.text.toLowerCase() === rawKey.toLowerCase());
        if (matchedOpt) {
          correctOptionId = matchedOpt.id;
        }
      }

      // Check if item is descriptive / open-ended
      const isDescriptive =
        item.type === 'descriptive' ||
        item.type === 'short_answer' ||
        item.type === 'subjective' ||
        (options.length < 2 &&
          Boolean(item.sampleAnswer || item.expectedAnswer || item.rubric || item.evaluationRubric || item.explanation));

      if (isDescriptive) {
        parsed.push({
          id: `bank_ai_${idx + 1}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'descriptive',
          question: questionText.trim(),
          sampleAnswer: item.sampleAnswer || item.expectedAnswer || item.answer || item.explanation || undefined,
          evaluationRubric: item.evaluationRubric || item.rubric || item.explanation || undefined,
          points: typeof item.points === 'number' && item.points > 0 ? item.points : 10,
          explanation: item.explanation || undefined,
        });
        return;
      }

      parsed.push({
        id: `bank_ai_${idx + 1}_${Math.random().toString(36).substring(2, 6)}`,
        type: 'mcq',
        question: questionText.trim(),
        options,
        correctOptionId,
        points: typeof item.points === 'number' && item.points > 0 ? item.points : 10,
        explanation: item.explanation || undefined,
      });
    });

    return parsed;
  }

  /**
   * Parses unstructured documents (PDF or DOCX) by extracting text and using Gemini AI.
   */
  private static async parseDocumentWithAi(
    buffer: Buffer,
    mimeType: string,
    filename: string
  ): Promise<ParsedQuestionItem[]> {
    const isPdf = filename.toLowerCase().endsWith('.pdf') || mimeType === 'application/pdf';

    // 1. Extract text using DocumentParserService (enhanced with mammoth + pdfjs-dist)
    const extracted = await DocumentParserService.extractText(buffer, mimeType, filename);
    const documentText = extracted.text ? extracted.text.trim() : '';

    const ai = GoogleProvider.getInstance();

    const promptInstructions = `You are an expert assessment question extractor.
Extract all assessment questions (both multiple-choice questions AND descriptive / analytical problem-solving questions) from the provided document into structured JSON.
Each question MUST follow this schema:
[
  {
    "type": "mcq",
    "question": "What is the capital of France?",
    "options": [
      { "id": "A", "text": "Berlin" },
      { "id": "B", "text": "Madrid" },
      { "id": "C", "text": "Paris" },
      { "id": "D", "text": "Rome" }
    ],
    "correctOptionId": "C",
    "points": 10,
    "explanation": "Paris is the capital of France."
  },
  {
    "type": "descriptive",
    "question": "A firm has fixed costs of $100k and variable costs of $40/unit with price $80. Derive the break-even volume and explain the impact of a 10% increase in variable costs.",
    "sampleAnswer": "Break-even volume is Fixed Costs / Contribution Margin...",
    "evaluationRubric": "Formulation: 3 pts, Derivation: 4 pts, Final conclusion: 3 pts",
    "points": 10,
    "explanation": "Tests quantitative break-even reasoning."
  }
]
Rules:
- Capture all questions found in the document.
- For MCQs: If options in the document are formatted as "A) Berlin", "B) Madrid", populate "id" and "text". If correct answer is indicated (e.g. "Ans: C"), set "correctOptionId".
- For Descriptive / Open-Ended questions: Set "type": "descriptive", populate "sampleAnswer" and "evaluationRubric".
- Return ONLY valid JSON (an array of question objects, or an object with a "questions" array). No markdown formatting.`;

    let aiRawText = '';

    // If text was successfully extracted and has content
    if (documentText && documentText.length >= 20) {
      const fullPrompt = `${promptInstructions}

Document Content:
"""
${documentText.slice(0, 35000)}
"""`;

      try {
        const response = await ai.generate({
          prompt: fullPrompt,
          promptName: 'parse_question_bank_document_text',
          jsonMode: true,
          temperature: 0.2,
        });
        aiRawText = response.text;
      } catch (aiErr: any) {
        logger.error({ aiErr }, 'Gemini text-based question extraction failed');
      }
    }

    // 2. Fallback: If text extraction was empty or failed, and document is a PDF, send buffer directly to Gemini
    if ((!aiRawText || aiRawText.length < 10) && isPdf) {
      try {
        const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const { GoogleGenAI } = await import('@google/genai');
        const genAiClient = new GoogleGenAI({ apiKey });

        const modelName = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
        const multimodalRes = await genAiClient.models.generateContent({
          model: modelName,
          contents: [
            {
              inlineData: {
                data: buffer.toString('base64'),
                mimeType: 'application/pdf',
              },
            },
            promptInstructions,
          ],
          config: {
            responseMimeType: 'application/json',
          },
        });
        aiRawText = multimodalRes.text || '';
      } catch (multiErr: any) {
        logger.error({ multiErr }, 'Gemini multimodal PDF question extraction failed');
      }
    }

    // If still no output from AI
    if (!aiRawText || aiRawText.trim().length === 0) {
      throw AppError.badRequest(
        `Unable to extract readable questions from "${filename}". Please ensure the file contains text questions or use our Excel/CSV template.`
      );
    }

    // 3. Clean and parse JSON
    let parsedJson: any;
    try {
      let cleanText = aiRawText.trim();
      cleanText = cleanText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      parsedJson = JSON.parse(cleanText);
    } catch (parseErr: any) {
      logger.error({ parseErr, aiRawText }, 'Failed to parse JSON from AI response');
      throw AppError.badRequest(
        `AI extracted questions from "${filename}", but the format was invalid. Please try re-uploading or use our Excel template.`
      );
    }

    // 4. Normalize questions
    const questions = this.normalizeAiQuestionsList(parsedJson);

    if (questions.length === 0) {
      throw AppError.badRequest(
        `No valid questions found in "${filename}". Please ensure questions have answer choices (for MCQs) or clear question prompts.`
      );
    }

    return questions;
  }

  /**
   * Generates a downloadable sample Excel workbook buffer.
   */
  public static async generateSampleExcelWorkbook(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Question Bank Template');

    sheet.columns = [
      { header: 'Type (mcq/descriptive)', key: 'type', width: 22 },
      { header: 'Question', key: 'question', width: 45 },
      { header: 'Option A (MCQ)', key: 'opt_a', width: 22 },
      { header: 'Option B (MCQ)', key: 'opt_b', width: 22 },
      { header: 'Option C (MCQ)', key: 'opt_c', width: 22 },
      { header: 'Option D (MCQ)', key: 'opt_d', width: 22 },
      { header: 'Correct Option (MCQ)', key: 'correct', width: 20 },
      { header: 'Sample / Model Answer (Descriptive)', key: 'sample_answer', width: 38 },
      { header: 'Evaluation Rubric (Descriptive)', key: 'rubric', width: 38 },
      { header: 'Points', key: 'points', width: 10 },
      { header: 'Explanation', key: 'explanation', width: 35 },
    ];

    // Format header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }, // Indigo brand color
    };

    // Add sample rows (MCQ)
    sheet.addRow({
      type: 'mcq',
      question: 'A can complete work in 12 days, and B can complete it in 18 days. If they work together for 4 days, what fraction of work remains?',
      opt_a: '1/3',
      opt_b: '4/9',
      opt_c: '5/9',
      opt_d: '2/5',
      correct: 'B',
      sample_answer: '',
      rubric: '',
      points: 10,
      explanation: 'Combined daily rate = 5/36. In 4 days they complete 20/36 = 5/9. Remaining is 1 - 5/9 = 4/9.',
    });

    sheet.addRow({
      type: 'mcq',
      question: 'What is the next number in the series: 4, 9, 19, 39, 79, ...?',
      opt_a: '119',
      opt_b: '139',
      opt_c: '159',
      opt_d: '169',
      correct: 'C',
      sample_answer: '',
      rubric: '',
      points: 10,
      explanation: 'Each term is generated by (previous * 2) + 1. 79 * 2 + 1 = 159.',
    });

    // Add sample rows (Descriptive)
    sheet.addRow({
      type: 'descriptive',
      question: 'A retail firm has fixed overhead costs of $120,000 per month and variable costs of $30 per unit. The product sells for $60 per unit. Calculate the monthly break-even unit volume. Then, show step-by-step how a 15% increase in variable costs changes the required break-even volume.',
      opt_a: '',
      opt_b: '',
      opt_c: '',
      opt_d: '',
      correct: '',
      sample_answer: '1. Initial contribution margin = $60 - $30 = $30. Initial break-even = $120,000 / $30 = 4,000 units. 2. New variable cost = $30 * 1.15 = $34.50. New contribution margin = $60 - $34.50 = $25.50. 3. New break-even = $120,000 / $25.50 = 4,705.88 (~4,706 units). The firm must sell 706 additional units (+17.65%) to reach break-even.',
      rubric: '1. Correct initial break-even calculation (3 pts); 2. Correct revised contribution margin calculation (3 pts); 3. Accurate final break-even volume and percentage impact explanation (4 pts).',
      points: 10,
      explanation: 'Tests multi-step quantitative break-even and financial ratio reasoning.',
    });

    sheet.addRow({
      type: 'descriptive',
      question: 'Five committee members (P, Q, R, S, T) sit in a straight row facing north. S sits at one extreme end. Q is second to the right of P. R sits immediately left of T. P is not adjacent to S. Deduce the unique seating arrangement from left to right, justifying each elimination step.',
      opt_a: '',
      opt_b: '',
      opt_c: '',
      opt_d: '',
      correct: '',
      sample_answer: 'Step 1: S is at an extreme end. Since P cannot be adjacent to S, and Q is 2 places to the right of P, P must have space to its right. Step 2: S at position 5 or 1. If S=1, P cannot be at 2 (adjacent to S), so P=3 => Q=5 (contradiction with S=1/5). Thus S must be at Position 5. Step 3: P at position 1, Q at position 3. Step 4: R immediately left of T leaves positions 3 & 4 or 2 & 4. Positions 2 and 4 are free => R=2, T=4. Final arrangement: P, R, Q, T, S.',
      rubric: '1. Step-by-step constraint elimination (4 pts); 2. Correct placement of S and P (3 pts); 3. Validated final order P, R, Q, T, S (3 pts).',
      points: 10,
      explanation: 'Tests logical deduction and constraint satisfaction reasoning.',
    });

    // Add sample rows (Rapid Fire / Speed Round)
    sheet.addRow({
      type: 'rapid',
      question: 'Quick Math: What is 15% of 240?',
      opt_a: '32',
      opt_b: '36',
      opt_c: '38',
      opt_d: '42',
      correct: 'B',
      sample_answer: '',
      rubric: '',
      points: 10,
      explanation: '10% of 240 is 24, 5% is 12. 24 + 12 = 36.',
    });

    const uint8Array = await workbook.xlsx.writeBuffer();
    return Buffer.from(uint8Array);
  }

  /**
   * Generates a downloadable sample CSV string.
   */
  public static generateSampleCsv(): string {
    return `Type,Question,Option A,Option B,Option C,Option D,Correct Option,Sample Answer,Rubric,Points,Explanation
mcq,"A can complete work in 12 days, and B in 18 days. If they work together for 4 days, what fraction remains?","1/3","4/9","5/9","2/5","B","","",10,"Combined daily rate = 5/36. In 4 days they complete 5/9. Remaining is 4/9."
mcq,"What is the next number in the series: 4, 9, 19, 39, 79, ...?","119","139","159","169","C","","",10,"Each term is previous * 2 + 1. 79 * 2 + 1 = 159."
descriptive,"A retail firm has fixed costs of $120,000/month and variable costs of $30/unit selling at $60/unit. Calculate initial break-even volume, then derive the new break-even if variable costs increase by 15%.","","","","","","Initial contribution margin: $30, break-even: 4,000 units. New variable cost: $34.50, new contribution margin: $25.50, new break-even: 4,706 units. Requires selling 706 additional units (+17.65%).","1. Initial break-even (3 pts); 2. Revised margin (3 pts); 3. Final volume and justification (4 pts)",10,"Tests multi-step quantitative break-even and financial ratio reasoning."
descriptive,"Five members (P, Q, R, S, T) sit in a straight row facing north. S sits at one extreme end. Q is second to the right of P. R sits immediately left of T. P is not next to S. Deduce the unique seating arrangement from left to right with step-by-step justification.","","","","","","Step 1: Test S at end. S must be at Position 5. Step 2: P=1, Q=3. Step 3: R=2, T=4. Validated arrangement: P, R, Q, T, S.","1. Constraint elimination (4 pts); 2. Placement of S and P (3 pts); 3. Validated final order P, R, Q, T, S (3 pts)",10,"Tests logical deduction and constraint satisfaction reasoning."
rapid,"Quick Math: What is 15% of 240?","32","36","38","42","B","","",10,"10% of 240 is 24, 5% is 12. 24 + 12 = 36."
`;
  }
}
