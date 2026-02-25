// player.js — AURA Music | Audio Engine
// The only module that touches Web Audio API / HTMLAudioElement.
// All state changes go through store.dispatch(). UI never calls audio directly.

// ─── ИСПРАВЛЕНИЕ #2 ───────────────────────────────────────────────────────────
// AudioContext создавался в конструкторе new AudioPlayer() — на верхнем уровне
// модуля, сразу при import. Браузер (Chrome 70+, Safari) запрещает создание
// AudioContext без предшествующего пользовательского жеста (autoplay policy).
// В лучшем случае контекст попадал в состояние 'suspended' и выбрасывал
// предупреждение; в худшем — бросал DOMException, который прерывал весь
// импорт модуля. Плюс crossOrigin = 'anonymous' на HTMLAudioElement без
// соответствующих CORS-заголовков на Jamendo ломал createMediaElementSource().
//
// Решение:
//   1. AudioContext создаётся лениво — только после первого клика/тапа.
//   2. createMediaElementSource() вызывается только внутри того же обработчика.
//   3. Без AudioContext плеер работает через прямой .volume — функциональность
//      сохраняется полностью.
// ─────────────────────────────────────────────────────────────────────────────

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
} from './utils.js';

// ─── AudioPlayer Class ────────────────────────────────────────────────────────

class AudioPlayer {
  #primary = null;          // HTMLAudioElement — текущий трек
  #secondary = null;        // HTMLAudioElement — для кроссфейда
  #context = null;          // AudioContext — создаётся лениво
  #gainNodePrimary = null;
  #gainNodeSecondary = null;
  #audioContextReady = false; // флаг: WebAudio подключён к элементам
  #progressTimer = null;
  #retryCount = 0;
  #preloadedUrl = null;
  #preloadAudio = null;
  #boundHandlers = {};

  constructor() {
    // Создаём Audio-элементы БЕЗ crossOrigin — Jamendo не шлёт CORS-заголовки
    // для аудиофайлов, crossOrigin='anonymous' ломает createMediaElementSource.
    this.#primary   = this.#createAudioElement('primary');
    this.#secondary = this.#createAudioElement('secondary');

    // Регистрируем ленивую инициализацию AudioContext
    this.#scheduleAudioContextInit();

    // Подписываемся на изменение volume в store
    this.#bindStoreSubscriptions();

    // Не паузим при скрытии вкладки — музыкальное приложение
    document.addEventListener('visibilitychange', this.#onVisibilityChange.bind(this));
  }

  // ─── Public Interface ──────────────────────────────────────────────────────

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

      if (this.#retryCount < AUDIO.MAX_RETRIES) {
        this.#retryCount++;
        await sleep(AUDIO.RETRY_DELAY_MS);
        await this.next();
      }
    }
  }

  async resume() {
    if (!this.#primary.src) return;
    try {
      // Инициализируем AudioContext при первом жесте (если ещё не готов)
      this.#tryInitAudioContext();
      await this.#primary.play();
      dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.PLAYING });
      this.#startProgressTimer();
      haptic(HAPTIC.LIGHT);
    } catch (err) {
      console.error('[Player] Resume error:', err);
    }
  }

  pause() {
    this.#primary.pause();
    dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.PAUSED });
    this.#stopProgressTimer();
    haptic(HAPTIC.LIGHT);
  }

  async toggle() {
    const { playerState } = getState();
    if (playerState === PLAYER_STATE.PLAYING) {
      this.pause();
    } else {
      await this.resume();
    }
  }

  seek(seconds) {
    const duration = this.#primary.duration;
    if (!isFinite(duration)) return;
    const time = clamp(seconds, 0, duration);
    this.#primary.currentTime = time;
    dispatch({ type: ACTION.SET_PROGRESS, payload: time });
    haptic(HAPTIC.SELECT);
  }

  seekRelative(delta) {
    this.seek(this.#primary.currentTime + delta);
  }

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

  setVolume(volume) {
    const v = clamp(volume, 0, 1);
    this.#primary.volume = v;
    this.#secondary.volume = 0;
    dispatch({ type: ACTION.SET_VOLUME, payload: v });

    // Если AudioContext уже поднят — обновляем и через GainNode
    if (this.#gainNodePrimary && this.#context) {
      this.#gainNodePrimary.gain.setTargetAtTime(v, this.#context.currentTime, 0.01);
    }
  }

  setQueue(tracks, startIndex = 0) {
    dispatch({ type: ACTION.SET_QUEUE, payload: { queue: tracks, index: startIndex } });
  }

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

  async crossfadeTo(nextTrack) {
    const CROSSFADE_DURATION = ANIM.CROSSFADE_VISUAL;
    const streamUrl = getTrackStreamUrl(nextTrack);

    dispatch({ type: ACTION.SET_CROSSFADING, payload: true });

    this.#secondary.src = streamUrl;
    this.#secondary.volume = 0;
    await this.#secondary.play().catch(() => {});

    const startTime = Date.now();
    const primaryStartVol = this.#primary.volume;
    const targetVol = getState().volume;

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / CROSSFADE_DURATION, 1);
      const eased = easeInOutCubic(t);

      this.#primary.volume  = primaryStartVol * (1 - eased);
      this.#secondary.volume = targetVol * eased;

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        this.#primary.pause();
        this.#primary.src = '';

        const tmp = this.#primary;
        this.#primary   = this.#secondary;
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

  // ─── Private: Audio Element ────────────────────────────────────────────────

  #createAudioElement(id) {
    const audio = new Audio();
    audio.id = `aura-audio-${id}`;
    audio.preload = 'auto';
    // НЕ ставим crossOrigin='anonymous' — Jamendo не шлёт нужные CORS-заголовки
    // для mp3-стримов, что ломает createMediaElementSource в Safari/Chrome.
    return audio;
  }

  // ─── Private: Lazy AudioContext Init ──────────────────────────────────────
  // Регистрируем обработчик один раз. После первого клика/тапа создаём
  // AudioContext и подключаем к нему Audio-элементы.

  #scheduleAudioContextInit() {
    const init = () => {
      this.#tryInitAudioContext();
      document.removeEventListener('click',      init);
      document.removeEventListener('touchstart', init);
    };
    document.addEventListener('click',      init, { once: true, passive: true });
    document.addEventListener('touchstart', init, { once: true, passive: true });
  }

  #tryInitAudioContext() {
    if (this.#audioContextReady) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.#context = new AudioCtx();

      this.#gainNodePrimary   = this.#context.createGain();
      this.#gainNodeSecondary = this.#context.createGain();

      // createMediaElementSource можно вызвать только ОДИН раз на элемент.
      // Если ранее уже была попытка (повторный клик после ошибки) — пропускаем.
      const srcPrimary   = this.#context.createMediaElementSource(this.#primary);
      const srcSecondary = this.#context.createMediaElementSource(this.#secondary);

      srcPrimary.connect(this.#gainNodePrimary);
      srcSecondary.connect(this.#gainNodeSecondary);
      this.#gainNodePrimary.connect(this.#context.destination);
      this.#gainNodeSecondary.connect(this.#context.destination);

      // Применяем текущее значение volume из store
      const vol = getState().volume;
      this.#gainNodePrimary.gain.setValueAtTime(vol, this.#context.currentTime);

      this.#audioContextReady = true;
      console.info('[Player] AudioContext ready:', this.#context.state);
    } catch (err) {
      // Продолжаем без AudioContext — плеер работает через .volume напрямую
      console.warn('[Player] AudioContext unavailable, using direct volume:', err.message);
      this.#context = null;
    }
  }

  // ─── Private: Load Audio ───────────────────────────────────────────────────

  async #loadAudio(url) {
    return new Promise((resolve, reject) => {
      this.#detachPrimaryListeners();

      dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.LOADING });
      dispatch({ type: ACTION.SET_PROGRESS,     payload: 0 });
      dispatch({ type: ACTION.SET_DURATION,     payload: 0 });

      this.#primary.src         = url;
      this.#primary.volume      = getState().volume;
      this.#primary.currentTime = 0;

      const onCanPlay = async () => {
        cleanup();
        dispatch({ type: ACTION.SET_DURATION, payload: this.#primary.duration });

        // Если AudioContext в suspended (autoplay block) — resume перед play()
        if (this.#context?.state === 'suspended') {
          await this.#context.resume().catch(() => {});
        }

        try {
          await this.#primary.play();
          dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.PLAYING });
          this.#retryCount = 0;
          this.#startProgressTimer();
          this.#attachPrimaryListeners();
          resolve();
        } catch (err) {
          // NotAllowedError = браузер заблокировал autoplay.
          // Ставим PAUSED — пользователь нажмёт play вручную.
          if (err.name === 'NotAllowedError') {
            dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.PAUSED });
            this.#attachPrimaryListeners();
            resolve(); // не reject — трек загружен, просто ждём жеста
          } else {
            reject(err);
          }
        }
      };

      const onError = () => {
        cleanup();
        reject(new Error(`${ERROR_MSG.PLAYBACK} (src: ${url})`));
      };

      const onWaiting = () => {
        dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.BUFFERING });
      };

      const cleanup = () => {
        this.#primary.removeEventListener('canplay', onCanPlay);
        this.#primary.removeEventListener('error',   onError);
        this.#primary.removeEventListener('waiting', onWaiting);
      };

      this.#primary.addEventListener('canplay',  onCanPlay,  { once: true });
      this.#primary.addEventListener('error',    onError,    { once: true });
      this.#primary.addEventListener('waiting',  onWaiting,  { once: true });

      this.#primary.load();
    });
  }

  // ─── Private: Event Listeners ──────────────────────────────────────────────

  #attachPrimaryListeners() {
    this.#detachPrimaryListeners();

    this.#boundHandlers.ended          = this.#onEnded.bind(this);
    this.#boundHandlers.error          = this.#onError.bind(this);
    this.#boundHandlers.waiting        = this.#onWaiting.bind(this);
    this.#boundHandlers.playing        = this.#onPlaying.bind(this);
    this.#boundHandlers.durationchange = this.#onDurationChange.bind(this);

    this.#primary.addEventListener('ended',          this.#boundHandlers.ended);
    this.#primary.addEventListener('error',          this.#boundHandlers.error);
    this.#primary.addEventListener('waiting',        this.#boundHandlers.waiting);
    this.#primary.addEventListener('playing',        this.#boundHandlers.playing);
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
      await this.crossfadeTo(queue[nextIndex]);
      dispatch({ type: ACTION.SET_CURRENT_TRACK, payload: queue[nextIndex] });
    } else if (state.repeatMode === REPEAT_MODE.ALL) {
      dispatch({ type: ACTION.SET_QUEUE_INDEX, payload: 0 });
      await this.play(queue[0]);
    } else {
      dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.ENDED });
      dispatch({ type: ACTION.SET_PROGRESS,     payload: 0 });
    }
  }

  #onError() {
    dispatch({ type: ACTION.SET_PLAYER_STATE, payload: PLAYER_STATE.ERROR });
    dispatch({ type: ACTION.SET_ERROR,        payload: ERROR_MSG.PLAYBACK });
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

  // ─── Private: Progress Timer ───────────────────────────────────────────────

  #startProgressTimer() {
    this.#stopProgressTimer();
    this.#progressTimer = setInterval(() => {
      if (!this.#primary || this.#primary.paused) return;

      const current  = this.#primary.currentTime;
      const duration = this.#primary.duration;

      dispatch({ type: ACTION.SET_PROGRESS, payload: current });

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

  // ─── Private: Visibility / Store ──────────────────────────────────────────

  #onVisibilityChange() {
    if (!document.hidden && this.#context?.state === 'suspended') {
      this.#context.resume().catch(() => {});
    }
  }

  #bindStoreSubscriptions() {
    select(selectors.volume, (volume) => {
      if (this.#primary) this.#primary.volume = volume;
      if (this.#gainNodePrimary && this.#context) {
        this.#gainNodePrimary.gain.setTargetAtTime(volume, this.#context.currentTime, 0.01);
      }
    });
  }
}

// ─── Easing function ─────────────────────────────────────────────────────────

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Singleton Export ─────────────────────────────────────────────────────────
// new AudioPlayer() здесь безопасен: конструктор теперь НЕ создаёт AudioContext.
// Он только создаёт два HTMLAudioElement и регистрирует один click/touchstart
// listener — никаких исключений при импорте модуля.

const audioPlayer = new AudioPlayer();
export default audioPlayer;
