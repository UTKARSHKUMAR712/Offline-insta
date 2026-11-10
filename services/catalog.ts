import AsyncStorage from '@react-native-async-storage/async-storage';
import { getInfoAsync } from 'expo-file-system/legacy';

import { authorFromUrl } from './api';
import type { LibraryStats, ReelData } from './types';

export const REELS_STORAGE_KEY = '@downloaded_reels';

/**
 * Collapse duplicate ids, keeping the saved copy when there is one. Local
 * storage can end up with duplicates after interrupted writes.
 */
export function dedupeReels(reels: ReelData[]): ReelData[] {
  const byId = new Map<string, ReelData>();
  for (const reel of reels) {
    const existing = byId.get(reel.id);
    if (!existing || (reel.isSaved && !existing.isSaved)) {
      byId.set(reel.id, reel);
    }
  }
  return Array.from(byId.values());
}

export function summarize(reels: ReelData[]): LibraryStats {
  return {
    count: reels.length,
    savedCount: reels.filter(reel => reel.isSaved).length,
    bytes: reels.reduce((sum, reel) => sum + (reel.sizeBytes ?? 0), 0),
  };
}

/**
 * Backfills metadata that older entries never stored: the author from the URL
 * and the real file size from disk. Returns the same object when nothing
 * changed so callers can detect whether a write is needed.
 */
export async function withDerivedMetadata(reel: ReelData): Promise<ReelData> {
  let next = reel;

  if (!next.author) {
    const author = authorFromUrl(next.originalUrl);
    if (author) next = { ...next, author };
  }

  if (next.sizeBytes === undefined) {
    try {
      const info = await getInfoAsync(next.localUri);
      if (info.exists && 'size' in info && typeof info.size === 'number') {
        next = { ...next, sizeBytes: info.size };
      }
    } catch {
      // File missing or unreadable — leave the size unknown.
    }
  }

  return next;
}

/** Repository over the AsyncStorage list of downloaded reels. */
export class Catalog {
  private static cache: ReelData[] | null = null;

  static invalidate(): void {
    this.cache = null;
  }

  static async all(): Promise<ReelData[]> {
    if (this.cache) return this.cache;

    let stored: string | null = null;
    try {
      stored = await AsyncStorage.getItem(REELS_STORAGE_KEY);
    } catch {
      return [];
    }

    if (!stored) {
      this.cache = [];
      return this.cache;
    }

    let parsed: ReelData[] = [];
    try {
      parsed = JSON.parse(stored) as ReelData[];
    } catch {
      // Corrupt payload: start clean rather than crash the feed.
      parsed = [];
    }

    const deduped = dedupeReels(parsed);
    const migrated = await Promise.all(deduped.map(withDerivedMetadata));
    const changed = migrated.some((reel, index) => reel !== deduped[index]);

    this.cache = migrated;
    if (changed) await this.persist(migrated);
    return this.cache;
  }

  static async has(postId: string): Promise<boolean> {
    const reels = await this.all();
    return reels.some(reel => reel.id === postId);
  }

  static async find(postId: string): Promise<ReelData | null> {
    const reels = await this.all();
    return reels.find(reel => reel.id === postId) ?? null;
  }

  static async upsert(reel: ReelData): Promise<void> {
    const reels = await this.all();
    const next = [reel, ...reels.filter(item => item.id !== reel.id)];
    this.cache = next;
    await this.persist(next);
  }

  static async remove(postId: string): Promise<ReelData | null> {
    const reels = await this.all();
    const reel = reels.find(item => item.id === postId) ?? null;
    if (!reel) return null;

    const next = reels.filter(item => item.id !== postId);
    this.cache = next;
    await this.persist(next);
    return reel;
  }

  static async setSaved(postId: string, isSaved: boolean): Promise<ReelData | null> {
    const reels = await this.all();
    let updated: ReelData | null = null;

    const next = reels.map(reel => {
      if (reel.id !== postId) return reel;
      updated = { ...reel, isSaved };
      return updated;
    });

    if (!updated) return null;

    this.cache = next;
    await this.persist(next);
    return updated;
  }

  static async stats(): Promise<LibraryStats> {
    return summarize(await this.all());
  }

  private static async persist(reels: ReelData[]): Promise<void> {
    try {
      await AsyncStorage.setItem(REELS_STORAGE_KEY, JSON.stringify(reels));
    } catch (error) {
      console.error('Failed to persist reel catalog', error);
    }
  }
}
