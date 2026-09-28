import mammoth from 'mammoth';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

import {
  CorruptedFileError,
  EmptyTextError,
  UnsupportedFileTypeError,
} from './import.errors';

// Configure pdfjs worker for Node environment
if (pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
}

export type SupportedFileType = 'pdf' | 'docx' | 'txt';

export class TextExtractionService {
  /**
   * Detect file format using magic bytes / binary signatures, falling back to extension hint.
   */
  public detectFileType(buffer: Buffer, fileTypeHint?: string): SupportedFileType {
    if (!buffer || buffer.length === 0) {
      throw new CorruptedFileError('Uploaded file buffer is empty (0 bytes).');
    }

    // PDF magic bytes: %PDF (0x25 0x50 0x44 0x46)
    if (buffer.length >= 4 && buffer.toString('utf-8', 0, 4) === '%PDF') {
      return 'pdf';
    }

    // DOCX / ZIP magic bytes: PK\x03\x04 (0x50 0x4B 0x03 0x04)
    if (
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04
    ) {
      return 'docx';
    }

    if (fileTypeHint) {
      const hint = fileTypeHint.toLowerCase().trim();
      if (hint.includes('pdf') || hint.endsWith('.pdf')) {
        return 'pdf';
      }
      if (
        hint.includes('word') ||
        hint.includes('docx') ||
        hint.endsWith('.docx')
      ) {
        return 'docx';
      }
      if (
        hint.includes('text') ||
        hint.includes('plain') ||
        hint.endsWith('.txt')
      ) {
        return 'txt';
      }
    }

    if (this.isPlainTextBuffer(buffer)) {
      return 'txt';
    }

    throw new UnsupportedFileTypeError(fileTypeHint || 'Unknown binary payload');
  }

  /**
   * Main entry point to extract raw text from a document buffer.
   */
  public async extractTextFromBuffer(
    buffer: Buffer,
    fileTypeHint?: string
  ): Promise<string> {
    if (!buffer || buffer.length === 0) {
      throw new CorruptedFileError('Uploaded file buffer is empty (0 bytes).');
    }

    const detectedType = this.detectFileType(buffer, fileTypeHint);
    let extractedText = '';

    switch (detectedType) {
      case 'pdf':
        extractedText = await this.extractPdfText(buffer);
        break;
      case 'docx':
        extractedText = await this.extractDocxText(buffer);
        break;
      case 'txt':
        extractedText = this.extractPlainText(buffer);
        break;
      default:
        throw new UnsupportedFileTypeError(detectedType);
    }

    const cleanedText = this.cleanExtractedText(extractedText);

    // STEP 6: Never continue if extracted text is empty
    if (!cleanedText || cleanedText.length < 20) {
      throw new EmptyTextError();
    }

    // STEP 5: Formatted extraction preview output
    const preview = cleanedText.slice(0, 500);
    console.log('\n=========== EXTRACTION ===========');
    console.log(`File Type  : ${detectedType}`);
    console.log(`Characters : ${cleanedText.length}`);
    console.log('Preview    :');
    console.log(preview);
    console.log('==================================\n');

    return cleanedText;
  }

  /**
   * STEP 2 & STEP 3: Robust PDF Text Extraction using pdfjs-dist
   * Preserves layout, line breaks, paragraphs, bullet points, spacing, and headings.
   */
  private async extractPdfText(buffer: Buffer): Promise<string> {
    try {
      const data = new Uint8Array(buffer);
      const loadingTask = pdfjsLib.getDocument({
        data,
        useSystemFonts: true,
        disableFontFace: true,
        isEvalSupported: false,
      });

      const pdfDocument = await loadingTask.promise;
      const numPages = pdfDocument.numPages;
      const pageTexts: string[] = [];

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        let lastY: number | null = null;
        const pageLines: string[] = [];
        let currentLine = '';

        for (const item of textContent.items) {
          if (!('str' in item)) continue;

          const y = item.transform ? item.transform[5] : null;

          // Detect new lines based on Y-coordinate difference
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 5) {
            if (currentLine.trim()) {
              pageLines.push(currentLine.trim());
            }
            currentLine = item.str;
          } else {
            // Same horizontal line: preserve spacing between words
            if (currentLine && !currentLine.endsWith(' ') && !item.str.startsWith(' ')) {
              currentLine += ' ';
            }
            currentLine += item.str;
          }
          lastY = y;
        }

        if (currentLine.trim()) {
          pageLines.push(currentLine.trim());
        }

        pageTexts.push(pageLines.join('\n'));
      }

      const fullText = pageTexts.join('\n\n').trim();

      if (!fullText || fullText.length < 20) {
        throw new EmptyTextError();
      }

      return fullText;
    } catch (err: any) {
      if (err instanceof EmptyTextError) {
        throw err;
      }
      if (err?.name === 'PasswordException' || err?.message?.includes('password')) {
        throw new CorruptedFileError('PDF is encrypted or password-protected.');
      }
      if (err?.name === 'InvalidPDFException' || err?.message?.includes('Invalid PDF')) {
        throw new CorruptedFileError('PDF file structure is invalid or corrupted.');
      }
      throw new CorruptedFileError(`PDF extraction failed: ${err?.message || 'Unreadable document'}`);
    }
  }

  /**
   * STEP 4: DOCX extraction using mammoth
   */
  private async extractDocxText(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const text = result?.value ? result.value.trim() : '';

      if (!text || text.length < 20) {
        throw new EmptyTextError();
      }

      return text;
    } catch (err: any) {
      if (err instanceof EmptyTextError) {
        throw err;
      }
      throw new CorruptedFileError(`DOCX extraction failed: ${err?.message || 'Invalid file structure'}`);
    }
  }

  private extractPlainText(buffer: Buffer): string {
    let text = buffer.toString('utf-8');
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 20) {
      throw new EmptyTextError();
    }
    return trimmed;
  }

  private cleanExtractedText(text: string): string {
    if (!text) return '';
    return text
      .replace(/\0/g, '')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  private isPlainTextBuffer(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 512);
    let nonAsciiCount = 0;
    for (let i = 0; i < sampleSize; i++) {
      const byte = buffer[i];
      if (byte === 0) return false;
      if ((byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte > 126) {
        nonAsciiCount++;
      }
    }
    return nonAsciiCount / sampleSize < 0.2;
  }
}
