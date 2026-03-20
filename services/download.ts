import { documentDirectory, createDownloadResumable, deleteAsync, getInfoAsync } from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Simple Event Emitter ────────────────────────────────────────────────────
class SimpleEventEmitter {
  private listeners: { [key: string]: Function[] } = {};
  on(event: string, listener: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
  }
  off(event: string, listener: Function) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l !== listener);
  }
  emit(event: string, data?: any) {
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
}

const STORAGE_KEY = '@downloaded_reels';
export const SETTINGS_AUTO_DELETE_KEY = '@settings_auto_delete_reels';
export const SETTINGS_PAUSE_DOWNLOADS_KEY = '@settings_pause_downloads';
const API_URL = 'https://reeldownloder.vercel.app/api/video';

export const DownloadEvents = new SimpleEventEmitter();

// ─── Download Service ────────────────────────────────────────────────────────
export class DownloadService {

  // Serial queue — all downloads go here, processed strictly one-at-a-time
  private static queue: string[] = [];
  private static queuedIds = new Set<string>();
  private static isProcessing = false;

  // ── Logging ──
  private static log(msg: string) {
    console.log(msg);
    DownloadEvents.emit('log', msg);
  }

  // ── Queue entry point ──
  static async downloadReel(postUrl: string) {
    const postId = this.extractId(postUrl);
    if (!postId) { this.log(`Cannot extract ID from: ${postUrl}`); return; }
    
    // Check if downloads are paused
    if (await this.getDownloadsPaused()) {
      this.log(`Download paused: ${postId} (Skipped)`);
      return;
    }

    if (this.queuedIds.has(postId)) return;
    if (await this.isReelDownloaded(postId)) { this.log(`Already saved: ${postId}`); return; }

    this.queuedIds.add(postId);
    this.queue.push(postUrl);
    this.log(`Queued ${postId} (${this.queue.length} in queue)`);
    this.runQueue();
  }

  private static extractId(url: string): string | null {
    const m = url.match(/\/(?:reels?|p)\/([a-zA-Z0-9_-]+)/i);
    return m ? m[1] : null;
  }

  // ── Queue runner — called by each new enqueue ──
  private static async runQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const url = this.queue.shift()!;
      await this.processOne(url);
    }
    this.isProcessing = false;
  }

  // ── Actual download logic for a single reel ──
  private static async processOne(postUrl: string) {
    const postId = this.extractId(postUrl)!;
    // Always try canonical URL first — profile-prefixed URLs often fail the API
    const canonical = `https://www.instagram.com/reel/${postId}/`;

    try {
      this.log(`⬇ Starting: ${postId}`);

      let videoInfo = await this.fetchVideoInfo(canonical);
      if (!videoInfo?.data?.videoUrl) {
        this.log(`Retrying with original URL...`);
        videoInfo = await this.fetchVideoInfo(postUrl);
      }

      const videoUrl = videoInfo?.data?.videoUrl;
      if (!videoUrl) { this.log(`❌ No video URL from API for ${postId}`); return; }

      const docDir = documentDirectory;
      if (!docDir) return;

      const localUri = `${docDir}reel_${postId}.mp4`;
      const resumable = createDownloadResumable(
        videoUrl,
        localUri,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          const pct = Math.round(totalBytesWritten / totalBytesExpectedToWrite * 100);
          DownloadEvents.emit('progress', { postId, percentage: pct });
        }
      );

      const result = await resumable.downloadAsync();
      if (!result || result.status !== 200) throw new Error(`HTTP ${result?.status}`);

      const reel: ReelData = { id: postId, localUri: result.uri, originalUrl: postUrl, timestamp: Date.now() };
      const existing = await this.getDownloadedReels();
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([reel, ...existing]));

      this.log(`✅ Done: ${postId}`);
      DownloadEvents.emit('progress', { postId, percentage: 100 });
      DownloadEvents.emit('success', reel);
    } catch (e: any) {
      this.log(`❌ Error on ${postId}: ${e.message}`);
    } finally {
      this.queuedIds.delete(postId);
    }
  }

  // ── Fetch video info from API ──
  static async fetchVideoInfo(postUrl: string) {
    try {
      const response = await fetch(`${API_URL}?postUrl=${postUrl}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (e: any) {
      this.log(`API error: ${e.message}`);
      return null;
    }
  }

  // ── Storage helpers ──
  static async getDownloadedReels(): Promise<ReelData[]> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored) as ReelData[];
      // Dedup: if two items share an ID, keep the one with isSaved=true
      const map = new Map<string, ReelData>();
      parsed.forEach(item => {
        const existing = map.get(item.id);
        if (!existing || (item.isSaved && !existing.isSaved)) map.set(item.id, item);
      });
      return Array.from(map.values());
    } catch { return []; }
  }

  static async isReelDownloaded(postId: string): Promise<boolean> {
    const reels = await this.getDownloadedReels();
    return reels.some(r => r.id === postId);
  }

  // ── Delete reel (hard delete — blocks isSaved reels) ──
  static async deleteReel(postId: string): Promise<boolean> {
    try {
      this.log(`Deleting: ${postId}`);
      let reels = await this.getDownloadedReels();
      const reel = reels.find(r => r.id === postId);
      if (!reel) { this.log(`Not found: ${postId}`); return false; }
      // Safety: never auto-delete a saved reel
      if (reel.isSaved) { this.log(`BLOCKED — reel ${postId} is saved`); return false; }

      const info = await getInfoAsync(reel.localUri);
      if (info.exists) await deleteAsync(reel.localUri);

      reels = reels.filter(r => r.id !== postId);
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
  static async toggleSaveReel(postId: string) {
    try {
      let reels = await this.getDownloadedReels();
      let updated: ReelData | null = null;
      reels = reels.map(r => {
        if (r.id === postId) { updated = { ...r, isSaved: !r.isSaved }; return updated; }
        return r;
      });
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reels));
      if (updated) DownloadEvents.emit('toggleSave', { id: postId, isSaved: (updated as ReelData).isSaved });
      return updated;
    } catch { return null; }
  }

  // ── Auto-delete setting ──
  static async getAutoDeleteEnabled(): Promise<boolean> {
    try {
      const val = await AsyncStorage.getItem(SETTINGS_AUTO_DELETE_KEY);
      return val === 'true';
    } catch { return false; }
  }

  static async setAutoDeleteEnabled(enabled: boolean) {
    try {
      await AsyncStorage.setItem(SETTINGS_AUTO_DELETE_KEY, enabled ? 'true' : 'false');
    } catch (e) { console.error(e); }
  }

  // ── Pause Downloads setting ──
  static async getDownloadsPaused(): Promise<boolean> {
    try {
      const val = await AsyncStorage.getItem(SETTINGS_PAUSE_DOWNLOADS_KEY);
      return val === 'true';
    } catch { return false; }
  }

  static async setDownloadsPaused(paused: boolean) {
    try {
      await AsyncStorage.setItem(SETTINGS_PAUSE_DOWNLOADS_KEY, paused ? 'true' : 'false');
      DownloadEvents.emit('pauseStatusChanged', paused);
    } catch (e) { console.error(e); }
  }
}
