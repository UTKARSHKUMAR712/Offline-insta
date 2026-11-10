import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ReelMetadata } from './types';

/** Persisted flag: keep advancing the reels feed while browsing. */
export const SETTINGS_AUTO_SCROLL_KEY = '@settings_auto_scroll_reels';

/** Randomized dwell window per step. */
export const AUTO_SCROLL_MIN_DELAY_MS = 7000;
export const AUTO_SCROLL_MAX_DELAY_MS = 20000;

/** Consecutive steps that do not move the feed before the loop gives up. */
export const AUTO_SCROLL_MAX_STALLS = 4;

/** Attempts per reel before a failing download is left alone. */
export const AUTO_SCROLL_MAX_ATTEMPTS = 2;

export type AutoScrollResult = {
  type: 'AUTO_SCROLL';
  ok: boolean;
  reason: string;
  count: number;
  index: number;
  /** Permalink of the reel on screen, read from the DOM. Empty when absent. */
  href: string;
  url: string;
  /** Why `href` was empty, for the on-device troubleshooting log. */
  diag?: {
    postLinks: number;
    canonical: string;
    ogUrl: string;
    title: string;
    captured: number;
    lastCode: string;
    /** Every shortcode seen so far, oldest first: the feed order to save from. */
    codes: string[];
    /** Author and caption Instagram sent alongside those shortcodes. */
    media: Record<string, ReelMetadata>;
  };
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
 *
 * Each step also reports the on-screen reel's permalink. The app downloads from
 * that link instead of waiting for a URL change, because a programmatic scroll
 * does not reliably move Instagram's address bar — which is why auto-scroll used
 * to advance without saving anything.
 */
export const AUTO_SCROLL_SCRIPT = `
(function () {
  if (window.__igReelScroller) return;
  var VIDEO_SELECTOR = 'main video';
  var COMMENTS_SELECTOR = '.BasePortal span';
  // /reel/<id>/ /reels/<id>/ /p/<id>/ /tv/<id>/ with or without a username
  // prefix. Deliberately does not match the /reels/ feed, /reels/audio/<n> or
  // /<user>/reels/ (a profile tab), which have no shortcode in the right place.
  var PERMALINK_KINDS = { reel: 1, reels: 1, p: 1, tv: 1 };

  function permalinkPath(pathname) {
    var parts = (pathname || '').split('/').filter(function (part) {
      return part.length > 0;
    });
    if (parts.length < 2) return '';
    var kind = parts[parts.length - 2].toLowerCase();
    var id = parts[parts.length - 1];
    if (!PERMALINK_KINDS[kind]) return '';
    if (!/^[A-Za-z0-9_-]{8,15}$/.test(id)) return '';
    return '/' + kind + '/' + id + '/';
  }

  // ── Shortcode capture, for layouts that render no post links ──
  // Instagram fetches each reel's data as you scroll; when the card has no
  // anchor, the shortcodes in those responses are the only DOM-external way to
  // name the reel on screen.
  var captured = [];
  // code -> { author, caption }, from the same payloads.
  var media = {};

  function addCode(code) {
    if (!code || captured.indexOf(code) !== -1) return;
    captured.push(code);
    if (captured.length > 50) captured.shift();
  }

  function addMedia(code, author, caption) {
    if (!code) return;
    var entry = media[code] || {};
    if (author) entry.author = String(author).slice(0, 60);
    if (caption) entry.caption = String(caption).slice(0, 300);
    if (entry.author || entry.caption) media[code] = entry;
  }

  function captionOf(node) {
    if (node.caption && typeof node.caption.text === 'string') return node.caption.text;
    var edges = node.edge_media_to_caption && node.edge_media_to_caption.edges;
    if (edges && edges.length && edges[0] && edges[0].node && typeof edges[0].node.text === 'string') {
      return edges[0].node.text;
    }
    return '';
  }

  // Walk a decoded payload for clip objects: that is where the shortcode, the
  // author handle and the caption sit together.
  function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 12 || walk.budget <= 0) return;
    walk.budget -= 1;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) walk(node[i], depth + 1);
      return;
    }
    if (
      typeof node.code === 'string' &&
      /^[A-Za-z0-9_-]{8,15}$/.test(node.code) &&
      (node.video_versions || node.clips_metadata || node.is_video || node.media_type === 2)
    ) {
      addCode(node.code);
      var owner = node.user || node.owner || null;
      addMedia(node.code, owner ? owner.username : '', captionOf(node));
      // video_versions is the progressive MP4 (video + audio). Keep its URL so
      // the download can skip the extractor entirely.
      var versions = node.video_versions;
      if (versions) {
        for (var v = 0; v < versions.length; v++) {
          var href = versions[v] && versions[v].url;
          if (typeof href === 'string' && href.indexOf('https://') === 0) {
            var entry = media[node.code] || {};
            if (!entry.videoUrl) entry.videoUrl = href;
            media[node.code] = entry;
            break;
          }
        }
      }
    }
    for (var key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) walk(node[key], depth + 1);
    }
  }

  function interesting(url) {
    return !!url && (url.indexOf('/api/v1/') !== -1 || url.indexOf('/graphql') !== -1);
  }

  function scanResponse(text) {
    if (!text) return;
    if (text.indexOf('video_versions') === -1 && text.indexOf('clips_metadata') === -1) return;
    // Server-rendered payloads arrive double-escaped (\"code\":\"…\"), which a
    // plain quote match would miss. Stripping backslashes is safe here: a
    // shortcode is only letters, digits, - and _.
    var raw = text.slice(0, 3000000);
    var slice = raw.split(String.fromCharCode(92)).join('');
    var patterns = [/"code":"([A-Za-z0-9_-]{8,15})"/g, /"shortcode":"([A-Za-z0-9_-]{8,15})"/g];
    for (var p = 0; p < patterns.length; p++) {
      var match;
      while ((match = patterns[p].exec(slice))) addCode(match[1]);
    }
    // The shortcodes are enough to download; author and caption need the real
    // structure, so decode a copy when the payload is valid JSON.
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      try {
        parsed = JSON.parse(slice);
      } catch (e2) {}
    }
    if (parsed) {
      walk.budget = 60000;
      walk(parsed, 0);
    }
  }

  function watchNetwork() {
    if (window.__igReelNetWatched) return;
    window.__igReelNetWatched = true;

    var originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function () {
        var call = originalFetch.apply(this, arguments);
        try {
          var first = arguments[0];
          var url = typeof first === 'string' ? first : (first && first.url) || '';
          if (interesting(url)) {
            call.then(function (response) {
              try {
                response.clone().text().then(scanResponse, function () {});
              } catch (e) {}
            }, function () {});
          }
        } catch (e) {}
        return call;
      };
    }

    var XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      var open = XHR.prototype.open;
      var send = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        this.__igUrl = url;
        return open.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        var request = this;
        if (interesting(request.__igUrl)) {
          request.addEventListener('load', function () {
            try {
              scanResponse(request.responseText);
            } catch (e) {}
          });
        }
        return send.apply(this, arguments);
      };
    }
  }

  watchNetwork();

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

  function permalinkFor(el) {
    // Reel links usually sit on the card around the video, a few levels up.
    var node = el ? el.parentElement : null;
    for (var depth = 0; node && depth < 10; depth++) {
      var links = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
      for (var i = 0; i < links.length; i++) {
        var raw = links[i].getAttribute('href') || '';
        var url;
        try {
          url = new URL(raw, location.origin);
        } catch (e) {
          continue;
        }
        if (permalinkPath(url.pathname)) return url.origin + permalinkPath(url.pathname);
      }
      node = node.parentElement;
    }
    // Fallback: a URL Instagram already moved to.
    try {
      if (permalinkPath(location.pathname)) return location.origin + permalinkPath(location.pathname);
    } catch (e) {}
    return '';
  }

  function metaValue(selector) {
    var node = document.querySelector(selector);
    if (!node) return '';
    return node.getAttribute('content') || node.getAttribute('href') || '';
  }

  // Every post link Instagram put in the document. Zero means the card has no
  // anchors at all and the permalink cannot be read from the DOM.
  function postLinkCount() {
    var links = document.querySelectorAll('a[href]');
    var count = 0;
    for (var i = 0; i < links.length; i++) {
      var raw = links[i].getAttribute('href') || '';
      try {
        if (permalinkPath(new URL(raw, location.origin).pathname)) count++;
      } catch (e) {}
    }
    return count;
  }

  // Only metadata for the codes this step reports, so the message stays small.
  function recentMedia() {
    var out = {};
    var codes = captured.slice(-30);
    for (var i = 0; i < codes.length; i++) {
      if (media[codes[i]]) out[codes[i]] = media[codes[i]];
    }
    return out;
  }

  function diag() {
    return {
      postLinks: postLinkCount(),
      canonical: metaValue('link[rel="canonical"]'),
      ogUrl: metaValue('meta[property="og:url"]'),
      title: document.title || '',
      captured: captured.length,
      lastCode: captured.length ? captured[captured.length - 1] : '',
      codes: captured.slice(-30),
      media: recentMedia()
    };
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
      href: list.length ? permalinkFor(list[0]) : '',
      url: location.href,
      diag: diag()
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
    result.href = permalinkFor(list[Math.max(index, 0)]);

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
        href: '',
        url: location.href
      }));
    } catch (e) {}
    return;
  }
  scroller.step();
})();
true;
`;
