import Constants from 'expo-constants';

export type PaymentMethod = 'wave' | 'orange_money' | 'mtn_momo' | 'stripe';

type ExtraConfig = {
  apiBaseUrl?: string;
  stripePublishableKey?: string;
  paymentProviders?: Partial<Record<PaymentMethod, unknown>>;
};

const DEFAULT_STRIPE_PUBLISHABLE_KEY =
  'pk_test_51SdPjqHV9ma3pQaOkxoBxKLX7oWBPeic7hDvKU6N2PmByx9UQBhhO1IIpSKaIcp9TlhdMmUPaz0YRwiFlG8XS2CI00DLw3BsaL';

const normalizeBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return fallback;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;
const providerFlags = extra.paymentProviders ?? {};

export const env = {
  apiBaseUrl:
    typeof extra.apiBaseUrl === 'string' && extra.apiBaseUrl.length > 0
      ? extra.apiBaseUrl
      : process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1',
  stripePublishableKey:
    typeof extra.stripePublishableKey === 'string' &&
    extra.stripePublishableKey.trim().length > 0
      ? extra.stripePublishableKey
      : DEFAULT_STRIPE_PUBLISHABLE_KEY,
  paymentProviders: {
    wave: normalizeBoolean(providerFlags.wave, true),
    orange_money: normalizeBoolean(providerFlags.orange_money, true),
    mtn_momo: normalizeBoolean(providerFlags.mtn_momo, true),
    stripe: normalizeBoolean(providerFlags.stripe, true),
  },
} as const;

export const isProviderEnabled = (method: PaymentMethod): boolean =>
  Boolean(env.paymentProviders[method]);
