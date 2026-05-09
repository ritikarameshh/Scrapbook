/**
 * MindAR requests getUserMedia with `facingMode: "environment"` only. On many iPhones,
 * simulators, or in-app browsers that fails with OverconstrainedError — MindAR then
 * emits arError VIDEO_FAIL. Retry once with any available camera.
 */
(function installRelaxedCameraGetUserMedia() {
  if (typeof window === 'undefined' || window.__scrapbookGumPatched) return;
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== 'function') return;

  const orig = md.getUserMedia.bind(md);

  function askedRearEnvironment(constraints) {
    const v = constraints && constraints.video;
    if (typeof v !== 'object' || v === null) return false;
    const fm = v.facingMode;
    if (fm === 'environment') return true;
    if (typeof fm === 'object' && fm) {
      if (fm.exact === 'environment' || fm.ideal === 'environment') return true;
    }
    return false;
  }

  md.getUserMedia = function (constraints) {
    return orig(constraints).catch((err) => {
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') throw err;
      if (askedRearEnvironment(constraints)) {
        return orig({
          audio: !!constraints.audio,
          video: true,
        });
      }
      throw err;
    });
  };

  window.__scrapbookGumPatched = true;
})();

// ============ Router ============
const screens    = document.querySelectorAll('.screen');
const navHistory = ['splash'];

function show(name) {
  const target = document.querySelector(`.screen[data-screen="${name}"]`);
  if (!target) return;

  const prev = document.querySelector('.screen.active');

  // AR lifecycle: stop when leaving ar-scan
  if (prev && prev.dataset.screen === 'ar-scan') stopAR();

  screens.forEach(s => s.classList.remove('active'));
  target.classList.add('active');

  const body = target.querySelector('.screen-body');
  if (body) body.scrollTop = 0;

  // AR lifecycle: start when entering ar-scan
  if (name === 'ar-scan') startAR();
}

function go(name) {
  if (navHistory[navHistory.length - 1] !== name) navHistory.push(name);
  show(name);
}

function back() {
  if (navHistory.length > 1) {
    navHistory.pop();
    show(navHistory[navHistory.length - 1]);
  }
}

document.addEventListener('click', (e) => {
  const goBtn   = e.target.closest('[data-go]');
  const backBtn = e.target.closest('[data-back]');
  const camRetry = e.target.closest('[data-ar-cam-retry]');
  if (camRetry) {
    hideARCameraError();
    stopAR();
    startAR();
    return;
  }
  if (goBtn) {
    go(goBtn.dataset.go);
    return;
  }
  if (backBtn) { back(); return; }
});

// ============ Mode toggle (You screen) ============
let currentMode = 'local';
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('[data-mode-toggle] .mode-toggle-opt').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.mode === mode);
  });
}
document.addEventListener('click', (e) => {
  const opt = e.target.closest('[data-mode-toggle] .mode-toggle-opt');
  if (opt) setMode(opt.dataset.mode);
});

// ============ AR — MindAR A-Frame image tracking ============
let arPhase   = 0; // 0 = idle | 1 = scanning | 2 = hunting
let arSceneEl = null;

// Hidden-gem demo: when true, Phase 1 uses outline-alignment instead of plain
// MindAR image detection. See docs/landmark-data-model.md for the long-term
// per-landmark data shape this stand-in flag is meant to grow into.
const HIDDEN_GEM_DEMO        = true;
const ALIGNMENT_THRESHOLD    = 0.50;   // tolerant IoU is more generous; 0.50 ≈ "roughly aligned"
const ALIGNMENT_SUSTAIN_MS   = 1000;
const ALIGNMENT_TICK_MS      = 100;    // visual validator runs at 10 Hz
const VISUAL_GRID_W          = 192;    // downsampled Sobel grid; cheap on phones
const VISUAL_GRID_H          = 256;
const VISUAL_EDGE_THRESHOLD  = 60;     // 0..255
const VISUAL_TOLERANCE_PX    = 4;      // tolerance-aware IoU: edges within N px count as a match

// In-app toggles — switched via the dev-controls strip shown during outline Phase 1.
// MindAR validator: SVG outline → ESB (targetIndex 0); AUTO outline → HiddenGem (targetIndex 1).
// Both use targets-combined.mind (compile at https://hiukim.github.io/mind-ar-js-doc/tools/compile
// by uploading EmpireStateBuilding.jpeg first, then HiddenGem.png).
let validatorMode = 'visual'; // 'visual' | 'mindar'
let outlineMode   = 'auto';   // 'svg'    | 'auto'  — visual validator matches HiddenGem.auto.png against HiddenGem.png in camera

function getOutlineSrc() {
  return outlineMode === 'auto'
    ? 'Assets/HiddenGem.auto.png'
    : 'Assets/hidden-gem-outline.svg';
}

function setupDevToggles() {
  const vBtn = document.getElementById('toggle-validator');
  const oBtn = document.getElementById('toggle-outline');
  if (!vBtn || !oBtn) return;

  function syncButtons() {
    vBtn.textContent = validatorMode.toUpperCase();
    vBtn.dataset.active = validatorMode;
    oBtn.textContent = outlineMode.toUpperCase();
    oBtn.dataset.active = outlineMode;
  }

  vBtn.addEventListener('click', () => {
    validatorMode = validatorMode === 'visual' ? 'mindar' : 'visual';
    syncButtons();
    if (arPhase === 1 && HIDDEN_GEM_DEMO) restartAlignmentLoop();
  });

  oBtn.addEventListener('click', () => {
    outlineMode = outlineMode === 'svg' ? 'auto' : 'svg';
    syncButtons();
    const src = getOutlineSrc();
    const imgEl = document.getElementById('outline-img');
    if (imgEl) imgEl.style.setProperty('--outline-src', `url("${src}")`);
    if (validatorMode === 'visual') buildOutlineMask(src);
    if (arPhase === 1 && HIDDEN_GEM_DEMO) restartAlignmentLoop();
  });

  syncButtons();
}

function restartAlignmentLoop() {
  stopAlignmentLoops();
  alignmentSustainStart = 0;
  esbTargetVisible = false;
  gemTargetVisible = false;
  const stage = document.querySelector('#ar-phase-outline .outline-stage');
  if (stage) { stage.dataset.state = 'idle'; stage.style.setProperty('--sustain', '0'); }
  if (validatorMode === 'visual') startVisualAlignment();
  else                            startMindARAlignment();
}

// World-locked stamp: billboard each frame so the disc faces the phone (portrait-friendly).
if (typeof AFRAME !== 'undefined' && !AFRAME.components['stamp-billboard']) {
  AFRAME.registerComponent('stamp-billboard', {
    tick() {
      if (arPhase !== 2 || !this.el.sceneEl) return;
      const camEl = this.el.sceneEl.querySelector('[camera]');
      if (!camEl) return;
      const camWorld = new AFRAME.THREE.Vector3();
      camEl.object3D.getWorldPosition(camWorld);
      this.el.object3D.lookAt(camWorld);
    },
  });
}

// Register compass tick component before any A-Frame scene is created.
// Runs every frame during phase 2 to rotate the compass arrow toward the stamp.
if (typeof AFRAME !== 'undefined' && !AFRAME.components['compass-updater']) {
  AFRAME.registerComponent('compass-updater', {
    tick() {
      if (arPhase !== 2) return;
      const stampEl  = document.getElementById('stamp-entity');
      const cameraEl = this.el.querySelector('[camera]');
      if (!stampEl || !cameraEl) return;

      const camera = cameraEl.getObject3D('camera');
      if (!camera) return;

      const worldPos  = new AFRAME.THREE.Vector3();
      stampEl.object3D.getWorldPosition(worldPos);
      const projected = worldPos.clone().project(camera);

      const compassArrow = document.querySelector('.compass-arrow');
      if (compassArrow) {
        const angle = Math.atan2(projected.x, projected.y);
        compassArrow.style.transform = `rotate(${angle}rad)`;
      }

      const inView =
        Math.abs(projected.x) < 0.48 &&
        Math.abs(projected.y) < 0.55 &&
        projected.z > -1 &&
        projected.z < 1;
      const tapHint = document.getElementById('tap-to-collect');
      if (tapHint) tapHint.hidden = !inView;
    },
  });
}

function showARCameraError(msg) {
  const box = document.getElementById('ar-camera-error');
  const sub = box?.querySelector('.ar-camera-error-sub');
  if (sub && msg) sub.textContent = msg;
  if (box) box.hidden = false;
}

function hideARCameraError() {
  const box = document.getElementById('ar-camera-error');
  if (box) box.hidden = true;
}

function resetARPhase1Hint() {
  const hint = document.querySelector('#ar-phase-1 .ar-hint');
  if (hint) {
    hint.classList.remove('ar-hint-insecure');
    hint.textContent = 'Point your camera at the Empire State Building';
  }
}

function startAR() {
  const container = document.getElementById('ar-scan-container');
  if (!container) return;

  resetARPhase1Hint();

  if (typeof AFRAME === 'undefined') {
    showARError('AR library failed to load. Check your network (A-Frame CDN) and refresh.');
    showARCameraError('Could not load A-Frame. Use HTTPS or try again.');
    return;
  }

  hideARCameraError();
  container.innerHTML = '';
  arPhase = 1;

  // Wait one frame so the ar-scan screen has layout (MindAR sizes video from container).
  requestAnimationFrame(() => {
    const active = document.querySelector('.screen.active');
    if (!active || active.dataset.screen !== 'ar-scan') return;
    if (HIDDEN_GEM_DEMO) mountOutlineSceneInto(container);
    else                 mountARSceneInto(container);
  });
}

function mountARSceneInto(container) {
  // autoStart default is true — MindAR calls system.start() on 'renderstart',
  // which requests camera access and begins tracking.
  container.innerHTML = `
    <a-scene id="ar-scene" embedded compass-updater
      mindar-image="imageTargetSrc: ./targets.mind; uiScanning: no; uiLoading: no; uiError: no;"
      vr-mode-ui="enabled: false"
      device-orientation-permission-ui="enabled: false"
      renderer="alpha: true"
      style="position:absolute;top:0;left:0;width:100%;height:100%;">
      <a-assets></a-assets>
      <a-light type="ambient" color="#ffffff" intensity="0.85"></a-light>
      <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
      <a-entity id="esb-anchor" mindar-image-target="targetIndex: 0"></a-entity>
      <a-entity id="stamp-entity" visible="false" stamp-billboard>
        <a-circle radius="0.34" position="0 0 0"
          material="shader: flat; color: #E26E5F; side: double"></a-circle>
        <a-ring radius-inner="0.2" radius-outer="0.32" position="0 0 0.003"
          material="shader: flat; color: #F4F0E8; side: double; opacity: 0.95; transparent: true"></a-ring>
      </a-entity>
    </a-scene>`;

  arSceneEl = document.getElementById('ar-scene');
  if (!arSceneEl) return;

  const anchor = document.getElementById('esb-anchor');
  if (anchor) {
    anchor.addEventListener('targetFound', () => {
      if (arPhase === 1) transitionToPhase2(anchor);
    });
  }

  arSceneEl.addEventListener('renderstart', () => {
    hideARCameraError();
    if (arSceneEl && arSceneEl.renderer) {
      arSceneEl.renderer.setClearColor(0x000000, 0);
    }
  }, { once: true });

  // MindAR emits arError on the scene when getUserMedia fails or video cannot start.
  arSceneEl.addEventListener('arError', (e) => {
    const code = e.detail?.error ?? '';
    showARError('Camera error — check permissions (' + code + ')');
    let sub =
      'Tap “Enable camera”, choose Allow, and use Safari/Chrome (not an in-app browser).';
    if (!window.isSecureContext) {
      sub = 'Serve the app over HTTPS or localhost — insecure http (e.g. LAN IP) blocks camera.';
    } else if (code === 'VIDEO_FAIL') {
      sub =
        'If you already allowed camera: try “Enable camera” again, open in Safari, or use a real device (simulators often have no rear camera).';
    }
    showARCameraError(sub);
  });

  setARPhaseUI(1);

  // Browsers treat http://192.168… as insecure — camera will fail, but AR still opens.
  if (!window.isSecureContext) {
    const hint = document.querySelector('#ar-phase-1 .ar-hint');
    if (hint) {
      hint.classList.add('ar-hint-insecure');
      hint.textContent =
        'Camera needs HTTPS on a phone. Use the https://….trycloudflare.com link from “npm run tunnel” on your computer — not http://192.168… or http://10.….';
    }
  }
}

// ---- Hidden-gem outline-alignment Phase 1 ----------------------------------

let alignmentTickerId      = null;
let alignmentSustainStart  = 0;
let alignmentLocked        = false;
let esbTargetVisible       = false;  // set by targetFound/targetLost on esb-anchor (index 0)
let gemTargetVisible       = false;  // set by targetFound/targetLost on gem-anchor (index 1)
let outlineMaskCanvas      = null;   // pre-binarized outline edge mask, used by visual validator
let visualSampleCanvas     = null;   // reused per tick to avoid GC churn

function mountOutlineSceneInto(container) {
  prepareOutlineUI(getOutlineSrc());

  // targets-combined.mind must contain both images in order:
  //   index 0 — EmpireStateBuilding.jpeg  (SVG outline)
  //   index 1 — HiddenGem.png             (AUTO outline)
  // Compile at https://hiukim.github.io/mind-ar-js-doc/tools/compile
  // Upload EmpireStateBuilding.jpeg first, then HiddenGem.png, then save to Assets/targets-combined.mind.
  container.innerHTML = `
    <a-scene id="ar-scene" embedded
      mindar-image="imageTargetSrc: ./Assets/targets-combined.mind; uiScanning: no; uiLoading: no; uiError: no;"
      vr-mode-ui="enabled: false"
      device-orientation-permission-ui="enabled: false"
      renderer="alpha: true"
      style="position:absolute;top:0;left:0;width:100%;height:100%;">
      <a-assets></a-assets>
      <a-light type="ambient" color="#ffffff" intensity="0.85"></a-light>
      <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
      <a-entity id="esb-anchor" mindar-image-target="targetIndex: 0"></a-entity>
      <a-entity id="gem-anchor" mindar-image-target="targetIndex: 1"></a-entity>
      <a-entity id="stamp-entity" visible="false" stamp-billboard>
        <a-circle radius="0.34" position="0 0 0"
          material="shader: flat; color: #E26E5F; side: double"></a-circle>
        <a-ring radius-inner="0.2" radius-outer="0.32" position="0 0 0.003"
          material="shader: flat; color: #F4F0E8; side: double; opacity: 0.95; transparent: true"></a-ring>
      </a-entity>
    </a-scene>`;

  arSceneEl = document.getElementById('ar-scene');
  if (!arSceneEl) return;

  arSceneEl.addEventListener('renderstart', () => {
    hideARCameraError();
    if (arSceneEl?.renderer) arSceneEl.renderer.setClearColor(0x000000, 0);
    esbTargetVisible = false;
    gemTargetVisible = false;
    const esbAnchor = document.getElementById('esb-anchor');
    const gemAnchor = document.getElementById('gem-anchor');
    if (esbAnchor) {
      esbAnchor.addEventListener('targetFound', () => { esbTargetVisible = true; });
      esbAnchor.addEventListener('targetLost',  () => { esbTargetVisible = false; });
    }
    if (gemAnchor) {
      gemAnchor.addEventListener('targetFound', () => { gemTargetVisible = true; });
      gemAnchor.addEventListener('targetLost',  () => { gemTargetVisible = false; });
    }
    if (validatorMode === 'visual') startVisualAlignment();
    else                            startMindARAlignment();
  }, { once: true });

  arSceneEl.addEventListener('arError', (e) => {
    const code = e.detail?.error ?? '';
    let sub = 'Tap “Enable camera”, choose Allow, and use Safari/Chrome.';
    if (!window.isSecureContext) {
      sub = 'Serve the app over HTTPS or localhost.';
    } else if (code === 'VIDEO_FAIL') {
      sub = 'Try “Enable camera” again, open in Safari, or use a real device.';
    } else if (code === 'INVALID_TARGET_URL' || code === 'TARGET_LOAD_FAIL') {
      sub = 'targets-combined.mind not found — compile it at https://hiukim.github.io/mind-ar-js-doc/tools/compile (upload EmpireStateBuilding.jpeg first, then HiddenGem.png) and save to Assets/targets-combined.mind.';
    }
    showARCameraError(sub);
  });

  setARPhaseUI(1);
}

function prepareOutlineUI(outlineSrc) {
  alignmentLocked = false;
  alignmentSustainStart = 0;

  const stage   = document.querySelector('#ar-phase-outline .outline-stage');
  const imgEl   = document.getElementById('outline-img');
  const scoreEl = document.getElementById('align-score');
  const hintEl  = document.getElementById('outline-hint');

  if (stage) {
    stage.dataset.state = 'idle';
    stage.style.setProperty('--sustain', '0');
  }
  if (imgEl)   imgEl.style.setProperty('--outline-src', `url("${outlineSrc}")`);
  if (scoreEl) scoreEl.textContent = '—';
  if (hintEl)  hintEl.textContent = 'Match the outline to what you see';

  buildOutlineMask(outlineSrc);
}

// Apply a single alignment score (0..1, where 0 = perfect) to the UI and
// fire onAlignmentLocked() once it's been below threshold for the sustain window.
function applyAlignmentScore(error) {
  if (alignmentLocked || arPhase !== 1) return;

  const stage   = document.querySelector('#ar-phase-outline .outline-stage');
  const scoreEl = document.getElementById('align-score');

  let state;
  if (error >= 0.70)                        state = 'far';
  else if (error >= ALIGNMENT_THRESHOLD)    state = 'near';
  else                                       state = 'aligned';

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
  if (alignmentLocked) return;
  alignmentLocked = true;

  stopAlignmentLoops();

  const stage = document.querySelector('#ar-phase-outline .outline-stage');
  if (stage) stage.dataset.state = 'locked';

  try { navigator.vibrate?.(80); } catch (_) {}

  // Visual validator: stamp in world space (no image anchor needed).
  // MindAR validator: stamp anchored to whichever target was being tracked.
  const anchorEl = validatorMode === 'mindar'
    ? (outlineMode === 'svg' ? document.getElementById('esb-anchor') : document.getElementById('gem-anchor'))
    : null;

  setTimeout(() => transitionToPhase2(anchorEl), 420);
}

function stopAlignmentLoops() {
  if (alignmentTickerId !== null) {
    clearInterval(alignmentTickerId);
    alignmentTickerId = null;
  }
}

window.__forceAlign = function () {
  applyAlignmentScore(0);
};

// --- Validator A: visual edge matching (Sobel + IoU) -------------------------

function startVisualAlignment() {
  if (alignmentTickerId !== null) stopAlignmentLoops();

  const video = arSceneEl?.querySelector('video') || document.querySelector('#ar-scan-container video');
  if (!video) return;

  if (!visualSampleCanvas) {
    visualSampleCanvas = document.createElement('canvas');
    visualSampleCanvas.width  = VISUAL_GRID_W;
    visualSampleCanvas.height = VISUAL_GRID_H;
  }

  alignmentTickerId = setInterval(() => {
    if (alignmentLocked || arPhase !== 1) return;
    const v = arSceneEl?.querySelector('video') || video;
    if (!v || v.readyState < 2 || !outlineMaskCanvas) return;

    const targetRect = readOutlineTargetRect();
    if (!targetRect) return;

    const ctx = visualSampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return;
    const screenW = window.innerWidth, screenH = window.innerHeight;
    const scale = Math.max(screenW / vw, screenH / vh);
    const drawW = vw * scale, drawH = vh * scale;
    const dx = (screenW - drawW) / 2, dy = (screenH - drawH) / 2;
    const srcX = (targetRect.left   - dx) / scale;
    const srcY = (targetRect.top    - dy) / scale;
    const srcW = targetRect.width  / scale;
    const srcH = targetRect.height / scale;

    ctx.drawImage(v, srcX, srcY, srcW, srcH, 0, 0, VISUAL_GRID_W, VISUAL_GRID_H);
    const camMask = sobelEdgeMask(ctx.getImageData(0, 0, VISUAL_GRID_W, VISUAL_GRID_H));
    // Tolerance-aware IoU: dilate both sides so edges within VISUAL_TOLERANCE_PX
    // count as a match. The on-screen outline image stays crisp; only the
    // scoring uses the fattened versions.
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
        if (cur[i]) { next[i] = 1; continue; }
        if ((x > 0       && cur[i - 1]) ||
            (x < w - 1   && cur[i + 1]) ||
            (y > 0       && cur[i - w]) ||
            (y < h - 1   && cur[i + w])) next[i] = 1;
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
    c.width  = VISUAL_GRID_W;
    c.height = VISUAL_GRID_H;
    const cx = c.getContext('2d');
    if (!cx) return;
    cx.clearRect(0, 0, c.width, c.height);
    const ar = img.naturalWidth / img.naturalHeight;
    const cellAr = VISUAL_GRID_W / VISUAL_GRID_H;
    let dw = VISUAL_GRID_W, dh = VISUAL_GRID_H, ddx = 0, ddy = 0;
    if (ar > cellAr) { dh = VISUAL_GRID_W / ar; ddy = (VISUAL_GRID_H - dh) / 2; }
    else             { dw = VISUAL_GRID_H * ar; ddx = (VISUAL_GRID_W - dw) / 2; }
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
  img.onerror = () => { outlineMaskCanvas = null; };
  img.src = src;
}

function sobelEdgeMask(imageData) {
  const w = imageData.width, h = imageData.height;
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
      out[i] = (Math.abs(gx) + Math.abs(gy)) > VISUAL_EDGE_THRESHOLD ? 1 : 0;
    }
  }
  return out;
}

function iouScore(a, b) {
  let inter = 0, union = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) union++;
  }
  return union === 0 ? 0 : inter / union;
}

// --- Validator B: MindAR event-based — SVG→ESB (index 0), AUTO→HiddenGem (index 1) ---

function startMindARAlignment() {
  if (alignmentTickerId !== null) stopAlignmentLoops();
  alignmentTickerId = setInterval(() => {
    if (alignmentLocked || arPhase !== 1) return;
    const visible = outlineMode === 'svg' ? esbTargetVisible : gemTargetVisible;
    applyAlignmentScore(visible ? 0 : 1);
  }, ALIGNMENT_TICK_MS);
}

function transitionToPhase2(anchorEl) {
  const stampEl = document.getElementById('stamp-entity');
  if (!stampEl) return;

  const angle = Math.random() * Math.PI * 2;
  const radius = 0.48 + Math.random() * 0.42;
  const yLift = 0.18 + Math.random() * 0.28;

  if (anchorEl) {
    // Scavenger hunt anchored to the tracked image: stamp is in image-local space.
    anchorEl.appendChild(stampEl);
    stampEl.setAttribute('position', {
      x: Math.cos(angle) * radius,
      y: yLift,
      z: Math.sin(angle) * radius,
    });
  } else {
    // Visual-validator path (no MindAR anchor): stamp lives in world space, ahead of camera.
    stampEl.setAttribute('position', {
      x: Math.cos(angle) * radius,
      y: yLift,
      z: -1.4 + Math.sin(angle) * radius * 0.6,
    });
  }

  stampEl.setAttribute('rotation', { x: 0, y: 0, z: 0 });
  stampEl.setAttribute('visible', true);
  stampEl.object3D.visible = true;

  arPhase = 2;
  setARPhaseUI(2);
}

function setARPhaseUI(phase) {
  const p1       = document.getElementById('ar-phase-1');
  const p1Out    = document.getElementById('ar-phase-outline');
  const p2       = document.getElementById('ar-phase-2');
  const tapHint  = document.getElementById('tap-to-collect');
  const usingOutline = HIDDEN_GEM_DEMO;
  if (p1)       p1.hidden    = (phase !== 1) || usingOutline;
  if (p1Out)    p1Out.hidden = (phase !== 1) || !usingOutline;
  if (p2)       p2.hidden    = (phase !== 2);
  if (tapHint)  tapHint.hidden = true;
}

function showARError(msg) {
  const hint = document.querySelector('#ar-phase-1 .ar-hint');
  if (hint) hint.textContent = msg;
}

function stopAR() {
  arPhase = 0;
  stopAlignmentLoops();
  alignmentLocked = false;
  alignmentSustainStart = 0;
  esbTargetVisible = false;
  gemTargetVisible = false;

  if (arSceneEl) {
    const s = arSceneEl;
    arSceneEl = null;
    try {
      // Stop MindAR: camera stream, AR processing, and dispose controller.
      s.systems?.['mindar-image-system']?.stop();
    } catch (_) {}
  }

  const container = document.getElementById('ar-scan-container');
  if (container) container.innerHTML = '';

  hideARCameraError();
  setARPhaseUI(1);
}

// Tap on ar-scan screen in phase 2: collect if stamp is centred in view.
const arScanEl = document.querySelector('[data-screen="ar-scan"]');
if (arScanEl) arScanEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-back]') || e.target.closest('[data-go]') || e.target.closest('[data-ar-cam-retry]')) return;
  if (arPhase !== 2 || !arSceneEl) return;

  const stampEl  = document.getElementById('stamp-entity');
  const cameraEl = arSceneEl.querySelector('[camera]');
  if (!stampEl || !cameraEl) return;

  const camera = cameraEl.getObject3D('camera');
  if (!camera) return;

  const worldPos  = new AFRAME.THREE.Vector3();
  stampEl.object3D.getWorldPosition(worldPos);
  const projected = worldPos.clone().project(camera);
  const inView =
    Math.abs(projected.x) < 0.48 &&
    Math.abs(projected.y) < 0.55 &&
    projected.z > -1 &&
    projected.z < 1;
  if (inView) collectStamp();
});

function collectStamp() {
  stopAR();
  go('ar-fact');
}

// ============ Boot ============
show('splash');
setupDevToggles();
