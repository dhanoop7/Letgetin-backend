import ExcelJS from 'exceljs';
import { AppError } from '../../utils/appError.js';
import { InstitutionStudentStatus } from './institutionStudent.model.js';

export interface ParsedStudentRow {
  rowNumber: number;
  name: string;
  email: string;
  course: string;
  year: string;
  skills: string[];
  status: InstitutionStudentStatus;
}

export interface RowFailure {
  row: number;
  reason: string;
}

const REQUIRED_HEADERS = ['name', 'email', 'course'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_STATUSES: InstitutionStudentStatus[] = ['active', 'placed', 'pending'];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

function splitSkills(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildRow(
  rowNumber: number,
  record: Record<string, string>
): { row?: ParsedStudentRow; failure?: RowFailure } {
  const name = (record.name || '').trim();
  const email = (record.email || '').trim().toLowerCase();
  const course = (record.course || '').trim();

  if (!name || !email || !course) {
    return { failure: { row: rowNumber, reason: 'Missing required field (name, email, or course)' } };
  }
  if (!EMAIL_RE.test(email)) {
    return { failure: { row: rowNumber, reason: `Invalid email address: ${email}` } };
  }

  const statusRaw = (record.status || '').trim().toLowerCase();
  const status = (VALID_STATUSES as string[]).includes(statusRaw) ? (statusRaw as InstitutionStudentStatus) : 'active';

  return {
    row: {
      rowNumber,
      name,
      email,
      course,
      year: (record.year || '').trim(),
      skills: splitSkills(record.skills || ''),
      status,
    },
  };
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  };

  const headers = parseLine(lines[0]).map(normalizeHeader);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = cells[idx] ?? '';
    });
    rows.push(record);
  }
  return rows;
}

async function parseXlsx(buffer: Buffer): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = normalizeHeader(String(cell.value ?? ''));
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (!header) return;
      const value = cell.value;
      record[header] = value === null || value === undefined ? '' : String(value).trim();
    });
    if (Object.values(record).some((v) => v.trim().length > 0)) {
      rows.push(record);
    }
  });
  return rows;
}

export async function parseStudentFile(
  buffer: Buffer,
  originalName: string,
  mimetype: string
): Promise<{ rows: ParsedStudentRow[]; failures: RowFailure[] }> {
  const isXlsx =
    mimetype.includes('spreadsheet') || mimetype.includes('excel') || /\.xlsx?$/i.test(originalName);
  const isCsv = !isXlsx && (mimetype.includes('csv') || /\.csv$/i.test(originalName));

  if (!isXlsx && !isCsv) {
    throw AppError.badRequest('Unsupported file type. Please upload a .csv or .xlsx file.');
  }

  let records: Record<string, string>[];
  try {
    records = isXlsx ? await parseXlsx(buffer) : parseCsv(buffer.toString('utf-8'));
  } catch {
    throw AppError.badRequest('Could not read the uploaded file. Please check the file is not corrupted.');
  }

  if (records.length === 0) {
    throw AppError.badRequest('The uploaded file has no data rows.');
  }

  const headers = Object.keys(records[0]);
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    throw AppError.badRequest(
      `Missing required column(s): ${missingHeaders.join(', ')}. Expected headers: name, email, course, year, skills, status.`
    );
  }

  const rows: ParsedStudentRow[] = [];
  const failures: RowFailure[] = [];
  records.forEach((record, idx) => {
    const rowNumber = idx + 2; // account for header row, 1-indexed
    const { row, failure } = buildRow(rowNumber, record);
    if (row) rows.push(row);
    if (failure) failures.push(failure);
  });

  return { rows, failures };
}
