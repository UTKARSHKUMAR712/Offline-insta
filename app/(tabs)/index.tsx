import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePalette } from '@/hooks/use-palette';
import { DownloadService, type LibraryStats, type ReelData } from '@/services/download';
import { formatBytes, formatDate } from '@/utils/format';

const EMPTY_STATS: LibraryStats = { count: 0, savedCount: 0, bytes: 0 };

export default function HomeScreen() {
  const router = useRouter();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<LibraryStats>(EMPTY_STATS);
  const [recent, setRecent] = useState<ReelData[]>([]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      (async () => {
        const [libraryStats, reels] = await Promise.all([
          DownloadService.getLibraryStats(),
          DownloadService.getDownloadedReels(),
        ]);
        if (!isActive) return;
        setStats(libraryStats);
        setRecent(reels.slice(0, 3));
      })().catch(() => {});
      return () => {
        isActive = false;
      };
    }, [])
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: palette.text }]}>SuperInsta</Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Watch Instagram reels offline, without the feed.
        </Text>

        <Pressable
          onPress={() => router.push('/insta')}
          accessibilityRole="button"
          accessibilityLabel="Browse Instagram and download reels"
          style={({ pressed }) => [
            styles.primaryCard,
            { backgroundColor: palette.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <View style={styles.primaryText}>
            <Text style={[styles.primaryTitle, { color: palette.onAccent }]}>Browse Instagram</Text>
            <Text style={[styles.primarySub, { color: palette.onAccent }]}>
              Open a reel and it saves automatically
            </Text>
          </View>
          <Ionicons name="logo-instagram" size={34} color={palette.onAccent} />
        </Pressable>

        <View style={styles.secondaryRow}>
          <Pressable
            onPress={() => router.push('/url-downloader')}
            accessibilityRole="button"
            accessibilityLabel="Paste a reel link to download it"
            style={({ pressed }) => [
              styles.secondaryCard,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons name="link-outline" size={24} color={palette.accent} />
            <Text style={[styles.secondaryTitle, { color: palette.text }]}>Paste a link</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/explore')}
            accessibilityRole="button"
            accessibilityLabel="Open the offline reels feed"
            style={({ pressed }) => [
              styles.secondaryCard,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons name="play-circle-outline" size={24} color={palette.accent} />
            <Text style={[styles.secondaryTitle, { color: palette.text }]}>Watch offline</Text>
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <Stat label="Downloaded" value={String(stats.count)} palette={palette} />
          <Stat label="Saved" value={String(stats.savedCount)} palette={palette} />
          <Stat label="Storage" value={formatBytes(stats.bytes)} palette={palette} />
        </View>

        <Text style={[styles.sectionTitle, { color: palette.text }]}>Latest downloads</Text>
        {recent.length === 0 ? (
          <Text style={[styles.emptyText, { color: palette.textMuted }]}>
            Nothing here yet. Open a reel in the Instagram browser and it will appear here.
          </Text>
        ) : (
          <View style={[styles.recentList, { borderColor: palette.border }]}>
            {recent.map((reel, index) => (
              <Pressable
                key={reel.id}
                onPress={() => router.push('/explore')}
                accessibilityRole="button"
                accessibilityLabel={`Open offline reel ${reel.author ?? reel.id}`}
                style={[
                  styles.recentRow,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
                ]}
              >
                <View style={[styles.recentIcon, { backgroundColor: palette.surfaceAlt }]}>
                  <Ionicons name="videocam" size={18} color={palette.textMuted} />
                </View>
                <View style={styles.recentText}>
                  <Text style={[styles.recentTitle, { color: palette.text }]} numberOfLines={1}>
                    {reel.author ? `@${reel.author}` : reel.id}
                  </Text>
                  <Text style={[styles.recentMeta, { color: palette.textMuted }]} numberOfLines={1}>
                    {formatDate(reel.timestamp)} · {formatBytes(reel.sizeBytes)}
                  </Text>
                </View>
                {reel.isSaved && <Ionicons name="bookmark" size={16} color={palette.gold} />}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({
  label,
  value,
  palette,
}: {
  label: string;
  value: string;
  palette: ReturnType<typeof usePalette>;
}) {
  return (
    <View style={[styles.statCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.statValue, { color: palette.text }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: palette.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 6,
    marginBottom: 28,
  },
  primaryCard: {
    borderRadius: 18,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  primaryText: {
    flex: 1,
    paddingRight: 12,
  },
  primaryTitle: {
    fontSize: 19,
    fontWeight: '700',
  },
  primarySub: {
    fontSize: 13,
    marginTop: 4,
    opacity: 0.9,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  secondaryCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  secondaryTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 32,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
  },
  recentList: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  recentIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentText: {
    flex: 1,
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  recentMeta: {
    fontSize: 12,
    marginTop: 2,
  },
});
