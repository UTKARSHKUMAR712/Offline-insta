import React, { useState, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, Dimensions, ViewToken, AppState, LayoutChangeEvent, Pressable, Alert } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DownloadService, ReelData } from '../../services/download';

const { width: windowWidth } = Dimensions.get('window');

export default function SavedReelsFeed() {
  const router = useRouter();
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

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0) setActiveVideoIndex(viewableItems[0].index || 0);
  }, []);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onContainerLayout = (e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    if (height > 0) setItemHeight(height);
  };

  const handleDelete = (id: string) => setReels(prev => prev.filter(r => r.id !== id));

  if (loading) return (
    <View style={styles.center}><Text style={styles.emptyText}>Loading...</Text></View>
  );

  if (reels.length === 0) return (
    <View style={styles.center}>
      <Pressable style={styles.backBtn} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={24} color="white" />
      </Pressable>
      <Text style={styles.emptyText}>No Saved Reels.</Text>
      <Text style={styles.subText}>Save your favourite offline reels so they never get auto-deleted!</Text>
    </View>
  );

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      <Pressable style={styles.backBtn} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={24} color="white" />
      </Pressable>
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
      />
    </View>
  );
}

// ── expo-video based SavedReelItem ───────────────────────────────────────────
const SavedReelItem = React.memo(({ item, isActive, itemHeight, onDelete }: {
  item: ReelData; isActive: boolean; itemHeight: number; onDelete: (id: string) => void;
}) => {
  const [isMuted, setIsMuted] = useState(false);

  const player = useVideoPlayer(item.localUri, p => {
    p.loop = true;
    p.muted = false;
    p.volume = 1;
  });

  useEffect(() => {
    if (isActive) player.play();
    else { player.pause(); player.currentTime = 0; }
  }, [isActive, player]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && isActive) player.play();
      else player.pause();
    });
    return () => sub.remove();
  }, [isActive, player]);

  useEffect(() => { player.muted = isMuted; }, [isMuted, player]);

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

  return (
    <Pressable style={[styles.reelContainer, { height: itemHeight }]} onPress={() => setIsMuted(m => !m)}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      {isMuted && (
        <View style={styles.muteIndicator}>
          <Ionicons name="volume-mute" size={28} color="rgba(255,255,255,0.8)" />
        </View>
      )}
      <View style={styles.bottomOverlay}>
        <Text style={styles.captionText}>Saved on: {new Date(item.timestamp).toLocaleDateString()}</Text>
      </View>
      <View style={styles.rightActionsRow}>
        <Pressable style={styles.actionItem} onPress={handleUnsave}>
          <Ionicons name="bookmark" size={30} color="#FFD700" />
          <Text style={[styles.actionText, { color: '#FFD700' }]}>Saved</Text>
        </Pressable>
        <Pressable style={styles.actionItem} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={30} color="#ff4444" />
          <Text style={[styles.actionText, { color: '#ff4444' }]}>Delete</Text>
        </Pressable>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111', padding: 20 },
  emptyText: { color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
  subText: { color: '#888', fontSize: 14, textAlign: 'center' },
  reelContainer: { width: windowWidth, backgroundColor: 'black', overflow: 'hidden' },
  muteIndicator: {
    position: 'absolute', top: '45%', alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 30, padding: 10, zIndex: 10,
  },
  bottomOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 15, paddingBottom: 25, backgroundColor: 'rgba(0,0,0,0.3)',
  },
  captionText: { color: 'white', fontSize: 14, marginBottom: 4 },
  rightActionsRow: { position: 'absolute', bottom: 30, right: 15, alignItems: 'center' },
  actionItem: { alignItems: 'center', marginBottom: 20 },
  actionText: { color: 'white', fontSize: 12, marginTop: 6 },
  backBtn: {
    position: 'absolute', top: 50, left: 12, zIndex: 50,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
});
