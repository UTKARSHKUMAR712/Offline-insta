import { StyleSheet, View, Text, TextInput, Modal, Pressable, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { useState, useRef, useCallback, type ComponentRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { DownloadService, DownloadEvents } from '../services/download';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { describeApiError, isInstagramUrl, parseInstagramUrl } from '../services/api';
import {
  AUTO_SCROLL_MAX_STALLS,
  AUTO_SCROLL_SCRIPT,
  AUTO_SCROLL_STEP_SCRIPT,
  getAutoScrollEnabled,
  nextAutoScrollDelay,
  type AutoScrollResult,
} from '../services/autoScroll';

/** Tray log plus the Metro console, so auto-scroll can be debugged from either. */
function logLine(message: string) {
  if (__DEV__) console.log(message);
  DownloadEvents.emit('log', message);
}

export default function HomeScreen() {
  const webViewRef = useRef<ComponentRef<typeof WebView>>(null);

  // Track the URL currently open in the WebView
  const [currentUrl, setCurrentUrl] = useState('');
  // Last reel we already queued, so SPA navigations don't queue it repeatedly
  const lastHandledRef = useRef<string | null>(null);

  // State for the manual URL input modal
  const [modalVisible, setModalVisible] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  // Auto-scroll: the setting lives in AsyncStorage, the loop below is paused
  // whenever a download is running so a reel is never skipped before it lands.
  const [autoScrollActive, setAutoScrollActive] = useState(false);
  const downloadsInFlightRef = useRef(0);
  const autoScrollStallsRef = useRef(0);
  // Shortcode of the reel the loop last saw, used to tell "advanced" from "stuck".
  const autoScrollLastShortcodeRef = useRef('');
  // Reels already queued by the loop this run, so a stale page URL the page keeps
  // reporting is not downloaded over and over.
  const autoScrollQueuedRef = useRef<Set<string>>(new Set());

  // Re-read the setting on focus: it is toggled from the Settings tab.
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      getAutoScrollEnabled()
        .then(enabled => {
          if (isActive) setAutoScrollActive(enabled);
        })
        .catch(() => {});
      return () => {
        isActive = false;
      };
    }, [])
  );

  const handleDetectedUrl = async (url: string) => {
    if (!url || !url.startsWith('http')) return;
    setCurrentUrl(url);

    const target = parseInstagramUrl(url);
    if (!target) {
      // feeds, profiles, explore, stories, audio pages…
      logLine(`>> page visited: ${new URL(url).pathname}`);
      return;
    }
    if (lastHandledRef.current === target.shortcode) return;

    lastHandledRef.current = target.shortcode;
    DownloadEvents.emit('log', '>> Reel detected, downloading...');
    downloadsInFlightRef.current += 1;
    try {
      await DownloadService.downloadReel(url);
    } catch (e: any) {
      // Automatic downloads have no modal open, so report through the overlay.
      DownloadEvents.emit('log', '>> ' + describeApiError(e));
      // Allow a later retry if the user reopens this reel.
      lastHandledRef.current = null;
    } finally {
      downloadsInFlightRef.current -= 1;
    }
  };

  // Fires on full page navigations only; SPA navigations are caught by the
  // history patch injected below.
  const onNavigationStateChange = (navState: any) => {
    void handleDetectedUrl(navState.url || '');
  };

  /**
   * This intercepts navigator.clipboard.writeText() inside the WebView.
   * Android WebView runs in a sandboxed context where clipboard writes 
   * don't reach the real system clipboard. This bridge fixes that:
   * Instagram's "Copy Link" now actually copies to the Android clipboard.
   */
  const injectedJavaScript = `
    (function() {
      var _origWrite = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText.bind(navigator.clipboard)
        : null;
      if (navigator.clipboard) {
        navigator.clipboard.writeText = function(text) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'CLIPBOARD_WRITE',
            text: text
          }));
          return _origWrite ? _origWrite(text) : Promise.resolve();
        };
      }
      // Instagram is a SPA: onNavigationStateChange does not fire for its
      // client-side route changes, so report the URL ourselves.
      try {
        var notify = function() {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'URL_CHANGE',
            url: location.href
          }));
        };
        ['pushState', 'replaceState'].forEach(function(method) {
          var original = history[method];
          history[method] = function() {
            var result = original.apply(this, arguments);
            notify();
            return result;
          };
        });
        window.addEventListener('popstate', notify);
      } catch (e) {}
    })();
    true;
  ` + AUTO_SCROLL_SCRIPT;

  /**
   * Gives up for this session when the feed stops moving: a reel page, a login
   * wall or a single mounted video all report the same non-progress, and
   * retrying forever would just burn battery and requests.
   */
  const handleAutoScrollResult = (result: AutoScrollResult) => {
    const path = (value: string) => {
      if (!value) return '-';
      try {
        const url = new URL(value);
        return url.pathname + url.search;
      } catch {
        return value;
      }
    };
    const diag = result.diag;
    const codes = diag?.codes || [];
    logLine(
      `>> auto ${result.reason || 'step'} · reel ${result.index + 1}/${result.count} · href ${path(
        result.href
      )} · postLinks ${diag ? diag.postLinks : '?'} · captured ${diag ? diag.captured : '?'} · page ${path(
        result.url
      )} · codes ${codes.length ? codes.join(',') : '-'}`
    );

    // An open comments panel is transient: the reel under it is not changing.
    if (result.reason === 'comments-open') return;

    // Name the reel to save. The card's own link is the most accurate source,
    // but on layouts that render no anchors (postLinks 0) it degrades to the
    // address bar, which a programmatic scroll never moves — so the shortcodes
    // Instagram fetched for the feed, in feed order, are the reliable fallback.
    const fromPage =
      parseInstagramUrl(result.href || '') ??
      parseInstagramUrl(diag?.canonical || '') ??
      parseInstagramUrl(diag?.ogUrl || '');
    const fromFeed = codes
      .map(code => parseInstagramUrl(`https://www.instagram.com/reel/${code}/`))
      .find(target => !!target && !autoScrollQueuedRef.current.has(target.shortcode));
    const target =
      fromPage && !autoScrollQueuedRef.current.has(fromPage.shortcode) ? fromPage : fromFeed;

    if (target) {
      autoScrollQueuedRef.current.add(target.shortcode);
      void handleDetectedUrl(target.canonicalUrl);
      if (target.shortcode !== autoScrollLastShortcodeRef.current) {
        autoScrollLastShortcodeRef.current = target.shortcode;
        autoScrollStallsRef.current = 0;
      }
    } else {
      logLine('>> auto: no new reel in the page data yet');
    }

    // Only a step that could not advance the feed is a stall. A scroll that moved
    // but had no new reel to name must keep going: the next one may have arrived.
    if (result.ok) return;

    autoScrollStallsRef.current += 1;
    if (autoScrollStallsRef.current < AUTO_SCROLL_MAX_STALLS) return;

    autoScrollStallsRef.current = 0;
    setAutoScrollActive(false);
    logLine('>> Auto-scroll stopped: the feed did not advance');
  };

  // Auto-scroll loop: React Native owns the clock, so a step never fires while
  // a download is still running. Running under useFocusEffect keeps it from
  // advancing a WebView the user has navigated away from.
  useFocusEffect(
    useCallback(() => {
      if (!autoScrollActive) return;

      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      autoScrollStallsRef.current = 0;
      autoScrollLastShortcodeRef.current = '';
      autoScrollQueuedRef.current = new Set();

      function schedule() {
        if (cancelled) return;
        timer = setTimeout(tick, nextAutoScrollDelay());
      }

      function tick() {
        timer = null;
        if (cancelled) return;
        if (downloadsInFlightRef.current > 0) {
          logLine('>> auto: holding the step, a download is running');
        } else if (webViewRef.current) {
          webViewRef.current.injectJavaScript(AUTO_SCROLL_STEP_SCRIPT);
        }
        schedule();
      }

      logLine('>> auto-scroll on · one step every 7–20s');
      schedule();

      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }, [autoScrollActive])
  );

  const onMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data || '{}');
      if (data.type === 'URL_CHANGE' && data.url) {
        void handleDetectedUrl(data.url);
        return;
      }
      if (data.type === 'AUTO_SCROLL') {
        handleAutoScrollResult(data as AutoScrollResult);
        return;
      }
      if (data.type === 'CLIPBOARD_WRITE' && data.text) {
        // Write to the real Android system clipboard
        await Clipboard.setStringAsync(data.text);
        // If it looks like an Instagram reel link, auto-fill the input
        const lower = (data.text as string).toLowerCase();
        if (lower.includes('instagram.com')) {
          setInputUrl(data.text);
          setModalVisible(true);
        }
      }
    } catch (_) {}
  };

  const handleManualDownload = async () => {
    const url = inputUrl.trim();
    if (!url) return;

    if (!isInstagramUrl(url) || !parseInstagramUrl(url)) {
      DownloadEvents.emit('log', '>> Invalid URL (not an Instagram reel/post)');
      Alert.alert('Invalid link', 'Paste an Instagram reel or post link, for example https://www.instagram.com/reel/…');
      return;
    }

    setIsDownloading(true);
    setModalVisible(false);
    setInputUrl('');

    DownloadEvents.emit('log', '>> Manual download started...');
    downloadsInFlightRef.current += 1;
    try {
      // Resolves only once the file is on disk (or was already saved).
      await DownloadService.downloadReel(url, { source: 'manual' });
    } catch (e: any) {
      Alert.alert('Download failed', describeApiError(e));
    } finally {
      downloadsInFlightRef.current -= 1;
      setIsDownloading(false);
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://www.instagram.com/reels/' }}
        // Only injection: intercepts clipboard writes so "Copy Link" actually works on Android
        injectedJavaScript={injectedJavaScript}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
      />

      {/* Floating download button — left side, semi-transparent */}
      <Pressable
        style={styles.floatingBtn}
        onPress={() => {
          // Pre-fill only when the current page is a reel/post, otherwise the
          // user would have to clear a feed URL every time.
          setInputUrl(parseInstagramUrl(currentUrl) ? currentUrl : '');
          setModalVisible(true);
        }}
      >
        <Ionicons name="cloud-download-outline" size={22} color="white" />
      </Pressable>

      {/* Manual URL Input Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>📥 Paste Reel URL</Text>
            <Text style={styles.modalSub}>Copy the Instagram reel link and paste it below</Text>

            <TextInput
              style={styles.input}
              placeholder="https://www.instagram.com/reel/..."
              placeholderTextColor="#666"
              value={inputUrl}
              onChangeText={setInputUrl}
              autoCorrect={false}
              autoCapitalize="none"
              keyboardType="url"
            />

            <View style={styles.modalButtons}>
              <Pressable style={styles.cancelBtn} onPress={() => { setModalVisible(false); setInputUrl(''); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.downloadBtn, (!inputUrl.trim() || isDownloading) && { opacity: 0.4 }]}
                onPress={handleManualDownload}
                disabled={!inputUrl.trim() || isDownloading}
              >
                <Text style={styles.downloadText}>{isDownloading ? 'Downloading…' : 'Download'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Floating button — left side, semi-transparent
  floatingBtn: {
    position: 'absolute',
    left: 8,
    top: '45%',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: '#333',
  },
  modalTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  modalSub: {
    color: '#888',
    fontSize: 13,
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: 'white',
    fontSize: 13,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
  },
  cancelText: {
    color: '#aaa',
    fontSize: 15,
  },
  downloadBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#0095f6',
    alignItems: 'center',
  },
  downloadText: {
    color: 'white',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
