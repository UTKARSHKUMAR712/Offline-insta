import { documentDirectory, createDownloadResumable, deleteAsync, getInfoAsync } from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, authorFromUrl, describeApiError, extractVideoUrl, parseInstagramUrl } from './api';

// ─── Simple Event Emitter ────────────────────────────────────────────────────
type Listener<T = any> = (data: T) => void;

class SimpleEventEmitter {
  private listeners: { [key: string]: Listener[] } = {};
  on<T = any>(event: string, listener: Listener<T>) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener as Listener);
  }
  off<T = any>(event: string, listener: Listener<T>) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l !== listener);
  }
  emit<T = any>(event: string, data?: T) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(listener => listener(data));
  }
}

// ─── Types & Constants ───────────────────────────────────────────────────────
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
  /** Size of the downloaded file in bytes (filled in lazily for old entries). */
  sizeBytes?: number;
  /** Video length in ms, when known. */
  durationMs?: number;
  mediaType?: 'reel' | 'post';
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

const STORAGE_KEY = '@downloaded_reels';
export const SETTINGS_AUTO_DELETE_KEY = '@settings_auto_delete_reels';
/** Pauses the automatic queue only — manual downloads are never blocked. */
export const SETTINGS_PAUSE_DOWNLOADS_KEY = '@settings_pause_downloads';

export const DownloadEvents = new SimpleEventEmitter();

interface QueueJob {
  postId: string;
  originalUrl: string;
  source: DownloadSource;
  resolve: (reel: ReelData | null) => void;
  reject: (error: unknown) => void;
}

// ─── Download Service ────────────────────────────────────────────────────────
export class DownloadService {
  // Serial queue — all downloads go here, processed strictly one-at-a-time
  private static queue: QueueJob[] = [];
  private static pending = new Map<string, Promise<ReelData | null>>();
  private static isProcessing = false;
  private static reelsCache: ReelData[] | null = null;

  // ── Logging ──
  private static log(msg: string) {
    if (__DEV__) {
      console.log(msg);
    }
    DownloadEvents.emit('log', msg);
  }

  /**
   * Queue a reel for download.
   *
   * Resolves with the stored reel once the file is on disk, `null` when the
   * request was skipped (already downloaded, or automatic downloads paused).
   * Rejects with an `ApiError` when extraction/download fails, so callers can
   * show a real message instead of guessing.
   */
  static async downloadReel(postUrl: string, options: { source?: DownloadSource } = {}): Promise<ReelData | null> {
    const source = options.source ?? 'auto';
    const target = parseInstagramUrl(postUrl);

    if (!target) {
      this.log(`Cannot extract ID from: ${postUrl}`);
      throw new ApiError('INVALID_URL', 'Not a recognised Instagram reel or post URL');
    }

    const postId = target.shortcode;

    // Pause only affects the automatic queue.
    if (source === 'auto' && (await this.getDownloadsPaused())) {
      this.log(`Download paused: ${postId} (Skipped)`);
      return null;
    }

    const inFlight = this.pending.get(postId);
    if (inFlight) return inFlight;

    if (await this.isReelDownloaded(postId)) {
      this.log(`Already saved: ${postId}`);
      const existing = (await this.getDownloadedReels()).find(r => r.id === postId) ?? null;
      return existing;
    }

    const promise = new Promise<ReelData | null>((resolve, reject) => {
      this.queue.push({ postId, originalUrl: postUrl, source, resolve, reject });
      this.log(`Queued ${postId} (${this.queue.length} in queue)`);
      this.runQueue();
    });

    this.pending.set(postId, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(postId);
    }
  }

  // ── Queue runner ──
  private static async runQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        // If automatic downloads were paused mid-queue, drop the automatic
        // jobs but let anything the user explicitly asked for finish.
        if (await this.getDownloadsPaused()) {
          const manualJobs = this.queue.filter(job => job.source === 'manual');
          this.queue
            .filter(job => job.source === 'auto')
            .forEach(job => {
              this.log(`Download paused: ${job.postId} (Skipped)`);
              job.resolve(null);
            });
          this.queue = manualJobs;
          if (this.queue.length === 0) break;
        }

        const job = this.queue.shift()!;
        try {
          const reel = await this.processOne(job);
          job.resolve(reel);
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // ── Actual download logic for a single reel ──
  private static async processOne(job: QueueJob): Promise<ReelData> {
    const { postId, originalUrl } = job;
    const docDir = documentDirectory;
    if (!docDir) throw new ApiError('SERVER', 'No writable document directory available');

    const localUri = `${docDir}reel_${postId}.mp4`;

    try {
      this.log(`⬇ Starting: ${postId}`);
      const { videoUrl } = await extractVideoUrl(originalUrl);

      let lastPercentage = -1;
      const resumable = createDownloadResumable(
        videoUrl,
        localUri,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (!totalBytesExpectedToWrite || totalBytesExpectedToWrite <= 0) return;
          const percentage = Math.min(100, Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100));
          // Only notify on change — the native callback fires far more often
          // than the UI needs to re-render.
          if (percentage === lastPercentage) return;
          lastPercentage = percentage;
          DownloadEvents.emit('progress', { postId, percentage });
        }
      );

      const result = await resumable.downloadAsync();
      if (!result) throw new ApiError('SERVER', 'Download produced no result');
      if (result.status !== 200) {
        throw new ApiError('SERVER', `Download failed (HTTP ${result.status})`, {
          status: result.status,
          retryable: result.status >= 500,
        });
      }

      const info = await getInfoAsync(result.uri).catch(() => null);
      const sizeBytes = info && info.exists && 'size' in info ? info.size : undefined;

      const reel: ReelData = {
        id: postId,
        localUri: result.uri,
        originalUrl,
        timestamp: Date.now(),
        author: authorFromUrl(originalUrl) ?? undefined,
        sizeBytes,
        mediaType: parseInstagramUrl(originalUrl)?.isPost ? 'post' : 'reel',
      };
      const existing = await this.getDownloadedReels();
      const updatedList = [reel, ...existing.filter(r => r.id !== postId)];
      this.reelsCache = updatedList;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedList));

      this.log(`✅ Done: ${postId}`);
      DownloadEvents.emit('progress', { postId, percentage: 100 });
      DownloadEvents.emit('success', reel);
      return reel;
    } catch (error: any) {
      // Never leave a half-written file behind that nothing can clean up.
      await this.removeFileQuietly(localUri);

      const message = describeApiError(error);
      this.log(`❌ ${postId}: ${message}`);
      DownloadEvents.emit<DownloadErrorEvent>('error', {
        postId,
        message,
        code: error instanceof ApiError ? error.code : undefined,
      });

      throw error instanceof ApiError ? error : new ApiError('SERVER', error?.message ?? String(error));
    }
  }

  private static async removeFileQuietly(uri: string) {
    try {
      const info = await getInfoAsync(uri);
      if (info.exists) await deleteAsync(uri, { idempotent: true });
    } catch {
      // best effort
    }
  }

  // ── Storage helpers ──
  static async getDownloadedReels(): Promise<ReelData[]> {
    if (this.reelsCache !== null) return this.reelsCache;

    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (!stored) {
        this.reelsCache = [];
        return [];
      }
      const parsed = JSON.parse(stored) as ReelData[];
      // Dedup: if two items share an ID, keep the one with isSaved=true
      const map = new Map<string, ReelData>();
      parsed.forEach(item => {
        const existing = map.get(item.id);
        if (!existing || (item.isSaved && !existing.isSaved)) map.set(item.id, item);
      });
      const { reels, changed } = await this.migrateEntries(Array.from(map.values()));
      this.reelsCache = reels;
      if (changed) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reels));
      return this.reelsCache;
    } catch {
      return [];
    }
  }

  /**
   * Fill in metadata that older entries never stored: the author from the URL
   * and the real file size from disk. Runs once per entry, then persists.
   */
  private static async migrateEntries(entries: ReelData[]) {
    let changed = false;

    const reels = await Promise.all(
      entries.map(async reel => {
        let next = reel;

        if (!next.author) {
          const author = authorFromUrl(next.originalUrl);
          if (author) {
            next = { ...next, author };
            changed = true;
          }
        }

        if (next.sizeBytes === undefined) {
          try {
            const info = await getInfoAsync(next.localUri);
            if (info.exists && 'size' in info && typeof info.size === 'number') {
              next = { ...next, sizeBytes: info.size };
              changed = true;
            }
          } catch {
            // File missing or unreadable — leave the size unknown.
          }
        }

        return next;
      })
    );

    return { reels, changed };
  }

  /** Library totals for the home/settings summaries. */
  static async getLibraryStats(): Promise<LibraryStats> {
    const reels = await this.getDownloadedReels();
    return {
      count: reels.length,
      savedCount: reels.filter(reel => reel.isSaved).length,
      bytes: reels.reduce((sum, reel) => sum + (reel.sizeBytes ?? 0), 0),
    };
  }

  static async isReelDownloaded(postId: string): Promise<boolean> {
    const reels = await this.getDownloadedReels();
    return reels.some(r => r.id === postId);
  }

  /** True while a reel for this id is queued or downloading. */
  static isReelPending(postId: string): boolean {
    return this.pending.has(postId);
  }

  // ── Delete reel (hard delete — blocks isSaved reels) ──
  static async deleteReel(postId: string): Promise<boolean> {
    try {
      this.log(`Deleting: ${postId}`);
      let reels = await this.getDownloadedReels();
      const reel = reels.find(r => r.id === postId);
      if (!reel) {
        this.log(`Not found: ${postId}`);
        return false;
      }
      // Safety: never auto-delete a saved reel
      if (reel.isSaved) {
        this.log(`BLOCKED — reel ${postId} is saved`);
        return false;
      }

      await this.removeFileQuietly(reel.localUri);

      reels = reels.filter(r => r.id !== postId);
      this.reelsCache = reels;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reels));

      this.log(`Deleted: ${postId}`);
      DownloadEvents.emit('delete', postId);
      return true;
    } catch (e: any) {
      this.log(`Delete error: ${e.message}`);
      return false;
    }
  }

  // ── Toggle isSaved ──
  static async toggleSaveReel(postId: string): Promise<ReelData | null> {
    try {
      let reels = await this.getDownloadedReels();
      let updated: ReelData | null = null;
      reels = reels.map(r => {
        if (r.id === postId) {
          updated = { ...r, isSaved: !r.isSaved };
          return updated;
        }
        return r;
      });
      this.reelsCache = reels;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reels));
      if (updated) {
        const savedReel = updated as ReelData;
        DownloadEvents.emit('toggleSave', { id: postId, isSaved: savedReel.isSaved });
      }
      return updated;
    } catch {
      return null;
    }
  }

  // ── Auto-delete setting ──
  static async getAutoDeleteEnabled(): Promise<boolean> {
    try {
      const val = await AsyncStorage.getItem(SETTINGS_AUTO_DELETE_KEY);
      return val === 'true';
    } catch {
      return false;
    }
  }

  static async setAutoDeleteEnabled(enabled: boolean) {
    try {
      await AsyncStorage.setItem(SETTINGS_AUTO_DELETE_KEY, enabled ? 'true' : 'false');
      DownloadEvents.emit('autoDeleteChanged', enabled);
    } catch (e) {
      console.error(e);
    }
  }

  // ── Pause Downloads setting (automatic queue only) ──
  static async getDownloadsPaused(): Promise<boolean> {
    try {
      const val = await AsyncStorage.getItem(SETTINGS_PAUSE_DOWNLOADS_KEY);
      return val === 'true';
    } catch {
      return false;
    }
  }

  static async setDownloadsPaused(paused: boolean) {
    try {
      await AsyncStorage.setItem(SETTINGS_PAUSE_DOWNLOADS_KEY, paused ? 'true' : 'false');
      DownloadEvents.emit('pauseStatusChanged', paused);
      // Cancelling while the queue is idle still needs to clear any automatic
      // jobs that are waiting.
      if (paused) this.runQueue();
    } catch (e) {
      console.error(e);
    }
  }
}
