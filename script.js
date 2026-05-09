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
// arPhase: 0 idle | 1 MindAR landmark image targets | 2 stamp hunt | 3 gem pins | 4 Sobel outline → hunt
let arPhase   = 0;
let arSceneEl = null;

// Phase 1: compiled targets from ritika/landmark-detection (Met reference images).
const LANDMARK_MIND_SRC = './met-detection/targets.mind';
// Phase 4 (and MindAR video passthrough): any valid .mind so the pipeline starts (not used for tracking there).
const OUTLINE_SESSION_MIND_SRC = './Assets/targets.mind';

let phase1LandmarkMatched      = false;
let pendingSecondSpotCompletion = false;

const ALIGNMENT_THRESHOLD    = 0.57;   // tolerant IoU is more generous; 0.50 ≈ "roughly aligned"
const ALIGNMENT_SUSTAIN_MS   = 1000;
const ALIGNMENT_TICK_MS      = 100;    // visual validator runs at 10 Hz
const VISUAL_GRID_W          = 192;    // downsampled Sobel grid; cheap on phones
const VISUAL_GRID_H          = 256;
const VISUAL_EDGE_THRESHOLD  = 60;     // 0..255
const VISUAL_TOLERANCE_PX    = 4;      // tolerance-aware IoU: edges within N px count as a match

// Single outline source — visual edge-match validator only.
const OUTLINE_SRC = 'Assets/HiddenGem.auto.png';

// Phase 3: hidden-gem suggestions shown after stamp collection.
const HIDDEN_GEMS = [
  { id: 'pub',     title: 'A 100 year old pub',                                    type: 'Pub',          walkMin: 4,  color: '#8C5A1A' },
  { id: 'gallery', title: 'A gallery where you can hear whispers across the room', type: 'Gallery',      walkMin: 7,  color: '#3F5532' },
  { id: 'install', title: 'A hidden away art installation',                        type: 'Art install.', walkMin: 11, color: '#E26E5F' },
];
// Phase 4 entry: second pin in the list (user heads to this “next” spot for outline matching).
const SECOND_SPOT_GEM_ID = HIDDEN_GEMS[1].id;

// Local offsets in camera space (camera looks down -Z); remapped through matrixWorld when gyro is on.
const PHASE3_PIN_LAYOUT = [
  { angleDeg: -22, radius: 1.1, y:  0.15 },
  { angleDeg:   0, radius: 1.2, y:  0.45 },
  { angleDeg:  22, radius: 1.1, y: -0.15 },
];
let currentGemId = null;
let gemToastTimer = null;

function restartAlignmentLoop() {
  stopAlignmentLoops();
  alignmentSustainStart = 0;
  const stage = document.querySelector('#ar-phase-outline .outline-stage');
  if (stage) { stage.dataset.state = 'idle'; stage.style.setProperty('--sustain', '0'); }
  startVisualAlignment();
}

// Phase 3 gem pin: open the HTML detail card on tap.
// Click events come from A-Frame's cursor + raycaster on the camera (see Phase 3 scene mount).
if (typeof AFRAME !== 'undefined' && !AFRAME.components['gem-pin']) {
  AFRAME.registerComponent('gem-pin', {
    schema: { id: { type: 'string' } },
    init() {
      this.onClick = () => {
        if (arPhase !== 3) return;
        playPinClickFx(this.el);
        openGemCard(this.data.id);
      };
      this.el.addEventListener('click', this.onClick);
    },
    remove() {
      this.el.removeEventListener('click', this.onClick);
    },
  });
}

// Brief scale-down then back, applied on the inner gltf wrapper so it doesn't
// clobber the outer pin's bob animation (which animates position).
function playPinClickFx(pinEl) {
  const target = pinEl.querySelector('[gltf-model]') || pinEl;
  const baseScale = target.getAttribute('scale') || { x: 0.14, y: 0.14, z: 0.14 };
  const bx = baseScale.x ?? 0.14, by = baseScale.y ?? 0.14, bz = baseScale.z ?? 0.14;
  const sx = bx * 0.7, sy = by * 0.7, sz = bz * 0.7;

  target.removeAttribute('animation__click');
  target.removeAttribute('animation__clickback');
  target.setAttribute('animation__click', {
    property: 'scale',
    to:       `${sx} ${sy} ${sz}`,
    dur:      110,
    easing:   'easeOutQuad',
  });
  target.setAttribute('animation__clickback', {
    property: 'scale',
    to:       `${bx} ${by} ${bz}`,
    dur:      180,
    delay:    110,
    easing:   'easeOutBack',
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

function resetOutlineHint() {
  const hint = document.querySelector('#ar-phase-outline .ar-hint');
  if (hint) {
    hint.classList.remove('ar-hint-insecure');
    hint.textContent = 'Match the outline to what you see';
  }
}

function resetLandmarkScanHint() {
  const hint = document.querySelector('#ar-phase-outline .ar-hint');
  if (hint) {
    hint.classList.remove('ar-hint-insecure');
    hint.textContent =
      'Point the camera at the printed landmark (demo uses The Met targets from ritika/landmark-detection)';
  }
}

function startAR() {
  const container = document.getElementById('ar-scan-container');
  if (!container) return;

  resetLandmarkScanHint();
  phase1LandmarkMatched = false;

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
    mountLandmarkDetectionScene(container);

    // Browsers treat http://192.168… as insecure — camera will fail, but AR still opens.
    if (!window.isSecureContext) {
      const hint = document.querySelector('#ar-phase-outline .ar-hint');
      if (hint) {
        hint.classList.add('ar-hint-insecure');
        hint.textContent =
          'Camera needs HTTPS on a phone. Use the https://….trycloudflare.com link from “npm run tunnel” on your computer — not http://192.168… or http://10.….';
      }
    }
  });
}

// ---- Phase 1: MindAR landmark (image targets) --------------------------------

function onLandmarkImageFound() {
  if (arPhase !== 1 || phase1LandmarkMatched) return;
  phase1LandmarkMatched = true;

  const hint = document.getElementById('outline-hint');
  if (hint) hint.textContent = 'Landmark found ✓';

  try { navigator.vibrate?.(80); } catch (_) {}

  setTimeout(() => transitionToPhase2({ secondSpotStamp: false }), 420);
}

function mountLandmarkDetectionScene(container) {
  alignmentLocked = false;
  alignmentSustainStart = 0;
  stopAlignmentLoops();

  const stage = document.querySelector('#ar-phase-outline .outline-stage');
  if (stage) stage.dataset.state = 'idle';

  // One anchor per compiled target index (met-detection/targets.mind).
  // met-detection/targets.mind is compiled with a single image target (see met-detection/script.js).
  const landmarkAnchorsHtml =
    '<a-entity mindar-image-target="targetIndex: 0"></a-entity>';

  container.innerHTML = `
    <a-scene id="ar-scene" embedded
      mindar-image="imageTargetSrc: ${LANDMARK_MIND_SRC}; uiScanning: no; uiLoading: no; uiError: no;"
      vr-mode-ui="enabled: false"
      device-orientation-permission-ui="enabled: false"
      renderer="alpha: true"
      style="position:absolute;top:0;left:0;width:100%;height:100%;">
      <a-assets></a-assets>
      <a-light type="ambient" color="#ffffff" intensity="0.85"></a-light>
      <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
      ${landmarkAnchorsHtml}
    </a-scene>`;

  arSceneEl = document.getElementById('ar-scene');
  if (!arSceneEl) return;

  arSceneEl.addEventListener(
    'renderstart',
    () => {
      hideARCameraError();
      if (arSceneEl?.renderer) arSceneEl.renderer.setClearColor(0x000000, 0);
      const anchors = arSceneEl.querySelectorAll('[mindar-image-target]');
      anchors.forEach((el) => {
        el.addEventListener('targetFound', onLandmarkImageFound);
      });
    },
    { once: true },
  );

  arSceneEl.addEventListener('arError', (e) => {
    const code = e.detail?.error ?? '';
    let sub = 'Tap “Enable camera”, choose Allow, and use Safari/Chrome.';
    if (!window.isSecureContext) {
      sub = 'Serve the app over HTTPS or localhost.';
    } else if (code === 'VIDEO_FAIL') {
      sub = 'Try “Enable camera” again, open in Safari, or use a real device.';
    } else if (code === 'INVALID_TARGET_URL' || code === 'TARGET_LOAD_FAIL') {
      sub = 'Landmark targets missing: met-detection/targets.mind';
    }
    showARCameraError(sub);
  });

  setARPhaseUI(1);
}

// ---- Phase 4: Sobel outline alignment (second spot) -------------------------

let alignmentTickerId      = null;
let alignmentSustainStart  = 0;
let alignmentLocked        = false;
let outlineMaskCanvas      = null;   // pre-binarized outline edge mask, used by visual validator
let visualSampleCanvas     = null;   // reused per tick to avoid GC churn

function mountOutlineAlignmentScene(container) {
  prepareOutlineUI(OUTLINE_SRC);

  // MindAR provides the camera passthrough; Sobel / outline IoU runs in JS (no image-target anchors).
  container.innerHTML = `
    <a-scene id="ar-scene" embedded
      mindar-image="imageTargetSrc: ${OUTLINE_SESSION_MIND_SRC}; uiScanning: no; uiLoading: no; uiError: no;"
      vr-mode-ui="enabled: false"
      device-orientation-permission-ui="enabled: false"
      renderer="alpha: true"
      style="position:absolute;top:0;left:0;width:100%;height:100%;">
      <a-assets></a-assets>
      <a-light type="ambient" color="#ffffff" intensity="0.85"></a-light>
      <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
    </a-scene>`;

  arSceneEl = document.getElementById('ar-scene');
  if (!arSceneEl) return;

  arSceneEl.addEventListener('renderstart', () => {
    hideARCameraError();
    if (arSceneEl?.renderer) arSceneEl.renderer.setClearColor(0x000000, 0);
    if (arPhase === 4) startVisualAlignment();
  }, { once: true });

  arSceneEl.addEventListener('arError', (e) => {
    const code = e.detail?.error ?? '';
    let sub = 'Tap “Enable camera”, choose Allow, and use Safari/Chrome.';
    if (!window.isSecureContext) {
      sub = 'Serve the app over HTTPS or localhost.';
    } else if (code === 'VIDEO_FAIL') {
      sub = 'Try “Enable camera” again, open in Safari, or use a real device.';
    } else if (code === 'INVALID_TARGET_URL' || code === 'TARGET_LOAD_FAIL') {
      sub = 'MindAR outline session needs a valid .mind in Assets/ (e.g. targets.mind).';
    }
    showARCameraError(sub);
  });

  setARPhaseUI(4);
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
  if (alignmentLocked || arPhase !== 4) return;

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
  if (alignmentLocked || arPhase !== 4) return;
  alignmentLocked = true;

  stopAlignmentLoops();

  const stage = document.querySelector('#ar-phase-outline .outline-stage');
  if (stage) stage.dataset.state = 'locked';

  try { navigator.vibrate?.(80); } catch (_) {}

  // Outline locked at second spot — stamp hunt again, then finish flow on collect.
  setTimeout(() => transitionToPhase2({ secondSpotStamp: true }), 420);
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

  if (!visualSampleCanvas) {
    visualSampleCanvas = document.createElement('canvas');
    visualSampleCanvas.width  = VISUAL_GRID_W;
    visualSampleCanvas.height = VISUAL_GRID_H;
  }

  // The MindAR <video> element may not exist at renderstart on a fresh mount —
  // re-query it every tick instead of bailing out of the whole loop. Once the
  // video appears and outlineMaskCanvas finishes building, scoring kicks in.
  alignmentTickerId = setInterval(() => {
    if (alignmentLocked || arPhase !== 4) return;
    const v = arSceneEl?.querySelector('video') || document.querySelector('#ar-scan-container video');
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

let phase2HuntModule = null;

async function transitionToPhase2(options = {}) {
  const { secondSpotStamp = false } = options;

  // Tear down MindAR / outline scene first — phase2-hunt.js owns its own
  // camera + Three.js scene and re-requests getUserMedia.
  teardownMindARScene();

  if (secondSpotStamp) pendingSecondSpotCompletion = true;

  arPhase = 2;
  setARPhaseUI(2);

  const host = document.getElementById('ar-phase-2-host');
  if (!host) return;

  try {
    if (!phase2HuntModule) phase2HuntModule = await import('./phase2-hunt.js');
    phase2HuntModule.startPhase2Hunt({
      host,
      stampUrl: './Assets/rodeo_coin.gltf',
      onCollected: collectStamp,
      onError: showARError,
    });
  } catch (err) {
    console.error('[script] failed to start phase 2 hunt', err);
    showARError('Could not start the stamp hunt — please reload.');
  }
}

function stopPhase2HuntIfRunning() {
  try { phase2HuntModule?.stopPhase2Hunt(); } catch (_) {}
}

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
  // Bottom detail sheet: only opened from a pin tap (`openGemCard`); clear whenever AR phase UI changes.
  closeGemCard();
}

let phase3VideoStream = null;

function teardownMindARScene() {
  // Stop alignment + MindAR system, but keep the AR screen visible.
  stopAlignmentLoops();
  alignmentLocked = false;
  alignmentSustainStart = 0;
  if (arSceneEl) {
    try { arSceneEl.systems?.['mindar-image-system']?.stop(); } catch (_) {}
  }
  arSceneEl = null;
  const container = document.getElementById('ar-scan-container');
  if (container) container.innerHTML = '';
}

function beginPhase4OutlineFlow() {
  resetOutlineHint();

  if (phase3VideoStream) {
    try { phase3VideoStream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
    phase3VideoStream = null;
  }
  if (arSceneEl) {
    try { arSceneEl.systems?.['mindar-image-system']?.stop(); } catch (_) {}
  }
  arSceneEl = null;

  const container = document.getElementById('ar-scan-container');
  if (!container) return;
  container.innerHTML = '';

  arPhase = 4;
  alignmentLocked = false;
  alignmentSustainStart = 0;
  stopAlignmentLoops();

  requestAnimationFrame(() => {
    const active = document.querySelector('.screen.active');
    if (!active || active.dataset.screen !== 'ar-scan') return;
    mountOutlineAlignmentScene(container);
  });
}

function transitionToPhase3() {
  // Phase 3 uses a plain A-Frame scene with a manual camera-feed video (no MindAR targets).
  // iOS 13+: device orientation must be requested from a user gesture; collectStamp() calls
  // us synchronously from the ar-scan click handler, so this runs inside that gesture.
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }

  teardownMindARScene();
  closeGemCard();

  const container = document.getElementById('ar-scan-container');
  if (!container) return;

  container.innerHTML = `
    <video id="phase3-video" autoplay playsinline muted
      style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0;"></video>
    <a-scene id="ar-scene" embedded
      vr-mode-ui="enabled: false"
      device-orientation-permission-ui="enabled: true"
      renderer="alpha: true"
      style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;">
      <a-entity id="phase3-world-root" position="0 0 0"></a-entity>
      <a-light type="ambient" color="#ffffff" intensity="0.9"></a-light>
      <!-- Magic-window: camera follows device orientation so pins (children of phase3-world-root)
           stay fixed in space; with look-controls off, the frustum never moves and pins read HUD-stuck. -->
      <a-camera position="0 0 0"
        look-controls="enabled: true; touchEnabled: false; mouseEnabled: false; magicWindowTrackingEnabled: true">
        <a-entity cursor="rayOrigin: mouse; fuse: false" raycaster="objects: .gem-pin; far: 50"></a-entity>
      </a-camera>
    </a-scene>`;

  arSceneEl = document.getElementById('ar-scene');
  arSceneEl?.addEventListener('renderstart', () => {
    if (arSceneEl?.renderer) arSceneEl.renderer.setClearColor(0x000000, 0);
  }, { once: true });

  // Camera passthrough via getUserMedia (independent of MindAR).
  const video = document.getElementById('phase3-video');
  navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    .then((stream) => {
      phase3VideoStream = stream;
      if (video) video.srcObject = stream;
    })
    .catch((err) => console.warn('[hidden-gem] camera unavailable:', err));

  arPhase = 3;
  setARPhaseUI(3);

  const spawnPins = () => {
    if (!arSceneEl) return;
    arSceneEl.querySelectorAll('.gem-pin').forEach((n) => n.parentNode.removeChild(n));
    spawnGemPinsInto(arSceneEl);
  };

  if (arSceneEl?.hasLoaded) spawnPins();
  else arSceneEl?.addEventListener('loaded', spawnPins, { once: true });
}

function repositionPhase3PinsFacingCamera(scene) {
  if (typeof AFRAME === 'undefined' || arPhase !== 3) return;
  const camEl = scene.querySelector('[camera]');
  const pins = scene.querySelectorAll('.gem-pin');
  if (!camEl || !pins.length) return;

  camEl.object3D.updateMatrixWorld(true);
  const mw = camEl.object3D.matrixWorld;
  const v = new AFRAME.THREE.Vector3();

  pins.forEach((pinEl, i) => {
    const row = PHASE3_PIN_LAYOUT[i];
    if (!row) return;
    const { angleDeg, radius, y } = row;
    const a = (angleDeg * Math.PI) / 180;
    const lx = Math.sin(a) * radius;
    const lz = -Math.cos(a) * radius;
    v.set(lx, y, lz);
    v.applyMatrix4(mw);
    const x = v.x;
    const yp = v.y;
    const z = v.z;
    pinEl.setAttribute('position', `${x} ${yp} ${z}`);
    pinEl.setAttribute('animation__bob', {
      property: 'position',
      to: `${x} ${yp + 0.08} ${z}`,
      dir: 'alternate',
      dur: 1400 + i * 120,
      easing: 'easeInOutSine',
      loop: true,
    });
  });

  const rayEl = scene.querySelector('[raycaster]');
  const rayComp = rayEl && rayEl.components && rayEl.components.raycaster;
  if (rayComp && typeof rayComp.setDirty === 'function') rayComp.setDirty();
}

function schedulePhase3PinRepositions(scene) {
  repositionPhase3PinsFacingCamera(scene);
  [32, 120, 280, 550].forEach((ms) => {
    setTimeout(() => repositionPhase3PinsFacingCamera(scene), ms);
  });
}

function spawnGemPinsInto(scene) {
  const worldRoot = scene.querySelector('#phase3-world-root') || scene;

  HIDDEN_GEMS.forEach((gem, i) => {
    const { angleDeg, radius, y } = PHASE3_PIN_LAYOUT[i] || PHASE3_PIN_LAYOUT[0];
    const a = (angleDeg * Math.PI) / 180;
    const x = Math.sin(a) * radius;
    const z = -Math.cos(a) * radius;

    // Outer pin entity carries the gem-pin (click) component and the floating bob animation.
    // The bob is on the OUTER entity so the inner model can independently spin.
    const pin = document.createElement('a-entity');
    pin.classList.add('gem-pin');
    pin.setAttribute('gem-pin', `id: ${gem.id}`);
    pin.setAttribute('position', `${x} ${y} ${z}`);
    pin.setAttribute('visible', 'true');
    // A-Frame raycaster `objects:` only tests meshes in each entity's object3DMap (geometry
    // component), not arbitrary child glTF nodes. Invisible sphere = tappable hit volume.
    pin.setAttribute('geometry', { primitive: 'sphere', radius: 0.42 });
    pin.setAttribute('material', {
      shader: 'flat',
      color: '#ffffff',
      opacity: 0,
      transparent: true,
      depthWrite: false,
    });

    // Floating animation: gentle vertical bob.
    pin.setAttribute('animation__bob', {
      property: 'position',
      to:       `${x} ${y + 0.08} ${z}`,
      dir:      'alternate',
      dur:      1400 + i * 120,
      easing:   'easeInOutSine',
      loop:     true,
    });

    // Inner wrapper: holds the gltf model + slow spin so the bob and spin don't interfere.
    const model = document.createElement('a-entity');
    model.setAttribute('gltf-model', 'url(./Assets/pin.gltf)');
    model.setAttribute('scale', '0.14 0.14 0.14');
    // Tint the model material once it loads so each pin reads as a distinct colour.
    model.addEventListener('model-loaded', (ev) => {
      const obj = ev.detail.model;
      obj.traverse((node) => {
        if (node.isMesh && node.material) {
          // Clone so we don't mutate a shared material across all pins.
          node.material = node.material.clone();
          node.material.color = new AFRAME.THREE.Color(gem.color);
          node.material.metalness = 0.1;
          node.material.roughness = 0.55;
        }
      });
    });
    // Fallback: if gltf fails (e.g. missing scene.bin), show a colored disc so the pin is still visible.
    model.addEventListener('model-error', () => {
      console.warn('[hidden-gem] pin model failed to load — falling back to disc. Add Assets/scene.bin or convert pin.gltf to .glb.');
      const disc = document.createElement('a-circle');
      disc.setAttribute('radius', '0.34');
      disc.setAttribute('material', `shader: flat; color: ${gem.color}; side: double`);
      pin.appendChild(disc);
    });
    pin.appendChild(model);

    // Slow spin around Y so the pin stays interesting.
    model.setAttribute('animation__spin', {
      property: 'rotation',
      from:     '0 0 0',
      to:       '0 360 0',
      dur:      6000,
      easing:   'linear',
      loop:     true,
    });

    worldRoot.appendChild(pin);
  });

  // Magic-window rotates the camera to the phone; raw world coords were authored for an
  // identity camera, so pins often end up outside the frustum. Re-map layout through the
  // camera matrix a few times as orientation settles (also covers denied gyro → no-op).
  schedulePhase3PinRepositions(scene);

  console.log('[hidden-gem] phase 3: spawned pins', scene.querySelectorAll('.gem-pin').length);
}

function openGemCard(id) {
  const gem = HIDDEN_GEMS.find((g) => g.id === id);
  if (!gem) return;
  currentGemId = id;

  const card     = document.getElementById('gem-detail-card');
  const titleEl  = card?.querySelector('[data-gem-title]');
  const typeEl   = card?.querySelector('[data-gem-type]');
  const walkEl   = card?.querySelector('[data-gem-walk]');
  if (titleEl) titleEl.textContent = gem.title;
  if (typeEl)  typeEl.textContent  = gem.type;
  if (walkEl)  walkEl.textContent  = `${gem.walkMin} min walk`;
  if (card)    card.hidden = false;
}

function closeGemCard() {
  const card = document.getElementById('gem-detail-card');
  if (card) card.hidden = true;
  currentGemId = null;
}

function showGemToast(msg) {
  const toast = document.getElementById('gem-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  if (gemToastTimer) clearTimeout(gemToastTimer);
  gemToastTimer = setTimeout(() => { toast.hidden = true; }, 1600);
}

document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : e.target?.parentElement;
  if (!t) return;
  if (t.closest('[data-gem-close]')) {
    e.preventDefault();
    e.stopPropagation();
    closeGemCard();
    return;
  }
  if (t.closest('[data-gem-go]')) {
    e.stopPropagation();
    if (currentGemId === SECOND_SPOT_GEM_ID && arPhase === 3) {
      closeGemCard();
      beginPhase4OutlineFlow();
      return;
    }
    console.log('[hidden-gem] go:', currentGemId);
    showGemToast('Heading there… (placeholder)');
  }
});

function showARError(msg) {
  const hint = document.querySelector('#ar-phase-outline .ar-hint');
  if (hint) hint.textContent = msg;
}

function stopAR() {
  arPhase = 0;
  phase1LandmarkMatched = false;
  pendingSecondSpotCompletion = false;
  stopPhase2HuntIfRunning();
  stopAlignmentLoops();
  alignmentLocked = false;
  alignmentSustainStart = 0;

  closeGemCard();
  const toast = document.getElementById('gem-toast');
  if (toast) toast.hidden = true;
  if (gemToastTimer) { clearTimeout(gemToastTimer); gemToastTimer = null; }

  // Phase 3's manual camera stream (independent of MindAR).
  if (phase3VideoStream) {
    try { phase3VideoStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    phase3VideoStream = null;
  }

  if (arSceneEl) {
    arSceneEl.querySelectorAll('.gem-pin').forEach((n) => n.parentNode.removeChild(n));
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

function collectStamp() {
  stopPhase2HuntIfRunning();
  if (pendingSecondSpotCompletion) {
    pendingSecondSpotCompletion = false;
    stopAR();
    go('book');
    return;
  }
  transitionToPhase3();
}

// ============ Boot ============
show('splash');
