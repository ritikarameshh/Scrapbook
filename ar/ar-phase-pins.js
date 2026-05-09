/**
 * Phase 3 — gem “pins” as screen-space DOM on top of the MindAR camera pass-through.
 * MindAR’s WebGL compositor often does not draw arbitrary A-Frame entities over the video feed,
 * so 3D pins were invisible; HTML pins in #gem-pin-layer stay in the UI stack reliably.
 */

import { HIDDEN_GEMS, PHASE3_PIN_LAYOUT } from './ar-config.js';
import { getArPhase } from './session-state.js';

let currentGemId = null;
let gemToastTimer = null;
let domPinClickBound = false;

export function getCurrentGemId() {
  return currentGemId;
}

function clearDomPinLayer() {
  const layer = document.getElementById('gem-pin-layer');
  if (layer) {
    layer.innerHTML = '';
    layer.setAttribute('aria-hidden', 'true');
  }
}

function clearAframePinsIfAny(sceneEl) {
  if (!sceneEl) return;
  sceneEl.querySelectorAll('.gem-pin').forEach((n) => n.parentNode?.removeChild(n));
}

function bindDomPinLayerOnce() {
  if (domPinClickBound) return;
  const layer = document.getElementById('gem-pin-layer');
  if (!layer) return;
  domPinClickBound = true;
  layer.addEventListener('click', (e) => {
    const pin = e.target.closest('.gem-pin-dom');
    if (!pin || getArPhase() !== 3) return;
    e.stopPropagation();
    openGemCard(pin.dataset.gemId);
  });
}

/**
 * @param {import('aframe').Entity | null} sceneEl — optional; clears any legacy A-Frame pins
 */
export function activatePinsPhase(sceneEl) {
  bindDomPinLayerOnce();
  clearAframePinsIfAny(sceneEl);
  clearDomPinLayer();

  const layer = document.getElementById('gem-pin-layer');
  if (!layer) return;

  layer.setAttribute('aria-hidden', 'false');

  HIDDEN_GEMS.forEach((gem, i) => {
    const row = PHASE3_PIN_LAYOUT[i] || PHASE3_PIN_LAYOUT[0];
    const { angleDeg, radius } = row;
    const rad = (angleDeg * Math.PI) / 180;
    // Map authored polar layout (radius ~1.1m) to screen vmin fan in front of the user.
    const spread = 34 * radius;
    const xVmin = Math.sin(rad) * spread;
    const yVmin = -Math.cos(rad) * spread * 0.65 + 10;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gem-pin-dom';
    btn.dataset.gemId = gem.id;
    btn.setAttribute('aria-label', `${gem.type}: ${gem.title}`);
    btn.style.left = `calc(50% + ${xVmin.toFixed(2)}vmin)`;
    btn.style.top = `calc(54% + ${yVmin.toFixed(2)}vmin)`;
    btn.style.background = gem.color;
    layer.appendChild(btn);
  });
}

/** @param {import('aframe').Entity | null} sceneEl */
export function deactivatePinsPhase(sceneEl) {
  clearDomPinLayer();
  clearAframePinsIfAny(sceneEl);
}

export function openGemCard(id) {
  const gem = HIDDEN_GEMS.find((g) => g.id === id);
  if (!gem) return;
  currentGemId = id;

  const card = document.getElementById('gem-detail-card');
  const titleEl = card?.querySelector('[data-gem-title]');
  const typeEl = card?.querySelector('[data-gem-type]');
  const walkEl = card?.querySelector('[data-gem-walk]');
  if (titleEl) titleEl.textContent = gem.title;
  if (typeEl) typeEl.textContent = gem.type;
  if (walkEl) walkEl.textContent = `${gem.walkMin} min walk`;
  if (card) card.hidden = false;
}

export function closeGemCard() {
  const card = document.getElementById('gem-detail-card');
  if (card) card.hidden = true;
  currentGemId = null;
}

export function showGemToast(msg) {
  const toast = document.getElementById('gem-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  if (gemToastTimer) clearTimeout(gemToastTimer);
  gemToastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 1600);
}

export function clearGemToastTimer() {
  if (gemToastTimer) {
    clearTimeout(gemToastTimer);
    gemToastTimer = null;
  }
}
