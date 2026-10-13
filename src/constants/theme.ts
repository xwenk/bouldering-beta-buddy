/**
 * Colours, spacing and type for 3B.
 *
 * The palette is built around chalk and tape: a warm off white ground, a near
 * black that is not pure black, and a single orange accent taken from the tape
 * colour most gyms use for the middle grades. Sent and fallen are semantic
 * colours kept apart from the accent, so a screen can report a good result
 * without competing with whatever the main action on it is.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#17150F',
    textSecondary: '#6B6558',
    textFaint: '#9C968A',
    background: '#FBF9F5',
    surface: '#FFFFFF',
    surfaceSunken: '#F2EFE8',
    border: '#E6E1D7',
    accent: '#D96E2B',
    accentSoft: '#FBEDE2',
    sent: '#2F8F5B',
    sentSoft: '#E4F3EA',
    fall: '#B4483F',
    fallSoft: '#F8E7E5',
    // Kept because the template's own components read these names.
    backgroundElement: '#F2EFE8',
    backgroundSelected: '#E6E1D7',
  },
  dark: {
    text: '#F5F2EC',
    textSecondary: '#A8A296',
    textFaint: '#767064',
    background: '#131210',
    surface: '#1C1A17',
    surfaceSunken: '#232019',
    border: '#332F28',
    accent: '#E8853F',
    accentSoft: '#2B1D12',
    sent: '#5FBF88',
    sentSoft: '#152418',
    fall: '#D97068',
    fallSoft: '#2A1614',
    backgroundElement: '#232019',
    backgroundSelected: '#332F28',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
