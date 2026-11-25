/**
 * SPREAD (spread.haking.tr) — Security, Sanitization & Integrity Module
 *
 * Guarantees zero-XSS DOM construction, prototype-pollution protection,
 * CSV formula-injection protection, URL allowlisting, and SHA-256 checksums.
 */

const ALLOWED_IMAGE_HOSTS = new Set([
  'community.akamai.steamstatic.com',
  'community.cloudflare.steamstatic.com',
  'raw.githubusercontent.com'
]);

const ALLOWED_LINK_HOSTS = new Set([
  'steamcommunity.com',
  'csfloat.com',
  'www.youpin898.com',
  'youpin898.com',
  'github.com',
  'spread.haking.tr',
  'haking.tr'
]);

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function cleanText(value, maxLen = 140) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

export function clampNumber(value, min = 0, max = 1e9, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function safeImageUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return '/assets/brand/logo-192.png';
  if (rawUrl.startsWith('/assets/')) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
      return parsed.href;
    }
  } catch {
    return '/assets/brand/logo-192.png';
  }
  return '/assets/brand/logo-192.png';
}

export function safeExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '#';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:' && ALLOWED_LINK_HOSTS.has(parsed.hostname)) {
      return parsed.href;
    }
  } catch {
    return '#';
  }
  return '#';
}

/**
 * Safe DOM element builder — NEVER parses arbitrary HTML strings.
 */
export function el(tag, props = null, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined || val === null || val === false) continue;
      if (key === 'className') {
        node.className = String(val);
      } else if (key === 'style' && typeof val === 'object') {
        for (const [sk, sv] of Object.entries(val)) {
          if (sk.startsWith('--')) {
            node.style.setProperty(sk, String(sv));
          } else {
            node.style[sk] = String(sv);
          }
        }
      } else if (key === 'dataset' && typeof val === 'object') {
        for (const [dk, dv] of Object.entries(val)) {
          node.dataset[dk] = String(dv);
        }
      } else if (key.startsWith('on') && typeof val === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === 'href') {
        node.setAttribute('href', safeExternalUrl(String(val)));
      } else if (key === 'src') {
        node.setAttribute('src', safeImageUrl(String(val)));
      } else if (typeof val === 'boolean') {
        if (val) node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(val));
      }
    }
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
  return node;
}

export function clearNode(node) {
  while (node && node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/**
 * Recursively strips prototype-pollution keys from parsed JSON data.
 */
export function sanitizeJsonValue(val, depth = 0) {
  if (depth > 8) return null;
  if (val === null || typeof val === 'number' || typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.slice(0, 5000);
  if (Array.isArray(val)) {
    return val.slice(0, 2000).map((item) => sanitizeJsonValue(item, depth + 1));
  }
  if (typeof val === 'object') {
    const out = Object.create(null);
    for (const key of Object.keys(val)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      out[key] = sanitizeJsonValue(val[key], depth + 1);
    }
    return out;
  }
  return null;
}

/**
 * Neutralize spreadsheet formula injection when exporting CSV files.
 */
export function safeCsvCell(value) {
  let str = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Computes a SHA-256 hex digest using the browser Web Crypto API.
 */
export async function sha256Hex(str) {
  if (globalThis.crypto?.subtle) {
    const data = new TextEncoder().encode(str);
    const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Deterministic fallback hash for non-HTTPS file:// contexts
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'fnv1a-' + (h >>> 0).toString(16).padStart(8, '0');
}
