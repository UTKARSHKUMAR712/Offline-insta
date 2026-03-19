import { Stack } from 'expo-router';
import React from 'react';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="insta"
        options={{
          title: 'Instagram Web',
          headerBackTitle: 'Home',
        }}
      />
      <Stack.Screen
        name="explore"
        options={{
          title: 'Offline Reels',
          headerBackTitle: 'Home',
          headerStyle: { backgroundColor: 'black' },
          headerTintColor: 'white',
        }}
      />
      <Stack.Screen
        name="saved"
        options={{
          title: 'Saved Reels',
          headerBackTitle: 'Home',
          headerStyle: { backgroundColor: 'black' },
          headerTintColor: 'white',
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          title: 'Settings',
          headerBackTitle: 'Home',
          headerStyle: { backgroundColor: '#111' },
          headerTintColor: 'white',
        }}
      />
    </Stack>
  );
}
