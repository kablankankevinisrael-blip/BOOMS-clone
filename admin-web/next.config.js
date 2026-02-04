/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  
  // AJOUT DE 5 LIGNES UNIQUEMENT - solution au problème mémoire
  webpack: (config, { dev, isServer }) => {
    // Désactive le cache filesystem problématique sur Windows
    config.cache = false;
    return config;
  },
  
  async redirects() {
    return [
      {
        source: '/',
        destination: '/dashboard',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
