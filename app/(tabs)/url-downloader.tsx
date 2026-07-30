import { StyleSheet, View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { useState, useEffect } from 'react';
import { DownloadService, DownloadEvents } from '../../services/download';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ConfigManager } from '../../services/ConfigManager';
import { DownloadProgressOverlay } from '../../components/DownloadProgressOverlay';

export default function UrlDownloaderScreen() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // We initialize the player unconditionally, but with a null-ish source or replace it when previewUrl changes
  const player = useVideoPlayer(previewUrl, p => {
    if (p) {
      p.loop = true;
      p.muted = false;
      p.play();
    }
  });

  const handlePreview = async () => {
    Keyboard.dismiss();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    if (!trimmedUrl.toLowerCase().includes('instagram.com')) {
      DownloadEvents.emit('log', '>> Invalid URL (not Instagram)');
      return;
    }

    setIsFetchingPreview(true);
    setPreviewUrl(null);
    DownloadEvents.emit('log', '>> Fetching preview...');
    
    try {
      const apiUrl = await ConfigManager.getApiUrl();
      const response = await fetch(`${apiUrl}?url=${encodeURIComponent(trimmedUrl)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      
      const videoUrl = data?.data?.videoUrl;
      if (videoUrl) {
        setPreviewUrl(videoUrl);
        DownloadEvents.emit('log', '>> Preview ready');
      } else {
        throw new Error('No video URL found');
      }
    } catch (e: any) {
      DownloadEvents.emit('log', '>> Preview Error: ' + e.message);
    } finally {
      setIsFetchingPreview(false);
    }
  };

  const handleDownload = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    
    setIsDownloading(true);
    DownloadEvents.emit('log', '>> Starting manual download...');
    
    try {
      await DownloadService.downloadReel(trimmedUrl);
      // setUrl(''); // Keep URL around so preview doesn't disappear immediately
    } catch (e: any) {
      DownloadEvents.emit('log', '>> Error: ' + e.message);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>URL Reel Downloader</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.label}>Paste Instagram Reel URL below:</Text>
        <TextInput
          style={styles.input}
          placeholder="https://www.instagram.com/reel/..."
          placeholderTextColor="#666"
          value={url}
          onChangeText={(text) => {
            setUrl(text);
            setPreviewUrl(null); // reset preview on URL change
          }}
          autoCorrect={false}
          autoCapitalize="none"
          keyboardType="url"
        />

        <Pressable 
          style={[styles.downloadBtn, (!url.trim() || isFetchingPreview) && styles.downloadBtnDisabled]} 
          onPress={handlePreview} 
          disabled={!url.trim() || isFetchingPreview}
        >
          <Text style={styles.downloadText}>
            {isFetchingPreview ? 'Fetching Preview...' : 'Preview Reel'}
          </Text>
        </Pressable>

        {previewUrl && (
          <View style={styles.previewContainer}>
            <VideoView
              player={player}
              style={styles.video}
              contentFit="contain"
              nativeControls
            />
            <Pressable 
              style={[styles.downloadBtn, { marginTop: 16, backgroundColor: '#28a745', width: '100%' }]} 
              onPress={handleDownload} 
              disabled={isDownloading}
            >
              <Text style={styles.downloadText}>
                {isDownloading ? 'Saving to Device...' : 'Download / Save Reel'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Extracted isolated overlay that handles its own re-renders on progress ticks */}
      <DownloadProgressOverlay />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  backBtn: {
    paddingRight: 15,
  },
  backText: {
    color: '#0095f6',
    fontSize: 16,
  },
  title: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  content: {
    padding: 24,
    flex: 1,
  },
  label: {
    color: 'white',
    fontSize: 16,
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: 'white',
    fontSize: 15,
    marginBottom: 24,
  },
  downloadBtn: {
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#0095f6',
    alignItems: 'center',
  },
  downloadBtnDisabled: {
    opacity: 0.5,
  },
  downloadText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  previewContainer: {
    marginTop: 24,
    alignItems: 'center',
    width: '100%',
  },
  video: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 400,
    backgroundColor: '#000',
    borderRadius: 12,
  },
});
