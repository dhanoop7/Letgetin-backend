export class ResumeImportError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnsupportedFileTypeError extends ResumeImportError {
  constructor(fileType: string) {
    super(`Unsupported file type or MIME format: "${fileType}". Supported formats are PDF, DOCX, and TXT.`, 400);
  }
}

export class CorruptedFileError extends ResumeImportError {
  constructor(details: string) {
    super(`File processing failed. The document appears to be corrupted or unreadable: ${details}`, 400);
  }
}

export class EmptyTextError extends ResumeImportError {
  constructor(customMessage?: string) {
    super(customMessage || 'Unable to extract readable text from uploaded resume.', 422);
  }
}

export class AIParseError extends ResumeImportError {
  constructor(details: string) {
    super(`AI Resume Parsing failed: ${details}`, 502);
  }
}

export class AITimeoutError extends ResumeImportError {
  constructor(timeoutMs: number) {
    super(`AI Resume Parsing timed out after ${timeoutMs / 1000} seconds. Please try again.`, 504);
  }
}

export class InvalidAIJSONError extends ResumeImportError {
  constructor(details: string) {
    super(`AI returned invalid or unparseable JSON structure: ${details}`, 502);
  }
}

export class ValidationError extends ResumeImportError {
  public readonly validationErrors?: unknown;

  constructor(message: string, validationErrors?: unknown) {
    super(`Resume validation failed: ${message}`, 422);
    this.validationErrors = validationErrors;
  }
}
