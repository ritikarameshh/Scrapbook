/** Bookshelf Met tile: Missing → The Met once landmark phase 2 is completed (browser tab session). */

const SESSION_KEY = 'scrapbook-home-met-phase2-complete';
const NEAR_STAMP_DISMISSED_KEY = 'scrapbook-near-stamp-dismissed';

export function persistMetCollectedAndReveal() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch (_) {}
  revealMetStampInDom();
  persistNearStampDismissed();
}

/** Hide “You are near a stamp” for the rest of the tab session after Met phase 2 completes. */
export function persistNearStampDismissed() {
  try {
    sessionStorage.setItem(NEAR_STAMP_DISMISSED_KEY, '1');
  } catch (_) {}
  hideNearStampAlertInDom();
}

function hideNearStampAlertInDom() {
  const el = document.getElementById('stamp-alert');
  if (el) el.hidden = true;
  document.body.classList.remove('app-dock-stamp-visible');
}

export function syncNearStampVisibilityFromSession() {
  try {
    if (sessionStorage.getItem(NEAR_STAMP_DISMISSED_KEY) !== '1') return;
  } catch (_) {
    return;
  }
  hideNearStampAlertInDom();
}

function revealMetStampInDom() {
  const root = document.querySelector('[data-book-stamp="met"]');
  if (!root) return;
  root.classList.remove('trip-stamp-missing');
  const img = root.querySelector('img');
  if (!img) return;
  img.src = 'Assets/Stamps/TheMet.png';
  img.alt = 'The Metropolitan Museum of Art stamp';
}

/** Call on load so refreshes within the tab keep The Met revealed. */
export function syncHomeMetStampFromSession() {
  try {
    if (sessionStorage.getItem(SESSION_KEY) !== '1') return;
  } catch (_) {
    return;
  }
  revealMetStampInDom();
}
