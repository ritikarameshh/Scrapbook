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
    mountARSceneInto(container);
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

function transitionToPhase2(anchorEl) {
  const stampEl = document.getElementById('stamp-entity');
  if (!stampEl || !anchorEl) return;

  // Scavenger hunt: stamp is fixed to the tracked image; user moves the phone to find it.
  anchorEl.appendChild(stampEl);

  const angle = Math.random() * Math.PI * 2;
  const radius = 0.48 + Math.random() * 0.42;
  const yLift = 0.18 + Math.random() * 0.28;
  stampEl.setAttribute('position', {
    x: Math.cos(angle) * radius,
    y: yLift,
    z: Math.sin(angle) * radius,
  });
  stampEl.setAttribute('rotation', { x: 0, y: 0, z: 0 });
  stampEl.setAttribute('visible', true);
  stampEl.object3D.visible = true;

  arPhase = 2;
  setARPhaseUI(2);
}

function setARPhaseUI(phase) {
  const p1      = document.getElementById('ar-phase-1');
  const p2      = document.getElementById('ar-phase-2');
  const tapHint = document.getElementById('tap-to-collect');
  if (p1)      p1.hidden = (phase !== 1);
  if (p2)      p2.hidden = (phase !== 2);
  if (tapHint) tapHint.hidden = true;
}

function showARError(msg) {
  const hint = document.querySelector('#ar-phase-1 .ar-hint');
  if (hint) hint.textContent = msg;
}

function stopAR() {
  arPhase = 0;

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
