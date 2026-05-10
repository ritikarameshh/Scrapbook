/** Bookshelf Met tile: Missing → The Met once landmark phase 2 is completed (browser tab session). */

const SESSION_KEY = 'scrapbook-home-met-phase2-complete';

export function persistMetCollectedAndReveal() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch (_) {}
  revealMetStampInDom();
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
