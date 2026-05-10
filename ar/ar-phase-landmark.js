/**
 * Phase 1 — MindAR image target detection (targetFound → callback).
 */

import { getArPhase } from './session-state.js';

let onFoundHandler = null;

function handleTargetFound() {
  if (getArPhase() !== 1) return;
  if (onFoundHandler) onFoundHandler();
}

/**
 * @param {import('aframe').Entity} sceneEl
 * @param {() => void} onFound
 */
export function activateLandmarkPhase(sceneEl, onFound) {
  deactivateLandmarkPhase(sceneEl);
  onFoundHandler = onFound;

  const anchors = sceneEl.querySelectorAll('[mindar-image-target]');
  anchors.forEach((el) => {
    el.addEventListener('targetFound', handleTargetFound);
  });
}

/** @param {import('aframe').Entity | null} sceneEl */
export function deactivateLandmarkPhase(sceneEl) {
  if (!sceneEl) return;
  const anchors = sceneEl.querySelectorAll('[mindar-image-target]');
  anchors.forEach((el) => {
    el.removeEventListener('targetFound', handleTargetFound);
  });
  onFoundHandler = null;
}
