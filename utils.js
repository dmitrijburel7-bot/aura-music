// utils.js — AURA Music | Pure utility functions (no side effects, no imports from app)
import {
  DEBOUNCE_SEARCH_MS,
  COLOR_EXTRACTION,
  CACHE,
  HAPTIC,
  STORAGE_KEY,
} from './constants.js';

// ─── Debounce ────────────────────────────────────────────────────────────────

/**
 * Creates a debounced version of a function.
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
export function debounce(fn, delay = DEBOUNCE_SEARCH_MS) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle — fire at most once per interval.
 * @param {Function} fn
 * @param {number} limit
 * @returns {Function}
 */
export function throttle(fn, limit = 100) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      return fn.apply(this, args);
    }
  };
}

// ─── Time / Math ──────────────────────────────────────────────────────────────

/**
 * Format seconds to mm:ss or h:mm:ss
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Map a value from one range to another
 */
export function mapRange(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/**
 * Generate a random integer between min and max (inclusive)
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Shuffle an array (Fisher-Yates) — returns new array
 */
export function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Color Utilities ─────────────────────────────────────────────────────────

/**
 * Extract dominant colors from an image URL using Canvas API.
 * Returns { primary, secondary, text, isDark } palette.
 * @param {string} imageUrl
 * @returns {Promise<{primary: string, secondary: string, accent: string, text: string, isDark: boolean}>}
 */
export async function extractColors(imageUrl) {
  return new Promise((resolve) => {
    const cacheKey = `color_${imageUrl}`;
    const cached = memoryCache.get(cacheKey);
    if (cached) return resolve(cached);

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const { CANVAS_SIZE, BRIGHTNESS_MIN, BRIGHTNESS_MAX } = COLOR_EXTRACTION;
        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

        const data = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
        const pixels = [];

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;

          const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
          if (brightness < BRIGHTNESS_MIN || brightness > BRIGHTNESS_MAX) continue;

          // Calculate saturation
          const max = Math.max(r, g, b) / 255;
          const min = Math.min(r, g, b) / 255;
          const saturation = max === 0 ? 0 : (max - min) / max;

          pixels.push({ r, g, b, saturation, brightness });
        }

        if (pixels.length === 0) {
          return resolve(buildFallbackPalette());
        }

        // Sort by saturation × brightness score (vibrant first)
        pixels.sort((a, b) =>
          (b.saturation * COLOR_EXTRACTION.SATURATION_WEIGHT * b.brightness) -
          (a.saturation * COLOR_EXTRACTION.SATURATION_WEIGHT * a.brightness)
        );

        // Take top quartile for primary
        const topCount = Math.max(1, Math.floor(pixels.length * 0.05));
        const topPixels = pixels.slice(0, topCount);

        const avg = topPixels.reduce(
          (acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }),
          { r: 0, g: 0, b: 0 }
        );
        const primary = {
          r: Math.round(avg.r / topCount),
          g: Math.round(avg.g / topCount),
          b: Math.round(avg.b / topCount),
        };

        // Secondary: contrast complementary
        const secondary = {
          r: Math.round(primary.r * 0.6 + (pixels[Math.floor(pixels.length * 0.4)]?.r || 60) * 0.4),
          g: Math.round(primary.g * 0.6 + (pixels[Math.floor(pixels.length * 0.4)]?.g || 60) * 0.4),
          b: Math.round(primary.b * 0.6 + (pixels[Math.floor(pixels.length * 0.4)]?.b || 80) * 0.4),
        };

        const isDark = (primary.r * 0.299 + primary.g * 0.587 + primary.b * 0.114) < 128;
        const textColor = isDark ? '#f0f0f0' : '#111111';

        const palette = {
          primary: rgbToHex(primary.r, primary.g, primary.b),
          secondary: rgbToHex(secondary.r, secondary.g, secondary.b),
          accent: rgbToHex(
            clamp(primary.r + 40, 0, 255),
            clamp(primary.g - 20, 0, 255),
            clamp(primary.b + 60, 0, 255)
          ),
          text: textColor,
          isDark,
          raw: primary,
        };

        memoryCache.set(cacheKey, palette, CACHE.COLOR_TTL_MS);
        resolve(palette);
      } catch (err) {
        console.warn('[AURA] Color extraction failed:', err);
        resolve(buildFallbackPalette());
      }
    };

    img.onerror = () => resolve(buildFallbackPalette());
    img.src = imageUrl;
  });
}

function buildFallbackPalette() {
  return {
    primary: '#1a1a2e',
    secondary: '#16213e',
    accent: '#e94560',
    text: '#f0f0f0',
    isDark: true,
    raw: { r: 26, g: 26, b: 46 },
  };
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : { r: 0, g: 0, b: 0 };
}

/**
 * Darken a hex color by a factor (0–1)
 */
export function darkenColor(hex, factor = 0.3) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    Math.round(r * (1 - factor)),
    Math.round(g * (1 - factor)),
    Math.round(b * (1 - factor))
  );
}

/**
 * Lighten a hex color by a factor (0–1)
 */
export function lightenColor(hex, factor = 0.3) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    Math.round(r + (255 - r) * factor),
    Math.round(g + (255 - g) * factor),
    Math.round(b + (255 - b) * factor)
  );
}

/**
 * Add alpha to hex → rgba string
 */
export function hexToRgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Haptic Feedback ─────────────────────────────────────────────────────────

/**
 * Trigger Telegram haptic feedback.
 * Gracefully degrades if not in Telegram WebApp context.
 * @param {string} type — one of HAPTIC constants
 */
export function haptic(type = HAPTIC.LIGHT) {
  try {
    const tg = window.Telegram?.WebApp;
    if (!tg?.HapticFeedback) return;

    switch (type) {
      case HAPTIC.LIGHT:
      case HAPTIC.MEDIUM:
      case HAPTIC.HEAVY:
        tg.HapticFeedback.impactOccurred(type);
        break;
      case HAPTIC.SUCCESS:
        tg.HapticFeedback.notificationOccurred('success');
        break;
      case HAPTIC.WARNING:
        tg.HapticFeedback.notificationOccurred('warning');
        break;
      case HAPTIC.ERROR:
        tg.HapticFeedback.notificationOccurred('error');
        break;
      case HAPTIC.SELECT:
        tg.HapticFeedback.selectionChanged();
        break;
      default:
        tg.HapticFeedback.impactOccurred('light');
    }
  } catch (e) {
    // Silently fail outside Telegram context
  }
}

// ─── In-Memory LRU Cache ──────────────────────────────────────────────────────

class MemoryCache {
  constructor(maxEntries = CACHE.MAX_ENTRIES) {
    this.maxEntries = maxEntries;
    this.store = new Map(); // key → { value, expiresAt }
  }

  set(key, value, ttl = CACHE.METADATA_TTL_MS) {
    if (this.store.size >= this.maxEntries) {
      // Evict oldest
      const firstKey = this.store.keys().next().value;
      this.store.delete(firstKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // LRU: refresh position
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}

export const memoryCache = new MemoryCache();

// ─── localStorage helpers ────────────────────────────────────────────────────

export function storageGet(key, fallback = null) {
  try {
    const item = localStorage.getItem(key);
    if (item === null) return fallback;
    return JSON.parse(item);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

// ─── DOM Helpers ──────────────────────────────────────────────────────────────

/**
 * Safe querySelector — returns null if not found.
 */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * Create element with optional attributes and children.
 */
export function createElement(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') el.className = val;
    else if (key === 'style' && typeof val === 'object') Object.assign(el.style, val);
    else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else {
      el.setAttribute(key, val);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') el.appendChild(document.createTextNode(child));
    else if (child instanceof Node) el.appendChild(child);
  }
  return el;
}

/**
 * Safely set inner HTML (basic XSS guard: strips <script> tags)
 */
export function safeSetHTML(el, html) {
  el.innerHTML = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
}

// ─── String helpers ───────────────────────────────────────────────────────────

export function truncate(str, maxLength = 40) {
  if (!str) return '';
  return str.length <= maxLength ? str : str.slice(0, maxLength - 1) + '…';
}

export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
}

// ─── Network ──────────────────────────────────────────────────────────────────

/**
 * Fetch with timeout + retries
 * @param {string} url
 * @param {object} options
 * @param {number} retries
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, retries = 3, timeoutMs = 8000) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt < retries) {
        await sleep(1500 * (attempt + 1)); // Exponential backoff
      }
    }
  }
  throw lastError;
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Platform Detection ───────────────────────────────────────────────────────

export const isTelegram = () => !!window.Telegram?.WebApp;

export const getTelegramUser = () => window.Telegram?.WebApp?.initDataUnsafe?.user ?? null;

export const getTelegramTheme = () => {
  const tg = window.Telegram?.WebApp;
  if (!tg) return { colorScheme: 'dark', bgColor: '#0f0f0f' };
  return {
    colorScheme: tg.colorScheme,
    bgColor: tg.backgroundColor,
    textColor: tg.themeParams?.text_color,
    buttonColor: tg.themeParams?.button_color,
  };
};

// ─── Event Bus (lightweight) ──────────────────────────────────────────────────

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event, data) {
    this.listeners.get(event)?.forEach(handler => {
      try { handler(data); } catch (e) { console.error(`[EventBus] Error in "${event}" handler:`, e); }
    });
  }

  once(event, handler) {
    const wrapper = (data) => {
      handler(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }
}

export const eventBus = new EventBus();

// ─── Unique ID ────────────────────────────────────────────────────────────────

let _idCounter = 0;
export function uid(prefix = 'aura') {
  return `${prefix}_${++_idCounter}_${Date.now().toString(36)}`;
}

// ─── Number formatting ────────────────────────────────────────────────────────

export function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
