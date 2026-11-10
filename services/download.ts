import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createDownloadResumable,
  deleteAsync,
  documentDirectory,
  getInfoAsync,
} from 'expo-file-system/legacy';

import { ApiError, authorFromUrl, describeApiError, extractVideoUrl, parseInstagramUrl } from './api';
import { Catalog } from './catalog';
import { DownloadEvents } from './events';
import { SerialQueue } from './queue';
import type {
  DownloadErrorEvent,
  DownloadJobMeta,
  DownloadSource,
  LibraryStats,
  ReelData,
} from './types';

export { DownloadEvents } from './events';
export type {
  DownloadErrorEvent,
  DownloadSource,
  LibraryStats,
  ReelData,
} from './types';

export const SETTINGS_AUTO_DELETE_KEY = '@settings_auto_delete_reels';
/** Pauses the automatic queue only — manual downloads are never blocked. */
export const SETTINGS_PAUSE_DOWNLOADS_KEY = '@settings_pause_downloads';

/**
 * Orchestrates the pipeline: URL → extractor → file download → catalog.
 * Storage lives in `catalog`, ordering in `queue`, notifications in `events`.
 */
export class DownloadService {
  private static queue = new SerialQueue<DownloadJobMeta, ReelData | null>();
  private static pending = new Map<string, Promise<ReelData | null>>();

  private static log(message: string) {
    if (__DEV__) {
      console.log(message);
    }
    DownloadEvents.emit('log', message);
  }

  /**
   * Queue a reel for download.
   *
   * Resolves with the stored reel once the file is on disk, `null` when the
   * request was skipped (already downloaded, or automatic downloads paused).
   * Rejects with an `ApiError` when extraction/download fails, so callers can
   * show a real message instead of guessing.
   */
  static async downloadReel(
    postUrl: string,
    options: { source?: DownloadSource } = {}
  ): Promise<ReelData | null> {
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

    if (await Catalog.has(postId)) {
      this.log(`Already saved: ${postId}`);
      return Catalog.find(postId);
    }

    const promise = this.queue.enqueue(
      { postId, originalUrl: postUrl, source },
      () => this.processOne({ postId, originalUrl: postUrl, source })
    );

    this.log(`Queued ${postId}`);
    this.pending.set(postId, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(postId);
    }
  }

  /** True while a reel for this id is queued or downloading. */
  static isReelPending(postId: string): boolean {
    return this.pending.has(postId);
  }

  private static async processOne(job: DownloadJobMeta): Promise<ReelData> {
    const { postId, originalUrl } = job;
    const docDir = documentDirectory;
    if (!docDir) throw new ApiError('SERVER', 'No writable document directory available');

    const localUri = `${docDir}reel_${postId}.mp4`;

    try {
      this.log(`⬇ Starting: ${postId}`);
      const { videoUrl } = await extractVideoUrl(originalUrl);

      let lastPercentage = -1;
      const resumable = createDownloadResumable(videoUrl, localUri, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        if (!totalBytesExpectedToWrite || totalBytesExpectedToWrite <= 0) return;
        const percentage = Math.min(
          100,
          Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100)
        );
        // Only notify on change — the native callback fires far more often
        // than the UI needs to re-render.
        if (percentage === lastPercentage) return;
        lastPercentage = percentage;
        DownloadEvents.emit('progress', { postId, percentage });
      });

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

      await Catalog.upsert(reel);

      this.log(`✅ Done: ${postId}`);
      DownloadEvents.emit('progress', { postId, percentage: 100 });
      DownloadEvents.emit('success', reel);
      return reel;
    } catch (error: unknown) {
      // Never leave a half-written file behind that nothing can clean up.
      await this.removeFileQuietly(localUri);

      const message = describeApiError(error);
      this.log(`❌ ${postId}: ${message}`);
      DownloadEvents.emit('error', {
        postId,
        message,
        code: error instanceof ApiError ? error.code : undefined,
      } satisfies DownloadErrorEvent);

      throw error instanceof ApiError
        ? error
        : new ApiError('SERVER', error instanceof Error ? error.message : String(error));
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

  // ── Catalog passthroughs (kept so screens keep one entry point) ──
  static getDownloadedReels(): Promise<ReelData[]> {
    return Catalog.all();
  }

  static async isReelDownloaded(postId: string): Promise<boolean> {
    return Catalog.has(postId);
  }

  static getLibraryStats(): Promise<LibraryStats> {
    return Catalog.stats();
  }

  static async deleteReel(postId: string): Promise<boolean> {
    try {
      this.log(`Deleting: ${postId}`);
      const reel = await Catalog.find(postId);

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
      await Catalog.remove(postId);

      this.log(`Deleted: ${postId}`);
      DownloadEvents.emit('delete', postId);
      return true;
    } catch (error: unknown) {
      this.log(`Delete error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  static async toggleSaveReel(postId: string): Promise<ReelData | null> {
    const current = await Catalog.find(postId);
    if (!current) return null;

    const updated = await Catalog.setSaved(postId, !current.isSaved);
    if (updated) {
      DownloadEvents.emit('toggleSave', { id: postId, isSaved: updated.isSaved === true });
    }
    return updated;
  }

  // ── Auto-delete setting ──
  static async getAutoDeleteEnabled(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(SETTINGS_AUTO_DELETE_KEY)) === 'true';
    } catch {
      return false;
    }
  }

  static async setAutoDeleteEnabled(enabled: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(SETTINGS_AUTO_DELETE_KEY, enabled ? 'true' : 'false');
      DownloadEvents.emit('autoDeleteChanged', enabled);
    } catch (error) {
      console.error(error);
    }
  }

  // ── Pause setting (automatic queue only) ──
  static async getDownloadsPaused(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(SETTINGS_PAUSE_DOWNLOADS_KEY)) === 'true';
    } catch {
      return false;
    }
  }

  static async setDownloadsPaused(paused: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(SETTINGS_PAUSE_DOWNLOADS_KEY, paused ? 'true' : 'false');
      DownloadEvents.emit('pauseStatusChanged', paused);

      if (paused) {
        // Settle queued automatic jobs so their callers don't hang.
        this.queue.dropQueued(
          meta => meta.source === 'auto',
          task => {
            this.log(`Download paused: ${task.meta.postId} (Skipped)`);
            task.resolve(null);
          }
        );
      }
    } catch (error) {
      console.error(error);
    }
  }
}
