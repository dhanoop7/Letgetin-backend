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
  static async extractText(fileBuffer: Buffer, mimeType: string): Promise<ExtractedDocumentResult> {
    const isImage = mimeType.startsWith('image/') || mimeType.includes('heic');

    if (isImage) {
      return {
        text: '',
        isImageOrScanned: true,
        mimeType,
      };
    }

    // Handle DOCX files using mammoth
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    ) {
      try {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        return {
          text: result.value ? result.value.trim() : '',
          isImageOrScanned: false,
          mimeType,
        };
      } catch (err) {
        console.warn('DOCX extraction warning:', err);
        return { text: '', isImageOrScanned: true, mimeType };
      }
    }

    // Handle PDF files using pdf-parse
    if (mimeType === 'application/pdf') {
      try {
        const data = await (pdfParse as any)(fileBuffer);
        const text = data.text ? data.text.trim() : '';

        // If text length is very short, it's likely a scanned image PDF
        if (text.length < 30) {
          return {
            text: '',
            isImageOrScanned: true,
            mimeType,
          };
        }

        return {
          text,
          isImageOrScanned: false,
          mimeType,
        };
      } catch (err) {
        console.warn('PDF parsing error, passing to Gemini Vision:', err);
        return { text: '', isImageOrScanned: true, mimeType };
      }
    }

    return {
      text: '',
      isImageOrScanned: true,
      mimeType,
    };
  }
}
