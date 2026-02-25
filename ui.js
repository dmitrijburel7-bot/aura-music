// ui.js — AURA Music | DOM Rendering & Event Wiring
// The only module that reads/writes the DOM (besides components).
// Communicates with audio only through player.js (never directly).
// Communicates with data only through store.dispatch / store.select.

import { dispatch, getState, select, selectors } from './store.js';
import audioPlayer from './player.js';
import {
  springExpandPlayer,
  springCollapsePlayer,
  staggerFadeIn,
  transitionGradient,
  setAlbumArtRotation,
  toastEnter,
  toastExit,
  ripple,
} from './animations.js';
import {
  ACTION,
  PLAYER_STATE,
  PLAYER_SIZE,
  SCREEN,
  REPEAT_MODE,
  HAPTIC,
  ANIM,
  ERROR_MSG,
} from './constants.js';
import {
  formatTime,
  extractColors,
  haptic,
  qs,
  qsa,
  truncate,
  debounce,
} from './utils.js';
import { createTrackList, createTrackRow, createTrackCard, updateTrackCardActive, updateTrackCardLike } from './components/track-card.js';
import { showTrackOptionsModal, showProModal } from './components/modal.js';
import { searchTracks, getHomeSections, getTrendingTracks, logPlayEvent } from './api.js';

// ─── DOM References ───────────────────────────────────────────────────────────
// Cached at init time. Never query DOM repeatedly inside hot paths.

const DOM = {};

// ─── Initialisation ───────────────────────────────────────────────────────────

export function initUI() {
  cacheDOMRefs();
  bindNavigationEvents();
  bindSearchEvents();
  bindMiniPlayerEvents();
  bindFullPlayerEvents();
  setupStoreSubscriptions();
  renderHomeScreen();
}

function cacheDOMRefs() {
  // Screens
  DOM.homeScreen   = qs('#screen-home');
  DOM.searchScreen = qs('#screen-search');
  DOM.libraryScreen = qs('#screen-library');

  // Navigation
  DOM.navBtns = qsa('.nav__btn');
  DOM.navHome = qs('[data-screen="home"]');
  DOM.navSearch = qs('[data-screen="search"]');
  DOM.navLibrary = qs('[data-screen="library"]');

  // Mini player
  DOM.miniPlayer    = qs('#mini-player');
  DOM.miniCover     = qs('#mini-cover');
  DOM.miniTitle     = qs('#mini-title');
  DOM.miniArtist    = qs('#mini-artist');
  DOM.miniPlayBtn   = qs('#mini-play-btn');
  DOM.miniNextBtn   = qs('#mini-next-btn');
  DOM.miniProgress  = qs('#mini-progress');

  // Full player
  DOM.fullPlayer      = qs('#full-player');
  DOM.fullCover       = qs('#full-cover');
  DOM.fullCoverWrap   = qs('#full-cover-wrap');
  DOM.fullTitle       = qs('#full-title');
  DOM.fullArtist      = qs('#full-artist');
  DOM.fullAlbum       = qs('#full-album');
  DOM.fullPlayBtn     = qs('#full-play-btn');
  DOM.fullPrevBtn     = qs('#full-prev-btn');
  DOM.fullNextBtn     = qs('#full-next-btn');
  DOM.fullShuffleBtn  = qs('#full-shuffle-btn');
  DOM.fullRepeatBtn   = qs('#full-repeat-btn');
  DOM.fullLikeBtn     = qs('#full-like-btn');
  DOM.fullProgressBar = qs('#full-progress-bar');
  DOM.fullProgressFill = qs('#full-progress-fill');
  DOM.fullCurrentTime = qs('#full-current-time');
  DOM.fullDuration    = qs('#full-duration');
  DOM.fullVolumeSlider = qs('#full-volume');
  DOM.fullCollapseBtn = qs('#full-collapse-btn');
  DOM.fullProBtn      = qs('#full-pro-btn');

  // Search
  DOM.searchInput     = qs('#search-input');
  DOM.searchClearBtn  = qs('#search-clear');
  DOM.searchResults   = qs('#search-results');
  DOM.searchEmpty     = qs('#search-empty');
  DOM.searchLoader    = qs('#search-loader');

  // Home
  DOM.homeContent     = qs('#home-content');
  DOM.homeSections    = qs('#home-sections');
  DOM.homeLoader      = qs('#home-loader');

  // Library
  DOM.libraryList     = qs('#library-list');
  DOM.libraryEmpty    = qs('#library-empty');

  // Toast
  DOM.toast           = qs('#toast');

  // Background gradient overlay
  DOM.gradientBg      = qs('#gradient-bg');
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function bindNavigationEvents() {
  DOM.navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const screen = btn.dataset.screen;
      haptic(HAPTIC.SELECT);
      dispatch({ type: ACTION.SET_SCREEN, payload: screen });
    });

    // Add ripple to nav buttons
    btn.addEventListener('click', (e) => ripple(btn, e, 'rgba(255,255,255,0.15)'));
  });
}

function showScreen(screen) {
  const screens = {
    [SCREEN.HOME]: DOM.homeScreen,
    [SCREEN.SEARCH]: DOM.searchScreen,
    [SCREEN.LIBRARY]: DOM.libraryScreen,
  };

  Object.entries(screens).forEach(([key, el]) => {
    if (!el) return;
    const isActive = key === screen;
    el.classList.toggle('screen--active', isActive);
    el.setAttribute('aria-hidden', String(!isActive));
  });

  // Update nav active state
  DOM.navBtns.forEach(btn => {
    btn.classList.toggle('nav__btn--active', btn.dataset.screen === screen);
  });

  // Lazy render screens on first visit
  if (screen === SCREEN.SEARCH && DOM.searchInput) {
    setTimeout(() => DOM.searchInput.focus(), 200);
  }
  if (screen === SCREEN.LIBRARY) {
    renderLibraryScreen();
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────

function bindSearchEvents() {
  if (!DOM.searchInput) return;

  const debouncedSearch = debounce(async (query) => {
    if (!query || query.trim().length < 2) {
      DOM.searchResults && (DOM.searchResults.innerHTML = '');
      DOM.searchEmpty && (DOM.searchEmpty.style.display = 'block');
      return;
    }

    setSearchLoading(true);
    try {
      const results = await searchTracks(query.trim());
      dispatch({ type: ACTION.SET_SEARCH_RESULTS, payload: results });
      renderSearchResults(results, query.trim());
    } catch (err) {
      showToast(err.message || ERROR_MSG.NETWORK, 'error');
    } finally {
      setSearchLoading(false);
    }
  }, 380);

  DOM.searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    dispatch({ type: ACTION.SET_SEARCH_QUERY, payload: query });
    DOM.searchClearBtn && (DOM.searchClearBtn.style.display = query ? 'flex' : 'none');
    DOM.searchEmpty && (DOM.searchEmpty.style.display = query ? 'none' : 'block');
    debouncedSearch(query);
  });

  DOM.searchClearBtn?.addEventListener('click', () => {
    DOM.searchInput.value = '';
    dispatch({ type: ACTION.SET_SEARCH_QUERY, payload: '' });
    DOM.searchResults.innerHTML = '';
    DOM.searchClearBtn.style.display = 'none';
    DOM.searchEmpty && (DOM.searchEmpty.style.display = 'block');
    DOM.searchInput.focus();
    haptic(HAPTIC.LIGHT);
  });
}

function setSearchLoading(loading) {
  if (DOM.searchLoader) DOM.searchLoader.style.display = loading ? 'flex' : 'none';
  if (DOM.searchResults) DOM.searchResults.style.opacity = loading ? '0.4' : '1';
}

function renderSearchResults(tracks, query) {
  if (!DOM.searchResults) return;
  DOM.searchResults.innerHTML = '';

  if (!tracks.length) {
    DOM.searchResults.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon">🔍</span>
        <p class="empty-state__text">No results for "<strong>${truncate(query, 30)}</strong>"</p>
        <p class="empty-state__hint">Try a different keyword or genre.</p>
      </div>
    `;
    return;
  }

  const { likedTrackIds, currentTrack } = getState();

  const list = createTrackList(tracks, getTrackCallbacks(), likedTrackIds, currentTrack?.id);
  DOM.searchResults.appendChild(list);
}

// ─── Home Screen ──────────────────────────────────────────────────────────────

async function renderHomeScreen() {
  if (!DOM.homeContent) return;
  DOM.homeLoader && (DOM.homeLoader.style.display = 'flex');
  DOM.homeSections && (DOM.homeSections.innerHTML = '');

  try {
    const [trending, sections] = await Promise.all([
      getTrendingTracks(10),
      getHomeSections(),
    ]);

    dispatch({ type: ACTION.SET_FEATURED_TRACKS, payload: trending });

    if (DOM.homeLoader) DOM.homeLoader.style.display = 'none';
    if (DOM.homeSections) {
      // Trending row
      renderHomeSection('🔥 Trending Now', trending, DOM.homeSections);

      // Genre sections
      sections.forEach(({ genre, tracks }) => {
        const sectionName = genre.charAt(0).toUpperCase() + genre.slice(1);
        renderHomeSection(`✦ ${sectionName}`, tracks, DOM.homeSections);
      });
    }
  } catch (err) {
    if (DOM.homeLoader) DOM.homeLoader.style.display = 'none';
    if (DOM.homeSections) {
      DOM.homeSections.innerHTML = `
        <div class="empty-state">
          <span class="empty-state__icon">📡</span>
          <p class="empty-state__text">Couldn't load tracks.</p>
          <button class="btn btn--secondary" id="home-retry">Retry</button>
        </div>
      `;
      qs('#home-retry')?.addEventListener('click', renderHomeScreen);
    }
  }
}

function renderHomeSection(title, tracks, container) {
  if (!container || !tracks.length) return;

  const section = document.createElement('section');
  section.className = 'home-section';

  const heading = document.createElement('h2');
  heading.className = 'home-section__title';
  heading.textContent = title;

  const row = createTrackRow(tracks, getTrackCallbacks());

  section.appendChild(heading);
  section.appendChild(row);
  container.appendChild(section);

  // Animate section in
  staggerFadeIn([section], container.children.length * 30);
}

// ─── Library Screen ───────────────────────────────────────────────────────────

function renderLibraryScreen() {
  if (!DOM.libraryList) return;

  const { library, likedTrackIds, currentTrack } = getState();
  DOM.libraryList.innerHTML = '';

  if (!library.length) {
    if (DOM.libraryEmpty) DOM.libraryEmpty.style.display = 'flex';
    return;
  }

  if (DOM.libraryEmpty) DOM.libraryEmpty.style.display = 'none';

  const list = createTrackList(library, getTrackCallbacks(), likedTrackIds, currentTrack?.id);
  DOM.libraryList.appendChild(list);
}

// ─── Mini Player ──────────────────────────────────────────────────────────────

function bindMiniPlayerEvents() {
  DOM.miniPlayer?.addEventListener('click', (e) => {
    if (e.target.closest('#mini-play-btn') || e.target.closest('#mini-next-btn')) return;
    expandPlayer();
  });

  DOM.miniPlayBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    haptic(HAPTIC.MEDIUM);
    audioPlayer.toggle();
  });

  DOM.miniNextBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    haptic(HAPTIC.MEDIUM);
    audioPlayer.next();
  });
}

function updateMiniPlayer(track, playerState, progress, duration) {
  if (!DOM.miniPlayer) return;

  const hasTrack = !!track;
  DOM.miniPlayer.classList.toggle('mini-player--visible', hasTrack);

  if (!hasTrack) return;

  if (DOM.miniCover) {
    DOM.miniCover.src = track.image || '';
    DOM.miniCover.alt = track.name;
  }
  if (DOM.miniTitle) DOM.miniTitle.textContent = truncate(track.name, 28);
  if (DOM.miniArtist) DOM.miniArtist.textContent = truncate(track.artist_name, 24);

  const isPlaying = playerState === PLAYER_STATE.PLAYING || playerState === PLAYER_STATE.BUFFERING;
  if (DOM.miniPlayBtn) {
    DOM.miniPlayBtn.innerHTML = isPlaying ? pauseIcon() : playIcon();
    DOM.miniPlayBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  // Progress bar
  if (DOM.miniProgress && duration > 0) {
    DOM.miniProgress.style.width = `${(progress / duration) * 100}%`;
  }
}

// ─── Full Player ──────────────────────────────────────────────────────────────

function bindFullPlayerEvents() {
  // Collapse
  DOM.fullCollapseBtn?.addEventListener('click', () => {
    haptic(HAPTIC.LIGHT);
    collapsePlayer();
  });

  // Swipe down to close (touch gesture)
  let touchStartY = 0;
  DOM.fullPlayer?.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  DOM.fullPlayer?.addEventListener('touchmove', (e) => {
    const delta = e.touches[0].clientY - touchStartY;
    if (delta > 0 && delta < 200) {
      DOM.fullPlayer.style.transform = `translateY(${delta * 0.5}px)`;
    }
  }, { passive: true });

  DOM.fullPlayer?.addEventListener('touchend', (e) => {
    const delta = e.changedTouches[0].clientY - touchStartY;
    if (delta > 80) {
      collapsePlayer();
    } else {
      DOM.fullPlayer.style.transform = '';
    }
  });

  // Playback controls
  DOM.fullPlayBtn?.addEventListener('click', () => {
    haptic(HAPTIC.MEDIUM);
    audioPlayer.toggle();
  });

  DOM.fullPrevBtn?.addEventListener('click', () => {
    haptic(HAPTIC.MEDIUM);
    audioPlayer.prev();
  });

  DOM.fullNextBtn?.addEventListener('click', () => {
    haptic(HAPTIC.MEDIUM);
    audioPlayer.next();
  });

  // Seek bar
  DOM.fullProgressBar?.addEventListener('click', (e) => {
    const rect = DOM.fullProgressBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const { duration } = getState();
    audioPlayer.seek(pct * duration);
    haptic(HAPTIC.SELECT);
  });

  // Touch scrubbing
  let isScrubbing = false;
  DOM.fullProgressBar?.addEventListener('touchstart', () => { isScrubbing = true; }, { passive: true });
  DOM.fullProgressBar?.addEventListener('touchmove', (e) => {
    if (!isScrubbing) return;
    const rect = DOM.fullProgressBar.getBoundingClientRect();
    const x = e.touches[0].clientX;
    const pct = Math.min(1, Math.max(0, (x - rect.left) / rect.width));
    const { duration } = getState();
    if (DOM.fullProgressFill) DOM.fullProgressFill.style.width = `${pct * 100}%`;
    if (DOM.fullCurrentTime) DOM.fullCurrentTime.textContent = formatTime(pct * duration);
  }, { passive: true });
  DOM.fullProgressBar?.addEventListener('touchend', (e) => {
    if (!isScrubbing) return;
    isScrubbing = false;
    const rect = DOM.fullProgressBar.getBoundingClientRect();
    const x = e.changedTouches[0].clientX;
    const pct = Math.min(1, Math.max(0, (x - rect.left) / rect.width));
    const { duration } = getState();
    audioPlayer.seek(pct * duration);
    haptic(HAPTIC.SELECT);
  });

  // Volume
  DOM.fullVolumeSlider?.addEventListener('input', (e) => {
    audioPlayer.setVolume(parseFloat(e.target.value));
  });

  // Shuffle
  DOM.fullShuffleBtn?.addEventListener('click', () => {
    haptic(HAPTIC.MEDIUM);
    dispatch({ type: ACTION.TOGGLE_SHUFFLE });
  });

  // Repeat
  DOM.fullRepeatBtn?.addEventListener('click', () => {
    haptic(HAPTIC.MEDIUM);
    const modes = [REPEAT_MODE.NONE, REPEAT_MODE.ALL, REPEAT_MODE.ONE];
    const current = getState().repeatMode;
    const next = modes[(modes.indexOf(current) + 1) % modes.length];
    dispatch({ type: ACTION.SET_REPEAT_MODE, payload: next });
  });

  // Like
  DOM.fullLikeBtn?.addEventListener('click', () => {
    const { currentTrack, likedTrackIds } = getState();
    if (!currentTrack) return;
    const isLiked = likedTrackIds.has(currentTrack.id);
    haptic(isLiked ? HAPTIC.LIGHT : HAPTIC.SUCCESS);
    dispatch({ type: ACTION.TOGGLE_LIKED, payload: { trackId: currentTrack.id, track: currentTrack } });
  });

  // Pro button
  DOM.fullProBtn?.addEventListener('click', () => {
    haptic(HAPTIC.MEDIUM);
    showProModal({ onPurchaseComplete: () => {
      updateProStatus(true);
    }});
  });
}

function updateFullPlayer(track, playerState, progress, duration, state) {
  if (!DOM.fullPlayer || !track) return;

  if (DOM.fullCover) {
    if (DOM.fullCover.src !== track.image) {
      DOM.fullCover.src = track.image || '';
    }
  }
  if (DOM.fullTitle) DOM.fullTitle.textContent = track.name;
  if (DOM.fullArtist) DOM.fullArtist.textContent = track.artist_name;
  if (DOM.fullAlbum) DOM.fullAlbum.textContent = track.album_name || '';

  const isPlaying = playerState === PLAYER_STATE.PLAYING;
  const isBuffering = playerState === PLAYER_STATE.BUFFERING;

  if (DOM.fullPlayBtn) {
    DOM.fullPlayBtn.innerHTML = isPlaying || isBuffering ? pauseIcon() : playIcon();
    DOM.fullPlayBtn.classList.toggle('full-player__play--buffering', isBuffering);
  }

  // Progress
  if (DOM.fullProgressFill && duration > 0) {
    DOM.fullProgressFill.style.width = `${(progress / duration) * 100}%`;
  }
  if (DOM.fullCurrentTime) DOM.fullCurrentTime.textContent = formatTime(progress);
  if (DOM.fullDuration) DOM.fullDuration.textContent = formatTime(duration);

  // Like state
  const isLiked = state.likedTrackIds.has(track.id);
  if (DOM.fullLikeBtn) {
    DOM.fullLikeBtn.classList.toggle('full-player__like--active', isLiked);
    DOM.fullLikeBtn.innerHTML = isLiked ? heartFilledIcon() : heartOutlineIcon();
  }

  // Shuffle / Repeat
  if (DOM.fullShuffleBtn) {
    DOM.fullShuffleBtn.classList.toggle('full-player__shuffle--active', state.shuffle);
  }
  if (DOM.fullRepeatBtn) {
    DOM.fullRepeatBtn.innerHTML = repeatIcon(state.repeatMode);
    DOM.fullRepeatBtn.classList.toggle('full-player__repeat--active', state.repeatMode !== REPEAT_MODE.NONE);
  }

  // Album art rotation
  setAlbumArtRotation(DOM.fullCover, isPlaying);

  // Volume
  if (DOM.fullVolumeSlider) DOM.fullVolumeSlider.value = String(state.volume);

  // Pro badge visibility
  if (DOM.fullProBtn) DOM.fullProBtn.style.display = state.isPro ? 'none' : 'flex';
}

// ─── Player Expand / Collapse ─────────────────────────────────────────────────

export function expandPlayer() {
  if (!DOM.fullPlayer) return;
  dispatch({ type: ACTION.SET_PLAYER_SIZE, payload: PLAYER_SIZE.FULL });
  DOM.fullPlayer.style.display = 'flex';
  DOM.fullPlayer.style.pointerEvents = 'auto';
  springExpandPlayer(DOM.fullPlayer);
  haptic(HAPTIC.LIGHT);
}

export function collapsePlayer() {
  if (!DOM.fullPlayer) return;
  dispatch({ type: ACTION.SET_PLAYER_SIZE, payload: PLAYER_SIZE.MINI });

  const anim = springCollapsePlayer(DOM.fullPlayer);
  anim?.addEventListener('finish', () => {
    DOM.fullPlayer.style.display = 'none';
    DOM.fullPlayer.style.transform = '';
  });
  haptic(HAPTIC.LIGHT);
}

// ─── Color Extraction & Gradient Update ──────────────────────────────────────

let _lastColorUrl = '';
let _currentPalette = { primary: '#1a1a2e', secondary: '#16213e', accent: '#e94560' };

async function updateGradientFromTrack(track) {
  if (!track?.image || track.image === _lastColorUrl) return;
  _lastColorUrl = track.image;

  try {
    const palette = await extractColors(track.image);
    dispatch({ type: ACTION.SET_DOMINANT_COLOR, payload: palette });

    transitionGradient(
      document.documentElement,
      _currentPalette,
      palette,
      ANIM.COLOR_TRANSITION
    );

    _currentPalette = palette;
  } catch {
    // Keep previous gradient
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let _toastTimer = null;
let _currentToastAnim = null;

export function showToast(message, type = 'info') {
  dispatch({ type: ACTION.SHOW_TOAST, payload: { message, type } });
}

function renderToast({ message, type }) {
  if (!DOM.toast) return;

  clearTimeout(_toastTimer);

  DOM.toast.className = `toast toast--${type}`;
  DOM.toast.textContent = message;
  DOM.toast.style.display = 'block';
  DOM.toast.style.transform = 'translateY(80px) translateX(-50%)';
  DOM.toast.style.opacity = '0';

  requestAnimationFrame(() => {
    toastEnter(DOM.toast);

    _toastTimer = setTimeout(async () => {
      await toastExit(DOM.toast);
      DOM.toast.style.display = 'none';
      dispatch({ type: ACTION.HIDE_TOAST });
    }, ANIM.TOAST_DURATION);
  });
}

// ─── Store Subscriptions ──────────────────────────────────────────────────────

function setupStoreSubscriptions() {
  // Current track changed
  select(selectors.currentTrack, (track) => {
    updateMiniPlayer(track, getState().playerState, getState().progress, getState().duration);
    updateFullPlayer(track, getState().playerState, getState().progress, getState().duration, getState());
    if (track) updateGradientFromTrack(track);
    syncActiveTrackCards(track?.id);
  });

  // Player state changed
  select(selectors.playerState, (playerState) => {
    const s = getState();
    updateMiniPlayer(s.currentTrack, playerState, s.progress, s.duration);
    updateFullPlayer(s.currentTrack, playerState, s.progress, s.duration, s);
  });

  // Progress (high frequency — only updates progress bar)
  select(selectors.progress, (progress) => {
    const { duration } = getState();
    if (DOM.miniProgress && duration > 0) {
      DOM.miniProgress.style.width = `${(progress / duration) * 100}%`;
    }
    if (DOM.fullProgressFill && duration > 0) {
      DOM.fullProgressFill.style.width = `${(progress / duration) * 100}%`;
    }
    if (DOM.fullCurrentTime) DOM.fullCurrentTime.textContent = formatTime(progress);
  });

  // Duration
  select(selectors.duration, (duration) => {
    if (DOM.fullDuration) DOM.fullDuration.textContent = formatTime(duration);
  });

  // Screen change
  select(selectors.screen, (screen) => {
    showScreen(screen);
  });

  // Liked tracks
  select(selectors.likedTrackIds, () => {
    const { currentTrack, likedTrackIds } = getState();
    if (currentTrack && DOM.fullLikeBtn) {
      const isLiked = likedTrackIds.has(currentTrack.id);
      DOM.fullLikeBtn.classList.toggle('full-player__like--active', isLiked);
      DOM.fullLikeBtn.innerHTML = isLiked ? heartFilledIcon() : heartOutlineIcon();
    }
    syncLikeStates();
  });

  // Shuffle
  select(selectors.isShuffle, (shuffle) => {
    DOM.fullShuffleBtn?.classList.toggle('full-player__shuffle--active', shuffle);
  });

  // Repeat
  select(selectors.repeatMode, (mode) => {
    if (DOM.fullRepeatBtn) {
      DOM.fullRepeatBtn.innerHTML = repeatIcon(mode);
      DOM.fullRepeatBtn.classList.toggle('full-player__repeat--active', mode !== REPEAT_MODE.NONE);
    }
  });

  // Toast
  select(selectors.toast, (toast) => {
    if (toast) renderToast(toast);
  });

  // Library changes
  select(selectors.library, () => {
    const { screen } = getState();
    if (screen === SCREEN.LIBRARY) renderLibraryScreen();
  });

  // Pro status
  select(selectors.isPro, (isPro) => {
    updateProStatus(isPro);
  });
}

// ─── Sync Active Track in All Lists ──────────────────────────────────────────

function syncActiveTrackCards(activeId) {
  qsa('.track-card').forEach(card => {
    const isActive = card.dataset.trackId === activeId;
    updateTrackCardActive(card, isActive);
  });
}

function syncLikeStates() {
  const { likedTrackIds } = getState();
  qsa('.track-card').forEach(card => {
    const id = card.dataset.trackId;
    if (id) updateTrackCardLike(card, likedTrackIds.has(id));
  });
}

// ─── Pro Status Update ────────────────────────────────────────────────────────

function updateProStatus(isPro) {
  document.body.classList.toggle('is-pro', isPro);
  if (DOM.fullProBtn) DOM.fullProBtn.style.display = isPro ? 'none' : 'flex';
}

// ─── Track Callbacks (shared between all lists) ───────────────────────────────

function getTrackCallbacks() {
  return {
    onPlay: (track) => {
      const { featuredTracks, searchResults, library } = getState();
      // Determine which queue to use based on context
      const queue = searchResults.length
        ? searchResults
        : featuredTracks.length
        ? featuredTracks
        : library;
      const idx = queue.findIndex(t => t.id === track.id);
      audioPlayer.play(track, queue, Math.max(0, idx));
      logPlayEvent(track);
    },
    onLike: (track) => {
      const { likedTrackIds } = getState();
      haptic(likedTrackIds.has(track.id) ? HAPTIC.LIGHT : HAPTIC.SUCCESS);
      dispatch({ type: ACTION.TOGGLE_LIKED, payload: { trackId: track.id, track } });
    },
    onAddToQueue: (track) => {
      audioPlayer.addToQueueNext(track);
      showToast(`"${truncate(track.name, 20)}" added to queue`, 'success');
    },
    onMoreOptions: (track, anchorEl) => {
      showTrackOptionsModal(track, {
        onAddToQueue: (t) => audioPlayer.addToQueueNext(t),
        onAddToLibrary: (t) => {
          dispatch({ type: ACTION.ADD_TO_LIBRARY, payload: t });
          showToast('Added to library', 'success');
        },
        onViewArtist: (t) => {
          dispatch({ type: ACTION.SET_SEARCH_QUERY, payload: t.artist_name });
          dispatch({ type: ACTION.SET_SCREEN, payload: SCREEN.SEARCH });
          // Trigger search
          setTimeout(() => {
            if (DOM.searchInput) DOM.searchInput.value = t.artist_name;
            DOM.searchInput?.dispatchEvent(new Event('input'));
          }, 100);
        },
      });
    },
  };
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function playIcon() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>`;
}

function pauseIcon() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
}

function heartFilledIcon() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
}

function heartOutlineIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
}

function repeatIcon(mode) {
  if (mode === REPEAT_MODE.ONE) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><line x1="11" y1="12" x2="13" y2="12" stroke-width="2.5"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
}
