import { Palettes, type Palette } from '@/constants/theme';

import { useColorScheme } from './use-color-scheme';

/** Colours for the current colour scheme (falls back to dark when unspecified). */
export function usePalette(): Palette {
  const scheme = useColorScheme();
  return scheme === 'light' ? Palettes.light : Palettes.dark;
}
