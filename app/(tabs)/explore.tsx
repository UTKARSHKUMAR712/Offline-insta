import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StyleSheet, View, Text, FlatList, Dimensions, ViewToken, AppState, LayoutChangeEvent, Pressable, Alert } from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DownloadService, ReelData, DownloadEvents } from '../../services/download';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { height: windowHeight, width: windowWidth } = Dimensions.get('window');

const LAST_VIEWED_INDEX_KEY = '@last_viewed_reel_index';

export default function OfflineReelsFeed() {
  const [reels, setReels] = useState<ReelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemHeight, setItemHeight] = useState(Dimensions.get('window').height - 80);
  const [autoDelete, setAutoDelete] = useState(false);
  
  // Keep a synchronous ref of reels to prevent stale closures in onViewableItemsChanged
  const reelsRef = useRef<ReelData[]>(reels);
  useEffect(() => { reelsRef.current = reels; }, [reels]);

  // Track which reel is currently visible on screen
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);

  // Reference for the FlatList to jump to the saved position
  const flatListRef = useRef<FlatList>(null);
  
  // Ref to track if we've successfully scrolled to the initial index yet
  // Ref to track if we've successfully scrolled to the initial index yet
  const hasInitializedScroll = useRef(false);

  useEffect(() => {
    const handleToggleSave = (data: { id: string, isSaved: boolean }) => {
      setReels(prevReels => prevReels.map(r => 
        r.id === data.id ? { ...r, isSaved: data.isSaved } : r
      ));
    };
    DownloadEvents.on('toggleSave', handleToggleSave);
    return () => {
      DownloadEvents.off('toggleSave', handleToggleSave);
    };
  }, []);

  // Load the downloaded videos from storage when this tab is focused
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadReels = async () => {
        try {
          const downloadedReels = await DownloadService.getDownloadedReels();
          const autoDelEnabled = await DownloadService.getAutoDeleteEnabled();
          if (isActive) {
            setReels(downloadedReels);
            setAutoDelete(autoDelEnabled);
            
            // Try to load the user's last saved scroll position
            const savedIndexStr = await AsyncStorage.getItem(LAST_VIEWED_INDEX_KEY);
            if (savedIndexStr) {
              const savedIndex = parseInt(savedIndexStr, 10);
              // Ensure the saved index is within bounds of our current array
              if (savedIndex >= 0 && savedIndex < downloadedReels.length) {
                setActiveVideoIndex(savedIndex);
              }
            }
            setLoading(false);
          }
        } catch (e) {
          console.error("Error loading offline reels:", e);
          if (isActive) setLoading(false);
        }
      };

      loadReels();

      return () => {
        isActive = false;
        // Optional: Save the index when leaving the screen
        AsyncStorage.setItem(LAST_VIEWED_INDEX_KEY, activeVideoIndex.toString()).catch(() => {});
      };
    }, [])
  );

  // Check what video is currently visible on screen to pause/play them
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0) {
      const newActiveIndex = viewableItems[0].index || 0;
      
      setActiveVideoIndex(prevIndex => {
        // Auto-delete logic: If we swiped down to a new video, and auto-delete is ON
        if (autoDelete && newActiveIndex > prevIndex) {
          const reelToMaybeDelete = reelsRef.current[prevIndex];
          if (reelToMaybeDelete && !reelToMaybeDelete.isSaved) {
            // Hard delete the previous reel since we swiped past it
            DownloadService.deleteReel(reelToMaybeDelete.id).then(() => {
              // We don't remove it from the FlatList local state to prevent aggressive scroll jumping,
              // but it'll be gone next time the app loads.
              console.log('Auto-deleted reel:', reelToMaybeDelete.id);
            });
          }
        }
        return newActiveIndex;
      });
      
      // Save this position to persistence storage immediately
      AsyncStorage.setItem(LAST_VIEWED_INDEX_KEY, newActiveIndex.toString()).catch(() => {});
    }
  }, [autoDelete]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50, // Consider a video 'active' when it takes up at least 50% of the screen
  }).current;

  const onContainerLayout = (event: LayoutChangeEvent) => {
    // Get the exact height of the viewable area (which excludes the botttom tab layout)
    const { height } = event.nativeEvent.layout;
    if (height > 0) {
      setItemHeight(height);
    }
  };

  // Once the data has loaded and the list is rendered, scroll to the saved position
  const onLayoutScroll = () => {
    if (!hasInitializedScroll.current && reels.length > 0 && activeVideoIndex > 0) {
       // Timeout ensures the list has had a frame to measure items
       setTimeout(() => {
         flatListRef.current?.scrollToIndex({ 
           index: activeVideoIndex, 
           animated: false 
         });
         hasInitializedScroll.current = true;
       }, 100);
    } else if (!hasInitializedScroll.current) {
        hasInitializedScroll.current = true;
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyText}>Loading downloaded reels...</Text>
      </View>
    );
  }

  if (reels.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyText}>No offline reels yet.</Text>
        <Text style={styles.subText}>Browse Instagram in the Home tab to start downloading!</Text>
      </View>
    );
  }

  const handleDeleteReel = (id: string) => {
    setReels(prev => prev.filter(r => r.id !== id));
  };

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      <FlatList
        ref={flatListRef}
        data={reels}
        // Unique keys via id + index to prevent crashes from duplicated IDs in local storage
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={({ item, index }) => (
          <ReelItem
            item={item}
            isActive={index === activeVideoIndex}
            itemHeight={itemHeight}
            onDelete={handleDeleteReel}
          />
        )}
        pagingEnabled // Enforces snapping to item boundaries (TikTok style)
        horizontal={false}
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(data, index) => ({
          length: itemHeight,
          offset: itemHeight * index,
          index,
        })}
        onLayout={onLayoutScroll}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------------
// Sub-component for individual Reels
// ---------------------------------------------------------------------------------
const ReelItem = ({ item, isActive, itemHeight, onDelete }: { item: ReelData; isActive: boolean; itemHeight: number; onDelete: (id: string) => void }) => {
  const videoRef = useRef<Video>(null);
  const [isSavedLocally, setIsSavedLocally] = useState<boolean>(item.isSaved || false);
  const [isDeleted, setIsDeleted] = useState(false);
  
  // Manage Video play state globally using AppState and isFocused
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    // If user backgrounds the app, pause the video.
    const subscription = AppState.addEventListener('change', nextAppState => {
      setAppState(nextAppState);
    });
    
    // Listen for background auto-deletions to update this specific component
    const handleDeleted = (deletedId: string) => {
      if (deletedId === item.id) {
        setIsDeleted(true);
      }
    };
    DownloadEvents.on('delete', handleDeleted);
    
    return () => {
      subscription.remove();
      DownloadEvents.off('delete', handleDeleted);
    };
  }, [item.id]);

  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (isActive && appState === 'active') {
      videoRef.current?.playAsync();
    } else {
      videoRef.current?.pauseAsync();
      videoRef.current?.setPositionAsync(0); // Reset reel to start when scrolled away
    }
  }, [isActive, appState]);

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const handleToggleSave = async () => {
    const updated: any = await DownloadService.toggleSaveReel(item.id);
    if (updated) {
      setIsSavedLocally(updated.isSaved || false);
    }
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
            } else {
               Alert.alert("Error", "Failed to delete reel.");
            }
          }
        }
      ]
    );
  };

  const handleSaveToGallery = async () => {
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert('Not Available', 'Sharing is not available on this device.');
        return;
      }
      // Opens the native Android share sheet — user can choose to save to gallery, send via WhatsApp, etc.
      // Zero permissions needed.
      await Sharing.shareAsync(item.localUri, {
        mimeType: 'video/mp4',
        dialogTitle: 'Save reel to gallery',
        UTI: 'public.movie',
      });
    } catch (e: any) {
      Alert.alert('Error', 'Could not share: ' + e.message);
    }
  };

  if (isDeleted) {
    return (
      <View style={[styles.reelContainer, { height: itemHeight }]}>
        <Ionicons name="trash-outline" size={64} color="#444" />
        <Text style={styles.deletedText}>This reel was auto-deleted to save space.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.reelContainer, { height: itemHeight }]}>
      <Pressable onPress={toggleMute} style={StyleSheet.absoluteFill}>
        <Video
          ref={videoRef}
          source={{ uri: item.localUri }}
          style={styles.video}
          resizeMode={ResizeMode.COVER}
          isLooping // Loop identically to IG/TikTok
          shouldPlay={isActive}
          isMuted={isMuted}
        />
      </Pressable>

      {/* Basic Overlays */}
      <View style={styles.bottomOverlay}>
        <Text style={styles.captionText} numberOfLines={2}>
           Downloaded: {new Date(item.timestamp).toLocaleDateString()}
        </Text>
      </View>

      <View style={styles.rightActionsRow}>
         {/* Save in-app Button */}
         <Pressable style={styles.actionItem} onPress={handleToggleSave}>
            <Ionicons name={isSavedLocally ? "bookmark" : "bookmark-outline"} size={30} color={isSavedLocally ? "#FFD700" : "white"} />
            <Text style={[styles.actionText, isSavedLocally && { color: "#FFD700" }]}>
              {isSavedLocally ? 'Saved' : 'Save'}
            </Text>
         </Pressable>
         
         {/* Save to Phone Gallery Button */}
         <Pressable style={styles.actionItem} onPress={handleSaveToGallery}>
            <Ionicons name="download-outline" size={30} color="white" />
            <Text style={styles.actionText}>Gallery</Text>
         </Pressable>
         
         {/* Delete Button */}
         <Pressable style={styles.actionItem} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={30} color="#ff4444" />
            <Text style={[styles.actionText, { color: '#ff4444' }]}>Delete</Text>
         </Pressable>
      </View>
    </View>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black', // Standard for reels view
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111',
    padding: 20,
  },
  emptyText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
  },
  reelContainer: {
    width: windowWidth,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
    // Removed strict height binding here to pass inline from component
  },
  video: {
    width: '100%',
    height: '100%',
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 15,
    paddingBottom: 25,
    backgroundColor: 'rgba(0,0,0,0.3)', // Fades text into view
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ff5a5f',
    marginRight: 10,
  },
  usernameText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
    marginRight: 10,
  },
  followButton: {
    borderColor: 'white',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  followText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  captionText: {
    color: 'white',
    fontSize: 14,
    marginBottom: 4,
  },
  rightActionsRow: {
    position: 'absolute',
    bottom: 30,
    right: 15,
    alignItems: 'center',
  },
  actionItem: {
    alignItems: 'center',
    marginBottom: 20,
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
