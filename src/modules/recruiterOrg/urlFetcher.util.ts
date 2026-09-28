import dns from 'dns';
import * as cheerio from 'cheerio';
import { AppError } from '../../utils/appError.js';

const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_EXTRACTED_TEXT_CHARS = 4000;

export interface ExtractedPageContent {
  title: string;
  metaDescription: string;
  ogTags: Record<string, string>;
  jsonLd: Record<string, unknown>[];
  bodyText: string;
}

const UNREACHABLE_ERROR = () =>
  AppError.badRequest('Unable to access this website. Please enter the details manually.');

function isPrivateOrReservedIp(ip: string): boolean {
  // IPv4
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [parseInt(v4[1], 10), parseInt(v4[2], 10)];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique local
  if (lower.startsWith('fe80')) return true; // link-local
  return false;
}

async function assertSafeHost(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
    throw UNREACHABLE_ERROR();
  }

  let addresses: string[];
  try {
    const results = await dns.promises.lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw UNREACHABLE_ERROR();
  }

  if (addresses.length === 0 || addresses.some(isPrivateOrReservedIp)) {
    throw UNREACHABLE_ERROR();
  }
}

function assertHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw AppError.badRequest('Please enter a valid website URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw AppError.badRequest('Please enter a valid website URL.');
  }
  return parsed;
}

/**
 * Fetches a user-supplied URL safely: blocks private/loopback/link-local targets (including via
 * redirect hops, re-validated on each hop), enforces a timeout, response-size cap, and HTML-only
 * content type. Never follows redirects blindly.
 */
async function safeFetchHtml(rawUrl: string): Promise<string> {
  let currentUrl = assertHttpUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeHost(currentUrl.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(currentUrl.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        // A browser-like UA avoids basic bot-protection false-positives (e.g. Cloudflare) on
        // legitimate public pages; this is a one-off, user-initiated fetch of a page the
        // recruiter themselves supplied, not scraping/crawling.
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    } catch {
      throw UNREACHABLE_ERROR();
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw UNREACHABLE_ERROR();
      try {
        currentUrl = new URL(location, currentUrl);
      } catch {
        throw UNREACHABLE_ERROR();
      }
      if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
        throw UNREACHABLE_ERROR();
      }
      continue; // re-validate the new host on the next loop iteration
    }

    if (!response.ok) {
      throw UNREACHABLE_ERROR();
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw UNREACHABLE_ERROR();
    }

    const reader = response.body?.getReader();
    if (!reader) throw UNREACHABLE_ERROR();

    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
  }

  throw UNREACHABLE_ERROR();
}

function extractReadableContent(html: string): ExtractedPageContent {
  const $ = cheerio.load(html);

  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';

  const ogTags: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr('property');
    const content = $(el).attr('content');
    if (prop && content) ogTags[prop] = content.trim();
  });

  const jsonLd: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      if (parsed && typeof parsed === 'object') {
        jsonLd.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  });

  $('script, style, nav, footer, header, noscript, svg').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, MAX_EXTRACTED_TEXT_CHARS);

  return { title, metaDescription, ogTags, jsonLd, bodyText };
}

export async function fetchAndExtractPageContent(url: string): Promise<ExtractedPageContent> {
  const html = await safeFetchHtml(url);
  return extractReadableContent(html);
}
