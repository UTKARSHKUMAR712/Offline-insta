import { StyleSheet, View, Text, Animated } from 'react-native';
import { WebView } from 'react-native-webview';
import { useState, useRef, useEffect } from 'react';
import { DownloadService, DownloadEvents } from '../../services/download';

export default function HomeScreen() {
  const webViewRef = useRef<WebView>(null);
  
  // State for overlay UI
  const [logs, setLogs] = useState<string[]>(['Ready to download']);
  const [progressFiles, setProgressFiles] = useState<{ [key: string]: number }>({});
  
  useEffect(() => {
    const handleLog = (msg: string) => {
      setLogs((prev) => {
        const newLogs = [...prev, msg];
        return newLogs.slice(-5); // Keep last 5 logs
      });
    };
    const handleProgress = ({ postId, percentage }: { postId: string, percentage: number }) => {
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

  // This script is injected into the Instagram web page.
  const injectedJavaScript = `
    (function() {
      let lastUrl = window.location.href;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'LOG', message: 'Injected JS Started! Current URL: ' + lastUrl }));
      
      setInterval(function() {
        if (window.location.href !== lastUrl) {
          lastUrl = window.location.href;
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'NEW_URL_DETECTED', url: lastUrl }));
        }
      }, 500);
    })();
    true;
  `;

  const onMessage = async (event: any) => {
    try {
       const data = JSON.parse(event.nativeEvent.data);
       
       if (data.type === 'NEW_URL_DETECTED') {
         const url = data.url;
         DownloadEvents.emit('log', '>> New URL: ' + url);
         
         // Convert to lowercase for safer string matching
         const lowerUrl = url.toLowerCase();
         if (lowerUrl.includes('/reel/') || lowerUrl.includes('/reels/') || lowerUrl.includes('/p/')) {
            DownloadEvents.emit('log', '>> Valid Instagram Video/Photo URL detected!');
            try {
              await DownloadService.downloadReel(url);
            } catch (downloadError: any) {
              DownloadEvents.emit('log', '>> CRITICAL ERROR: ' + downloadError.message);
            }
         } else {
            DownloadEvents.emit('log', '>> URL skipped (Not a Reel/Post)');
         }
       } else if (data.type === 'LOG') {
         DownloadEvents.emit('log', '[WebView] ' + data.message);
       }
    } catch (e: any) {
       DownloadEvents.emit('log', 'System Parse Error: ' + e.message);
    }
  };

  const activeDownloads = Object.entries(progressFiles);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://www.instagram.com/reels/' }}
        injectedJavaScript={injectedJavaScript}
        onMessage={onMessage}
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1" // forces mobile view
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
      />
      
      {/* Overlay UI */}
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
  container: {
    flex: 1,
  },
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
    backgroundColor: '#007AFF', // iOS Blue
  },
});
