/** Shared domain types for the reel library and download pipeline. */

export interface ReelData {
  id: string;
  localUri: string;
  originalUrl: string;
  timestamp: number;
  isSaved?: boolean;
  /** Instagram handle, derived from the URL when it carries one. */
  author?: string;
  /** Caption text — only present once the extractor returns metadata. */
  caption?: string;
  /** Hashtags found in the caption, without the leading `#`. */
  hashtags?: string[];
  /** Size of the downloaded file in bytes (filled in lazily for old entries). */
  sizeBytes?: number;
  /** Video length in ms, when known. */
  durationMs?: number;
  mediaType?: 'reel' | 'post';
}

/** What the reels feed already knows about a clip before it is downloaded. */
export interface ReelMetadata {
  author?: string;
  caption?: string;
}

export interface LibraryStats {
  count: number;
  savedCount: number;
  bytes: number;
}

export type DownloadSource = 'auto' | 'manual';

export interface DownloadErrorEvent {
  postId: string;
  message: string;
  code?: string;
}

export interface DownloadJobMeta {
  postId: string;
  originalUrl: string;
  source: DownloadSource;
  metadata?: ReelMetadata;
}

export interface DownloadEventMap {
  log: string;
  progress: { postId: string; percentage: number };
  success: ReelData;
  error: DownloadErrorEvent;
  delete: string;
  toggleSave: { id: string; isSaved: boolean };
  autoDeleteChanged: boolean;
  pauseStatusChanged: boolean;
}
