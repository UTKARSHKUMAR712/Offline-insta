import { StyleSheet, View, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { useState, useRef, useEffect } from 'react';
import { DownloadService, DownloadEvents } from '../../services/download';

export default function HomeScreen() {
  const webViewRef = useRef<WebView>(null);

  const [logs, setLogs] = useState<string[]>(['Ready to download']);
  const [progressFiles, setProgressFiles] = useState<{ [key: string]: number }>({});

  useEffect(() => {
    const handleLog = (msg: string) => {
      setLogs((prev) => [...prev, msg].slice(-5));
    };
    const handleProgress = ({ postId, percentage }: { postId: string; percentage: number }) => {
      setProgressFiles((prev) => ({ ...prev, [postId]: percentage }));
      if (percentage === 100) {
        setTimeout(() => {
          setProgressFiles((prev) => {
            const copy = { ...prev };
            delete copy[postId];
            return copy;
          });
        }, 3000);
      }
    };

    DownloadEvents.on('log', handleLog);
    DownloadEvents.on('progress', handleProgress);

    return () => {
      DownloadEvents.off('log', handleLog);
      DownloadEvents.off('progress', handleProgress);
    };
  }, []);

  /**
   * onNavigationStateChange fires every time the page URL changes — it's a 
   * pure native WebView event, NO JavaScript injection is involved, and 
   * Instagram cannot detect it. The web page runs exactly as normal.
   */
  const onNavigationStateChange = async (navState: any) => {
    const url: string = navState.url || '';
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.includes('/reel/') || lowerUrl.includes('/reels/') || lowerUrl.includes('/p/')) {
      DownloadEvents.emit('log', '>> Reel detected, downloading...');
      try {
        await DownloadService.downloadReel(url);
      } catch (e: any) {
        DownloadEvents.emit('log', '>> Error: ' + e.message);
      }
    }
  };

  const activeDownloads = Object.entries(progressFiles);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://www.instagram.com/reels/' }}
        // NO injectedJavaScript — Instagram runs exactly as on a normal browser
        onNavigationStateChange={onNavigationStateChange}
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
      />

      {/* Overlay UI — pointer-events none so it never blocks the web view */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.logBox}>
          {logs.map((logStr, index) => (
            <Text key={index} style={styles.logText}>{logStr}</Text>
          ))}
        </View>

        {activeDownloads.map(([postId, percent]) => (
          <View key={postId} style={styles.progressContainer}>
            <Text style={styles.progressText}>Downloading {postId}: {percent}%</Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${percent}%` }]} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    zIndex: 10,
    gap: 10,
  },
  logBox: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 10,
    borderRadius: 8,
  },
  logText: {
    color: '#0f0',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  progressContainer: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 10,
    borderRadius: 8,
  },
  progressText: {
    color: 'white',
    fontSize: 12,
    marginBottom: 5,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
  },
});
