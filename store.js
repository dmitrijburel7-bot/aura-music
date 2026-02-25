// store.js — AURA Music | Reactive central state manager
// Pattern: Flux-inspired unidirectional data flow
// No direct DOM manipulation here. Pure state.

import {
  ACTION,
  PLAYER_STATE,
  REPEAT_MODE,
  PLAYER_SIZE,
  SCREEN,
  STORAGE_KEY,
  AUDIO,
  DEFAULT_GRADIENT,
} from './constants.js';
import { storageGet, storageSet, eventBus } from './utils.js';

// ─── Initial State ────────────────────────────────────────────────────────────

const createInitialState = () => ({
  // Player
  currentTrack: null,
  playerState: PLAYER_STATE.IDLE,
  progress: 0,           // seconds
  duration: 0,           // seconds
  volume: storageGet(STORAGE_KEY.VOLUME, AUDIO.DEFAULT_VOLUME),
  queue: [],
  queueIndex: -1,
  repeatMode: storageGet(STORAGE_KEY.REPEAT, REPEAT_MODE.NONE),
  shuffle: storageGet(STORAGE_KEY.SHUFFLE, false),
  shuffledQueue: [],
  playerSize: PLAYER_SIZE.MINI,
  isCrossfading: false,

  // UI
  screen: SCREEN.HOME,
  searchQuery: '',
  searchResults: [],
  featuredTracks: [],
  isLoading: false,
  isSearching: false,
  error: null,
  dominantColor: {
    primary: DEFAULT_GRADIENT.from,
    secondary: DEFAULT_GRADIENT.via,
    accent: '#e94560',
    text: '#f0f0f0',
    isDark: true,
  },

  // Library
  likedTrackIds: new Set(storageGet(STORAGE_KEY.LIKED, [])),
  library: storageGet(STORAGE_KEY.LIBRARY, []),
  recentTracks: storageGet(STORAGE_KEY.RECENT, []),

  // Toast
  toast: null,

  // Pro
  isPro: storageGet(STORAGE_KEY.PRO, false),
  isProLoading: false,
});

// ─── Store Class ──────────────────────────────────────────────────────────────

class Store {
  #state;
  #listeners = new Set();
  #selectorListeners = new Map(); // selector → Set<{selector, handler, lastValue}>

  constructor() {
    this.#state = createInitialState();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  getState() {
    return this.#state;
  }

  /**
   * Subscribe to any state change.
   * @param {Function} listener - called with (newState, prevState, action)
   * @returns {Function} unsubscribe
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Subscribe to a derived slice of state (selector-based subscription).
   * Only fires when selected value changes (shallow equal).
   * @param {Function} selector - (state) => derivedValue
   * @param {Function} handler - (newValue, prevValue) => void
   * @returns {Function} unsubscribe
   */
  select(selector, handler) {
    const entry = { selector, handler, lastValue: selector(this.#state) };
    if (!this.#selectorListeners.has(selector)) {
      this.#selectorListeners.set(selector, new Set());
    }
    this.#selectorListeners.get(selector).add(entry);
    return () => {
      this.#selectorListeners.get(selector)?.delete(entry);
    };
  }

  /**
   * Dispatch an action to update state.
   * @param {{ type: string, payload?: any }} action
   */
  dispatch(action) {
    const prevState = this.#state;
    const nextState = this.#reduce(this.#state, action);

    if (nextState === prevState) return; // No change

    this.#state = nextState;

    // Notify all general subscribers
    this.#listeners.forEach(listener => {
      try { listener(nextState, prevState, action); } catch (e) {
        console.error('[Store] Subscriber error:', e);
      }
    });

    // Notify selector subscribers
    this.#selectorListeners.forEach((entries) => {
      entries.forEach(entry => {
        const newValue = entry.selector(nextState);
        if (!shallowEqual(newValue, entry.lastValue)) {
          const prevValue = entry.lastValue;
          entry.lastValue = newValue;
          try { entry.handler(newValue, prevValue); } catch (e) {
            console.error('[Store] Selector subscriber error:', e);
          }
        }
      });
    });

    // Emit on event bus for cross-module communication
    eventBus.emit('state:change', { action, state: nextState });
  }

  // ─── Reducer ────────────────────────────────────────────────────────────────

  #reduce(state, action) {
    switch (action.type) {

      // ── Player ──────────────────────────────────────────────────────────────

      case ACTION.SET_CURRENT_TRACK: {
        const track = action.payload;
        if (track?.id === state.currentTrack?.id) return state;

        // Update recent tracks (keep last 50, unique)
        const recentTracks = [
          track,
          ...state.recentTracks.filter(t => t.id !== track?.id),
        ].slice(0, 50);

        // Persist
        storageSet(STORAGE_KEY.RECENT, recentTracks.slice(0, 20).map(t => ({
          id: t.id, name: t.name, artist_name: t.artist_name, image: t.image
        })));

        return { ...state, currentTrack: track, recentTracks };
      }

      case ACTION.SET_PLAYER_STATE:
        if (state.playerState === action.payload) return state;
        return { ...state, playerState: action.payload };

      case ACTION.SET_PROGRESS:
        if (Math.abs(state.progress - action.payload) < 0.1) return state;
        return { ...state, progress: action.payload };

      case ACTION.SET_DURATION:
        if (state.duration === action.payload) return state;
        return { ...state, duration: action.payload };

      case ACTION.SET_VOLUME: {
        const volume = Math.min(1, Math.max(0, action.payload));
        storageSet(STORAGE_KEY.VOLUME, volume);
        return { ...state, volume };
      }

      case ACTION.SET_QUEUE: {
        const { queue, index = 0 } = action.payload;
        const shuffledQueue = state.shuffle ? shuffleArray(queue) : [];
        return { ...state, queue, queueIndex: index, shuffledQueue };
      }

      case ACTION.SET_QUEUE_INDEX:
        return { ...state, queueIndex: action.payload };

      case ACTION.SET_REPEAT_MODE: {
        const repeatMode = action.payload;
        storageSet(STORAGE_KEY.REPEAT, repeatMode);
        return { ...state, repeatMode };
      }

      case ACTION.TOGGLE_SHUFFLE: {
        const shuffle = !state.shuffle;
        const shuffledQueue = shuffle ? shuffleArray(state.queue) : [];
        storageSet(STORAGE_KEY.SHUFFLE, shuffle);
        return { ...state, shuffle, shuffledQueue };
      }

      case ACTION.SET_PLAYER_SIZE:
        if (state.playerSize === action.payload) return state;
        return { ...state, playerSize: action.payload };

      case ACTION.SET_CROSSFADING:
        return { ...state, isCrossfading: action.payload };

      // ── UI ──────────────────────────────────────────────────────────────────

      case ACTION.SET_SCREEN:
        if (state.screen === action.payload) return state;
        return { ...state, screen: action.payload };

      case ACTION.SET_SEARCH_QUERY:
        return { ...state, searchQuery: action.payload };

      case ACTION.SET_SEARCH_RESULTS:
        return { ...state, searchResults: action.payload, isSearching: false };

      case ACTION.SET_FEATURED_TRACKS:
        return { ...state, featuredTracks: action.payload };

      case ACTION.SET_LOADING:
        return { ...state, isLoading: action.payload };

      case ACTION.SET_ERROR:
        return { ...state, error: action.payload, isLoading: false, isSearching: false };

      case ACTION.CLEAR_ERROR:
        return { ...state, error: null };

      case ACTION.SET_DOMINANT_COLOR:
        return { ...state, dominantColor: action.payload };

      // ── Library ─────────────────────────────────────────────────────────────

      case ACTION.TOGGLE_LIKED: {
        const { trackId, track } = action.payload;
        const likedTrackIds = new Set(state.likedTrackIds);
        let library = [...state.library];

        if (likedTrackIds.has(trackId)) {
          likedTrackIds.delete(trackId);
          library = library.filter(t => t.id !== trackId);
        } else {
          likedTrackIds.add(trackId);
          if (track && !library.find(t => t.id === trackId)) {
            library = [track, ...library];
          }
        }

        // Persist
        storageSet(STORAGE_KEY.LIKED, [...likedTrackIds]);
        storageSet(STORAGE_KEY.LIBRARY, library.slice(0, 500).map(t => ({
          id: t.id, name: t.name, artist_name: t.artist_name, image: t.image,
          duration: t.duration, audio: t.audio,
        })));

        return { ...state, likedTrackIds, library };
      }

      case ACTION.ADD_TO_LIBRARY: {
        const track = action.payload;
        if (state.library.find(t => t.id === track.id)) return state;
        const library = [track, ...state.library].slice(0, 500);
        storageSet(STORAGE_KEY.LIBRARY, library);
        return { ...state, library };
      }

      case ACTION.REMOVE_FROM_LIBRARY: {
        const id = action.payload;
        const library = state.library.filter(t => t.id !== id);
        storageSet(STORAGE_KEY.LIBRARY, library);
        return { ...state, library };
      }

      // ── Toast ────────────────────────────────────────────────────────────────

      case ACTION.SHOW_TOAST:
        return { ...state, toast: action.payload };

      case ACTION.HIDE_TOAST:
        return { ...state, toast: null };

      // ── Pro ──────────────────────────────────────────────────────────────────

      case ACTION.SET_PRO_STATUS: {
        storageSet(STORAGE_KEY.PRO, action.payload);
        return { ...state, isPro: action.payload, isProLoading: false };
      }

      case ACTION.SET_PRO_LOADING:
        return { ...state, isProLoading: action.payload };

      default:
        return state;
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shallowEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const item of a) if (!b.has(item)) return false;
    return true;
  }
  if (typeof a !== 'object' || a === null || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => a[k] === b[k]);
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Singleton export ─────────────────────────────────────────────────────────

const store = new Store();
export default store;

// Convenience named exports
export const getState = () => store.getState();
export const dispatch = (action) => store.dispatch(action);
export const subscribe = (listener) => store.subscribe(listener);
export const select = (selector, handler) => store.select(selector, handler);

// ─── Selector helpers ─────────────────────────────────────────────────────────

export const selectors = {
  currentTrack: (s) => s.currentTrack,
  playerState: (s) => s.playerState,
  progress: (s) => s.progress,
  duration: (s) => s.duration,
  volume: (s) => s.volume,
  queue: (s) => s.queue,
  queueIndex: (s) => s.queueIndex,
  activeQueue: (s) => s.shuffle && s.shuffledQueue.length ? s.shuffledQueue : s.queue,
  repeatMode: (s) => s.repeatMode,
  isShuffle: (s) => s.shuffle,
  playerSize: (s) => s.playerSize,
  screen: (s) => s.screen,
  searchQuery: (s) => s.searchQuery,
  searchResults: (s) => s.searchResults,
  featuredTracks: (s) => s.featuredTracks,
  isLoading: (s) => s.isLoading,
  error: (s) => s.error,
  dominantColor: (s) => s.dominantColor,
  likedTrackIds: (s) => s.likedTrackIds,
  isLiked: (trackId) => (s) => s.likedTrackIds.has(trackId),
  library: (s) => s.library,
  recentTracks: (s) => s.recentTracks,
  toast: (s) => s.toast,
  isPro: (s) => s.isPro,
  isProLoading: (s) => s.isProLoading,
  isCrossfading: (s) => s.isCrossfading,
};
