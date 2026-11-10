import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Dimensions,
  FlatList,
  LayoutChangeEvent,
  ListViewToken,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as MediaLibrary from 'expo-media-library';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePalette } from '../../hooks/use-palette';
import { DownloadService, ReelData } from '../../services/download';
import { formatBytes, formatDate } from '../../utils/format';

const { width: windowWidth } = Dimensions.get('window');

export default function SavedReelsFeed() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [reels, setReels] = useState<ReelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemHeight, setItemHeight] = useState(Dimensions.get('window').height);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      const load = async () => {
        try {
          const all = await DownloadService.getDownloadedReels();
          if (isActive) {
            setReels(all.filter(r => r.isSaved));
            setLoading(false);
          }
        } catch {
          if (isActive) setLoading(false);
        }
      };
      load();
      return () => { isActive = false; };
    }, [])
  );

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    if (viewableItems.length > 0) setActiveVideoIndex(viewableItems[0].index || 0);
  }, []);

  // Stable object for FlatList; useMemo keeps it identity-stable without
  // reading a ref during render.
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 50 }), []);

  const onContainerLayout = (e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    if (height > 0) setItemHeight(height);
  };

  const libraryBytes = useMemo(
    () => reels.reduce((sum, reel) => sum + (reel.sizeBytes ?? 0), 0),
    [reels]
  );

  const handleDelete = (id: string) => setReels(prev => prev.filter(r => r.id !== id));

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Text style={[styles.emptyText, { color: palette.text }]}>Loading…</Text>
      </View>
    );
  }

  if (reels.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Ionicons name="bookmark-outline" size={44} color={palette.textMuted} />
        <Text style={[styles.emptyText, { color: palette.text }]}>No saved reels</Text>
        <Text style={[styles.subText, { color: palette.textMuted }]}>
          Tap Save on a reel in the offline feed to keep it forever — saved reels are never
          auto-deleted.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]} onLayout={onContainerLayout}>
      <FlatList
        ref={flatListRef}
        data={reels}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={({ item, index }) => (
          <SavedReelItem
            item={item}
            isActive={index === activeVideoIndex}
            itemHeight={itemHeight}
            onDelete={handleDelete}
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={1}
        removeClippedSubviews={true}
        getItemLayout={(_, index) => ({ length: itemHeight, offset: itemHeight * index, index })}
        onScrollToIndexFailed={info =>
          flatListRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: false,
          })
        }
      />

      <View style={[styles.header, { top: insets.top + 8 }]} pointerEvents="none">
        <View style={[styles.headerPill, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Ionicons name="bookmark" size={14} color={palette.gold} />
          <Text style={[styles.headerText, { color: palette.text }]}>
            {reels.length} saved · {formatBytes(libraryBytes)}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── expo-video based SavedReelItem ───────────────────────────────────────────
const SavedReelItem = React.memo(function SavedReelItem({ item, isActive, itemHeight, onDelete }: {
  item: ReelData; isActive: boolean; itemHeight: number; onDelete: (id: string) => void;
}) {
  const palette = usePalette();
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);

  const player = useVideoPlayer(item.localUri, p => {
    p.loop = true;
    p.muted = false;
    p.volume = 1;
  });

  useEffect(() => {
    if (isActive && !isPaused) player.play();
    else { player.pause(); if (!isActive) player.currentTime = 0; }
  }, [isActive, isPaused, player]);

  // Switching tabs must silence the reel: this screen stays mounted behind them.
  useFocusEffect(
    useCallback(() => {
      if (isActive && !isPaused) player.play();
      return () => {
        player.pause();
      };
    }, [isActive, isPaused, player])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && isActive) player.play();
      else player.pause();
    });
    return () => sub.remove();
  }, [isActive, player]);

  useEffect(() => { player.muted = isMuted; }, [isMuted, player]);

  const togglePlayPause = () => {
    const next = !isPaused;
    setIsPaused(next);
    if (next) player.pause();
    else player.play();
  };

  const handleUnsave = async () => {
    await DownloadService.toggleSaveReel(item.id);
    onDelete(item.id);
  };

  const handleDelete = () => {
    Alert.alert('Delete Reel', 'Delete this reel permanently?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const ok = await DownloadService.deleteReel(item.id);
          if (ok) onDelete(item.id);
        },
      },
    ]);
  };

  const handleSaveToGallery = async () => {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to save reels to your gallery.');
        return;
      }
      await MediaLibrary.Asset.create(item.localUri);
      Alert.alert('Saved to gallery', 'The reel is now in your photo library.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Unknown error while saving to the gallery.');
    }
  };

  const caption = item.caption?.trim() ?? '';
  const canExpand = caption.length > 110 || caption.split('\n').length > 2;

  return (
    <View style={[styles.reelContainer, { height: itemHeight }]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={togglePlayPause}
        accessibilityLabel="Play or pause reel"
      >
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
        />
      </Pressable>

      {/* Mute above the play button, clear of dead centre so a tap in the
          middle still plays/pauses instead of muting. */}
      <View style={styles.centerControls} pointerEvents="box-none">
        <Pressable
          onPress={() => setIsMuted(m => !m)}
          style={[styles.circleButton, styles.mutePosition]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute reel' : 'Mute reel'}
        >
          <Ionicons name={isMuted ? 'volume-mute' : 'volume-high'} size={18} color="white" />
        </Pressable>
        {isPaused && (
          <Pressable
            onPress={togglePlayPause}
            style={[styles.playButton, styles.playPosition]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Play reel"
          >
            <Ionicons name="play" size={34} color="white" style={styles.playIcon} />
          </Pressable>
        )}
      </View>

      <View style={styles.bottomOverlay} pointerEvents="box-none">
        <Text style={styles.titleText} numberOfLines={1}>
          {item.author ? `@${item.author}` : item.id}
        </Text>
        {!!caption && (
          <Pressable onPress={() => setCaptionExpanded(v => !v)} disabled={!canExpand}>
            <Text style={styles.captionText} numberOfLines={captionExpanded ? undefined : 2}>
              {caption}
            </Text>
            {canExpand && (
              <Text style={styles.moreText}>{captionExpanded ? 'less' : 'more'}</Text>
            )}
          </Pressable>
        )}
        <Text style={styles.metaText}>
          Saved {formatDate(item.timestamp)} · {formatBytes(item.sizeBytes)}
        </Text>
      </View>
      <View style={styles.rightActionsRow}>
        <Pressable
          style={styles.actionItem}
          onPress={handleUnsave}
          accessibilityRole="button"
          accessibilityLabel="Remove from saved"
        >
          <Ionicons name="bookmark" size={30} color={palette.gold} />
          <Text style={[styles.actionText, { color: palette.gold }]}>Saved</Text>
        </Pressable>
        <Pressable
          style={styles.actionItem}
          onPress={handleSaveToGallery}
          accessibilityRole="button"
          accessibilityLabel="Save reel to gallery"
        >
          <Ionicons name="download-outline" size={30} color="white" />
          <Text style={styles.actionText}>Gallery</Text>
        </Pressable>
        <Pressable
          style={styles.actionItem}
          onPress={handleDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete reel"
        >
          <Ionicons name="trash-outline" size={30} color="#ff4444" />
          <Text style={[styles.actionText, { color: '#ff4444' }]}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontSize: 18, fontWeight: 'bold', marginTop: 12 },
  subText: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  reelContainer: { width: windowWidth, backgroundColor: 'black', overflow: 'hidden' },
  centerControls: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
  },
  mutePosition: { position: 'absolute', top: '34%' },
  playPosition: { position: 'absolute', top: '50%', marginTop: -33 },
  circleButton: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  playButton: {
    width: 66, height: 66, borderRadius: 33,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  // The triangle looks off-centre without a nudge to the right.
  playIcon: { marginLeft: 4 },
  header: {
    position: 'absolute',
    left: 12,
    right: 12,
    alignItems: 'flex-start',
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    height: 28,
  },
  headerText: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  bottomOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 90,
    padding: 15, paddingBottom: 25, backgroundColor: 'rgba(0,0,0,0.3)',
  },
  titleText: { color: 'white', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  captionText: { color: 'white', fontSize: 14, lineHeight: 19 },
  moreText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '600', marginTop: 2 },
  metaText: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  rightActionsRow: { position: 'absolute', bottom: 24, right: 12, alignItems: 'center' },
  actionItem: { alignItems: 'center', marginBottom: 18 },
  actionText: { color: 'white', fontSize: 12, marginTop: 6 },
});
