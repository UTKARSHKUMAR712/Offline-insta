import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StyleSheet, View, Text, FlatList, Dimensions, ViewToken, AppState, LayoutChangeEvent, Pressable } from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DownloadService, ReelData } from '../../services/download';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { height: windowHeight, width: windowWidth } = Dimensions.get('window');

const LAST_VIEWED_INDEX_KEY = '@last_viewed_reel_index';

export default function OfflineReelsFeed() {
  const [reels, setReels] = useState<ReelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemHeight, setItemHeight] = useState(Dimensions.get('window').height - 80);
  
  // Track which reel is currently visible on screen
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);

  // Reference for the FlatList to jump to the saved position
  const flatListRef = useRef<FlatList>(null);
  
  // Ref to track if we've successfully scrolled to the initial index yet
  const hasInitializedScroll = useRef(false);

  // Load the downloaded videos from storage when this tab is focused
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadReels = async () => {
        try {
          const downloadedReels = await DownloadService.getDownloadedReels();
          if (isActive) {
            setReels(downloadedReels);
            
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
      setActiveVideoIndex(newActiveIndex);
      
      // Save this position to persistence storage immediately
      AsyncStorage.setItem(LAST_VIEWED_INDEX_KEY, newActiveIndex.toString()).catch(() => {});
    }
  }, []);

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
const ReelItem = ({ item, isActive, itemHeight }: { item: ReelData; isActive: boolean; itemHeight: number }) => {
  const videoRef = useRef<Video>(null);
  
  // Manage Video play state globally using AppState and isFocused
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    // If user backgrounds the app, pause the video.
    const subscription = AppState.addEventListener('change', nextAppState => {
      setAppState(nextAppState);
    });
    return () => {
      subscription.remove();
    };
  }, []);

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

      {/* OVERLAYS FOR NATIVE INSTAGRAM FEEL */}
      <View style={styles.bottomOverlay}>
        <View style={styles.userInfo}>
           <View style={styles.avatarPlaceholder} />
           <Text style={styles.usernameText}>@offline_user</Text>
           <View style={styles.followButton}>
              <Text style={styles.followText}>Follow</Text>
           </View>
        </View>
        <Text style={styles.captionText} numberOfLines={2}>
           Downloaded offline reel • {new Date(item.timestamp).toLocaleDateString()}
        </Text>
        <View style={styles.musicContainer}>
           <Ionicons name="musical-note" size={14} color="white" />
           <Text style={styles.musicText}>Original Audio</Text>
        </View>
      </View>

      <View style={styles.rightActionsRow}>
         <View style={styles.actionItem}>
            <Ionicons name="heart-outline" size={32} color="white" />
            <Text style={styles.actionText}>Like</Text>
         </View>
         <View style={styles.actionItem}>
            <Ionicons name="chatbubble-outline" size={30} color="white" />
            <Text style={styles.actionText}>0</Text>
         </View>
         <View style={styles.actionItem}>
            <Ionicons name="paper-plane-outline" size={30} color="white" />
            <Text style={styles.actionText}>Share</Text>
         </View>
         <View style={styles.actionItem}>
            <Ionicons name="ellipsis-vertical" size={24} color="white" />
         </View>
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
    marginBottom: 12,
  },
  musicContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  musicText: {
    color: 'white',
    fontSize: 13,
    marginLeft: 6,
  },
  rightActionsRow: {
    position: 'absolute',
    bottom: 30,
    right: 10,
    alignItems: 'center',
  },
  actionItem: {
    alignItems: 'center',
    marginBottom: 18,
  },
  actionText: {
    color: 'white',
    fontSize: 12,
    marginTop: 4,
  },
});
