// ui/sync.js — AURA Music | Cross-Screen DOM Synchronisation
// Updates track card visuals across ALL rendered screens simultaneously.
// Called when playing track changes or likes are toggled.

import { getState } from '../store.js';
import { updateTrackCardActive, updateTrackCardLike } from '../components/track-card.js';
import { qsa } from '../utils.js';

/**
 * Mark the active track card across all visible lists.
 * @param {string|null} activeId
 */
export function syncActiveTrackCards(activeId) {
  qsa('.track-card').forEach(card => {
    updateTrackCardActive(card, !!activeId && card.dataset.trackId === activeId);
  });
}

/**
 * Sync like button state across all visible cards.
 */
export function syncLikeStates() {
  const { likedTrackIds } = getState();
  qsa('.track-card').forEach(card => {
    if (card.dataset.trackId) {
      updateTrackCardLike(card, likedTrackIds.has(card.dataset.trackId));
    }
  });
}
