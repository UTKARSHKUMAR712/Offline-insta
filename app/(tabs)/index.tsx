import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={styles.button}
            onPress={() => router.push('/insta')}
            activeOpacity={0.7}
          >
            <Text style={styles.buttonText}>instarel{'\n'}downloader</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.button}
            onPress={() => router.push('/explore')}
            activeOpacity={0.7}
          >
            <Text style={styles.buttonText}>offline reels</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.button}
            onPress={() => router.push('/saved')}
            activeOpacity={0.7}
          >
            <Text style={styles.buttonText}>saved reels</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.button}
            onPress={() => router.push('/settings')}
            activeOpacity={0.7}
          >
            <Text style={styles.buttonText}>settings</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>made by Utkarsh Kumar</Text>
          <Text style={styles.footerText}>For</Text>
          <Text style={styles.footerText}>Utkarsh Kumar</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111', // Very dark grey/black
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center', // Centers the buttons vertically
    alignItems: 'center',
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
    gap: 30, // Space between buttons
  },
  button: {
    borderWidth: 1.5,
    borderColor: 'white',
    borderRadius: 12,
    width: '70%',
    maxWidth: 300,
    paddingVertical: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 24,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
  },
});
