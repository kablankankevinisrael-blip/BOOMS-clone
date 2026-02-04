const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

const polyfillAtob = (input: string): string => {
  let output = '';
  let i = 0;
  const sanitized = input.replace(/[^A-Za-z0-9+/=]/g, '');

  while (i < sanitized.length) {
    const enc1 = BASE64_ALPHABET.indexOf(sanitized.charAt(i++));
    const enc2 = BASE64_ALPHABET.indexOf(sanitized.charAt(i++));
    const enc3 = BASE64_ALPHABET.indexOf(sanitized.charAt(i++));
    const enc4 = BASE64_ALPHABET.indexOf(sanitized.charAt(i++));

    if ([enc1, enc2, enc3, enc4].some((value) => value === -1)) {
      break;
    }

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    output += String.fromCharCode(chr1);

    if (enc3 !== 64) {
      output += String.fromCharCode(chr2);
    }
    if (enc4 !== 64) {
      output += String.fromCharCode(chr3);
    }
  }

  return output;
};

const safeAtob = (input: string): string => {
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(input);
  }
  return polyfillAtob(input);
};

const normalizeBase64Url = (input: string): string => {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4;
  if (padding === 0) {
    return base64;
  }
  return base64 + '='.repeat(4 - padding);
};

export const decodeBase64 = (input: string): string => safeAtob(input);

export const decodeBase64Url = (input: string): string => {
  const normalized = normalizeBase64Url(input);
  return safeAtob(normalized);
};
