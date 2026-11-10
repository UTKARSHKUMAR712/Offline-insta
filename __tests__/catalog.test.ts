import AsyncStorage from '@react-native-async-storage/async-storage';

import { Catalog, dedupeReels, summarize, withDerivedMetadata } from '../services/catalog';
import type { ReelData } from '../services/types';

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1234, isDirectory: false })),
}));

const reel = (overrides: Partial<ReelData> & { id: string }): ReelData => ({
  localUri: `file:///reel_${overrides.id}.mp4`,
  originalUrl: `https://www.instagram.com/utkarsh712/reel/${overrides.id}/`,
  timestamp: 1_700_000_000_000,
  ...overrides,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  Catalog.invalidate();
});

describe('dedupeReels', () => {
  it('keeps one entry per id', () => {
    const result = dedupeReels([reel({ id: 'a' }), reel({ id: 'a' }), reel({ id: 'b' })]);
    expect(result.map(item => item.id)).toEqual(['a', 'b']);
  });

  it('prefers the saved copy when duplicates disagree', () => {
    const result = dedupeReels([
      reel({ id: 'a', isSaved: false }),
      reel({ id: 'a', isSaved: true }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].isSaved).toBe(true);
  });
});

describe('summarize', () => {
  it('counts reels, saved reels and bytes', () => {
    const stats = summarize([
      reel({ id: 'a', sizeBytes: 1000, isSaved: true }),
      reel({ id: 'b', sizeBytes: 500 }),
      reel({ id: 'c' }),
    ]);
    expect(stats).toEqual({ count: 3, savedCount: 1, bytes: 1500 });
  });
});

describe('withDerivedMetadata', () => {
  it('fills in the author from the URL', async () => {
    const migrated = await withDerivedMetadata(reel({ id: 'a', sizeBytes: 10 }));
    expect(migrated.author).toBe('utkarsh712');
  });

  it('keeps an existing author untouched', async () => {
    const migrated = await withDerivedMetadata(reel({ id: 'a', author: 'someone', sizeBytes: 10 }));
    expect(migrated.author).toBe('someone');
  });

  it('reads the file size from disk when missing', async () => {
    const migrated = await withDerivedMetadata(reel({ id: 'a' }));
    expect(migrated.sizeBytes).toBe(1234);
  });
});

describe('Catalog', () => {
  it('dedupes and migrates what was already on disk, then persists it', async () => {
    await AsyncStorage.setItem(
      '@downloaded_reels',
      JSON.stringify([
        reel({ id: 'a' }),
        reel({ id: 'a', isSaved: true }),
        reel({ id: 'b', sizeBytes: 42 }),
      ])
    );

    const reels = await Catalog.all();

    expect(reels.map(item => item.id)).toEqual(['a', 'b']);
    expect(reels.find(item => item.id === 'a')?.isSaved).toBe(true);
    expect(reels.find(item => item.id === 'a')?.sizeBytes).toBe(1234);

    const persisted = JSON.parse((await AsyncStorage.getItem('@downloaded_reels')) ?? '[]');
    expect(persisted).toHaveLength(2);
  });

  it('starts clean on a corrupt payload', async () => {
    await AsyncStorage.setItem('@downloaded_reels', '{not json');
    await expect(Catalog.all()).resolves.toEqual([]);
  });

  it('upserts without duplicating and removes files from the list', async () => {
    await Catalog.upsert(reel({ id: 'a', sizeBytes: 1 }));
    await Catalog.upsert(reel({ id: 'a', sizeBytes: 2 }));

    expect(await Catalog.all()).toHaveLength(1);
    expect(await Catalog.stats()).toMatchObject({ count: 1, bytes: 2 });

    const removed = await Catalog.remove('a');
    expect(removed?.id).toBe('a');
    expect(await Catalog.all()).toHaveLength(0);
  });

  it('toggles the saved flag', async () => {
    await Catalog.upsert(reel({ id: 'a', sizeBytes: 1 }));

    expect((await Catalog.setSaved('a', true))?.isSaved).toBe(true);
    expect(await Catalog.stats()).toMatchObject({ savedCount: 1 });

    expect((await Catalog.setSaved('a', false))?.isSaved).toBe(false);
    expect(await Catalog.stats()).toMatchObject({ savedCount: 0 });
    expect(await Catalog.setSaved('missing', true)).toBeNull();
  });
});
