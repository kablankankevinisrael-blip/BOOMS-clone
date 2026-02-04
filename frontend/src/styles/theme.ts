export const palette = {
  obsidian: '#0B1220',
  graphite: '#1B2336',
  indigo: '#4B63F6',
  iris: '#7A5AF8',
  teal: '#24D1B5',
  amber: '#F6C144',
  coral: '#FF7B6E',
  slate: '#94A3B8',
  fog: '#E2E8F0',
  white: '#FFFFFF',
};

export const gradients = {
  hero: ['#0B1220', '#161F33', '#202B43'] as const,
  card: ['#1E2740', '#202B47'],
  accent: ['#4B63F6', '#7A5AF8'],
  success: ['#1FBF84', '#2BD1A1'],
  warning: ['#F6C144', '#FF9472'],
};

export const shadows = {
  soft: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
};

export const fonts = {
  heading: 'SpaceGrotesk_600SemiBold',
  body: 'PlusJakartaSans_400Regular',
  bodyMedium: 'PlusJakartaSans_500Medium',
  mono: 'SpaceGrotesk_400Regular',
};

export const theme = {
  palette,
  gradients,
  shadows,
  fonts,
};
