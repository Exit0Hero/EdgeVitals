/**
 * Design tokens sampled from the reference PDF (docs/spec/EdgeVitals-POC-Wireframes.pdf)
 * and docs/spec/15_DESIGN_SYSTEM.md.
 */
export const colors = {
  primary: '#1E5EDA',
  primaryPressed: '#184DB5',
  primarySoft: '#E8F0FD',
  hero: '#F2F6FF',
  surface: '#F4F5F7',
  border: '#E5E6EA',
  background: '#FFFFFF',
  text: '#111419',
  textSecondary: '#3F4650',
  muted: '#636A76', // ≥4.5:1 on white, surface, hero and primarySoft (WCAG AA)
  subtle: '#767C85', // non-text only (≥3:1 on white)
  success: '#247A50',
  successSoft: '#E6F4EC',
  warning: '#A8561A',
  warningSoft: '#FCF0E4',
  danger: '#B42318',
  dangerSoft: '#FDECEA',
  scanBackground: '#1A1F25',
  scanSurface: '#262C34',
  scanText: '#FFFFFF',
  scanMuted: '#B4BAC2',
  white: '#FFFFFF',
} as const;

export const radius = { card: 20, control: 14, small: 10, pill: 999 } as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;

export const type = {
  display: { fontSize: 32, lineHeight: 36, fontWeight: '800' as const, letterSpacing: -0.6 },
  title: { fontSize: 26, lineHeight: 31, fontWeight: '700' as const, letterSpacing: -0.4 },
  heading: { fontSize: 18, lineHeight: 23, fontWeight: '700' as const },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  tiny: { fontSize: 11, lineHeight: 14, fontWeight: '500' as const },
  metric: { fontSize: 24, lineHeight: 28, fontWeight: '700' as const },
  metricLarge: { fontSize: 34, lineHeight: 38, fontWeight: '800' as const },
} as const;

export const MIN_TOUCH = 44;
