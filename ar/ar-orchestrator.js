/**
 * AR flow coordinator: one MindAR session, phase modules swapped without camera teardown.
 */

import { HIDDEN_GEMS, SECOND_SPOT_GEM_ID } from './ar-config.js';
import { buildDirectionsUrl } from '../saved-spots.js';
import * as homeStampState from '../home-stamp-state.js';
import * as mindarHost from './ar-mindar-host.js';
import * as phaseLandmark from './ar-phase-landmark.js';
import * as phaseOutline from './ar-phase-outline.js';
import * as phasePins from './ar-phase-pins.js';
import { getArPhase, setArPhase, getArSceneEl } from './session-state.js';

let phase2HuntModule = null;
let phase1LandmarkMatched = false;
let pendingSecondSpotCompletion = false;

/** Phase 2 content for the first stamp (landmark) — The Met. */
const PHASE2_LANDMARK_CONFIG = {
  stampUrl: './Assets/MetStamp.gltf',
  // stampName / stampImage / funFacts intentionally omitted so phase2-hunt.js
  // falls back to its Met defaults.
};

/** Phase 2 content for the second-spot stamp (after Phase 4) — Lexington Candy Shop. */
const PHASE2_SECOND_SPOT_CONFIG = {
  stampUrl: './Assets/LexingtonCandyShop/LCS.gltf',
  stampName: 'Lexington Candy Shop',
  stampImage: './Assets/Stamps/LexingtonCandyShop.png',
  funFacts: [
    {
      lead: 'This 100 year old diner serves Coca Cola the old-fashioned way by mixing hand-pumped syrup with soda.',
      body: 'Their coke floats, malteds and egg creams are must-trys!',
    },
  ],
};

/** @type {((name: string) => void) | null} */
let navigateGo = null;

/** @type {(() => void) | null} */
let hideCameraError = null;

/** @type {((msg: string) => void) | null} */
let showCameraError = null;

/** @type {((msg: string) => void) | null} */
let showHintError = null;

let gemUiBound = false;

function setARPhaseUI(phase) {
  const p1Out = document.getElementById('ar-phase-outline');
  const p2 = document.getElementById('ar-phase-2');
  const p3 = document.getElementById('ar-phase-3');
  if (p1Out) {
    p1Out.hidden = phase !== 1 && phase !== 4;
    p1Out.classList.toggle('landmark-scan-mode', phase === 1);
  }
  if (p2) p2.hidden = phase !== 2;
  if (p3) p3.hidden = phase !== 3;
  phasePins.closeGemCard();
}

function resetLandmarkHintUI() {
  const hint = document.querySelector('#ar-phase-outline .ar-hint');
  if (hint) {
    hint.classList.remove('ar-hint-insecure');
    hint.classList.add('landmark-hint');
    hint.innerHTML =
      '<span>Capture </span>' +
      '<strong>the Metropolitan Museum of Art</strong>' +
      '<span> to find the stamp</span>';
  }
}

function warnInsecureContext() {
  if (window.isSecureContext) return;
  const hint = document.querySelector('#ar-phase-outline .ar-hint');
  if (hint) {
    hint.classList.remove('landmark-hint');
    hint.classList.add('ar-hint-insecure');
    hint.textContent =
      'Camera needs HTTPS on a phone. Use the https://….trycloudflare.com link from “npm run tunnel” on your computer — not http://192.168… or http://10.….';
  }
}

function bindGemUiOnce() {
  if (gemUiBound) return;
  gemUiBound = true;
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!t) return;
    if (t.closest('[data-gem-close]')) {
      e.preventDefault();
      e.stopPropagation();
      phasePins.closeGemCard();
      return;
    }
    if (t.closest('[data-gem-go]')) {
      e.stopPropagation();
      if (phasePins.getCurrentGemId() === SECOND_SPOT_GEM_ID && getArPhase() === 3) {
        phasePins.closeGemCard();
        beginPhase4OutlineFlow();
        return;
      }
      const gemId = phasePins.getCurrentGemId();
      const gem = gemId ? HIDDEN_GEMS.find((g) => g.id === gemId) : null;
      phasePins.closeGemCard();
      if (gem) {
        window.open(buildDirectionsUrl(gem), '_blank', 'noopener,noreferrer');
      }
      stopARSession();
      navigateGo?.('home');
      return;
    }
    if (t.closest('[data-gem-save]')) {
      e.stopPropagation();
      const btn = t.closest('[data-gem-save]');
      const id = phasePins.getCurrentGemId();
      const label = btn?.querySelector('.gem-detail-save-label');
      if (btn?.classList.contains('gem-detail-save--saved')) {
        if (id) phasePins.unmarkGemSavedForLater(id);
        btn.classList.remove('gem-detail-save--saved');
        if (label) label.textContent = 'Save for later';
        btn.setAttribute('aria-pressed', 'false');
        return;
      }
      if (id) phasePins.markGemSavedForLater(id);
      btn?.classList.add('gem-detail-save--saved');
      if (label) label.textContent = 'Saved';
      btn?.setAttribute('aria-pressed', 'true');
      phasePins.showGemToast('Saved for later');
    }
  });
}

async function waitForMindARVideo(sceneEl, timeoutMs = 8000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const v = mindarHost.getMindARVideoFromScene(sceneEl);
    if (v && v.readyState >= 2) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return mindarHost.getMindARVideoFromScene(sceneEl);
}

async function transitionToPhase2(options = {}) {
  const secondSpotStamp = options.secondSpotStamp ?? false;
  const sceneEl = getArSceneEl();

  try {
    phase2HuntModule?.stopPhase2Hunt();
  } catch (_) {}

  phaseLandmark.deactivateLandmarkPhase(sceneEl);
  phaseOutline.deactivateOutlinePhase();
  phasePins.deactivatePinsPhase(sceneEl);
  mindarHost.setMindARCameraLookControlsEnabled(sceneEl, false);

  if (secondSpotStamp) pendingSecondSpotCompletion = true;

  setArPhase(2);
  setARPhaseUI(2);

  const host = document.getElementById('ar-phase-2-host');
  if (!host) return;

  const video = await waitForMindARVideo(sceneEl);

  try {
    if (!phase2HuntModule) phase2HuntModule = await import('../phase2-hunt.js');
    const phase2Config = secondSpotStamp ? PHASE2_SECOND_SPOT_CONFIG : PHASE2_LANDMARK_CONFIG;
    await phase2HuntModule.startPhase2Hunt({
      host,
      sharedVideoElement: video || undefined,
      ...phase2Config,
      secondSpotStamp,
      /** Facts modal ✕ exits AR to the main Book tab (`home` screen). */
      onExitFactsViaClose: () => navigateGo?.('home'),
      onCollected: collectStamp,
      onError: (msg) => showHintError?.(msg),
    });
  } catch (err) {
    console.error('[ar-orchestrator] phase 2 failed', err);
    showHintError?.('Could not start the stamp hunt — please reload.');
  }
}

function transitionToPhase3() {
  try {
    phase2HuntModule?.stopPhase2Hunt();
  } catch (_) {}

  if (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  ) {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }

  const sceneEl = getArSceneEl();
  phaseLandmark.deactivateLandmarkPhase(sceneEl);
  phaseOutline.deactivateOutlinePhase();

  // Phase 3 uses its own magic-window scene (see ar-phase3-magic-window.js), not MindAR’s camera.
  mindarHost.setMindARCameraLookControlsEnabled(sceneEl, false);

  setArPhase(3);
  setARPhaseUI(3);
  phasePins.activatePinsPhase(sceneEl);
}

function beginPhase4OutlineFlow() {
  phaseOutline.resetOutlineHint();

  const sceneEl = getArSceneEl();
  phasePins.deactivatePinsPhase(sceneEl);
  mindarHost.setMindARCameraLookControlsEnabled(sceneEl, false);

  setArPhase(4);
  setARPhaseUI(4);

  phaseOutline.activateOutlinePhase(() => {
    transitionToPhase2({ secondSpotStamp: true });
  });
}

function collectStamp() {
  try {
    phase2HuntModule?.stopPhase2Hunt();
  } catch (_) {}

  if (pendingSecondSpotCompletion) {
    pendingSecondSpotCompletion = false;
    stopARSession();
    navigateGo?.('home');
    return;
  }
  homeStampState.persistMetCollectedAndReveal();
  transitionToPhase3();
}

/**
 * @param {{ go: (name: string) => void; showCameraError?: (msg: string) => void; hideCameraError?: () => void; showHintError?: (msg: string) => void; testJumpPhase4?: boolean }} opts
 */
export function startARSession(opts) {
  bindGemUiOnce();
  navigateGo = opts.go;
  showCameraError = opts.showCameraError ?? null;
  hideCameraError = opts.hideCameraError ?? null;
  showHintError = opts.showHintError ?? null;
  const testJumpPhase4 = opts.testJumpPhase4 === true;

  const container = document.getElementById('ar-scan-container');
  if (!container) return;

  if (typeof AFRAME === 'undefined') {
    showHintError?.('AR library failed to load. Check your network (A-Frame CDN) and refresh.');
    showCameraError?.('Could not load A-Frame. Use HTTPS or try again.');
    return;
  }

  resetLandmarkHintUI();
  phase1LandmarkMatched = false;
  hideCameraError?.();

  mindarHost
    .mountPersistentMindARScene(container, {
      onArError: (sub) => showCameraError?.(sub),
    })
    .then((sceneEl) => {
      const active = document.querySelector('.screen.active');
      if (!active || active.dataset.screen !== 'ar-scan') return;
      if (!sceneEl) return;

      hideCameraError?.();

      if (testJumpPhase4) {
        beginPhase4OutlineFlow();
        warnInsecureContext();
        return;
      }

      setArPhase(1);
      setARPhaseUI(1);

      phaseLandmark.activateLandmarkPhase(sceneEl, () => {
        if (getArPhase() !== 1 || phase1LandmarkMatched) return;
        phase1LandmarkMatched = true;
        const hint = document.getElementById('outline-hint');
        if (hint) hint.textContent = 'Landmark found ✓';
        try {
          navigator.vibrate?.(80);
        } catch (_) {}
        setTimeout(() => transitionToPhase2({ secondSpotStamp: false }), 420);
      });

      warnInsecureContext();
    });
}

/**
 * While on the Lexington (second-spot) stamp hunt, AR overlay ✕ returns to Book
 * instead of generic history-back.
 */
export function interceptRepeatedStampHuntBackToBook() {
  if (!pendingSecondSpotCompletion || getArPhase() !== 2) return false;
  stopARSession();
  navigateGo?.('home');
  return true;
}

export function stopARSession() {
  setArPhase(0);
  phase1LandmarkMatched = false;
  pendingSecondSpotCompletion = false;
  phasePins.resetGemSaveState();

  try {
    phase2HuntModule?.stopPhase2Hunt();
  } catch (_) {}

  phaseOutline.deactivateOutlinePhase();
  phaseLandmark.deactivateLandmarkPhase(getArSceneEl());
  phasePins.deactivatePinsPhase(getArSceneEl());
  phasePins.closeGemCard();
  phasePins.clearGemToastTimer();

  const toast = document.getElementById('gem-toast');
  if (toast) toast.hidden = true;

  const container = document.getElementById('ar-scan-container');
  mindarHost.teardownMindARSession(container);

  hideCameraError?.();
  setARPhaseUI(1);
}
