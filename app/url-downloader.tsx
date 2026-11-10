import { StyleSheet, View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, Keyboard, Alert } from 'react-native';
import { useState } from 'react';
import { DownloadService, DownloadEvents } from '../services/download';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { describeApiError, extractVideoUrl, parseInstagramUrl } from '../services/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '../hooks/use-palette';

export default function UrlDownloaderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
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

    if (!parseInstagramUrl(trimmedUrl)) {
      DownloadEvents.emit('log', '>> Invalid URL (not an Instagram reel/post)');
      Alert.alert('Invalid link', 'Paste an Instagram reel or post link, for example https://www.instagram.com/reel/…');
      return;
    }

    setIsFetchingPreview(true);
    setPreviewUrl(null);
    DownloadEvents.emit('log', '>> Fetching preview...');

    try {
      const { videoUrl } = await extractVideoUrl(trimmedUrl);
      setPreviewUrl(videoUrl);
      DownloadEvents.emit('log', '>> Preview ready');
    } catch (e: any) {
      const message = describeApiError(e);
      DownloadEvents.emit('log', '>> Preview Error: ' + message);
      Alert.alert('Preview unavailable', message);
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
      // Resolves only once the file is actually on disk.
      await DownloadService.downloadReel(trimmedUrl, { source: 'manual' });
    } catch (e: any) {
      Alert.alert('Download failed', describeApiError(e));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: palette.border }]}>
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
