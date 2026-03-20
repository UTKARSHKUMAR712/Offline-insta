import React, { useState, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, Dimensions, ViewToken, AppState, LayoutChangeEvent, Pressable, Alert } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DownloadService, ReelData } from '../../services/download';

const { width: windowWidth } = Dimensions.get('window');

export default function SavedReelsFeed() {
  const router = useRouter();
  const [reels, setReels] = useState<ReelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemHeight, setItemHeight] = useState(Dimensions.get('window').height - 80);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      const loadReels = async () => {
        try {
          const downloadedReels = await DownloadService.getDownloadedReels();
          // Filter ONLY the saved ones
          const savedReels = downloadedReels.filter(r => r.isSaved);
          if (isActive) {
            setReels(savedReels);
            setLoading(false);
          }
        } catch (e) {
          if (isActive) setLoading(false);
        }
      };
      loadReels();
      return () => { isActive = false; };
    }, [])
  );

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0) {
      setActiveVideoIndex(viewableItems[0].index || 0);
    }
  }, []);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const onContainerLayout = (event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    if (height > 0) setItemHeight(height);
  };

  const handleDeleteSavedReel = (id: string) => {
    setReels(prev => prev.filter(r => r.id !== id));
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyText}>Loading...</Text>
      </View>
    );
  }

  if (reels.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyText}>No Saved Reels.</Text>
        <Text style={styles.subText}>You can explicitly 'Save' your favorite offline reels so they never get auto-deleted!</Text>
      </View>
    );
  }

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
            onDelete={handleDeleteSavedReel}
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(data, index) => ({
          length: itemHeight,
          offset: itemHeight * index,
          index,
        })}
      />
    </View>
  );
}

const SavedReelItem = ({ item, isActive, itemHeight, onDelete }: { item: ReelData; isActive: boolean; itemHeight: number; onDelete: (id: string) => void }) => {
  const videoRef = useRef<Video>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextAppState => setAppState(nextAppState));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (isActive && appState === 'active') {
      videoRef.current?.playAsync();
    } else {
      videoRef.current?.pauseAsync();
      videoRef.current?.setPositionAsync(0);
    }
  }, [isActive, appState]);

  const toggleMute = () => setIsMuted(!isMuted);

  const handleToggleSave = async () => {
    // If they toggle save from here, it UN-saves it.
    await DownloadService.toggleSaveReel(item.id);
    onDelete(item.id); // Remove it immediately from the saved view as it's no longer saved.
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Reel",
      "Are you sure you want to completely delete this reel from your device?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: async () => {
            const success = await DownloadService.deleteReel(item.id);
            if (success) {
               onDelete(item.id);
            }
          }
        }
      ]
    );
  };

  return (
    <View style={[styles.reelContainer, { height: itemHeight }]}>
      <Pressable onPress={toggleMute} style={StyleSheet.absoluteFill}>
        <Video
          ref={videoRef}
          source={{ uri: item.localUri }}
          style={styles.video}
          resizeMode={ResizeMode.COVER}
          isLooping
          shouldPlay={isActive && appState === 'active'}
          isMuted={isMuted}
          useNativeControls={false}
        />
      </Pressable>

      <View style={styles.bottomOverlay}>
        <Text style={styles.captionText} numberOfLines={2}>
           Saved on: {new Date(item.timestamp).toLocaleDateString()}
        </Text>
      </View>

      <View style={styles.rightActionsRow}>
         {/* Un-save Button */}
         <Pressable style={styles.actionItem} onPress={handleToggleSave}>
            <Ionicons name="bookmark" size={30} color="#FFD700" />
            <Text style={[styles.actionText, { color: "#FFD700" }]}>Saved</Text>
         </Pressable>
         
         {/* Soft delete just removes it, but let's just make it a hard delete just like usual */}
         <Pressable style={styles.actionItem} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={30} color="#ff4444" />
            <Text style={[styles.actionText, { color: '#ff4444' }]}>Delete</Text>
         </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111', padding: 20 },
  emptyText: { color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
  subText: { color: '#888', fontSize: 14, textAlign: 'center' },
  reelContainer: { width: windowWidth, backgroundColor: 'black', justifyContent: 'center', alignItems: 'center' },
  video: { width: '100%', height: '100%' },
  bottomOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 15, paddingBottom: 25, backgroundColor: 'rgba(0,0,0,0.3)' },
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
