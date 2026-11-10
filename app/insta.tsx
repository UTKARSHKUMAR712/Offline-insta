import { StyleSheet, View, Text, TextInput, Modal, Pressable, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { useState, useRef, type ComponentRef } from 'react';
import { DownloadService, DownloadEvents } from '../services/download';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { describeApiError, isInstagramUrl, parseInstagramUrl } from '../services/api';

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

  const handleDetectedUrl = async (url: string) => {
    if (!url || !url.startsWith('http')) return;
    setCurrentUrl(url);

    const target = parseInstagramUrl(url);
    if (!target) return; // feeds, profiles, explore, stories, audio pages…
    if (lastHandledRef.current === target.shortcode) return;

    lastHandledRef.current = target.shortcode;
    DownloadEvents.emit('log', '>> Reel detected, downloading...');
    try {
      await DownloadService.downloadReel(url);
    } catch (e: any) {
      // Automatic downloads have no modal open, so report through the overlay.
      DownloadEvents.emit('log', '>> ' + describeApiError(e));
      // Allow a later retry if the user reopens this reel.
      lastHandledRef.current = null;
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
  `;

  const onMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data || '{}');
      if (data.type === 'URL_CHANGE' && data.url) {
        void handleDetectedUrl(data.url);
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
    try {
      // Resolves only once the file is on disk (or was already saved).
      await DownloadService.downloadReel(url, { source: 'manual' });
    } catch (e: any) {
      Alert.alert('Download failed', describeApiError(e));
    } finally {
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
