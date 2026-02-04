// services/api.ts
import axios from 'axios';

// ✅ Lecture depuis .env.local via NEXT_PUBLIC_API_BASE_URL
const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';
const rawBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || '').trim();

const resolveBaseUrl = () => {
  const candidate = rawBaseUrl || DEFAULT_API_BASE_URL;
  const trimmed = candidate.replace(/\/$/, '');

  try {
    const url = new URL(trimmed);
    const isLocalHost = ['localhost', '127.0.0.1'].includes(url.hostname);

    if (typeof window !== 'undefined' && isLocalHost) {
      const currentHost = window.location.hostname;
      if (currentHost && currentHost !== 'localhost') {
        url.hostname = currentHost;
      }
    }

    return url.toString().replace(/\/$/, '');
  } catch (error) {
    console.warn('[API] Base URL invalide, utilisation du fallback', error);
    return DEFAULT_API_BASE_URL;
  }
};

const API_BASE_URL = resolveBaseUrl();

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('admin_token');
      if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      console.error('[API] Network error', error.message);
    }
    return Promise.reject(error);
  }
);

export default api;