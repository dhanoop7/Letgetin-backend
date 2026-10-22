import * as pdfParseModule from 'pdf-parse';
import mammoth from 'mammoth';

const pdfParse = (pdfParseModule as any).default || pdfParseModule;

export interface ExtractedDocumentResult {
  text: string;
  isImageOrScanned: boolean;
  mimeType: string;
}

export class DocumentParserService {
  /**
   * Extracts searchable text from PDF or DOCX, or marks as image/scanned for Gemini Vision
   */
  static async extractText(
    fileBuffer: Buffer,
    mimeType: string,
    filename?: string
  ): Promise<ExtractedDocumentResult> {
    const ext = filename?.split('.').pop()?.toLowerCase() || '';
    const isImage = mimeType.startsWith('image/') || mimeType.includes('heic');

    if (isImage) {
      return {
        text: '',
        isImageOrScanned: true,
        mimeType,
      };
    }

    const isDocx =
      ext === 'docx' ||
      ext === 'doc' ||
      mimeType.includes('word') ||
      mimeType.includes('officedocument') ||
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    // Handle DOCX files using mammoth
    if (isDocx) {
      try {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        const text = result.value ? result.value.trim() : '';
        return {
          text,
          isImageOrScanned: text.length < 20,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
      } catch (err) {
        console.warn('DOCX extraction warning, attempting fallback:', err);
      }
    }

    const isPdf =
      ext === 'pdf' ||
      mimeType === 'application/pdf' ||
      fileBuffer.slice(0, 5).toString('utf-8').includes('%PDF');

    // Handle PDF files using pdf-parse with pdfjs-dist fallback
    if (isPdf) {
      // 1. First attempt with pdf-parse
      try {
        const data = await (pdfParse as any)(fileBuffer);
        const text = data.text ? data.text.trim() : '';
        if (text.length >= 30) {
          return {
            text,
            isImageOrScanned: false,
            mimeType: 'application/pdf',
          };
        }
      } catch (err) {
        console.warn('pdf-parse failed, falling back to pdfjs-dist:', err);
      }

      // 2. Fallback attempt with TextExtractionService (pdfjs-dist)
      try {
        const { TextExtractionService } = await import('../modules/import/text-extraction.service.js');
        const extractor = new TextExtractionService();
        const text = await extractor.extractTextFromBuffer(fileBuffer, 'pdf');
        if (text && text.trim().length >= 20) {
          return {
            text: text.trim(),
            isImageOrScanned: false,
            mimeType: 'application/pdf',
          };
        }
      } catch (err) {
        console.warn('pdfjs-dist extraction fallback warning:', err);
      }

      return {
        text: '',
        isImageOrScanned: true,
        mimeType: 'application/pdf',
      };
    }

    return {
      text: '',
      isImageOrScanned: true,
      mimeType,
    };
  }
}
