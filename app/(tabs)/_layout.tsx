import { Stack } from 'expo-router';
import React from 'react';

export default function TabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="insta" />
      <Stack.Screen name="explore" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="settings" />
    </Stack>
  );
}
