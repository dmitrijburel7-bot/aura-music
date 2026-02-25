// ui/screens/search.screen.js — AURA Music | Search Screen Controller

import { select, dispatch, getState, selectors } from '../../store.js';
import { executeSearch } from '../../services/data.service.js';
import { createTrackList } from '../../components/track-card.js';
import { getTrackCallbacks } from '../track-callbacks.js';
import { qs, debounce, truncate, haptic } from '../../utils.js';
import { ACTION, HAPTIC } from '../../constants.js';

const D = {};

export function initSearchScreen() {
  D.screen  = qs('#screen-search');
  D.input   = qs('#search-input');
  D.clear   = qs('#search-clear');
  D.results = qs('#search-results');
  D.empty   = qs('#search-empty');
  D.loader  = qs('#search-loader');

  if (!D.screen) return;

  _bindEvents();
  _subscribeToStore();
}

export function focusSearchInput() {
  setTimeout(() => D.input?.focus(), 200);
}

function _bindEvents() {
  if (!D.input) return;

  const debouncedSearch = debounce(async (query) => {
    if (!query || query.trim().length < 2) { _showEmptyState(); return; }
    await executeSearch(query.trim());
  }, 380);

  D.input.addEventListener('input', (e) => {
    const q = e.target.value;
    dispatch({ type: ACTION.SET_SEARCH_QUERY, payload: q });
    if (D.clear) D.clear.style.display = q ? 'flex' : 'none';
    if (!q) { _showEmptyState(); return; }
    debouncedSearch(q);
  });

  D.clear?.addEventListener('click', () => {
    D.input.value = '';
    dispatch({ type: ACTION.SET_SEARCH_QUERY, payload: '' });
    dispatch({ type: ACTION.SET_SEARCH_RESULTS, payload: [] });
    if (D.clear) D.clear.style.display = 'none';
    _showEmptyState();
    D.input.focus();
    haptic(HAPTIC.LIGHT);
  });
}

function _subscribeToStore() {
  select(selectors.isSearching, (loading) => {
    if (D.loader) D.loader.style.display = loading ? 'flex' : 'none';
    if (D.results) D.results.style.opacity = loading ? '0.4' : '1';
  });

  select(selectors.searchResults, (results) => {
    const { searchQuery } = getState();
    if (!searchQuery?.trim()) return;
    _renderResults(results, searchQuery.trim());
  });
}

function _renderResults(tracks, query) {
  if (!D.results) return;
  D.results.innerHTML = '';
  if (D.empty) D.empty.style.display = 'none';

  if (!tracks.length) {
    D.results.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon">🔍</span>
        <p class="empty-state__text">No results for "${truncate(query, 28)}"</p>
        <p class="empty-state__hint">Try a different keyword or genre.</p>
      </div>
    `;
    return;
  }

  const { likedTrackIds, currentTrack } = getState();
  const list = createTrackList(tracks, getTrackCallbacks(), likedTrackIds, currentTrack?.id);
  D.results.appendChild(list);
}

function _showEmptyState() {
  if (D.results) D.results.innerHTML = '';
  if (D.empty) D.empty.style.display = 'flex';
  if (D.loader) D.loader.style.display = 'none';
}
