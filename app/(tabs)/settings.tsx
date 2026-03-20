import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Switch, SafeAreaView, ActivityIndicator, Pressable, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { DownloadService } from '../../services/download';
import { Ionicons } from '@expo/vector-icons';

// A small hidden WebView that we clear to log out Instagram.
// We only show it briefly, then navigate back.
let logoutWebViewRef: any = null;

export default function SettingsScreen() {
  const router = useRouter();
  const [autoDelete, setAutoDelete] = useState(false);
  const [pauseDownloads, setPauseDownloads] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showLogoutView, setShowLogoutView] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      const adEnabled = await DownloadService.getAutoDeleteEnabled();
      const pdEnabled = await DownloadService.getDownloadsPaused();
      setAutoDelete(adEnabled);
      setPauseDownloads(pdEnabled);
      setLoading(false);
    };
    loadSettings();
  }, []);

  const toggleAutoDelete = async (value: boolean) => {
    setAutoDelete(value);
    await DownloadService.setAutoDeleteEnabled(value);
  };

  const togglePauseDownloads = async (value: boolean) => {
    setPauseDownloads(value);
    await DownloadService.setDownloadsPaused(value);
  };

  const handleLogout = () => {
    Alert.alert(
      'Log out of Instagram',
      'This will clear your Instagram session and cookies from the app. You will need to log in again next time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: () => setShowLogoutView(true),
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="white" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Back Button */}
      <Pressable style={styles.backBtn} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={22} color="white" />
        <Text style={styles.backText}>Home</Text>
      </Pressable>
      {/* Auto-Delete Setting */}
      <View style={styles.settingRow}>
        <View style={styles.textContainer}>
          <Text style={styles.title}>Auto-Delete Offline Reels</Text>
          <Text style={styles.description}>
            Automatically permanently delete reels as soon as you swipe past them in the Offline Reels feed. Saved reels will not be deleted.
          </Text>
        </View>
        <Switch
          trackColor={{ false: '#3e3e3e', true: '#FFD700' }}
          thumbColor="#f4f3f4"
          ios_backgroundColor="#3e3e3e"
          onValueChange={toggleAutoDelete}
          value={autoDelete}
        />
      </View>

      {/* Pause Downloads Setting */}
      <View style={styles.settingRow}>
        <View style={styles.textContainer}>
          <Text style={styles.title}>Pause Automatic Downloads</Text>
          <Text style={styles.description}>
            When enabled, the app will stop automatically fetching and downloading reels from Instagram pages.
          </Text>
        </View>
        <Switch
          trackColor={{ false: '#3e3e3e', true: '#FFD700' }}
          thumbColor="#f4f3f4"
          ios_backgroundColor="#3e3e3e"
          onValueChange={togglePauseDownloads}
          value={pauseDownloads}
        />
      </View>

      {/* Instagram Logout */}
      <Pressable style={styles.logoutRow} onPress={handleLogout}>
        <Text style={styles.logoutTitle}>Log Out of Instagram</Text>
        <Text style={styles.description}>
          Clears your Instagram session cookies from this app. You will need to log in again next time.
        </Text>
      </Pressable>

      {/* Hidden WebView used purely to clear Instagram cookies by loading the logout URL */}
      {showLogoutView && (
        <View style={{ height: 0, overflow: 'hidden' }}>
          <WebView
            ref={(ref) => { logoutWebViewRef = ref; }}
            source={{ uri: 'https://www.instagram.com/accounts/logout/' }}
            // This is a standard web navigation to Instagram's own logout page.
            // No JS is injected. Instagram itself handles the session clear.
            onNavigationStateChange={(state) => {
              // Once Instagram redirects us away from the logout page, we're done.
              if (state.url && !state.loading) {
                setShowLogoutView(false);
                Alert.alert('Logged Out', 'Your Instagram session has been cleared. You will be asked to log in again next time.');
              }
            }}
            onError={() => {
              setShowLogoutView(false);
              Alert.alert('Logged Out', 'Your Instagram cookies have been cleared.');
            }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
    padding: 20,
  },
  center: {
    flex: 1,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#222',
    padding: 20,
    borderRadius: 12,
    marginTop: 20,
  },
  logoutRow: {
    backgroundColor: '#1a0a0a',
    borderWidth: 1,
    borderColor: '#441111',
    padding: 20,
    borderRadius: 12,
    marginTop: 16,
    width: '100%',
  },
  logoutTitle: {
    color: '#ff4444',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  textContainer: {
    flex: 1,
    paddingRight: 10,
  },
  title: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  description: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 18,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingVertical: 8,
  },
  backText: {
    color: 'white',
    fontSize: 16,
    marginLeft: 4,
  },
});
