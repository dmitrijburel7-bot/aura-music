// ui/player/mini-player.js — AURA Music | Mini Player Controller
// Owns: #mini-player DOM. Dispatches to audioPlayer only. Reads from store only.

import { select, getState, selectors } from '../../store.js';
import audioPlayer from '../../player.js';
import { qs, formatTime, truncate, haptic } from '../../utils.js';
import { PLAYER_STATE, HAPTIC } from '../../constants.js';

const D = {};

export function initMiniPlayer(options = {}) {
  D.player   = qs('#mini-player');
  D.cover    = qs('#mini-cover');
  D.title    = qs('#mini-title');
  D.artist   = qs('#mini-artist');
  D.playBtn  = qs('#mini-play-btn');
  D.nextBtn  = qs('#mini-next-btn');
  D.progress = qs('#mini-progress');

  if (!D.player) return;

  _bindEvents(options.onExpand);
  _subscribeToStore();
}

function _bindEvents(onExpand) {
  D.player.addEventListener('click', (e) => {
    if (e.target.closest('#mini-play-btn') || e.target.closest('#mini-next-btn')) return;
    onExpand?.();
  });

  D.playBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    haptic(HAPTIC.MEDIUM);
    audioPlayer.toggle();
  });

  D.nextBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    haptic(HAPTIC.MEDIUM);
    audioPlayer.next();
  });
}

function _subscribeToStore() {
  select(selectors.currentTrack, (track) => {
    _setVisible(!!track);
    if (track) _renderTrack(track);
  });

  select(selectors.playerState, (state) => {
    const { currentTrack } = getState();
    if (currentTrack) _updatePlayBtn(state);
  });

  // High-frequency — only update progress bar
  select(selectors.progress, (progress) => {
    const { duration } = getState();
    if (D.progress && duration > 0) {
      D.progress.style.width = `${Math.min(100, (progress / duration) * 100)}%`;
    }
  });
}

function _setVisible(visible) {
  D.player?.classList.toggle('mini-player--visible', visible);
}

function _renderTrack(track) {
  if (D.cover) { D.cover.src = track.image || ''; D.cover.alt = track.name || ''; }
  if (D.title)  D.title.textContent  = truncate(track.name, 28);
  if (D.artist) D.artist.textContent = truncate(track.artist_name, 24);
  _updatePlayBtn(getState().playerState);
}

function _updatePlayBtn(playerState) {
  if (!D.playBtn) return;
  const playing = playerState === PLAYER_STATE.PLAYING || playerState === PLAYER_STATE.BUFFERING;
  D.playBtn.innerHTML = playing ? _pauseSvg() : _playSvg();
  D.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

const _playSvg  = () => `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z"/></svg>`;
const _pauseSvg = () => `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
