import { documentDirectory, createDownloadResumable } from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

class SimpleEventEmitter {
  events: { [key: string]: Function[] } = {};

  on(event: string, listener: Function) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(listener);
  }

  off(event: string, listener: Function) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(l => l !== listener);
  }

  emit(event: string, data?: any) {
    if (!this.events[event]) return;
    this.events[event].forEach(listener => listener(data));
  }
}

export interface ReelData {
  id: string; // The instagram post ID
  localUri: string; // The local file path on the device
  originalUrl: string; // The original instagram URL
  timestamp: number;
}

const STORAGE_KEY = '@downloaded_reels';
// Change this to your actual Vercel deployment URL
const API_URL = 'https://reeldownloder.vercel.app/api/video'; 

// Create an event emitter to broadcast download progress to the UI
export const DownloadEvents = new SimpleEventEmitter();

export class DownloadService {
  /**
   * Helper to broadcast log messages to the UI
   */
  static log(message: string) {
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
      return stored ? JSON.parse(stored) : [];
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

    if (await this.isReelDownloaded(postId)) {
      this.log(`Reel ${postId} is already downloaded.`);
      return null;
    }

    this.log(`Starting process for ID: ${postId}`);

    // 2. Fetch the actual mp4 video URL from our Vercel API
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
    
    try {
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
    }
  }
}
