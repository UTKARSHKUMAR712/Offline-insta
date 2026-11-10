import { ConfigManager } from './ConfigManager';

// ─── Instagram URL helpers ──────────────────────────────────────────────────
// Matches a post shortcode in any of the forms Instagram hands out:
//   /reel/<id>/            /reels/<id>/          /p/<id>/
//   /<username>/reel/<id>/ /share/reel/<id>/     with or without trailing slash
// Deliberately does NOT match /reels/ (feed), /reels/audio/<n>, /explore/…, /stories/…
// Real shortcodes are 8–15 base64-ish characters; anything shorter is a path word.
const SHORTCODE_PATTERN = /(?:^|\/)(?:[A-Za-z0-9._]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{8,15})(?:[/?#]|$)/i;

export interface InstagramTarget {
  shortcode: string;
  /** Canonical form the extractor is happiest with. */
  canonicalUrl: string;
  /** True for /p/ posts, which may be a photo or a carousel. */
  isPost: boolean;
}

export function parseInstagramUrl(url: string): InstagramTarget | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) return null;

  // /reels/audio/<track-id> is a music page, not a reel.
  if (/\/reels\/audio\//i.test(parsed.pathname)) return null;

  const match = parsed.pathname.match(SHORTCODE_PATTERN);
  if (!match) return null;

  const shortcode = match[1];
  const isPost = /\/p\//i.test(parsed.pathname);
  // Always ask the API for the canonical /reel/ form: profile-prefixed and
  // /share/ links are inconsistent across extraction strategies.
  return {
    shortcode,
    canonicalUrl: `https://www.instagram.com/reel/${shortcode}/`,
    isPost,
  };
}

/**
 * Instagram username embedded in a post URL (``/<user>/reel/<id>/``), when present.
 * Profile-prefixed links carry it; bare ``/reel/<id>/`` links do not.
 */
export function authorFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url.trim());
    const match = pathname.match(/^\/([A-Za-z0-9._]+)\/(?:reel|reels|p|tv)\//i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Kept for call sites that only need the id. */
export function extractShortcode(url: string): string | null {
  return parseInstagramUrl(url)?.shortcode ?? null;
}

export function isInstagramUrl(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

/** The extractor only ever returns absolute HTTPS media URLs. */
export function isAllowedVideoUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:';
  } catch {
    return false;
  }
}

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|heic|gif|avif)$/i;

/**
 * Instagram serves photo posts (and its bot fallback) as a `cdninstagram.com`
 * `.jpg`. The extractor hands those back in `videoUrl`, so without this check a
 * still image gets saved as `reel_<id>.mp4` — a file with no video track and no
 * audio at all.
 */
export function isImageMediaUrl(url: string): boolean {
  try {
    return IMAGE_EXTENSION.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// ─── Errors ─────────────────────────────────────────────────────────────────
export type ApiErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_URL'
  | 'EXTRACTION_FAILED'
  | 'NOT_VIDEO'
  | 'NOT_FOUND'
  | 'PRIVATE'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'SERVER'
  | 'BAD_RESPONSE';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(code: ApiErrorCode, message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

/** A user-facing sentence for an extraction failure. */
export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';

  switch (error.code) {
    case 'INVALID_URL':
      return 'That link is not a valid Instagram post URL.';
    case 'UNSUPPORTED_URL':
      return 'Only instagram.com reels and posts are supported.';
    case 'NOT_FOUND':
    case 'PRIVATE':
      return 'That reel is private, deleted, or unavailable.';
    case 'EXTRACTION_FAILED':
      return 'Instagram did not return a video for this link. It may be a photo post, private, or region-locked.';
    case 'NOT_VIDEO':
      return 'That post is a photo, so there is no video to save.';
    case 'RATE_LIMITED':
      return 'Too many requests right now. Try again in a few seconds.';
    case 'TIMEOUT':
      return 'The server took too long to respond. Check your connection and try again.';
    case 'NETWORK':
      return 'No internet connection. Check your network and try again.';
    case 'BAD_RESPONSE':
      return 'The extractor sent back an unexpected response.';
    default:
      return 'The extractor is unavailable right now. Try again shortly.';
  }
}

// ─── Request plumbing ───────────────────────────────────────────────────────
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 500;

export interface ExtractResult {
  videoUrl: string;
  /** Raw `meta` block from the extractor, when present. */
  meta?: { success?: boolean; type?: string; source?: string; cached?: boolean };
}

interface ExtractorErrorBody {
  success?: boolean;
  error?: { code?: string; message?: string };
}

interface ExtractorSuccessBody {
  data?: { videoUrl?: string };
  meta?: ExtractResult['meta'];
}

type ExtractorBody = ExtractorSuccessBody & ExtractorErrorBody;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function mapServerErrorCode(code: string | undefined): ApiErrorCode | null {
  switch (code) {
    case 'INVALID_URL':
    case 'UNSUPPORTED_URL':
    case 'NOT_FOUND':
    case 'PRIVATE':
    case 'RATE_LIMITED':
    case 'EXTRACTION_FAILED':
      return code;
    default:
      return null;
  }
}

async function requestOnce(postUrl: string): Promise<ExtractResult> {
  const apiUrl = await ConfigManager.getApiUrl();
  // The extractor accepts both ?postUrl= and ?url=; we standardise on postUrl
  // and always encode, otherwise links containing `&utm_source=…` get truncated.
  const requestUrl = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}postUrl=${encodeURIComponent(postUrl)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
  } catch (cause: any) {
    if (cause?.name === 'AbortError') {
      throw new ApiError('TIMEOUT', `Timed out after ${REQUEST_TIMEOUT_MS}ms`, { retryable: true });
    }
    throw new ApiError('NETWORK', cause?.message || 'Network request failed', { retryable: true });
  } finally {
    clearTimeout(timeoutId);
  }

  let body: ExtractorBody | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const serverCode = mapServerErrorCode(body?.error?.code);
    if (response.status === 429) {
      throw new ApiError('RATE_LIMITED', body?.error?.message || 'Rate limited', { status: 429, retryable: true });
    }
    if (response.status >= 500) {
      // The extractor returns 500 for "no strategy matched", which is really a
      // content problem (private/deleted/photo), so retrying it only wastes
      // requests. Unknown 5xx responses are treated as transient.
      const code = serverCode ?? 'SERVER';
      throw new ApiError(code, body?.error?.message || `HTTP ${response.status}`, {
        status: response.status,
        retryable: code === 'SERVER',
      });
    }
    if (response.status === 404) {
      throw new ApiError('NOT_FOUND', body?.error?.message || 'Not found', { status: 404 });
    }
    throw new ApiError(serverCode ?? 'INVALID_URL', body?.error?.message || `HTTP ${response.status}`, {
      status: response.status,
    });
  }

  const videoUrl = body?.data?.videoUrl;
  if (!videoUrl || typeof videoUrl !== 'string') {
    throw new ApiError('BAD_RESPONSE', 'Response did not include data.videoUrl', { retryable: true });
  }
  if (!isAllowedVideoUrl(videoUrl)) {
    throw new ApiError('BAD_RESPONSE', 'Extractor returned a non-Instagram CDN URL');
  }
  // An image is not a video: saving it would give a silent, unplayable file.
  // Not retryable — the post is a photo, so asking again changes nothing.
  if (body?.meta?.type === 'image' || body?.meta?.source === 'googlebot-fallback-image' || isImageMediaUrl(videoUrl)) {
    throw new ApiError('NOT_VIDEO', 'Extractor returned an image instead of a video');
  }

  return { videoUrl, meta: body?.meta };
}

/** Extracts a direct CDN video URL for an Instagram reel/post URL. */
export async function extractVideoUrl(postUrl: string): Promise<ExtractResult> {
  const target = parseInstagramUrl(postUrl);
  if (!target) {
    throw new ApiError('INVALID_URL', 'Not a recognised Instagram reel or post URL');
  }

  let lastError: ApiError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await requestOnce(target.canonicalUrl);
    } catch (error: any) {
      const apiError = error instanceof ApiError ? error : new ApiError('NETWORK', String(error?.message ?? error));
      lastError = apiError;
      if (!apiError.retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(BACKOFF_MS * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new ApiError('SERVER', 'Extraction failed');
}
