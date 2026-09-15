/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const BrandColors = {
  primary: '#0EA5E9',      // Daytime Turquoise / Sky
  deep: '#0284C7',         // Deep Sky
  ink: '#1B1B1F',
  accentDark: '#3B82F6',   // Nighttime Ultramarine
} as const;

/**
 * Channel triplets for the brand accents, and the only way to write a
 * translucent accent in a StyleSheet or inline style.
 *
 * React Native can't read the `--accent` CSS variable the NativeWind classes
 * use, so every `rgba()` tint here was hand-typed -- and three different bases
 * drifted into circulation: 255,90,31 (#FF5A1F) and 255,107,53 (#FF6B35)
 * alongside the real 255,95,59. They were close enough to look intentional and
 * far enough to never quite line up: OnboardingWizard had style objects setting
 * `borderColor: theme.tint` next to `backgroundColor: 'rgba(255, 90, 31, 0.1)'`
 * -- two different oranges on the same element. Call accentAlpha() instead.
 */
export const BrandRgb = {
  primary: '14, 165, 233',     // #0EA5E9 (Turquoise / Sky)
  accentDark: '59, 130, 246',  // #3B82F6 (Ultramarine)
} as const;

/** Brand accent at `alpha`. Pass dark=true on a dark canvas. */
export const accentAlpha = (alpha: number, dark = false) =>
  `rgba(${dark ? BrandRgb.accentDark : BrandRgb.primary}, ${alpha})`;

export const NeutralColors = {
  50: '#F7F7F9',
  100: '#EAEAED',
  200: '#DEDEE3',
  400: '#B4B4BD',
  600: '#6F6F79',
  800: '#3A3A40',
} as const;

export const SemanticColors = {
  success: { main: '#2FB673', bg: '#E9F7EF', text: '#0F5C34' },
  warning: { main: '#F5A623', bg: '#FDF2E3', text: '#7A4A0A' },
  error: { main: '#E5484D', bg: '#FCEAEA', text: '#7A1F1F' },
  info: { main: '#3B82F6', bg: '#E8F0FE', text: '#123E80' },
} as const;

/**
 * Sport hues, one value per theme.
 *
 * The dark values are the light ones mixed ~23% toward white, which is the
 * ratio the original hand-picked pairs already used - a sport keeps its
 * identity on a dark card without glowing. Read these through `sportColor()`
 * rather than indexing directly, so an unknown sport falls back sensibly.
 *
 * This replaced four separate copies of the same palette (utils/sportIcons,
 * SideBySideWeekBar, MicroPlanAgendaCard, coach.tsx), three of which held only
 * the light values - which is why sport colours never changed in dark mode.
 */
export const SportColors = {
  light: {
    SWIM: '#2E8FE0', BIKE: '#4CAF6D', RIDE: '#4CAF6D', RUN: '#D9A62E',
    CARDIO: '#E0625A', HIIT: '#E0625A', STRENGTH: '#B36AE0', YOGA: '#2EBFAF',
    MOBILITY: '#2EBFAF', WALK: '#8FA82E', HIKE: '#8FA82E', REST: '#6F6F79',
    ROWING: '#0284C7', WINTER: '#38BDF8', RACQUET: '#84CC16', SOCCER: '#10B981',
    BASKETBALL: '#F97316', GOLF: '#22C55E', COMBAT: '#EF4444', FITNESS: '#F43F5E',
    DEFAULT: BrandColors.primary,
  },
  dark: {
    SWIM: '#5BA8E8', BIKE: '#6FC48A', RIDE: '#6FC48A', RUN: '#E0B94F',
    CARDIO: '#E8837C', HIIT: '#E8837C', STRENGTH: '#C48AEA', YOGA: '#4FD1C0',
    MOBILITY: '#4FD1C0', WALK: '#A8C24F', HIKE: '#A8C24F', REST: '#9A9AA2',
    ROWING: '#3CA0D4', WINTER: '#66CCFA', RACQUET: '#A0D84B', SOCCER: '#47C99E',
    BASKETBALL: '#FF8468', GOLF: '#55D283', COMBAT: '#F36F6F', FITNESS: '#F76B83',
    DEFAULT: BrandColors.accentDark,
  },
} as const;

export type SportKey = keyof typeof SportColors.light;

/** The hue for a sport in the given theme; unknown sports get the accent. */
export function sportColor(
  sport: string | undefined,
  scheme: 'light' | 'dark' = 'light',
): string {
  const key = String(sport || '').toUpperCase() as SportKey;
  return SportColors[scheme][key] ?? SportColors[scheme].DEFAULT;
}

/**
 * The runtime half of the palette.
 *
 * These MUST match the CSS custom properties in `src/global.css`, which is
 * what every `theme-*` Tailwind class resolves to. Anything with a className
 * reads global.css; anything setting a prop (icon `color`, placeholderTextColor)
 * reads this. When the two disagree the same "muted" text is two different
 * greys depending on how it happened to be written -- which is exactly what
 * this file previously did, holding a warm neutral set while global.css held
 * Tailwind's slate.
 *
 * global.css is the source of truth. Change it there, mirror it here.
 */
export const Colors = {
  light: {
    text: '#0F172A',               // --text-main
    textSecondary: '#64748B',      // --text-muted
    background: '#F8FAFC',         // --bg-main
    card: '#FFFFFF',               // --bg-card
    border: '#E2E8F0',             // --border-color
    tint: BrandColors.primary,               // --accent
    backgroundElement: '#F1F5F9',  // --gray-100
    backgroundSelected: '#E2E8F0', // --gray-200
  },
  dark: {
    text: '#F8FAFC',
    textSecondary: '#94A3B8',
    background: '#0F172A',
    card: '#1E293B',
    border: '#334155',
    tint: BrandColors.accentDark,
    backgroundElement: '#1E293B',
    backgroundSelected: '#334155',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'PlusJakartaSans-Medium',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'Rajdhani-Bold',
    numeric: 'Rajdhani-Bold',
  },
  default: {
    sans: 'PlusJakartaSans_500Medium',
    serif: 'serif',
    rounded: 'normal',
    mono: 'Rajdhani_700Bold',
    numeric: 'Rajdhani_700Bold',
  },
  web: {
    sans: 'PlusJakartaSans_500Medium, sans-serif',
    serif: 'serif',
    rounded: 'sans-serif',
    mono: 'Rajdhani_700Bold, monospace',
    numeric: 'Rajdhani_700Bold, monospace',
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

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
