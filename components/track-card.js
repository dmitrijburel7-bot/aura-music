// components/track-card.js — AURA Music | Track Card Component
// Creates DOM nodes. Uses animations.js for effects.
// Never touches store directly — receives data via arguments, emits events via callbacks.

import { ripple, springLikeBounce, staggerFadeIn } from '../animations.js';
import { truncate, formatTime, createElement, haptic } from '../utils.js';
import { HAPTIC } from '../constants.js';

/**
 * @typedef {object} TrackCardOptions
 * @property {Track} track
 * @property {boolean} isLiked
 * @property {boolean} isActive - currently playing
 * @property {Function} onPlay - (track) => void
 * @property {Function} onLike - (track) => void
 * @property {Function} onAddToQueue - (track) => void
 * @property {Function} onMoreOptions - (track, element) => void
 * @property {'list'|'compact'|'card'} variant
 */

/**
 * Creates a track card DOM element.
 * @param {TrackCardOptions} options
 * @returns {HTMLElement}
 */
export function createTrackCard({
  track,
  isLiked = false,
  isActive = false,
  onPlay = () => {},
  onLike = () => {},
  onAddToQueue = () => {},
  onMoreOptions = () => {},
  variant = 'list',
}) {
  const el = createElement('div', {
    className: `track-card track-card--${variant}${isActive ? ' track-card--active' : ''}`,
    'data-track-id': track.id,
    role: 'button',
    tabindex: '0',
    'aria-label': `Play ${track.name} by ${track.artist_name}`,
  });

  // Cover art
  const cover = createElement('div', { className: 'track-card__cover' });
  const img = createElement('img', {
    className: 'track-card__cover-img',
    src: track.image || '',
    alt: `${track.name} cover`,
    loading: 'lazy',
    decoding: 'async',
  });
  img.onerror = () => {
    img.src = generateFallbackSvg(track.name, track.artist_name);
  };

  const playOverlay = createElement('div', { className: 'track-card__play-overlay' });
  const playIcon = isActive
    ? createEqualiserIcon()
    : createPlayIcon();
  playOverlay.appendChild(playIcon);
  cover.appendChild(img);
  cover.appendChild(playOverlay);

  // Info
  const info = createElement('div', { className: 'track-card__info' });
  const name = createElement('p', { className: 'track-card__name' }, truncate(track.name, 36));
  const artist = createElement('p', { className: 'track-card__artist' }, truncate(track.artist_name, 30));
  info.appendChild(name);
  info.appendChild(artist);

  // Meta (duration)
  const meta = createElement('div', { className: 'track-card__meta' });
  const duration = createElement('span', { className: 'track-card__duration' }, formatTime(track.duration));

  // Like button
  const likeBtn = createElement('button', {
    className: `track-card__like${isLiked ? ' track-card__like--active' : ''}`,
    'aria-label': isLiked ? 'Unlike' : 'Like',
    'aria-pressed': String(isLiked),
    type: 'button',
  });
  likeBtn.innerHTML = likeIcon(isLiked);

  // More options button
  const moreBtn = createElement('button', {
    className: 'track-card__more',
    'aria-label': 'More options',
    type: 'button',
  });
  moreBtn.innerHTML = moreIcon();

  meta.appendChild(duration);
  meta.appendChild(likeBtn);
  meta.appendChild(moreBtn);

  el.appendChild(cover);
  el.appendChild(info);
  el.appendChild(meta);

  // ── Event Listeners ─────────────────────────────────────────────────────────

  // Play on card click (but not on action buttons)
  el.addEventListener('click', (e) => {
    if (e.target.closest('.track-card__like') || e.target.closest('.track-card__more')) return;
    haptic(HAPTIC.MEDIUM);
    ripple(el, e, 'rgba(255,255,255,0.12)');
    onPlay(track);
  });

  el.addEventListener('touchstart', (e) => {
    if (e.target.closest('.track-card__like') || e.target.closest('.track-card__more')) return;
    ripple(el, e, 'rgba(255,255,255,0.1)');
  }, { passive: true });

  // Keyboard accessibility
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPlay(track);
    }
  });

  // Like button
  likeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    haptic(isLiked ? HAPTIC.LIGHT : HAPTIC.SUCCESS);
    springLikeBounce(likeBtn);
    onLike(track);

    // Optimistic UI update
    const nowLiked = !likeBtn.classList.contains('track-card__like--active');
    likeBtn.classList.toggle('track-card__like--active', nowLiked);
    likeBtn.innerHTML = likeIcon(nowLiked);
    likeBtn.setAttribute('aria-pressed', String(nowLiked));
  });

  // More button
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    haptic(HAPTIC.LIGHT);
    onMoreOptions(track, moreBtn);
  });

  return el;
}

/**
 * Update an existing track card's active state without re-rendering.
 * @param {HTMLElement} cardEl
 * @param {boolean} isActive
 */
export function updateTrackCardActive(cardEl, isActive) {
  if (!cardEl) return;
  cardEl.classList.toggle('track-card--active', isActive);
  const overlay = cardEl.querySelector('.track-card__play-overlay');
  if (overlay) {
    overlay.innerHTML = '';
    overlay.appendChild(isActive ? createEqualiserIcon() : createPlayIcon());
  }
}

/**
 * Update like state on existing card.
 */
export function updateTrackCardLike(cardEl, isLiked) {
  if (!cardEl) return;
  const btn = cardEl.querySelector('.track-card__like');
  if (!btn) return;
  btn.classList.toggle('track-card__like--active', isLiked);
  btn.innerHTML = likeIcon(isLiked);
  btn.setAttribute('aria-pressed', String(isLiked));
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function createPlayIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.innerHTML = '<path d="M8 5v14l11-7z"/>';
  return svg;
}

function createEqualiserIcon() {
  const div = createElement('div', { className: 'equaliser' });
  for (let i = 0; i < 4; i++) {
    const bar = createElement('span', { className: 'equaliser__bar' });
    div.appendChild(bar);
  }
  return div;
}

function likeIcon(isLiked) {
  return isLiked
    ? `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
}

function moreIcon() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;
}

function generateFallbackSvg(name = '', artist = '') {
  const initials = (name.charAt(0) + (artist.charAt(0) || '')).toUpperCase();
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" style="stop-color:hsl(${hue},60%,35%)"/>
    <stop offset="100%" style="stop-color:hsl(${(hue + 60) % 360},60%,25%)"/>
    </linearGradient></defs>
    <rect width="100" height="100" fill="url(#g)" rx="8"/>
    <text x="50" y="58" font-family="sans-serif" font-size="32" font-weight="bold"
      fill="rgba(255,255,255,0.9)" text-anchor="middle">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Create a horizontal scrollable row of track cards (card variant).
 * @param {Track[]} tracks
 * @param {object} callbacks
 * @returns {HTMLElement}
 */
export function createTrackRow(tracks, callbacks = {}) {
  const container = createElement('div', { className: 'track-row' });
  const cards = tracks.map(track => createTrackCard({ track, variant: 'card', ...callbacks }));
  cards.forEach(card => container.appendChild(card));
  return container;
}

/**
 * Create a vertical list of track cards (list variant).
 * @param {Track[]} tracks
 * @param {object} callbacks
 * @param {Set} likedIds
 * @param {string|null} activeTrackId
 * @returns {HTMLElement}
 */
export function createTrackList(tracks, callbacks = {}, likedIds = new Set(), activeTrackId = null) {
  const container = createElement('div', { className: 'track-list' });

  tracks.forEach(track => {
    const card = createTrackCard({
      track,
      variant: 'list',
      isLiked: likedIds.has(track.id),
      isActive: track.id === activeTrackId,
      ...callbacks,
    });
    container.appendChild(card);
  });

  // Staggered entrance animation
  requestAnimationFrame(() => {
    staggerFadeIn(Array.from(container.children), 0);
  });

  return container;
}
