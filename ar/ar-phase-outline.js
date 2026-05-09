/**
 * Phase 4 — Sobel / outline IoU alignment using the persistent MindAR camera video.
 */

import { OUTLINE_SRC } from './ar-config.js';
import { getArPhase, getArSceneEl } from './session-state.js';

const ALIGNMENT_THRESHOLD = 0.57;
const ALIGNMENT_SUSTAIN_MS = 1000;
const ALIGNMENT_TICK_MS = 100;
const VISUAL_GRID_W = 192;
const VISUAL_GRID_H = 256;
const VISUAL_EDGE_THRESHOLD = 60;
const VISUAL_TOLERANCE_PX = 4;

let alignmentTickerId = null;
let alignmentSustainStart = 0;
let alignmentLocked = false;
let outlineMaskCanvas = null;
let visualSampleCanvas = null;
let onLockedCallback = null;

export function resetOutlineHint() {
  const hint = document.querySelector('#ar-phase-outline .ar-hint');
  if (hint) {
    hint.classList.remove('ar-hint-insecure');
    hint.textContent = 'Match the outline to what you see';
  }
}

export function restartAlignmentLoop() {
  stopAlignmentLoops();
  alignmentSustainStart = 0;
  const stage = document.querySelector('#ar-phase-outline .outline-stage');
  if (stage) {
    stage.dataset.state = 'idle';
    stage.style.setProperty('--sustain', '0');
  }
  startVisualAlignment();
}

function prepareOutlineUI(outlineSrc) {
  alignmentLocked = false;
  alignmentSustainStart = 0;

  const stage = document.querySelector('#ar-phase-outline .outline-stage');
  const imgEl = document.getElementById('outline-img');
  const scoreEl = document.getElementById('align-score');
  const hintEl = document.getElementById('outline-hint');

  if (stage) {
    stage.dataset.state = 'idle';
    stage.style.setProperty('--sustain', '0');
  }
  if (imgEl) imgEl.style.setProperty('--outline-src', `url("${outlineSrc}")`);
  if (scoreEl) scoreEl.textContent = '—';
  if (hintEl) hintEl.textContent = 'Match the outline to what you see';

  buildOutlineMask(outlineSrc);
}

function applyAlignmentScore(error) {
  if (alignmentLocked || getArPhase() !== 4) return;

  const stage = document.querySelector('#ar-phase-outline .outline-stage');
  const scoreEl = document.getElementById('align-score');

  let state;
  if (error >= 0.7) state = 'far';
  else if (error >= ALIGNMENT_THRESHOLD) state = 'near';
  else state = 'aligned';

  let sustain = 0;
  const now = performance.now();
  if (error < ALIGNMENT_THRESHOLD) {
    if (alignmentSustainStart === 0) alignmentSustainStart = now;
    sustain = Math.min(1, (now - alignmentSustainStart) / ALIGNMENT_SUSTAIN_MS);
  } else {
    alignmentSustainStart = 0;
  }

  if (stage) {
    stage.dataset.state = state;
    stage.style.setProperty('--sustain', String(sustain));
  }
  if (scoreEl) scoreEl.textContent = `${Math.round(error * 100)}%`;

  if (sustain >= 1) onAlignmentLocked();
}

function onAlignmentLocked() {
  if (alignmentLocked || getArPhase() !== 4) return;
  alignmentLocked = true;

  stopAlignmentLoops();

  const stage = document.querySelector('#ar-phase-outline .outline-stage');
  if (stage) stage.dataset.state = 'locked';

  try {
    navigator.vibrate?.(80);
  } catch (_) {}

  if (typeof onLockedCallback === 'function') {
    setTimeout(() => onLockedCallback(), 420);
  }
}

export function stopAlignmentLoops() {
  if (alignmentTickerId !== null) {
    clearInterval(alignmentTickerId);
    alignmentTickerId = null;
  }
}

function startVisualAlignment() {
  if (alignmentTickerId !== null) stopAlignmentLoops();

  if (!visualSampleCanvas) {
    visualSampleCanvas = document.createElement('canvas');
    visualSampleCanvas.width = VISUAL_GRID_W;
    visualSampleCanvas.height = VISUAL_GRID_H;
  }

  alignmentTickerId = setInterval(() => {
    if (alignmentLocked || getArPhase() !== 4) return;
    const arSceneEl = getArSceneEl();
    const v =
      arSceneEl?.querySelector('video') || document.querySelector('#ar-scan-container video');
    if (!v || v.readyState < 2 || !outlineMaskCanvas) return;

    const targetRect = readOutlineTargetRect();
    if (!targetRect) return;

    const ctx = visualSampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const scale = Math.max(screenW / vw, screenH / vh);
    const drawW = vw * scale;
    const drawH = vh * scale;
    const dx = (screenW - drawW) / 2;
    const dy = (screenH - drawH) / 2;
    const srcX = (targetRect.left - dx) / scale;
    const srcY = (targetRect.top - dy) / scale;
    const srcW = targetRect.width / scale;
    const srcH = targetRect.height / scale;

    ctx.drawImage(v, srcX, srcY, srcW, srcH, 0, 0, VISUAL_GRID_W, VISUAL_GRID_H);
    const camMask = sobelEdgeMask(ctx.getImageData(0, 0, VISUAL_GRID_W, VISUAL_GRID_H));
    const camDilated = dilateMask(camMask, VISUAL_GRID_W, VISUAL_GRID_H, VISUAL_TOLERANCE_PX);
    applyAlignmentScore(1 - iouScore(camDilated, outlineMaskCanvas.dilated));
  }, ALIGNMENT_TICK_MS);
}

function dilateMask(mask, w, h, iters) {
  let cur = mask;
  for (let it = 0; it < iters; it++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i]) {
          next[i] = 1;
          continue;
        }
        if (
          (x > 0 && cur[i - 1]) ||
          (x < w - 1 && cur[i + 1]) ||
          (y > 0 && cur[i - w]) ||
          (y < h - 1 && cur[i + w])
        ) {
          next[i] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

function readOutlineTargetRect() {
  const el = document.getElementById('outline-target');
  if (!el) return null;
  return el.getBoundingClientRect();
}

function buildOutlineMask(src) {
  outlineMaskCanvas = null;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = VISUAL_GRID_W;
    c.height = VISUAL_GRID_H;
    const cx = c.getContext('2d');
    if (!cx) return;
    cx.clearRect(0, 0, c.width, c.height);
    const ar = img.naturalWidth / img.naturalHeight;
    const cellAr = VISUAL_GRID_W / VISUAL_GRID_H;
    let dw = VISUAL_GRID_W;
    let dh = VISUAL_GRID_H;
    let ddx = 0;
    let ddy = 0;
    if (ar > cellAr) {
      dh = VISUAL_GRID_W / ar;
      ddy = (VISUAL_GRID_H - dh) / 2;
    } else {
      dw = VISUAL_GRID_H * ar;
      ddx = (VISUAL_GRID_W - dw) / 2;
    }
    cx.drawImage(img, ddx, ddy, dw, dh);
    const id = cx.getImageData(0, 0, c.width, c.height);
    const mask = new Uint8Array(c.width * c.height);
    for (let i = 0; i < mask.length; i++) {
      const a = id.data[i * 4 + 3];
      const lum = 0.299 * id.data[i * 4] + 0.587 * id.data[i * 4 + 1] + 0.114 * id.data[i * 4 + 2];
      mask[i] = (a > 80 && lum < 200) || a > 200 ? 1 : 0;
    }
    outlineMaskCanvas = {
      data: mask,
      dilated: dilateMask(mask, c.width, c.height, VISUAL_TOLERANCE_PX),
      width: c.width,
      height: c.height,
    };
  };
  img.onerror = () => {
    outlineMaskCanvas = null;
  };
  img.src = src;
}

function sobelEdgeMask(imageData) {
  const w = imageData.width;
  const h = imageData.height;
  const src = imageData.data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    gray[j] = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0;
  }
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      out[i] = Math.abs(gx) + Math.abs(gy) > VISUAL_EDGE_THRESHOLD ? 1 : 0;
    }
  }
  return out;
}

function iouScore(a, b) {
  let inter = 0;
  let union = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) union++;
  }
  return union === 0 ? 0 : inter / union;
}

/**
 * @param {() => void} onLocked — e.g. transition to stamp hunt
 */
export function activateOutlinePhase(onLocked) {
  deactivateOutlinePhase();
  onLockedCallback = onLocked;
  prepareOutlineUI(OUTLINE_SRC);
  alignmentLocked = false;
  alignmentSustainStart = 0;
  startVisualAlignment();

  window.__forceAlign = function () {
    applyAlignmentScore(0);
  };
}

export function deactivateOutlinePhase() {
  stopAlignmentLoops();
  alignmentLocked = false;
  alignmentSustainStart = 0;
  onLockedCallback = null;
  if (window.__forceAlign) delete window.__forceAlign;
}
