// player.js — AURA Music | Audio Engine
// The only module that touches Web Audio API / HTMLAudioElement.
// All state changes go through store.dispatch(). UI never calls audio directly.

import { dispatch, getState, select, selectors } from './store.js';
import { getTrackStreamUrl, logPlayEvent } from './api.js';
import {
  ACTION,
  PLAYER_STATE,
  REPEAT_MODE,
  AUDIO,
  ANIM,
  HAPTIC,
  ERROR_MSG,
} from './constants.js';
import {
  clamp,
  sleep,
  haptic,
  memoryCache,
  eventBus,
  shuffle as shuffleArray,
} from './utils.js';

// ─── AudioPlayer Class ────────────────────────────────────────────────────────

class AudioPlayer {
  #primary = null;          // HTMLAudioElement — current track
  #secondary = null;        // HTMLAudioElement — crossfade target
  #context = null;          // AudioContext (for advanced processing)
  #gainNodePrimary = null;
  #gainNodeSecondary = null;
  #crossfadeTimer = null;
  #progressTimer = null;
  #retryCount = 0;
  #preloadedUrl = null;
  #preloadAudio = null;
  #boundHandlers = {};

  constructor() {
    this.#primary = this.#createAudioElement('primary');
    this.#secondary = this.#createAudioElement('secondary');
    this.#initAudioContext();
    this.#bindStoreSubscriptions();

    // Handle visibility change (pause on tab hide, resume on focus)
    document.addEventListener('visibilitychange', this.#onVisibilityChange.bind(this));
  }

  // ─── Public Interface ──────────────────────────────────────────────────────

  /**
   * Load and play a track. Sets queue if not already set.
   * @param {Track} track
   * @param {Track[]} [queue] - optional new queue to set
   * @param {number} [queueIndex] - index of track in queue
   */
  async play(track, queue = null, queueIndex = 0) {
    if (!track) return;

    if (queue) {
      dispatch({ type: ACTION.SET_QUEUE, payload: { queue, index: queueIndex } });
    }

    dispatch({ type: ACTION.SET_CURRENT_TRACK, payload: track });
    dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.LOADING });

    haptic(HAPTIC.MEDIUM);

    try {
      const streamUrl = getTrackStreamUrl(track);
      await this.#loadAudio(streamUrl);
      logPlayEvent(track);
    } catch (err) {
      console.error('[Player] Play error:', err);
      dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.ERROR });
      dispatch({ type: ACTION.SET_ERROR, payload: ERROR_MSG.PLAYBACK });
      haptic(HAPTIC.ERROR);

      // Auto-skip on error
      if (this.#retryCount < AUDIO.MAX_RETRIES) {
        this.#retryCount++;
        await sleep(AUDIO.RETRY_DELAY_MS);
        await this.next();
      }
    }
  }

  /**
   * Resume playback
   */
  async resume() {
    if (!this.#primary.src) return;
    try {
      await this.#primary.play();
      dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.PLAYING });
      this.#startProgressTimer();
      haptic(HAPTIC.LIGHT);
    } catch (err) {
      console.error('[Player] Resume error:', err);
    }
  }

  /**
   * Pause playback
   */
  pause() {
    this.#primary.pause();
    dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.PAUSED });
    this.#stopProgressTimer();
    haptic(HAPTIC.LIGHT);
  }

  /**
   * Toggle play/pause
   */
  async toggle() {
    const { playerState } = getState();
    if (playerState === PLAYER_STATE.PLAYING) {
      this.pause();
    } else {
      await this.resume();
    }
  }

  /**
   * Seek to a specific time in seconds
   * @param {number} seconds
   */
  seek(seconds) {
    const duration = this.#primary.duration;
    if (!isFinite(duration)) return;
    const time = clamp(seconds, 0, duration);
    this.#primary.currentTime = time;
    dispatch({ type: ACTION.SET_PROGRESS, payload: time });
    haptic(HAPTIC.SELECT);
  }

  /**
   * Seek by a relative amount
   * @param {number} delta - seconds to skip (+/-)
   */
  seekRelative(delta) {
    this.seek(this.#primary.currentTime + delta);
  }

  /**
   * Skip to next track in queue
   */
  async next() {
    const state = getState();
    const queue = selectors.activeQueue(state);
    let index = state.queueIndex;

    if (queue.length === 0) return;
    haptic(HAPTIC.MEDIUM);

    if (state.repeatMode === REPEAT_MODE.ONE) {
      this.seek(0);
      await this.resume();
      return;
    }

    index++;
    if (index >= queue.length) {
      if (state.repeatMode === REPEAT_MODE.ALL) {
        index = 0;
      } else {
        dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.ENDED });
        return;
      }
    }

    dispatch({ type: ACTION.SET_QUEUE_INDEX, payload: index });
    await this.play(queue[index]);
  }

  /**
   * Skip to previous track (or restart if > 3 seconds in)
   */
  async prev() {
    const state = getState();
    const queue = selectors.activeQueue(state);
    haptic(HAPTIC.MEDIUM);

    if (this.#primary.currentTime > 3) {
      this.seek(0);
      return;
    }

    let index = state.queueIndex - 1;
    if (index < 0) {
      index = state.repeatMode === REPEAT_MODE.ALL ? queue.length - 1 : 0;
    }

    dispatch({ type: ACTION.SET_QUEUE_INDEX, payload: index });
    if (queue[index]) await this.play(queue[index]);
  }

  /**
   * Set volume (0–1)
   * @param {number} volume
   */
  setVolume(volume) {
    const v = clamp(volume, 0, 1);
    this.#primary.volume = v;
    this.#secondary.volume = 0;
    dispatch({ type: ACTION.SET_VOLUME, payload: v });

    if (this.#gainNodePrimary) {
      this.#gainNodePrimary.gain.setTargetAtTime(v, this.#context.currentTime, 0.01);
    }
  }

  /**
   * Set the playback queue without playing immediately.
   * @param {Track[]} tracks
   * @param {number} startIndex
   */
  setQueue(tracks, startIndex = 0) {
    dispatch({ type: ACTION.SET_QUEUE, payload: { queue: tracks, index: startIndex } });
  }

  /**
   * Add a track to the queue after the current position.
   * @param {Track} track
   */
  addToQueueNext(track) {
    const { queue, queueIndex } = getState();
    const newQueue = [
      ...queue.slice(0, queueIndex + 1),
      track,
      ...queue.slice(queueIndex + 1),
    ];
    dispatch({ type: ACTION.SET_QUEUE, payload: { queue: newQueue, index: queueIndex } });
    haptic(HAPTIC.SUCCESS);
  }

  /**
   * Crossfade to a new track (used by auto-advance)
   * @param {Track} nextTrack
   */
  async crossfadeTo(nextTrack) {
    const CROSSFADE_DURATION = ANIM.CROSSFADE_VISUAL;
    const streamUrl = getTrackStreamUrl(nextTrack);

    dispatch({ type: ACTION.SET_CROSSFADING, payload: true });

    // Load into secondary
    this.#secondary.src = streamUrl;
    this.#secondary.volume = 0;
    await this.#secondary.play().catch(() => {});

    // Fade primary out, secondary in
    const startTime = Date.now();
    const primaryStartVol = this.#primary.volume;
    const targetVol = getState().volume;

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / CROSSFADE_DURATION, 1);
      const eased = easeInOutCubic(t);

      this.#primary.volume = primaryStartVol * (1 - eased);
      this.#secondary.volume = targetVol * eased;

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        // Swap primary/secondary
        this.#primary.pause();
        this.#primary.src = '';

        const tmp = this.#primary;
        this.#primary = this.#secondary;
        this.#secondary = tmp;
        this.#secondary.volume = 0;

        dispatch({ type: ACTION.SET_CURRENT_TRACK, payload: nextTrack });
        dispatch({ type: ACTION.SET_CROSSFADING, payload: false });
        this.#attachPrimaryListeners();
        this.#startProgressTimer();
        logPlayEvent(nextTrack);
      }
    };

    requestAnimationFrame(tick);
  }

  /**
   * Preload next track's audio URL into browser cache.
   * Call this when playback reaches 85%.
   * @param {Track} track
   */
  preloadNext(track) {
    if (!track || this.#preloadedUrl === track.audio) return;
    this.#preloadedUrl = track.audio;

    if (this.#preloadAudio) {
      this.#preloadAudio.src = '';
    }
    this.#preloadAudio = new Audio();
    this.#preloadAudio.preload = 'metadata';
    this.#preloadAudio.src = getTrackStreamUrl(track);
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  #createAudioElement(id) {
    const audio = new Audio();
    audio.id = `aura-audio-${id}`;
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    return audio;
  }

  #initAudioContext() {
    try {
      this.#context = new (window.AudioContext || window.webkitAudioContext)();

      // Wire up gain nodes for crossfade control
      this.#gainNodePrimary = this.#context.createGain();
      this.#gainNodeSecondary = this.#context.createGain();

      const srcPrimary = this.#context.createMediaElementSource(this.#primary);
      const srcSecondary = this.#context.createMediaElementSource(this.#secondary);

      srcPrimary.connect(this.#gainNodePrimary);
      srcSecondary.connect(this.#gainNodeSecondary);
      this.#gainNodePrimary.connect(this.#context.destination);
      this.#gainNodeSecondary.connect(this.#context.destination);

      // Resume context on first user gesture
      const resumeContext = () => {
        if (this.#context.state === 'suspended') {
          this.#context.resume();
        }
        document.removeEventListener('click', resumeContext);
        document.removeEventListener('touchstart', resumeContext);
      };
      document.addEventListener('click', resumeContext);
      document.addEventListener('touchstart', resumeContext);
    } catch (err) {
      console.warn('[Player] AudioContext init failed — falling back to direct audio:', err);
      this.#context = null;
    }
  }

  async #loadAudio(url) {
    return new Promise((resolve, reject) => {
      // Remove old listeners from primary
      this.#detachPrimaryListeners();

      dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.LOADING });
      dispatch({ type: ACTION.SET_PROGRESS, payload: 0 });
      dispatch({ type: ACTION.SET_DURATION, payload: 0 });

      this.#primary.src = url;
      this.#primary.volume = getState().volume;
      this.#primary.currentTime = 0;

      const onCanPlay = async () => {
        cleanup();
        dispatch({ type: ACTION.SET_DURATION, payload: this.#primary.duration });

        try {
          await this.#primary.play();
          dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.PLAYING });
          this.#retryCount = 0;
          this.#startProgressTimer();
          this.#attachPrimaryListeners();
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      const onError = () => {
        cleanup();
        reject(new Error(ERROR_MSG.PLAYBACK));
      };

      const onWaiting = () => {
        dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.BUFFERING });
      };

      const cleanup = () => {
        this.#primary.removeEventListener('canplay', onCanPlay);
        this.#primary.removeEventListener('error', onError);
        this.#primary.removeEventListener('waiting', onWaiting);
      };

      this.#primary.addEventListener('canplay', onCanPlay, { once: true });
      this.#primary.addEventListener('error', onError, { once: true });
      this.#primary.addEventListener('waiting', onWaiting, { once: true });

      this.#primary.load();
    });
  }

  #attachPrimaryListeners() {
    this.#detachPrimaryListeners();

    this.#boundHandlers.ended = this.#onEnded.bind(this);
    this.#boundHandlers.error = this.#onError.bind(this);
    this.#boundHandlers.waiting = this.#onWaiting.bind(this);
    this.#boundHandlers.playing = this.#onPlaying.bind(this);
    this.#boundHandlers.durationchange = this.#onDurationChange.bind(this);

    this.#primary.addEventListener('ended', this.#boundHandlers.ended);
    this.#primary.addEventListener('error', this.#boundHandlers.error);
    this.#primary.addEventListener('waiting', this.#boundHandlers.waiting);
    this.#primary.addEventListener('playing', this.#boundHandlers.playing);
    this.#primary.addEventListener('durationchange', this.#boundHandlers.durationchange);
  }

  #detachPrimaryListeners() {
    for (const [event, handler] of Object.entries(this.#boundHandlers)) {
      this.#primary.removeEventListener(event, handler);
    }
    this.#boundHandlers = {};
  }

  async #onEnded() {
    const state = getState();
    const queue = selectors.activeQueue(state);
    this.#stopProgressTimer();

    if (state.repeatMode === REPEAT_MODE.ONE) {
      this.seek(0);
      await this.resume();
      return;
    }

    const nextIndex = state.queueIndex + 1;

    if (nextIndex < queue.length) {
      dispatch({ type: ACTION.SET_QUEUE_INDEX, payload: nextIndex });
      const nextTrack = queue[nextIndex];
      await this.crossfadeTo(nextTrack);
      dispatch({ type: ACTION.SET_CURRENT_TRACK, payload: nextTrack });
    } else if (state.repeatMode === REPEAT_MODE.ALL) {
      dispatch({ type: ACTION.SET_QUEUE_INDEX, payload: 0 });
      await this.play(queue[0]);
    } else {
      dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.ENDED });
      dispatch({ type: ACTION.SET_PROGRESS, payload: 0 });
    }
  }

  #onError() {
    dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.ERROR });
    dispatch({ type: ACTION.SET_ERROR, payload: ERROR_MSG.PLAYBACK });
    haptic(HAPTIC.ERROR);
  }

  #onWaiting() {
    dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.BUFFERING });
  }

  #onPlaying() {
    dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.PLAYING });
    this.#startProgressTimer();
  }

  #onDurationChange() {
    if (isFinite(this.#primary.duration)) {
      dispatch({ type: ACTION.SET_DURATION, payload: this.#primary.duration });
    }
  }

  #startProgressTimer() {
    this.#stopProgressTimer();
    this.#progressTimer = setInterval(() => {
      if (!this.#primary || this.#primary.paused) return;

      const current = this.#primary.currentTime;
      const duration = this.#primary.duration;

      dispatch({ type: ACTION.SET_PROGRESS, payload: current });

      // Preload next track when 85% through
      if (isFinite(duration) && duration > 0 && current / duration >= AUDIO.PRELOAD_NEXT_AT_PERCENT) {
        const state = getState();
        const queue = selectors.activeQueue(state);
        const nextIndex = state.queueIndex + 1;
        if (nextIndex < queue.length) {
          this.preloadNext(queue[nextIndex]);
        }
      }
    }, 250);
  }

  #stopProgressTimer() {
    if (this.#progressTimer) {
      clearInterval(this.#progressTimer);
      this.#progressTimer = null;
    }
  }

  #onVisibilityChange() {
    if (document.hidden) {
      // Keep audio running in background — this is intentional for a music app
      // We do NOT pause here.
    } else {
      // Resume AudioContext if it was suspended
      if (this.#context?.state === 'suspended') {
        this.#context.resume();
      }
    }
  }

  #bindStoreSubscriptions() {
    // When volume changes in store, apply to audio element
    select(selectors.volume, (volume) => {
      if (this.#primary) this.#primary.volume = volume;
    });
  }
}

// ─── Easing function ─────────────────────────────────────────────────────────

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

const audioPlayer = new AudioPlayer();
export default audioPlayer;
