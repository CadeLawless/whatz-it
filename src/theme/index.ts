import type { TextStyle } from 'react-native';

export const colors = {
  background: '#F7F5EF',
  surface: '#FFFFFF',
  ink: '#18231D',
  muted: '#667069',
  border: '#E4E1D8',
  accentSoft: '#E8E3FF',
  white: '#FFFFFF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const radius = { md: 12, lg: 20, xl: 28, pill: 999 } as const;

export const typography: Record<'hero' | 'title' | 'body', TextStyle> = {
  hero: { fontSize: 42, lineHeight: 45, fontWeight: '900', letterSpacing: -1.4 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -0.6 },
  body: { fontSize: 17, lineHeight: 25, fontWeight: '500' },
};
