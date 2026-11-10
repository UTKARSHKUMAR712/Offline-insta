/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

export interface Palette {
  isDark: boolean;
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  danger: string;
  success: string;
  gold: string;
}

/**
 * Single source of truth for app chrome colours. Screens must not hardcode
 * `#111` / `#222` anymore — ask for the palette instead.
 */
export const Palettes: { light: Palette; dark: Palette } = {
  dark: {
    isDark: true,
    background: '#0B0B0C',
    surface: '#161618',
    surfaceAlt: '#1F1F22',
    border: '#2C2C30',
    text: '#F2F2F4',
    textMuted: '#9A9AA0',
    accent: '#0095F6',
    onAccent: '#FFFFFF',
    danger: '#FF4D4F',
    success: '#3DDC84',
    gold: '#FFD700',
  },
  light: {
    isDark: false,
    background: '#FFFFFF',
    surface: '#F4F4F6',
    surfaceAlt: '#EAEAEE',
    border: '#DDDDE2',
    text: '#111214',
    textMuted: '#6B6B72',
    accent: '#0095F6',
    onAccent: '#FFFFFF',
    danger: '#D92D20',
    success: '#0E7C3A',
    gold: '#B8860B',
  },
};

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
