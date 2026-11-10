import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Dimensions,
  FlatList,
  LayoutChangeEvent,
  Linking,
  ListViewToken,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { usePalette } from '../../hooks/use-palette';
import { DownloadService, ReelData, DownloadEvents } from '../../services/download';
import { formatBytes, formatDate } from '../../utils/format';

const { width: windowWidth } = Dimensions.get('window');

const LAST_VIEWED_INDEX_KEY = '@last_viewed_reel_index';

type SortMode = 'newest' | 'oldest' | 'largest' | 'smallest';

const SORT_ORDER: SortMode[] = ['newest', 'oldest', 'largest', 'smallest'];

const SORT_LABEL: Record<SortMode, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  largest: 'Largest',
  smallest: 'Smallest',
};

export default function OfflineReelsFeed() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();

  const [reels, setReels] = useState<ReelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemHeight, setItemHeight] = useState(Dimensions.get('window').height - 80);
  const [autoDelete, setAutoDelete] = useState(false);
  // Items whose file was auto-deleted stay in the list (so the scroll position
  // doesn't jump) but render a placeholder instead of a dead VideoView.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');

  // Keep synchronous refs so the viewability callback never closes over stale values.
  const reelsRef = useRef<ReelData[]>(reels);

  // RN's ViewabilityHelper captures the callback at mount, so the auto-delete
  // toggle must be read from a ref instead of being a dependency.
  const autoDeleteRef = useRef(false);
  useEffect(() => { autoDeleteRef.current = autoDelete; }, [autoDelete]);

  // Track which reel is currently visible on screen
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const activeIndexRef = useRef(0);

  // Reference for the FlatList to jump to the saved position
  const flatListRef = useRef<FlatList>(null);

  // Ref to track if we've successfully scrolled to the initial index yet
  const hasInitializedScroll = useRef(false);

  const visibleReels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? reels.filter(reel =>
          [reel.author ?? '', reel.caption ?? '', reel.id]
            .some(field => field.toLowerCase().includes(needle))
        )
      : reels;

    const sorted = [...filtered];
    switch (sort) {
      case 'oldest':
        sorted.sort((a, b) => a.timestamp - b.timestamp);
        break;
      case 'largest':
        sorted.sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
        break;
      case 'smallest':
        sorted.sort((a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0));
        break;
      default:
        sorted.sort((a, b) => b.timestamp - a.timestamp);
    }
    return sorted;
  }, [reels, query, sort]);

  useEffect(() => { reelsRef.current = visibleReels; }, [visibleReels]);

  const libraryBytes = useMemo(
    () => reels.reduce((sum, reel) => sum + (reel.sizeBytes ?? 0), 0),
    [reels]
  );

  useEffect(() => {
    const handleToggleSave = (data: { id: string; isSaved: boolean }) => {
      setReels(prevReels =>
        prevReels.map(r => (r.id === data.id ? { ...r, isSaved: data.isSaved } : r))
      );
    };
    const handleDeleted = (postId: string) => {
      setDeletedIds(prev => {
        if (prev.has(postId)) return prev;
        const next = new Set(prev);
        next.add(postId);
        return next;
      });
    };
    DownloadEvents.on('toggleSave', handleToggleSave);
    DownloadEvents.on('delete', handleDeleted);
    return () => {
      DownloadEvents.off('toggleSave', handleToggleSave);
      DownloadEvents.off('delete', handleDeleted);
    };
  }, []);

  // Load the downloaded videos from storage when this tab is focused
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadReels = async () => {
        try {
          const [downloadedReels, autoDelEnabled, savedIndexStr] = await Promise.all([
            DownloadService.getDownloadedReels(),
            DownloadService.getAutoDeleteEnabled(),
            AsyncStorage.getItem(LAST_VIEWED_INDEX_KEY),
          ]);
          if (!isActive) return;

          setReels(downloadedReels);
          setAutoDelete(autoDelEnabled);
          autoDeleteRef.current = autoDelEnabled;
          setDeletedIds(new Set());

          // Restore the last position, clamped to the current list.
          const savedIndex = savedIndexStr ? parseInt(savedIndexStr, 10) : 0;
          const startIndex = Number.isFinite(savedIndex)
            ? Math.max(0, Math.min(savedIndex, downloadedReels.length - 1))
            : 0;
          setActiveVideoIndex(startIndex);
          activeIndexRef.current = startIndex;

          setLoading(false);
        } catch (e) {
          console.error('Error loading offline reels:', e);
          if (isActive) setLoading(false);
        }
      };

      // Every return to the feed starts a fresh list, so allow one restore.
      hasInitializedScroll.current = false;
      loadReels();

      return () => {
        isActive = false;
        // Save the position we are actually on, not the first render's value.
        AsyncStorage.setItem(LAST_VIEWED_INDEX_KEY, activeIndexRef.current.toString()).catch(() => {});
      };
    }, [])
  );

  // Check what video is currently visible on screen to pause/play them
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    if (viewableItems.length === 0) return;

    const newActiveIndex = viewableItems[0].index ?? 0;
    const previousIndex = activeIndexRef.current;
    activeIndexRef.current = newActiveIndex;
    setActiveVideoIndex(newActiveIndex);

    // Auto-delete: once the user has moved forward, reclaim the reel they left.
    if (autoDeleteRef.current && newActiveIndex > previousIndex) {
      const reelToMaybeDelete = reelsRef.current[previousIndex];
      if (reelToMaybeDelete && !reelToMaybeDelete.isSaved) {
        DownloadService.deleteReel(reelToMaybeDelete.id).catch(() => {});
      }
    }

    // Save this position to persistence storage immediately
    AsyncStorage.setItem(LAST_VIEWED_INDEX_KEY, newActiveIndex.toString()).catch(() => {});
  }, []);

  // Stable object for FlatList; useMemo keeps it identity-stable without
  // reading a ref during render.
  const viewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 50 }), // 'active' at 50% visibility
    []
  );

  const onContainerLayout = (event: LayoutChangeEvent) => {
    // Get the exact height of the viewable area (which excludes the bottom tabs)
    const { height } = event.nativeEvent.layout;
    if (height > 0) {
      setItemHeight(height);
    }
  };

  // Once the data has loaded and the list is rendered, scroll to the saved position
  const onLayoutScroll = () => {
    if (hasInitializedScroll.current) return;
    hasInitializedScroll.current = true;

    const index = activeIndexRef.current;
    if (reels.length === 0 || index <= 0) return;

    // Timeout ensures the list has had a frame to measure items
    setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index, animated: false });
    }, 100);
  };

  // A new filter or sort order means the old position is meaningless.
  const didMount = useRef(true);
  useEffect(() => {
    if (didMount.current) {
      didMount.current = false;
      return;
    }
    activeIndexRef.current = 0;
    setActiveVideoIndex(0);
    hasInitializedScroll.current = true;
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [query, sort]);

  const handleDeleteReel = (id: string) => {
    setReels(prev => prev.filter(r => r.id !== id));
  };

  const cycleSort = () => {
    const next = SORT_ORDER[(SORT_ORDER.indexOf(sort) + 1) % SORT_ORDER.length];
    setSort(next);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };

  if (loading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: palette.background }]}>
        <Text style={[styles.emptyText, { color: palette.text }]}>Loading downloaded reels…</Text>
      </View>
    );
  }

  if (reels.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: palette.background }]}>
        <Ionicons name="videocam-off-outline" size={44} color={palette.textMuted} />
        <Text style={[styles.emptyText, { color: palette.text }]}>No offline reels yet</Text>
        <Text style={[styles.subText, { color: palette.textMuted }]}>
          Open a reel in the Instagram browser and it will download automatically.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]} onLayout={onContainerLayout}>
      <FlatList
        ref={flatListRef}
        data={visibleReels}
        // Unique keys via id + index to prevent crashes from duplicated IDs in local storage
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={({ item, index }) => (
          <ReelItem
            item={item}
            isActive={index === activeVideoIndex}
            isDeleted={deletedIds.has(item.id)}
            itemHeight={itemHeight}
            onDelete={handleDeleteReel}
          />
        )}
        pagingEnabled // Enforces snapping to item boundaries (TikTok style)
        horizontal={false}
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={1}
        removeClippedSubviews={true}
        keyboardShouldPersistTaps="handled"
        getItemLayout={(data, index) => ({
          length: itemHeight,
          offset: itemHeight * index,
          index,
        })}
        onScrollToIndexFailed={info => {
          // getItemLayout should make this impossible, but never leave a blank feed.
          flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        }}
        onLayout={onLayoutScroll}
        ListEmptyComponent={
          <View style={[styles.centerContainer, { height: itemHeight, backgroundColor: palette.background }]}>
            <Text style={[styles.emptyText, { color: palette.text }]}>No matches</Text>
            <Text style={[styles.subText, { color: palette.textMuted }]}>
              Nothing matches “{query.trim()}”.
            </Text>
            <Pressable onPress={closeSearch} style={{ marginTop: 16 }}>
              <Text style={{ color: palette.accent, fontWeight: '600' }}>Clear search</Text>
            </Pressable>
          </View>
        }
      />

      {/* Feed controls: search, sort, storage usage */}
      <View style={[styles.toolbar, { top: insets.top + 8 }]} pointerEvents="box-none">
        {searchOpen ? (
          <View style={[styles.searchBar, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Ionicons name="search" size={16} color={palette.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: palette.text }]}
              value={query}
              onChangeText={setQuery}
              placeholder="Search author, caption or id"
              placeholderTextColor={palette.textMuted}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            <Pressable onPress={closeSearch} hitSlop={10} accessibilityLabel="Close search">
              <Ionicons name="close-circle" size={18} color={palette.textMuted} />
            </Pressable>
          </View>
        ) : (
          <>
            <Pressable
              onPress={() => setSearchOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Search offline reels"
              style={[styles.controlButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
            >
              <Ionicons name="search" size={18} color={palette.text} />
            </Pressable>

            <Pressable
              onPress={cycleSort}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${SORT_LABEL[sort]}. Tap to change.`}
              style={[styles.sortChip, { backgroundColor: palette.surface, borderColor: palette.border }]}
            >
              <Ionicons name="swap-vertical" size={14} color={palette.textMuted} />
              <Text style={[styles.sortText, { color: palette.text }]}>{SORT_LABEL[sort]}</Text>
            </Pressable>

            <View style={[styles.storagePill, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <Text style={[styles.storageText, { color: palette.textMuted }]}>
                {visibleReels.length}/{reels.length} · {formatBytes(libraryBytes)}
              </Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

// ── expo-video based ReelItem ──────────────────────────────────────────────
const ReelItem = React.memo(function ReelItem({ item, isActive, isDeleted, itemHeight, onDelete }: {
  item: ReelData;
  isActive: boolean;
  isDeleted: boolean;
  itemHeight: number;
  onDelete: (id: string) => void;
}) {
  const palette = usePalette();
  const [isSavedLocally, setIsSavedLocally] = useState<boolean>(item.isSaved || false);
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);

  // expo-video player — created once per item
  const player = useVideoPlayer(item.localUri, p => {
    p.loop = true;
    p.muted = false;
    p.volume = 1;
  });

  // Play/pause when visibility changes. A deleted reel has no file to play.
  useEffect(() => {
    if (isDeleted) {
      player.pause();
      return;
    }
    if (isActive && !isPaused) {
      player.play();
    } else {
      player.pause();
      if (!isActive) player.currentTime = 0;
    }
  }, [isActive, isDeleted, isPaused, player]);

  // Coming back to a reel in the feed starts it playing again, controls hidden.
  // Adjusted during render (the React pattern) instead of in an effect, which
  // would paint one extra frame with the stale controls.
  const [wasActive, setWasActive] = useState(isActive);
  if (wasActive !== isActive) {
    setWasActive(isActive);
    if (!isActive) {
      setIsPaused(false);
      setShowControls(false);
    }
  }

  // Leaving the tab (or this screen) must stop the audio: the feed stays mounted
  // behind the other tabs, so nothing else would ever pause it.
  useFocusEffect(
    useCallback(() => {
      if (isActive && !isPaused && !isDeleted) player.play();
      return () => {
        player.pause();
      };
    }, [isActive, isPaused, isDeleted, player])
  );

  // Handle app backgrounding
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (isDeleted) return;
      if (state === 'active' && isActive) player.play();
      else player.pause();
    });
    return () => sub.remove();
  }, [isActive, isDeleted, player]);

  // Mute toggle
  useEffect(() => {
    player.muted = isMuted;
  }, [isMuted, player]);

  // Controls stay hidden until tapped: a middle tap pauses and reveals the play
  // badge with the mute toggle above it, a second tap plays and hides them.
  const togglePlayPause = () => {
    const next = !isPaused;
    setIsPaused(next);
    setShowControls(next);
    if (next) player.pause();
    else player.play();
  };

  const toggleMute = () => {
    setIsMuted(m => !m);
    setShowControls(true);
  };

  const handleToggleSave = async () => {
    const updated = await DownloadService.toggleSaveReel(item.id);
    if (updated) setIsSavedLocally(updated.isSaved || false);
  };

  const handleDelete = () => {
    Alert.alert('Delete Reel', 'Are you sure you want to delete this reel?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const ok = await DownloadService.deleteReel(item.id);
          if (ok) onDelete(item.id);
          else Alert.alert('Error', 'Failed to delete reel.');
        },
      },
    ]);
  };

  // Real gallery save: writes the file into the device photo library.
  const handleSaveToGallery = async () => {
    try {
      // Write-only: saving a file needs no read access, and asking for the full
      // set makes Android demand the audio permission this app never declared.
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        Alert.alert(
          'Permission needed',
          'Allow access to save reels to your gallery.'
        );
        return;
      }
      await MediaLibrary.Asset.create(item.localUri);
      Alert.alert('Saved to gallery', 'The reel is now in your photo library.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Unknown error while saving to the gallery.');
    }
  };

  const handleShare = () => {
    Alert.alert('Share reel', item.originalUrl, [
      {
        text: 'Copy link',
        onPress: async () => {
          await Clipboard.setStringAsync(item.originalUrl);
          Alert.alert('Link copied');
        },
      },
      {
        text: 'Open in Instagram',
        onPress: () => {
          Linking.openURL(item.originalUrl).catch(() =>
            Alert.alert('Could not open Instagram')
          );
        },
      },
      {
        text: 'Share video file',
        onPress: async () => {
          try {
            if (!(await Sharing.isAvailableAsync())) {
              Alert.alert('Sharing not available on this device');
              return;
            }
            await Sharing.shareAsync(item.localUri, {
              mimeType: 'video/mp4',
              dialogTitle: 'Share reel',
              UTI: 'public.movie',
            });
          } catch (e: any) {
            Alert.alert('Could not share', e?.message ?? 'Unknown error');
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (isDeleted) {
    return (
      <View style={[styles.reelContainer, { height: itemHeight }]}>
        <Ionicons name="trash-outline" size={64} color="#444" />
        <Text style={styles.deletedText}>This reel was auto-deleted to save space.</Text>
      </View>
    );
  }

  const author = item.author ? `@${item.author}` : item.id;
  const initial = (item.author || item.id).replace(/^@/, '').charAt(0).toUpperCase();
  const caption = item.caption?.trim() ?? '';
  // Only offer "more" for captions that cannot fit the two lines on show.
  const canExpand = caption.length > 110 || caption.split('\n').length > 2;

  return (
    <View style={[styles.reelContainer, { height: itemHeight }]}>
      {/* The native video surface swallows touches on Android, so it sits below
          a transparent tap layer instead of inside the Pressable. */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        pointerEvents="none"
      />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={togglePlayPause}
        accessibilityRole="button"
        accessibilityLabel={isPaused ? 'Play reel' : 'Pause reel'}
      />

      {/* Hidden until the reel is paused; the mute circle then sits above the
          play badge, clear of dead centre so the middle stays a play/pause tap. */}
      {showControls && (
        <View style={styles.centerControls} pointerEvents="box-none">
          <Pressable
            onPress={toggleMute}
            style={[styles.circleButton, styles.mutePosition]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? 'Unmute reel' : 'Mute reel'}
          >
            <Ionicons name={isMuted ? 'volume-mute' : 'volume-high'} size={18} color="white" />
          </Pressable>
          <Pressable
            onPress={togglePlayPause}
            style={[styles.playButton, styles.playPosition]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={isPaused ? 'Play reel' : 'Pause reel'}
          >
            <Ionicons
              name={isPaused ? 'play' : 'pause'}
              size={34}
              color="white"
              style={isPaused ? styles.playIcon : undefined}
            />
          </Pressable>
        </View>
      )}

      <View style={styles.bottomOverlay} pointerEvents="box-none">
        <View style={styles.authorRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.authorText} numberOfLines={1}>{author}</Text>
        </View>
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
          {formatDate(item.timestamp)} · {formatBytes(item.sizeBytes)}
          {item.isSaved ? ' · Saved' : ''}
        </Text>
      </View>

      <View style={styles.rightActionsRow}>
        <Pressable
          style={styles.actionItem}
          onPress={handleToggleSave}
          accessibilityRole="button"
          accessibilityLabel={isSavedLocally ? 'Remove from saved' : 'Save reel'}
        >
          <Ionicons
            name={isSavedLocally ? 'bookmark' : 'bookmark-outline'}
            size={30}
            color={isSavedLocally ? palette.gold : 'white'}
          />
          <Text style={[styles.actionText, isSavedLocally && { color: palette.gold }]}>
            {isSavedLocally ? 'Saved' : 'Save'}
          </Text>
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
          onPress={handleShare}
          accessibilityRole="button"
          accessibilityLabel="Share or copy reel link"
        >
          <Ionicons name="share-social-outline" size={30} color="white" />
          <Text style={styles.actionText}>Share</Text>
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
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 12,
  },
  subText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  toolbar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 50,
  },
  controlButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortChip: {
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sortText: {
    fontSize: 12,
    fontWeight: '600',
  },
  storagePill: {
    marginLeft: 'auto',
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storageText: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  searchBar: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  reelContainer: {
    width: windowWidth,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  centerControls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  mutePosition: {
    position: 'absolute',
    top: '34%',
  },
  playPosition: {
    position: 'absolute',
    top: '50%',
    marginTop: -33,
  },
  circleButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    // The triangle looks off-centre without a nudge to the right.
    marginLeft: 4,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 84,
    padding: 15,
    paddingBottom: 25,
    backgroundColor: 'rgba(0,0,0,0.35)', // Fades text into view
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '700',
  },
  authorText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  captionText: {
    color: 'white',
    fontSize: 14,
    lineHeight: 19,
  },
  moreText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  metaText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
  },
  rightActionsRow: {
    position: 'absolute',
    bottom: 24,
    right: 12,
    alignItems: 'center',
  },
  actionItem: {
    alignItems: 'center',
    marginBottom: 18,
  },
  actionText: {
    color: 'white',
    fontSize: 12,
    marginTop: 6,
  },
  deletedText: {
    color: '#888',
    fontSize: 14,
    marginTop: 15,
  },
});
