import { documentDirectory, createDownloadResumable, deleteAsync, getInfoAsync } from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

export interface ReelData {
  id: string; // The instagram post ID
  localUri: string; // The local file path on the device
  originalUrl: string; // The original instagram URL
  timestamp: number;
  isSaved?: boolean; // If true, it appears in "Saved Reels" tab, else "Offline Reels" and can be auto-deleted
}

const STORAGE_KEY = '@downloaded_reels';
export const SETTINGS_AUTO_DELETE_KEY = '@settings_auto_delete_reels';
// Change this to your actual Vercel deployment URL
const API_URL = 'https://reeldownloder.vercel.app/api/video'; 

// Create an event emitter to broadcast download progress to the UI
export const DownloadEvents = new SimpleEventEmitter();

export class DownloadService {
  private static activeDownloads = new Set<string>();

  /**
   * Helper to broadcast log messages to the UI
   */
  private static log(message: string) {
    console.log(message);
    DownloadEvents.emit('log', message);
  }

  /**
   * Fetch a Reel URL from the Vercel API
   */
  static async fetchVideoInfo(postUrl: string) {
    try {
      this.log(`Fetching from API: ${API_URL}?postUrl=${postUrl}`);
      // As requested, not encoding the URI component
      const response = await fetch(`${API_URL}?postUrl=${postUrl}`);
      
      if (!response.ok) {
        throw new Error(`API returned Error: ${response.status}`);
      }
      
      const json = await response.json();
      this.log(`API Fetch Success!`);
      return json;
    } catch (e: any) {
      this.log(`API Fetch Failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Returns a list of all currently downloaded reels from AsyncStorage
   */
  static async getDownloadedReels(): Promise<ReelData[]> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored) as ReelData[];
      
      // Filter out any stale duplicates from legacy race condition bugs.
      // We manually construct the Map to guarantee that if there is a duplicate where `isSaved === true`, 
      // it takes absolute precedence over the un-saved clone.
      const uniqueReelsMap = new Map<string, ReelData>();
      parsed.forEach(item => {
        const existing = uniqueReelsMap.get(item.id);
        if (!existing || (item.isSaved && !existing.isSaved)) {
          uniqueReelsMap.set(item.id, item);
        }
      });
      const uniqueReels = Array.from(uniqueReelsMap.values());
      return uniqueReels;
    } catch (e) {
      console.error('Failed to load reels from storage', e);
      return [];
    }
  }

  /**
   * Check if a Reel is already downloaded to prevent duplicates
   */
  static async isReelDownloaded(postId: string): Promise<boolean> {
    const reels = await this.getDownloadedReels();
    return reels.some(reel => reel.id === postId);
  }

  /**
   * Main function to trigger the download flow
   */
  static async downloadReel(postUrl: string) {
    // 1. Extract a rough post ID from the URL for uniqueness
    // Accommodates both /reel/, /reels/ and /p/ URL structures.
    const match = postUrl.match(/\/(?:reels?|p)\/([a-zA-Z0-9_-]+)/i);
    const postId = match ? match[1] : null;

    if (!postId) {
      this.log(`Could not extract ID from URL: ${postUrl}`);
      return null;
    }

    if (this.activeDownloads.has(postId)) {
      return null;
    }
    
    if (await this.isReelDownloaded(postId)) {
      this.log(`Reel ${postId} is already downloaded.`);
      return null;
    }

    this.activeDownloads.add(postId);

    try {
      this.log(`Starting process for ID: ${postId}`);
      const videoInfo = await this.fetchVideoInfo(postUrl);
    
      // Log exactly what the API gave us to the Android screen
      this.log(`API Response: ${JSON.stringify(videoInfo).substring(0, 100)}...`);

      // The API responds with: { "status": "success", "data": { "videoUrl": "..." } }
      let videoUrl = videoInfo?.data?.videoUrl; 

      if (!videoUrl) {
        this.log(`NO VIDEO URL FOUND inside API JSON payload.`);
        return null;
      }

      // 3. Download the actual file to the device
      const docDir = documentDirectory;
      if (!docDir) {
        this.log(`Error: File system document directory is missing.`);
        return null;
      }
      const localFileUri = `${docDir}reel_${postId}.mp4`;
      
      this.log(`Starting MP4 download...`);
      
      // Use createDownloadResumable to track progress %
      const downloadResumable = createDownloadResumable(
        videoUrl,
        localFileUri,
        {},
        (downloadProgress) => {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          const percentage = Math.round(progress * 100);
          DownloadEvents.emit('progress', { postId, percentage });
        }
      );

      const downloadResult = await downloadResumable.downloadAsync();
      
      if (!downloadResult || downloadResult.status !== 200) {
        throw new Error(`File download failed. Status: ${downloadResult?.status}`);
      }

      this.log(`Download Complete! (100%)`);
      DownloadEvents.emit('progress', { postId, percentage: 100 });

      // 4. Save metadata to AsyncStorage
      const newReel: ReelData = {
        id: postId,
        localUri: downloadResult.uri,
        originalUrl: postUrl,
        timestamp: Date.now(),
      };

      const existingReels = await this.getDownloadedReels();
      // Add securely to the front of the list
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([newReel, ...existingReels]));
      
      this.log(`Successfully saved reel to storage!`);
      DownloadEvents.emit('success', newReel);
      return newReel;
    } catch (e: any) {
      this.log(`Download Error: ${e.message}`);
      return null;
    } finally {
      this.activeDownloads.delete(postId);
    }
  }

  /**
   * Hard delete a reel from local filesystem and storage
   */
  static async deleteReel(postId: string) {
    try {
      this.log(`Attempting to delete reel: ${postId}`);
      let reels = await this.getDownloadedReels();
      const reelToDelete = reels.find(r => r.id === postId);
      
      if (!reelToDelete) {
        this.log(`Reel ${postId} not found in storage.`);
        return false;
      }

      // ULTIMATE SAFETY OVERRIDE: 
      // Do not allow deletion if the latest database record shows this reel is explicitly saved 
      // (Even if the frontend UI asked us to delete it due to state desync)
      if (reelToDelete.isSaved) {
        this.log(`ATTEMPTED DELETION BLOCKED: Reel ${postId} is marked as explicitly saved.`);
        return false;
      }

      // Hard delete from file system
      const fileInfo = await getInfoAsync(reelToDelete.localUri);
      if (fileInfo.exists) {
        await deleteAsync(reelToDelete.localUri);
        this.log(`Deleted MP4 file from device.`);
      }

      // Remove from AsyncStorage
      reels = reels.filter(r => r.id !== postId);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reels));
      
      this.log(`Reel ${postId} fully deleted from app.`);
      DownloadEvents.emit('delete', postId);
      return true;
    } catch (e: any) {
      this.log(`Failed to delete reel: ${e.message}`);
      return false;
    }
  }

  /**
   * Toggle a reel's 'isSaved' state to prevent auto-deletion
   */
  static async toggleSaveReel(postId: string) {
    try {
      let reels = await this.getDownloadedReels();
      let updatedReel: ReelData | null = null;
      reels = reels.map(r => {
        if (r.id === postId) {
          updatedReel = { ...r, isSaved: !r.isSaved };
          return updatedReel;
        }
        return r;
      });
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reels));
      if (updatedReel) {
        DownloadEvents.emit('save', updatedReel);
      }
      return updatedReel;
    } catch (e) {
      console.error('Failed to toggle save state', e);
      return null;
    }
  }

  /**
   * Auto-delete setting config
   */
  static async getAutoDeleteEnabled(): Promise<boolean> {
    try {
      const val = await AsyncStorage.getItem(SETTINGS_AUTO_DELETE_KEY);
      return val === 'true'; // Default false
    } catch {
      return false;
    }
  }

  static async setAutoDeleteEnabled(enabled: boolean) {
    try {
      await AsyncStorage.setItem(SETTINGS_AUTO_DELETE_KEY, enabled ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to save setting', e);
    }
  }
} // End 
