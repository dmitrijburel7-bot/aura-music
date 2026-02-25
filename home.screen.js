// ui/screens/home.screen.js — AURA Music | Home Screen Controller
// Owns: #screen-home DOM rendering.
// Data arrives exclusively from store via select(). Never calls API directly.
// DataService → store dispatch → this module subscribes → renders.

import { select, getState, selectors } from '../../store.js';
import { refreshHomeData } from '../../services/data.service.js';
import { createTrackRow } from '../../components/track-card.js';
import { getTrackCallbacks } from '../track-callbacks.js';
import { staggerFadeIn } from '../../animations.js';
import { qs } from '../../utils.js';

// ─── DOM ──────────────────────────────────────────────────────────────────────

const D = {};
let _hasRendered = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initHomeScreen() {
  D.screen   = qs('#screen-home');
  D.loader   = qs('#home-loader');
  D.sections = qs('#home-sections');

  if (!D.screen) return;

  _subscribeToStore();
}

/**
 * Trigger a refresh of home data (called externally, e.g. pull-to-refresh).
 */
export async function refreshHome() {
  _hasRendered = false;
  if (D.sections) D.sections.innerHTML = '';
  await refreshHomeData();
}

// ─── Store subscriptions ──────────────────────────────────────────────────────

function _subscribeToStore() {
  // Loading spinner
  select(selectors.isLoading, (isLoading) => {
    if (D.loader) D.loader.style.display = isLoading ? 'flex' : 'none';
  });

  // Trending tracks arrive
  select(selectors.featuredTracks, (tracks) => {
    if (!tracks?.length) return;
    if (_hasRendered) return;
    _tryRender();
  });

  // Genre sections arrive
  select(selectors.homeSections, (sections) => {
    if (_hasRendered) return;
    _tryRender();
  });

  // Error state
  select(selectors.error, (error) => {
    if (!error || _hasRendered) return;
    _renderError(error);
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function _tryRender() {
  const { featuredTracks, homeSections, isLoading } = getState();
  // Only render once data has arrived (not while still loading)
  if (isLoading) return;
  if (!featuredTracks.length && !homeSections.length) return;
  if (_hasRendered) return;

  _hasRendered = true;
  _render(featuredTracks, homeSections);
}

function _render(trending, sections) {
  if (!D.sections) return;
  D.sections.innerHTML = '';

  const cbs = getTrackCallbacks();
  const sectionEls = [];

  if (trending.length) {
    sectionEls.push(_buildSection('🔥 Trending Now', trending, cbs));
  }

  sections.forEach(({ genre, tracks }) => {
    if (!tracks?.length) return;
    const label = genre.charAt(0).toUpperCase() + genre.slice(1);
    sectionEls.push(_buildSection(`✦ ${label}`, tracks, cbs));
  });

  sectionEls.forEach(el => D.sections.appendChild(el));

  // Staggered entrance animation
  requestAnimationFrame(() => staggerFadeIn(sectionEls, 0));
}

function _buildSection(title, tracks, callbacks) {
  const section = document.createElement('section');
  section.className = 'home-section';

  const heading = document.createElement('h2');
  heading.className = 'home-section__title';
  heading.textContent = title;

  const row = createTrackRow(tracks, callbacks);

  section.appendChild(heading);
  section.appendChild(row);
  return section;
}

function _renderError(msg) {
  if (!D.sections) return;
  _hasRendered = true;
  D.sections.innerHTML = `
    <div class="empty-state">
      <span class="empty-state__icon">📡</span>
      <p class="empty-state__text">Couldn't load tracks</p>
      <p class="empty-state__hint">${msg || 'Check your connection.'}</p>
      <button class="btn btn--secondary" id="home-retry" style="margin-top:16px">Retry</button>
    </div>
  `;
  qs('#home-retry')?.addEventListener('click', () => refreshHome());
}
