/**
 * Saved Spots — Spots-screen renderer (demo).
 *
 * The Spots tab shows a small, hardcoded list of "saved" hidden gems so the
 * screen always has content to demo. There is no persistence: the phase 3
 * "Save for later" button only shows a confirmation toast — the visible spots
 * here are independent of that action.
 *
 * Each card has:
 *   • a "Get directions" button (opens Google Maps directions to the gem)
 *   • an in-session "✕" remove button (removes the card from the DOM only)
 */

import { HIDDEN_GEMS } from './ar/ar-config.js';

/** Hardcoded demo list — ids must match HIDDEN_GEMS. */
const DEMO_SPOT_IDS = ['lexington-candy', 'pub', 'install'];

function gemById(id) {
  return HIDDEN_GEMS.find((g) => g.id === id) || null;
}

/**
 * Build a Google Maps directions URL for a gem using its `mapsQuery` (or title fallback).
 * @param {{ mapsQuery?: string; title?: string }} gem
 */
export function buildDirectionsUrl(gem) {
  const dest = (gem?.mapsQuery || gem?.title || '').trim();
  const encoded = encodeURIComponent(dest || 'New York, NY');
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=walking`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}

function buildSavedSpotCard(gem) {
  const card = document.createElement('article');
  card.className = 'saved-spot-card';
  card.dataset.spotId = gem.id;

  const accent = gem.color || 'var(--primary-500)';

  card.innerHTML = `
    <button type="button" class="saved-spot-remove" data-spot-remove aria-label="Remove saved spot">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
      </svg>
    </button>
    <span class="saved-spot-accent" aria-hidden="true"></span>
    <p class="saved-spot-type">${escapeHtml(gem.type || 'Spot')}</p>
    <h3 class="saved-spot-title">${escapeHtml(gem.title || 'Saved spot')}</h3>
    <p class="saved-spot-meta">${escapeHtml(`${gem.walkMin ?? '—'} min walk`)}</p>
    <button type="button" class="btn btn-primary btn-block saved-spot-directions" data-spot-directions>
      <svg class="saved-spot-directions-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.71 11.29l-9-9a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42l9 9a1 1 0 0 0 1.42 0l9-9a1 1 0 0 0 0-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5L17.5 11z" fill="currentColor"/>
      </svg>
      <span>Get directions</span>
    </button>
  `;

  const accentEl = card.querySelector('.saved-spot-accent');
  if (accentEl) accentEl.style.background = accent;

  return card;
}

function syncEmptyState() {
  const list = document.getElementById('saved-spots-list');
  const empty = document.getElementById('saved-spots-empty');
  if (!list || !empty) return;
  const hasCards = list.children.length > 0;
  list.hidden = !hasCards;
  empty.hidden = hasCards;
}

/**
 * Render the Spots screen list area with the demo spots. Safe to call
 * repeatedly — fully replaces the children of the list element.
 */
export function renderSpotsScreen() {
  const list = document.getElementById('saved-spots-list');
  if (!list) return;
  list.innerHTML = '';
  DEMO_SPOT_IDS.forEach((id) => {
    const gem = gemById(id);
    if (!gem) return;
    list.appendChild(buildSavedSpotCard(gem));
  });
  syncEmptyState();
}

let spotsScreenBound = false;
/** Wire click handlers for directions + in-session remove. Idempotent. */
export function bindSpotsScreen() {
  if (spotsScreenBound) return;
  spotsScreenBound = true;

  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;

    const directionsBtn = t.closest('[data-spot-directions]');
    if (directionsBtn) {
      const card = directionsBtn.closest('.saved-spot-card');
      const id = card?.dataset.spotId;
      if (!id) return;
      const gem = gemById(id);
      if (!gem) return;
      window.open(buildDirectionsUrl(gem), '_blank', 'noopener,noreferrer');
      return;
    }

    const removeBtn = t.closest('[data-spot-remove]');
    if (removeBtn) {
      const card = removeBtn.closest('.saved-spot-card');
      if (!card) return;
      card.remove();
      syncEmptyState();
    }
  });
}
