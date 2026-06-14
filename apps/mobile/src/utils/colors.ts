export const colors = {
  primary:      '#1D9E75',
  primaryDark:  '#0F6E56',
  primaryLight: '#E1F5EE',
  primaryMid:   '#5DCAA5',
  dark:         '#111827',
  darkMid:      '#1F2937',
  gray:         '#6B7280',
  grayLight:    '#F3F4F6',
  white:        '#FFFFFF',
  danger:       '#E24B4A',
  warning:      '#F59E0B',
  success:      '#1D9E75',
  border:       '#E5E7EB',
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
} as const;

export const radius = {
  sm: 6, md: 10, lg: 16, xl: 24, full: 9999,
} as const;

export const fontSize = {
  xs: 11, sm: 13, md: 15, lg: 17,
  xl: 20, xxl: 24, xxxl: 32, stat: 44,
} as const;
