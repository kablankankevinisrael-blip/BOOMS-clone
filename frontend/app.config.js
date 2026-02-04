import 'dotenv/config';

const baseConfig = require('./app.json');

const parseBoolean = (value, fallback = false) => {
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

// 🔐 Lire Stripe key depuis .env (jamais de fallback hardcodé)
const FALLBACK_STRIPE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || 
  null;  // Pas de fallback pk_test_ - doit venir de .env

module.exports = () => {
  const extra = baseConfig.expo?.extra || {};
  const existingProviders = extra.paymentProviders || {};

  const providerFlag = (envValue, existingValue, fallback = true) =>
    parseBoolean(
      envValue !== undefined
        ? envValue
        : existingValue !== undefined
        ? existingValue
        : fallback,
      fallback
    );

  return {
    ...baseConfig,
    expo: {
      ...baseConfig.expo,
      extra: {
        ...extra,
        // 🔐 Lire API_BASE_URL depuis .env - PAS de hardcoded IP
        apiBaseUrl:
          process.env.EXPO_PUBLIC_API_BASE_URL ||
          extra.apiBaseUrl ||
          'http://localhost:8000/api/v1',  // Fallback développement local seulement
        paymentProviders: {
          wave: providerFlag(
            process.env.EXPO_PUBLIC_ENABLE_WAVE,
            existingProviders.wave,
            true
          ),
          orange_money: providerFlag(
            process.env.EXPO_PUBLIC_ENABLE_ORANGE_MONEY,
            existingProviders.orange_money,
            true
          ),
          mtn_momo: providerFlag(
            process.env.EXPO_PUBLIC_ENABLE_MTN_MOMO,
            existingProviders.mtn_momo,
            true
          ),
          stripe: providerFlag(
            process.env.EXPO_PUBLIC_ENABLE_STRIPE,
            existingProviders.stripe,
            true
          ),
        },
        stripePublishableKey:
          process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
          extra.stripePublishableKey ||
          FALLBACK_STRIPE_PUBLISHABLE_KEY,
      },
    },
  };
};
