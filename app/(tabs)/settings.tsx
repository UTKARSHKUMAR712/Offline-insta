import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePalette } from '../../hooks/use-palette';
import { DownloadService, type LibraryStats } from '../../services/download';
import { getAutoScrollEnabled, setAutoScrollEnabled } from '../../services/autoScroll';
import { formatBytes } from '../../utils/format';

const EMPTY_STATS: LibraryStats = { count: 0, savedCount: 0, bytes: 0 };

export default function SettingsScreen() {
  const router = useRouter();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [autoDelete, setAutoDelete] = useState(false);
  const [pauseDownloads, setPauseDownloads] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const [stats, setStats] = useState<LibraryStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      const [adEnabled, pdEnabled, asEnabled] = await Promise.all([
        DownloadService.getAutoDeleteEnabled(),
        DownloadService.getDownloadsPaused(),
        getAutoScrollEnabled(),
      ]);
      setAutoDelete(adEnabled);
      setPauseDownloads(pdEnabled);
      setAutoScroll(asEnabled);
      setLoading(false);
    };
    loadSettings().catch(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      DownloadService.getLibraryStats()
        .then(next => {
          if (isActive) setStats(next);
        })
        .catch(() => {});
      return () => {
        isActive = false;
      };
    }, [])
  );

  const toggleAutoDelete = async (value: boolean) => {
    setAutoDelete(value);
    await DownloadService.setAutoDeleteEnabled(value);
  };

  const togglePauseDownloads = async (value: boolean) => {
    setPauseDownloads(value);
    await DownloadService.setDownloadsPaused(value);
  };

  const toggleAutoScroll = async (value: boolean) => {
    setAutoScroll(value);
    await setAutoScrollEnabled(value);
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.textMuted} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: palette.text }]}>Settings</Text>

        {/* Library summary */}
        <Pressable
          onPress={() => router.push('/explore')}
          accessibilityRole="button"
          accessibilityLabel="Open offline reels"
          style={[styles.storageCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
        >
          <View style={[styles.storageIcon, { backgroundColor: palette.surfaceAlt }]}>
            <Ionicons name="folder-open-outline" size={20} color={palette.accent} />
          </View>
          <View style={styles.storageText}>
            <Text style={[styles.storageTitle, { color: palette.text }]}>
              {formatBytes(stats.bytes)} used
            </Text>
            <Text style={[styles.storageMeta, { color: palette.textMuted }]}>
              {stats.count} {stats.count === 1 ? 'reel' : 'reels'} · {stats.savedCount} saved
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </Pressable>

        <SettingRow
          title="Auto-Delete Offline Reels"
          description="Delete reels automatically once you swipe past them in the offline feed. Saved reels are never deleted."
          value={autoDelete}
          onValueChange={toggleAutoDelete}
        />

        <SettingRow
          title="Pause Automatic Downloads"
          description="Reels you open in the Instagram browser stop downloading automatically. Links you paste into a downloader still work."
          value={pauseDownloads}
          onValueChange={togglePauseDownloads}
        />

        <SettingRow
          title="Auto-Scroll Reels"
          description="Advance to the next reel every 7–20 seconds in the Instagram browser, downloading each one on the way. Pauses while a download is running and stops if the feed does not move."
          value={autoScroll}
          onValueChange={toggleAutoScroll}
        />

        {/*
          The old "Log Out of Instagram" row is gone on purpose. It loaded
          /accounts/logout/ in a hidden WebView, which cannot clear cookies
          (Instagram needs a POST + CSRF token) and still claimed success.
          A real session clear needs the platform cookie store, which means a
          native module and a development build — so the feature is removed
          rather than lying to the user. See docs/ANALYSIS.md, item 16.
        */}
      </ScrollView>
    </View>
  );
}

function SettingRow({
  title,
  description,
  value,
  onValueChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.settingRow, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.textContainer}>
        <Text style={[styles.rowTitle, { color: palette.text }]}>{title}</Text>
        <Text style={[styles.description, { color: palette.textMuted }]}>{description}</Text>
      </View>
      <Switch
        trackColor={{ false: palette.surfaceAlt, true: palette.accent }}
        thumbColor="#f4f3f4"
        ios_backgroundColor={palette.surfaceAlt}
        onValueChange={onValueChange}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5, marginBottom: 20 },
  storageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  storageIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storageText: { flex: 1 },
  storageTitle: { fontSize: 16, fontWeight: '600' },
  storageMeta: { fontSize: 12, marginTop: 2 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    padding: 16,
    borderRadius: 16,
    marginTop: 12,
    gap: 12,
  },
  textContainer: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', marginBottom: 6 },
  description: { fontSize: 12, lineHeight: 17 },
});
