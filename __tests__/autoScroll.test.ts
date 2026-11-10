import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  AUTO_SCROLL_MAX_DELAY_MS,
  AUTO_SCROLL_MIN_DELAY_MS,
  SETTINGS_AUTO_SCROLL_KEY,
  getAutoScrollEnabled,
  nextAutoScrollDelay,
  setAutoScrollEnabled,
} from '../services/autoScroll';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('auto-scroll setting', () => {
  it('defaults to off', async () => {
    await expect(getAutoScrollEnabled()).resolves.toBe(false);
  });

  it('persists both states', async () => {
    await setAutoScrollEnabled(true);
    await expect(getAutoScrollEnabled()).resolves.toBe(true);
    expect(await AsyncStorage.getItem(SETTINGS_AUTO_SCROLL_KEY)).toBe('true');

    await setAutoScrollEnabled(false);
    await expect(getAutoScrollEnabled()).resolves.toBe(false);
  });
});

describe('nextAutoScrollDelay', () => {
  it('stays inside the 2-4s window', () => {
    expect(nextAutoScrollDelay(() => 0)).toBe(AUTO_SCROLL_MIN_DELAY_MS);
    expect(nextAutoScrollDelay(() => 1)).toBe(AUTO_SCROLL_MAX_DELAY_MS);

    const middle = nextAutoScrollDelay(() => 0.5);
    expect(middle).toBeGreaterThan(AUTO_SCROLL_MIN_DELAY_MS);
    expect(middle).toBeLessThan(AUTO_SCROLL_MAX_DELAY_MS);

    for (let i = 0; i < 50; i++) {
      const value = nextAutoScrollDelay();
      expect(value).toBeGreaterThanOrEqual(AUTO_SCROLL_MIN_DELAY_MS);
      expect(value).toBeLessThanOrEqual(AUTO_SCROLL_MAX_DELAY_MS);
    }
  });
});
