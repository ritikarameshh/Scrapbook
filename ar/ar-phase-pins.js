/**
 * Phase 3 — gem card UI + delegates 3D “floating” pins to ar-phase3-magic-window.js
 * (plain A-Frame magic window on a mirrored MindAR stream).
 */

import { HIDDEN_GEMS } from './ar-config.js';
import * as mindarHost from './ar-mindar-host.js';
import * as phase3Magic from './ar-phase3-magic-window.js';

let currentGemId = null;
let gemToastTimer = null;
/** Demo: which gems were saved in this AR session (persists when reopening a pin). */
const savedGemIds = new Set();

export function resetGemSaveState() {
  savedGemIds.clear();
}

export function markGemSavedForLater(id) {
  savedGemIds.add(id);
}

export function unmarkGemSavedForLater(id) {
  savedGemIds.delete(id);
}

export function getCurrentGemId() {
  return currentGemId;
}

/** @param {import('aframe').Entity | null} sceneEl */
export function activatePinsPhase(sceneEl) {
  const container = document.getElementById('ar-scan-container');
  const video = mindarHost.getMindARVideoFromScene(sceneEl);
  phase3Magic.mount(container, video, sceneEl);
}

/** @param {import('aframe').Entity | null} sceneEl */
export function deactivatePinsPhase(sceneEl) {
  const container = document.getElementById('ar-scan-container');
  phase3Magic.unmount(container, sceneEl);
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
  const saveBtn = card?.querySelector('[data-gem-save]');
  if (saveBtn) {
    const label = saveBtn.querySelector('.gem-detail-save-label');
    const saved = savedGemIds.has(id);
    saveBtn.classList.toggle('gem-detail-save--saved', saved);
    saveBtn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    if (label) label.textContent = saved ? 'Saved' : 'Save for later';
  }
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
