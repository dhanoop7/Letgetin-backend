/**
 * Experience Calculator Utility
 * 
 * Accurately calculates total candidate work experience from structured employment entries.
 * Features:
 * - Parses diverse date formats (YYYY, YYYY-MM, Month YYYY, MM/YYYY, ISO, etc.)
 * - Recognizes current/active positions (isCurrent flag, "Present", "Current", "Now")
 * - Merges overlapping employment intervals into a continuous timeline to prevent double-counting
 * - Accurately computes duration in months first, then converts to years
 * - Safe handling of missing/invalid dates (never invents experience)
 * - Guarantees 0 experience for fresher candidates
 */

export interface RawExperienceEntry {
  startDate?: string | Date | null;
  start?: string | Date | null;
  endDate?: string | Date | null;
  end?: string | Date | null;
  isCurrent?: boolean;
}

export interface DateInterval {
  start: Date;
  end: Date;
}

export interface ExperienceCalculationResult {
  totalMonths: number;
  totalYears: number; // e.g. 3.5, rounded to 1 decimal place
  yearsRounded: number; // integer years e.g. 3 or 4
  intervals: DateInterval[];
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function getLastDayOfMonth(year: number, monthZeroIndexed: number): number {
  return new Date(Date.UTC(year, monthZeroIndexed + 1, 0)).getUTCDate();
}

/**
 * Parses diverse date input strings into a normalized UTC Date object.
 */
export function parseExperienceDate(value: unknown, isEnd: boolean = false): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // Check if representing present/ongoing
  if (/^(present|current|now|ongoing|till\s*date|active)$/i.test(trimmed)) {
    return new Date();
  }

  // 1. ISO year-month-day: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    if (month >= 0 && month <= 11) {
      const day = isoMatch[3] ? parseInt(isoMatch[3], 10) : (isEnd ? getLastDayOfMonth(year, month) : 1);
      return new Date(Date.UTC(year, month, Math.min(day, getLastDayOfMonth(year, month))));
    }
  }

  // 2. Month/Year: MM/YYYY or MM-YYYY
  const mYMatch = trimmed.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (mYMatch) {
    const month = parseInt(mYMatch[1], 10) - 1;
    const year = parseInt(mYMatch[2], 10);
    if (month >= 0 && month <= 11) {
      const day = isEnd ? getLastDayOfMonth(year, month) : 1;
      return new Date(Date.UTC(year, month, day));
    }
  }

  // 3. Month Name + Year: "Jan 2022", "January, 2022", "Sept 2023"
  const monthNameMatch = trimmed.match(/^([a-zA-Z]+)[,\s]+(\d{4})$/);
  if (monthNameMatch) {
    const monthKey = monthNameMatch[1].toLowerCase();
    const month = MONTH_MAP[monthKey];
    const year = parseInt(monthNameMatch[2], 10);
    if (month !== undefined && !isNaN(year)) {
      const day = isEnd ? getLastDayOfMonth(year, month) : 1;
      return new Date(Date.UTC(year, month, day));
    }
  }

  // 4. Year + Month Name: "2022 Jan"
  const yearMonthMatch = trimmed.match(/^(\d{4})[,\s]+([a-zA-Z]+)$/);
  if (yearMonthMatch) {
    const year = parseInt(yearMonthMatch[1], 10);
    const monthKey = yearMonthMatch[2].toLowerCase();
    const month = MONTH_MAP[monthKey];
    if (month !== undefined && !isNaN(year)) {
      const day = isEnd ? getLastDayOfMonth(year, month) : 1;
      return new Date(Date.UTC(year, month, day));
    }
  }

  // 5. Year only: "2022"
  const yearOnlyMatch = trimmed.match(/^(\d{4})$/);
  if (yearOnlyMatch) {
    const year = parseInt(yearOnlyMatch[1], 10);
    if (year >= 1950 && year <= 2100) {
      return isEnd ? new Date(Date.UTC(year, 11, 31)) : new Date(Date.UTC(year, 0, 1));
    }
  }

  // 6. Generic Date.parse fallback
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return new Date(parsed);
  }

  return null;
}

/**
 * Calculates continuous non-overlapping intervals from raw experience entries.
 */
export function mergeOverlappingIntervals(entries: RawExperienceEntry[]): DateInterval[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const rawIntervals: DateInterval[] = [];
  const now = new Date();

  for (const entry of entries) {
    const startVal = entry.startDate || entry.start;
    const endVal = entry.endDate || entry.end;
    const isCurrent = entry.isCurrent === true || (typeof endVal === 'string' && /^(present|current|now|ongoing|till\s*date|active)$/i.test(endVal));

    const startDate = parseExperienceDate(startVal, false);
    if (!startDate) {
      // Missing start date cannot form a reliable experience interval
      continue;
    }

    let endDate: Date | null = null;
    if (isCurrent || !endVal) {
      endDate = now;
    } else {
      endDate = parseExperienceDate(endVal, true);
    }

    if (!endDate) {
      // If end date could not be parsed but position might be current or open-ended, fallback safely
      endDate = now;
    }

    // Safeguard: start must be <= end
    if (startDate.getTime() <= endDate.getTime()) {
      rawIntervals.push({ start: startDate, end: endDate });
    }
  }

  if (rawIntervals.length === 0) {
    return [];
  }

  // Sort intervals by start date ascending
  rawIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Merge overlapping and contiguous intervals
  const merged: DateInterval[] = [rawIntervals[0]];

  for (let i = 1; i < rawIntervals.length; i++) {
    const current = rawIntervals[i];
    const prev = merged[merged.length - 1];

    // If current starts before or within the same month as previous ends, merge
    if (current.start.getTime() <= prev.end.getTime()) {
      if (current.end.getTime() > prev.end.getTime()) {
        prev.end = current.end;
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Computes exact duration in months between two dates inclusive.
 */
export function calculateMonthsBetween(start: Date, end: Date): number {
  if (start.getTime() > end.getTime()) {
    return 0;
  }

  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();

  const diffMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
  return Math.max(1, diffMonths);
}

export class ExperienceCalculator {
  /**
   * Main calculation method.
   * If isFresher is true, returns 0 experience immediately.
   */
  public static calculateTotalExperience(
    entries: RawExperienceEntry[] = [],
    isFresher: boolean = false
  ): ExperienceCalculationResult {
    if (isFresher) {
      return {
        totalMonths: 0,
        totalYears: 0,
        yearsRounded: 0,
        intervals: [],
      };
    }

    const intervals = mergeOverlappingIntervals(entries);
    if (intervals.length === 0) {
      return {
        totalMonths: 0,
        totalYears: 0,
        yearsRounded: 0,
        intervals: [],
      };
    }

    let totalMonths = 0;
    for (const interval of intervals) {
      totalMonths += calculateMonthsBetween(interval.start, interval.end);
    }

    const totalYears = Math.round((totalMonths / 12) * 10) / 10;
    const yearsRounded = Math.round(totalMonths / 12);

    return {
      totalMonths,
      totalYears,
      yearsRounded,
      intervals,
    };
  }
}
