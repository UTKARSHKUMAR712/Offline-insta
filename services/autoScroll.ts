import AsyncStorage from '@react-native-async-storage/async-storage';

/** Persisted flag: keep advancing the reels feed while browsing. */
export const SETTINGS_AUTO_SCROLL_KEY = '@settings_auto_scroll_reels';

/** Randomized dwell window per step. */
export const AUTO_SCROLL_MIN_DELAY_MS = 2000;
export const AUTO_SCROLL_MAX_DELAY_MS = 4000;

/** Consecutive steps that do not move the feed before the loop gives up. */
export const AUTO_SCROLL_MAX_STALLS = 4;

export type AutoScrollResult = {
  type: 'AUTO_SCROLL';
  ok: boolean;
  reason: string;
  count: number;
  index: number;
  url: string;
};

export async function getAutoScrollEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SETTINGS_AUTO_SCROLL_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setAutoScrollEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_AUTO_SCROLL_KEY, enabled ? 'true' : 'false');
  } catch (error) {
    console.error('Failed to persist auto-scroll setting', error);
  }
}

/** Delay before the next step, uniformly inside [min, max]. */
export function nextAutoScrollDelay(random: () => number = Math.random): number {
  const span = AUTO_SCROLL_MAX_DELAY_MS - AUTO_SCROLL_MIN_DELAY_MS;
  return AUTO_SCROLL_MIN_DELAY_MS + Math.round(random() * span);
}

/**
 * Installed once per page load, defines `window.__igReelScroller`.
 *
 * The technique is the one Auto-Reels-Scroller (a Chrome extension) proved to
 * work: find the reel that is fully inside the viewport by geometry, then
 * `scrollIntoView()` the *next* video element. That needs no knowledge of the
 * scroll container and no synthetic touch input, so it works in a WebView.
 *
 * Two additions for this app:
 *  - layouts that mount a single reel (mobile web) have no next sibling, so the
 *    nearest scrollable ancestor is scrolled by one viewport instead;
 *  - an open comments panel pauses stepping, as in the original extension.
 */
export const AUTO_SCROLL_SCRIPT = `
(function () {
  if (window.__igReelScroller) return;
  var VIDEO_SELECTOR = 'main video';
  var COMMENTS_SELECTOR = '.BasePortal span';

  function viewport() {
    return {
      width: window.innerWidth || document.documentElement.clientWidth,
      height: window.innerHeight || document.documentElement.clientHeight
    };
  }

  function videos() {
    return Array.prototype.slice.call(document.querySelectorAll(VIDEO_SELECTOR));
  }

  function fullyVisible(el) {
    var rect = el.getBoundingClientRect();
    var size = viewport();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top >= -1 &&
      rect.left >= -1 &&
      rect.bottom <= size.height + 1 &&
      rect.right <= size.width + 1
    );
  }

  function closestToCenter(list) {
    var middle = viewport().height / 2;
    var best = -1;
    var bestDistance = Infinity;
    for (var i = 0; i < list.length; i++) {
      var rect = list[i].getBoundingClientRect();
      if (rect.height <= 0) continue;
      var distance = Math.abs((rect.top + rect.bottom) / 2 - middle);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  function currentIndex(list) {
    for (var i = 0; i < list.length; i++) {
      if (fullyVisible(list[i])) return i;
    }
    return closestToCenter(list);
  }

  function commentsOpen() {
    var panel = document.querySelector(COMMENTS_SELECTOR);
    return !!(panel && panel.innerText && panel.innerText.trim().length);
  }

  function scrollableAncestor(el) {
    var node = el ? el.parentElement : null;
    while (node && node !== document.body && node !== document.documentElement) {
      var overflowY = window.getComputedStyle(node).overflowY;
      var scrollable = /(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight + 4;
      if (scrollable) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.body;
  }

  function report(result) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(result));
    } catch (e) {}
  }

  function step() {
    var list = videos();
    var result = {
      type: 'AUTO_SCROLL',
      ok: false,
      reason: '',
      count: list.length,
      index: -1,
      url: location.href
    };

    if (commentsOpen()) {
      result.reason = 'comments-open';
      report(result);
      return;
    }

    if (!list.length) {
      result.reason = 'no-video';
      report(result);
      return;
    }

    var index = currentIndex(list);
    result.index = index;

    if (index >= 0 && index + 1 < list.length) {
      list[index + 1].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      result.ok = true;
      result.reason = 'next-video';
      report(result);
      return;
    }

    // Single-reel layouts: move the scroll container by one viewport so
    // Instagram mounts the following reel.
    var container = scrollableAncestor(list[Math.max(index, 0)]);
    var height = container.clientHeight || viewport().height;
    if (!height) {
      result.reason = 'no-container';
      report(result);
      return;
    }
    container.scrollBy({ top: height, behavior: 'smooth' });
    result.ok = true;
    result.reason = 'scroll-container';
    report(result);
  }

  window.__igReelScroller = { step: step };
})();
true;
`;

/**
 * One step. React Native owns the clock so it can hold the loop while a
 * download is in flight; the page stays a passive executor.
 */
export const AUTO_SCROLL_STEP_SCRIPT = `
(function () {
  var scroller = window.__igReelScroller;
  if (!scroller) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'AUTO_SCROLL',
        ok: false,
        reason: 'not-ready',
        count: 0,
        index: -1,
        url: location.href
      }));
    } catch (e) {}
    return;
  }
  scroller.step();
})();
true;
`;
