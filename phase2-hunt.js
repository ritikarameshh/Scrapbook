import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const TEMPLATE = `
  <video class="p2-cameraVideo" autoplay muted playsinline></video>
  <canvas class="p2-threeCanvas"></canvas>

  <div class="p2-statusBar p2-hidden">Look around to find the stamp</div>

  <div class="p2-compassHint">Calibrating compass…</div>

  <div class="p2-handIndicator">
    <span class="p2-icon">✋</span>
    <span class="p2-val">—</span>
  </div>

  <div class="p2-arrowHint">
    <img class="p2-arrowImg" src="./Assets/arrow.svg" alt="" aria-hidden="true" />
  </div>

  <div class="p2-countdownWrap">
    <svg class="p2-countdownRing" viewBox="0 0 220 220" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="p2CountdownGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#E8AE3D" />
          <stop offset="50%" stop-color="#E26E5F" />
          <stop offset="100%" stop-color="#452222" />
        </linearGradient>
      </defs>
      <circle class="p2-track" cx="110" cy="110" r="100" />
      <circle class="p2-progress" cx="110" cy="110" r="100"
        stroke-dasharray="628.318" stroke-dashoffset="628.318" />
    </svg>
    <div class="p2-countdownText">
      <div class="p2-countdownNumber">3</div>
      <div class="p2-countdownLabel">Don&apos;t let go</div>
    </div>
  </div>

  <div class="p2-flashOverlay"></div>
  <div class="p2-shockwave"></div>

  <div class="p2-manualCollect">
    <button class="btn btn-primary p2-manualCollectBtn" type="button">Tap to Collect</button>
  </div>

  <div class="p2-loadingScreen">
    <div class="p2-loadingHeader">
      <p class="p2-loadingEyebrow">You found</p>
      <h1 class="p2-loadingTitle">The Metropolitan Museum of Art</h1>
    </div>
    <div class="p2-loadingBody">
      <p class="p2-loadingPrompt">Find this stamp around you and grab it!</p>
      <div class="p2-loadingStamp">
        <img src="./Assets/Stamps/TheMet.png" alt="The Metropolitan Museum of Art stamp" />
      </div>
    </div>
    <div class="p2-loadingFooter">
      <div class="p2-spinner" aria-hidden="true"></div>
      <div class="p2-loadingText">Firing up</div>
    </div>
  </div>

  <div class="p2-errorScreen">
    <div class="p2-errorIcon">⚠️</div>
    <h2 class="p2-errorTitle">Something went wrong</h2>
    <p class="p2-errorMsg">Please try again.</p>
    <button class="btn btn-primary p2-errorRetryBtn" type="button">Try Again</button>
  </div>

  <div class="p2-confettiContainer"></div>

  <div class="p2-factsBackdrop"></div>
  <div class="p2-factsModal">
    <div class="p2-factsCard">
      <button class="p2-factsClose" type="button" aria-label="Close">✕</button>
      <h2 class="p2-factsTitle">Stamp found!</h2>
      <div class="p2-stampViewer">
        <canvas class="p2-stampViewerCanvas" aria-hidden="true"></canvas>
      </div>
      <div class="p2-factsCallout">
        <p class="p2-factsEyebrow">Did you know</p>
        <p class="p2-featuredFact"></p>
      </div>
      <div class="p2-actionRow">
        <button class="p2-shareBtn" type="button">Share</button>
        <button class="p2-dismissBtn" type="button">
          <span class="p2-dismissBtnTitle">See 3 local favorites</span>
          <span class="p2-dismissBtnSub">All &lt; 5 min away</span>
        </button>
      </div>
    </div>
  </div>
`;

let activeInstance = null;

export function stopPhase2Hunt() {
  if (!activeInstance) return;
  try { activeInstance.stop(); } catch (err) { console.warn('[phase2-hunt] stop error', err); }
  activeInstance = null;
}

export async function startPhase2Hunt({
  host,
  onCollected,
  onError,
  stampUrl = './Assets/MetStamp.gltf',
  stampName = 'The Metropolitan Museum of Art',
  stampImage = './Assets/Stamps/TheMet.png',
  /** When set, reuse this element’s stream (e.g. MindAR video) instead of opening a new camera. */
  sharedVideoElement = null,
  funFacts = [
    {
      lead: 'The Met is home to the Egyptian Temple of Dendur that has been restored entirely inside the building.',
      body: 'You can see it in the Egyptian Gallery inside!',
    },
    {
      lead: 'The Met opened in 1872 in a Fifth Avenue building it has long since outgrown.',
      body: 'Today it spans over 2 million square feet across three locations.',
    },
    {
      lead: 'The Met holds more than 1.5 million works of art spanning 5,000 years of human creativity.',
      body: 'You could visit every day for a year and still not see it all.',
    },
  ],
  /** Post–outline Lexington Candy hunt: primary CTA = Done, exits to Book via onCollected. */
  secondSpotStamp = false,
  /** Facts bottomsheet ✕ only: leave AR to Book without firing onCollected. */
  onExitFactsViaClose = null,
}) {
  if (activeInstance) stopPhase2Hunt();
  if (!host) throw new Error('phase2-hunt: host element required');

  host.classList.add('phase2-hunt-host');
  host.innerHTML = TEMPLATE;

  // Track listeners we add to window/document so we can remove them on stop.
  const winListeners = [];
  const addWin = (target, ev, fn, opts) => {
    target.addEventListener(ev, fn, opts);
    winListeners.push({ target, ev, fn, opts });
  };

  const $ = (sel) => host.querySelector(sel);
  const tplCameraVideo = $('.p2-cameraVideo');
  // MindAR’s <video> lives under WebGL layers and is often not visible. Mirror its MediaStream
  // onto this host’s video so CSS (#ar-phase-2-host .p2-cameraVideo) shows the feed while
  // MediaPipe / optical flow read the same mirrored element.
  const ownsCameraStream = !sharedVideoElement;
  const captureVideo = tplCameraVideo;
  const threeCanvas   = $('.p2-threeCanvas');
  const statusBar     = $('.p2-statusBar');
  const compassHint   = $('.p2-compassHint');
  const handIndicator = $('.p2-handIndicator');
  const handIndicatorVal = $('.p2-handIndicator .p2-val');
  const arrowHint     = $('.p2-arrowHint');
  const countdownWrap = $('.p2-countdownWrap');
  const countdownProgress = $('.p2-countdownRing .p2-progress');
  const countdownNumber = $('.p2-countdownNumber');
  const countdownLabel = $('.p2-countdownLabel');
  const flashOverlay  = $('.p2-flashOverlay');
  const shockwave     = $('.p2-shockwave');
  const loadingScreen = $('.p2-loadingScreen');
  const loadingText   = $('.p2-loadingText');
  const loadingTitle  = $('.p2-loadingTitle');
  const loadingStampImg = $('.p2-loadingStamp img');
  const errorScreen   = $('.p2-errorScreen');
  const errorTitle    = $('.p2-errorTitle');
  const errorMsg      = $('.p2-errorMsg');
  const errorRetryBtn = $('.p2-errorRetryBtn');
  const manualCollect = $('.p2-manualCollect');
  const manualCollectBtn = $('.p2-manualCollectBtn');
  const confettiContainer = $('.p2-confettiContainer');
  const factsBackdrop = $('.p2-factsBackdrop');
  const factsModal    = $('.p2-factsModal');
  const stampViewerCanvas = $('.p2-stampViewerCanvas');
  const featuredFactEl = $('.p2-featuredFact');
  const shareBtn      = $('.p2-shareBtn');
  const dismissBtn    = $('.p2-dismissBtn');
  const dismissBtnTitleEl = $('.p2-dismissBtnTitle');
  const dismissBtnSubEl = $('.p2-dismissBtnSub');
  const factsCloseBtn = $('.p2-factsClose');

  /* ---- Config ---- */
  const STAMP_URL = stampUrl;
  const STAMP_NAME = stampName;
  const FUN_FACTS = funFacts;
  const STAMP_POSITION = new THREE.Vector3(1.4, 0.2, -2.4);
  const HUD_DEPTH = 1.6;
  const HUD_LOCAL_SCALE = 0.18;
  let HUD_LOCAL_POSITION = new THREE.Vector3(0.4, -0.78, -HUD_DEPTH);

  const FIST_THRESHOLD = 1.7;
  const OPEN_THRESHOLD = 2.2;
  const COUNTDOWN_DURATION = 3.0;
  const CENTER_FOUND_FRACTION = 0.90;
  const HAND_TIMEOUT_FOR_FALLBACK_MS = 8000;
  const STAMP_MAX_SCREEN_NDC_Y = 0.34;
  const STAMP_NDC_CLAMP_STEP = 0.065;
  const STAMP_MIN_WORLD_Y = -0.75;

  /* ---- State machine ---- */
  const STATES = Object.freeze({
    INIT: 'INIT', SEARCHING: 'SEARCHING', STAMP_IN_VIEW: 'STAMP_IN_VIEW',
    GRABBING: 'GRABBING', COLLECTING: 'COLLECTING', COLLECTED: 'COLLECTED',
    FACTS_SHOWN: 'FACTS_SHOWN',
  });
  let state = STATES.INIT;
  const STATUS_TEXTS = {
    [STATES.INIT]: '',
    [STATES.SEARCHING]: 'Look around to find the stamp',
    [STATES.STAMP_IN_VIEW]: 'Reach out and grab it by closing your fist!',
    [STATES.GRABBING]: '',
    [STATES.COLLECTING]: '',
    [STATES.COLLECTED]: 'Stamp Collected! ✨',
    [STATES.FACTS_SHOWN]: '',
  };
  let stampInViewEnteredMs = 0;

  function setState(next) {
    if (state === next) return;
    state = next;
    const text = STATUS_TEXTS[state] || '';
    if (text) { statusBar.textContent = text; statusBar.classList.remove('p2-hidden'); }
    else { statusBar.classList.add('p2-hidden'); }
    if (state === STATES.SEARCHING) arrowHint.classList.add('p2-visible');
    else arrowHint.classList.remove('p2-visible');
    if (state === STATES.STAMP_IN_VIEW) stampInViewEnteredMs = performance.now();
  }

  function vibrate(p) { try { if ('vibrate' in navigator) navigator.vibrate(p); } catch (_) {} }

  function showError(title, message, retry) {
    errorTitle.textContent = title;
    errorMsg.textContent = message;
    errorRetryBtn.style.display = retry ? 'inline-flex' : 'none';
    errorRetryBtn.onclick = retry || null;
    errorScreen.classList.add('p2-visible');
    if (onError) onError(message || title);
  }
  function hideError() { errorScreen.classList.remove('p2-visible'); }

  /* ---- Three.js ---- */
  let renderer, scene, camera, stampRoot, stampLight, particleSystem;
  const clock = new THREE.Clock();

  function initThree() {
    renderer = new THREE.WebGLRenderer({
      canvas: threeCanvas, alpha: true, antialias: true, premultipliedAlpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 100);
    camera.position.set(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    const headLight = new THREE.DirectionalLight(0xfff8f2, 1.55);
    headLight.position.set(0, 0.12, 0.08);
    const headLightTarget = new THREE.Object3D();
    headLightTarget.position.set(0, 0, -1);
    camera.add(headLightTarget);
    headLight.target = headLightTarget;
    camera.add(headLight);
    const point = new THREE.PointLight(0xffffff, 1.2, 30);
    point.position.set(2, 3, 2);
    scene.add(point);
    stampLight = new THREE.PointLight(0xE8AE3D, 1.6, 6);
    stampLight.position.copy(STAMP_POSITION);
    scene.add(stampLight);
    addWin(window, 'resize', onResize);
  }

  function onResize() {
    if (!renderer || !camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (stampRoot && stampRoot.userData.isHud) {
      recomputeHudLocalPosition();
      stampRoot.position.copy(HUD_LOCAL_POSITION);
    }
  }

  function forEachMeshMaterial(mesh, fn) {
    if (!mesh.isMesh || !mesh.material) return;
    const mats = mesh.material;
    if (Array.isArray(mats)) mats.forEach(fn);
    else fn(mats);
  }

  /* ---- Stamp loading ---- */
  let stampReady = false;
  let baseStampScale = 1;
  function loadStamp() {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(STAMP_URL, (gltf) => {
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const norm = 0.6 / maxDim;
        model.scale.multiplyScalar(norm);
        const center = new THREE.Vector3(); box.getCenter(center);
        model.position.sub(center.multiplyScalar(norm));
        stampRoot = new THREE.Group();
        stampRoot.add(model);
        stampRoot.position.copy(STAMP_POSITION);
        stampRoot.userData = {
          basePosition: STAMP_POSITION.clone(),
          worldPosition: STAMP_POSITION.clone(),
          isHud: false,
        };
        stampRoot.traverse((obj) => {
          if (!obj.isMesh) return;
          forEachMeshMaterial(obj, (m) => {
            m.transparent = true;
            m.opacity = 0;
            if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          });
          obj.castShadow = false;
          obj.receiveShadow = false;
        });
        baseStampScale = stampRoot.scale.x;
        scene.add(stampRoot);
        stampReady = true;
        resolve();
      }, undefined, (err) => { console.error('GLTF load error', err); reject(err); });
    });
  }

  function setStampOpacity(o) {
    if (!stampRoot) return;
    stampRoot.traverse((obj) => {
      if (!obj.isMesh) return;
      forEachMeshMaterial(obj, (m) => {
        m.transparent = true;
        m.opacity = o;
      });
    });
  }

  /* ---- Camera ---- */
  let mediaStream = null;
  function requestCameraStream() {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  }
  async function attachCameraStream(streamPromise) {
    if (!ownsCameraStream) {
      try {
        const ext = sharedVideoElement;
        for (let i = 0; i < 80 && ext && !ext.srcObject; i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (!ext?.srcObject) {
          console.warn('[phase2-hunt] MindAR video has no MediaStream after wait');
          return false;
        }
        tplCameraVideo.srcObject = ext.srcObject;
        await tplCameraVideo.play();
        return tplCameraVideo.readyState >= 2;
      } catch (err) {
        console.error('[phase2-hunt] shared video mirror error:', err);
        showError(
          'Camera not ready',
          'The AR camera preview is not available yet. Close AR and try again.',
          null,
        );
        return false;
      }
    }
    try {
      mediaStream = await streamPromise;
      captureVideo.srcObject = mediaStream;
      await captureVideo.play();
      return true;
    } catch (err) {
      console.error('[phase2-hunt] Camera error:', err);
      showError('Camera access needed',
        'Please allow camera access in your browser settings, then reload to start the hunt.',
        () => location.reload());
      return false;
    }
  }

  /* ---- Device orientation ---- */
  let orientationSupported = false;
  let orientation = null;
  let screenOrient = 0;
  let stampPlacedFromOrientation = false;
  const _stampProjClamp = new THREE.Vector3();

  function placeStampOffscreenFromCurrentView() {
    if (!stampRoot || stampPlacedFromOrientation) return false;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const sign = Math.random() < 0.5 ? -1 : 1;
    const angle = sign * THREE.MathUtils.degToRad(60 + Math.random() * 80);
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    STAMP_POSITION.set(forward.x * 2.4, 0.2, forward.z * 2.4);
    if (camera) {
      const preX = STAMP_POSITION.x, preZ = STAMP_POSITION.z, preY = STAMP_POSITION.y;
      for (let i = 0; i < 40; i++) {
        _stampProjClamp.copy(STAMP_POSITION).project(camera);
        if (_stampProjClamp.y <= STAMP_MAX_SCREEN_NDC_Y) break;
        STAMP_POSITION.y -= STAMP_NDC_CLAMP_STEP;
      }
      STAMP_POSITION.y = Math.max(STAMP_POSITION.y, STAMP_MIN_WORLD_Y);
      _stampProjClamp.copy(STAMP_POSITION).project(camera);
      if (_stampProjClamp.z >= 1) STAMP_POSITION.set(preX, preY, preZ);
    }
    stampRoot.position.copy(STAMP_POSITION);
    stampRoot.userData.basePosition.copy(STAMP_POSITION);
    stampPlacedFromOrientation = true;
    return true;
  }

  const COMPASS_SMOOTH_T = 0.17;
  let compassSmoothSeeded = false;
  function lerpAngleDeg(from, to, t) {
    let d = ((to - from + 540) % 360) - 180;
    const r = from + d * t;
    return ((r % 360) + 360) % 360;
  }

  function requestOrientationPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { return DeviceOrientationEvent.requestPermission().catch(() => 'denied'); }
      catch (_) { return Promise.resolve('denied'); }
    }
    return Promise.resolve('granted');
  }

  async function initDeviceOrientation(permissionPromise) {
    const result = await permissionPromise;
    if (result !== 'granted') { orientationSupported = false; return false; }
    return new Promise((resolve) => {
      let received = false;
      const handler = (e) => {
        const heading = (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading))
          ? (360 - e.webkitCompassHeading) % 360
          : e.alpha;
        if (heading == null && e.beta == null && e.gamma == null) return;
        if (!received) {
          received = true;
          orientationSupported = true;
          if (compassHint) compassHint.classList.remove('p2-visible');
          resolve(true);
        }
        orientation = orientation || { alpha: 0, beta: 0, gamma: 0 };
        if (heading != null) {
          if (!compassSmoothSeeded) { orientation.alpha = heading; compassSmoothSeeded = true; }
          else orientation.alpha = lerpAngleDeg(orientation.alpha, heading, COMPASS_SMOOTH_T);
        }
        if (e.beta  != null) orientation.beta  = e.beta;
        if (e.gamma != null) orientation.gamma = e.gamma;
        updateCameraFromDevice();
        placeStampOffscreenFromCurrentView();
      };
      addWin(window, 'deviceorientation', handler, true);
      addWin(window, 'deviceorientationabsolute', handler, true);
      addWin(window, 'orientationchange', () => { screenOrient = window.orientation || 0; });
      screenOrient = window.orientation || 0;
      setTimeout(() => { if (!received) { orientationSupported = false; resolve(false); } }, 2000);
    });
  }

  const _q1 = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  const _eu = new THREE.Euler();
  const _zee = new THREE.Vector3(0, 0, 1);
  function updateCameraFromDevice() {
    if (!orientationSupported || !orientation) return;
    const alpha = THREE.MathUtils.degToRad(orientation.alpha);
    const beta  = THREE.MathUtils.degToRad(orientation.beta);
    const gamma = THREE.MathUtils.degToRad(orientation.gamma);
    const orient = THREE.MathUtils.degToRad(screenOrient);
    _eu.set(beta, alpha, -gamma, 'YXZ');
    camera.quaternion.setFromEuler(_eu);
    camera.quaternion.multiply(_q2);
    camera.quaternion.multiply(_q1.setFromAxisAngle(_zee, -orient));
  }

  /* ---- Optical flow fallback ---- */
  const OF_W = 64, OF_H = 48;
  const OF_DX_RANGE = 6, OF_DY_RANGE = 4;
  const OF_LP_ALPHA = 0.7;
  let opticalFlowActive = false;
  let _ofCanvas = null, _ofCtx = null;
  let _ofPrev = null, _ofCur = null;
  let _ofHasPrev = false, _ofLastMs = 0, _ofRaf = 0;
  let _ofSmoothDx = 0, _ofSmoothDy = 0;
  let _ofYawDeg = 0, _ofPitchDeg = 0;

  function startOpticalFlow() {
    if (opticalFlowActive) return;
    if (!captureVideo || captureVideo.readyState < 2) {
      setTimeout(startOpticalFlow, 100);
      return;
    }
    _ofCanvas = document.createElement('canvas');
    _ofCanvas.width = OF_W; _ofCanvas.height = OF_H;
    _ofCtx = _ofCanvas.getContext('2d', { willReadFrequently: true });
    _ofPrev = new Uint8Array(OF_W * OF_H);
    _ofCur  = new Uint8Array(OF_W * OF_H);
    orientation = orientation || { alpha: 0, beta: 0, gamma: 0 };
    orientationSupported = true;
    opticalFlowActive = true;
    _ofLastMs = performance.now();
    if (compassHint) compassHint.classList.remove('p2-visible');
    _ofTick();
  }
  function _ofGrabLuma(target) {
    _ofCtx.drawImage(captureVideo, 0, 0, OF_W, OF_H);
    const data = _ofCtx.getImageData(0, 0, OF_W, OF_H).data;
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      target[j] = (data[i] * 77 + data[i + 1] * 151 + data[i + 2] * 28) >> 8;
    }
  }
  function _ofComputeShift() {
    let bestDx = 0, bestDy = 0, bestSad = Infinity;
    for (let dy = -OF_DY_RANGE; dy <= OF_DY_RANGE; dy++) {
      const yMin = Math.max(0, -dy), yMax = Math.min(OF_H, OF_H - dy);
      for (let dx = -OF_DX_RANGE; dx <= OF_DX_RANGE; dx++) {
        const xMin = Math.max(0, -dx), xMax = Math.min(OF_W, OF_W - dx);
        let sad = 0;
        for (let y = yMin; y < yMax; y += 2) {
          const rowCur = y * OF_W, rowPrev = (y + dy) * OF_W;
          for (let x = xMin; x < xMax; x += 2) {
            const a = _ofCur[rowCur + x], b = _ofPrev[rowPrev + x + dx];
            sad += a > b ? a - b : b - a;
            if (sad >= bestSad) break;
          }
          if (sad >= bestSad) break;
        }
        if (sad < bestSad) { bestSad = sad; bestDx = dx; bestDy = dy; }
      }
    }
    return [bestDx, bestDy];
  }
  function _ofTick() {
    if (!opticalFlowActive) return;
    _ofRaf = requestAnimationFrame(_ofTick);
    if (!captureVideo || captureVideo.readyState < 2) return;
    const now = performance.now();
    if (now - _ofLastMs < 33) return;
    _ofLastMs = now;
    _ofGrabLuma(_ofCur);
    if (!_ofHasPrev) { _ofPrev.set(_ofCur); _ofHasPrev = true; return; }
    const [dx, dy] = _ofComputeShift();
    _ofSmoothDx = OF_LP_ALPHA * _ofSmoothDx + (1 - OF_LP_ALPHA) * dx;
    _ofSmoothDy = OF_LP_ALPHA * _ofSmoothDy + (1 - OF_LP_ALPHA) * dy;
    const hfovDeg = camera ? camera.fov * camera.aspect : 60;
    const vfovDeg = camera ? camera.fov : 45;
    _ofYawDeg   -= _ofSmoothDx * (hfovDeg / OF_W);
    _ofPitchDeg += _ofSmoothDy * (vfovDeg / OF_H);
    _ofPitchDeg = Math.max(-80, Math.min(80, _ofPitchDeg));
    orientation.alpha = _ofYawDeg;
    orientation.beta  = 90 + _ofPitchDeg;
    orientation.gamma = 0;
    const tmp = _ofPrev; _ofPrev = _ofCur; _ofCur = tmp;
  }

  /* ---- MediaPipe Hands ---- */
  let hands = null;
  let mediapipeReady = false;
  let mediapipeFailed = false;
  let frameToggle = 0;
  let lastHandLandmarks = null;
  let handVisible = false;
  let lastHandSeenMs = 0;

  async function initMediaPipe() {
    if (typeof Hands === 'undefined') {
      console.warn('[phase2-hunt] MediaPipe Hands global not found.');
      mediapipeFailed = true;
      showManualFallback();
      return;
    }
    try {
      hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
      });
      hands.setOptions({
        maxNumHands: 1, modelComplexity: 0,
        minDetectionConfidence: 0.6, minTrackingConfidence: 0.5,
      });
      hands.onResults(onHandResults);
      await hands.initialize();
      mediapipeReady = true;
    } catch (err) {
      console.error('[phase2-hunt] MediaPipe init failed', err);
      mediapipeFailed = true;
      showManualFallback();
    }
  }
  function showManualFallback() { manualCollect.classList.add('p2-visible'); }

  function onHandResults(results) {
    const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
    if (hasHand) {
      lastHandLandmarks = results.multiHandLandmarks[0];
      lastHandSeenMs = performance.now();
      if (!handVisible) { handVisible = true; handIndicator.classList.add('p2-active'); }
      processGrabGesture(lastHandLandmarks);
    } else {
      handIndicatorVal.textContent = '—';
      handIndicator.classList.remove('p2-fist');
    }
  }

  function fingerExtension(lm, mcp, pip, tip) {
    const dxTM = lm[tip].x - lm[mcp].x;
    const dyTM = lm[tip].y - lm[mcp].y;
    const dxPM = lm[pip].x - lm[mcp].x;
    const dyPM = lm[pip].y - lm[mcp].y;
    return Math.hypot(dxTM, dyTM) / (Math.hypot(dxPM, dyPM) || 0.0001);
  }
  function computeHandClosure(lm) {
    return (fingerExtension(lm, 5, 6, 8) + fingerExtension(lm, 9, 10, 12) +
            fingerExtension(lm, 13, 14, 16) + fingerExtension(lm, 17, 18, 20)) / 4;
  }

  let isFist = false;
  function processGrabGesture(lm) {
    const closure = computeHandClosure(lm);
    if (!isFist && closure < FIST_THRESHOLD) isFist = true;
    else if (isFist && closure > OPEN_THRESHOLD) isFist = false;
    handIndicatorVal.textContent = closure.toFixed(2);
    handIndicator.classList.toggle('p2-fist', isFist);
    if (isFist) {
      if (state === STATES.STAMP_IN_VIEW) { setState(STATES.GRABBING); startCountdown(); }
    } else {
      if (state === STATES.GRABBING) {
        cancelCountdown();
        setState(STATES.STAMP_IN_VIEW);
      }
    }
  }

  /* ---- Countdown ---- */
  let countdown = null;
  const RING_CIRC = 2 * Math.PI * 100;
  function setRingProgress(p) {
    countdownProgress.setAttribute('stroke-dashoffset', (RING_CIRC * (1 - p)).toFixed(2));
  }
  function startCountdown() {
    countdown = { startSec: clock.elapsedTime, lastTickInt: 4 };
    countdownWrap.classList.add('p2-visible');
    countdownNumber.textContent = '3';
    countdownLabel.textContent = "Don't let go";
    setRingProgress(0);
  }
  function cancelCountdown() {
    countdown = null;
    countdownWrap.classList.remove('p2-visible');
    setRingProgress(0);
  }
  function tickCountdown() {
    if (!countdown) return;
    const t = clock.elapsedTime - countdown.startSec;
    const p = Math.min(t / COUNTDOWN_DURATION, 1);
    setRingProgress(p);
    const remaining = Math.max(0, COUNTDOWN_DURATION - t);
    const intRem = Math.ceil(remaining);
    if (intRem !== countdown.lastTickInt && intRem >= 1 && intRem <= 3) {
      countdown.lastTickInt = intRem;
      countdownNumber.textContent = String(intRem);
      countdownNumber.classList.remove('p2-tick');
      void countdownNumber.offsetWidth;
      countdownNumber.classList.add('p2-tick');
      if      (intRem === 3) vibrate(100);
      else if (intRem === 2) vibrate(200);
      else if (intRem === 1) vibrate(300);
    }
    if (p >= 1) completeCountdown();
  }
  function completeCountdown() {
    countdown = null;
    countdownWrap.classList.remove('p2-visible');
    setRingProgress(0);
    vibrate([100, 50, 100, 50, 500]);
    triggerCollection();
  }

  /* ---- Collection animation ---- */
  let collection = null;
  function triggerCollection() {
    if (state === STATES.COLLECTING || state === STATES.COLLECTED) return;
    setState(STATES.COLLECTING);
    const worldPos = new THREE.Vector3();
    stampRoot.getWorldPosition(worldPos);
    const screen = worldToScreen(worldPos);
    shockwave.style.left = `${screen.x}px`;
    shockwave.style.top  = `${screen.y}px`;
    collection = {
      startSec: clock.elapsedTime, phase: 'freeze',
      worldPos, initialScale: stampRoot.scale.x,
      initialPos: stampRoot.position.clone(),
      initialQuat: stampRoot.quaternion.clone(),
      spawnedParticles: false, flashFired: false, poppedFired: false,
      flightStartSec: null, shrinkStartSec: null, shrinkStartLocal: null,
      settleDoneFired: false,
    };
    setStampEmissive(0xfff1c4, 1.4);
    vibrate([500]);
    flashOverlay.style.transition = 'opacity 0.15s ease-out';
    flashOverlay.style.opacity = '0.4';
    setTimeout(() => {
      flashOverlay.style.transition = 'opacity 0.15s ease-in';
      flashOverlay.style.opacity = '0';
    }, 150);
  }
  function setStampEmissive(color, intensity) {
    if (!stampRoot) return;
    stampRoot.traverse((obj) => {
      if (!obj.isMesh) return;
      forEachMeshMaterial(obj, (m) => {
        if ('emissive' in m) {
          m.emissive.setHex(color);
          m.emissiveIntensity = intensity;
        }
      });
    });
  }
  function tickCollection(dt) {
    if (!collection) return;
    const t = clock.elapsedTime - collection.startSec;
    if (collection.phase === 'freeze' && t >= 0.1) {
      collection.phase = 'pop';
      shockwave.classList.remove('p2-fire');
      void shockwave.offsetWidth;
      shockwave.classList.add('p2-fire');
      collection.poppedFired = true;
    }
    if (collection.phase === 'pop') {
      const localT = (t - 0.1) / 0.1;
      const k = Math.min(localT, 1);
      stampRoot.scale.setScalar(collection.initialScale * (1 + 0.5 * k));
      if (localT >= 1) {
        collection.phase = 'flight';
        collection.flightStartSec = clock.elapsedTime;
        const wp = new THREE.Vector3();
        stampRoot.getWorldPosition(wp);
        spawnParticles(wp);
        setStampEmissive(0x000000, 0);
      }
    }
    if (collection.phase === 'flight') {
      const flT = (clock.elapsedTime - collection.flightStartSec) / 0.6;
      const k = Math.min(flT, 1);
      const eased = easeInCubic(k);
      const targetWorld = new THREE.Vector3(0, 0, -0.5).applyMatrix4(camera.matrixWorld);
      const newPos = new THREE.Vector3().lerpVectors(collection.initialPos, targetWorld, eased);
      stampRoot.position.copy(newPos);
      const s = collection.initialScale * (1.5 + 1.6 * eased);
      stampRoot.scale.setScalar(s);
      stampRoot.rotation.x = Math.sin(eased * Math.PI * 6) * 0.5;
      stampRoot.rotation.z = Math.cos(eased * Math.PI * 4) * 0.4;
      stampRoot.rotation.y += dt * 4.5;
      if (flT >= 1) {
        collection.phase = 'shrink';
        collection.shrinkStartSec = clock.elapsedTime;
        recomputeHudLocalPosition();
        const localPos = new THREE.Vector3();
        stampRoot.getWorldPosition(localPos);
        camera.worldToLocal(localPos);
        const localQuat = stampRoot.quaternion.clone();
        camera.add(stampRoot);
        stampRoot.position.copy(localPos);
        stampRoot.quaternion.copy(localQuat);
        stampRoot.userData.isHud = true;
        collection.shrinkStartLocal = localPos.clone();
        collection.shrinkStartScale = stampRoot.scale.x;
      }
    }
    if (collection.phase === 'shrink') {
      const sT = (clock.elapsedTime - collection.shrinkStartSec) / 0.7;
      const k = Math.min(sT, 1);
      const eased = easeOutCubic(k);
      const p0 = collection.shrinkStartLocal;
      const p2 = HUD_LOCAL_POSITION;
      const p1 = new THREE.Vector3(
        (p0.x + p2.x) * 0.5 + 0.4,
        Math.max(p0.y, p2.y) + 0.6,
        (p0.z + p2.z) * 0.5,
      );
      const inv = 1 - eased;
      const pos = new THREE.Vector3()
        .addScaledVector(p0, inv * inv)
        .addScaledVector(p1, 2 * inv * eased)
        .addScaledVector(p2, eased * eased);
      stampRoot.position.copy(pos);
      const targetScale = baseStampScale * HUD_LOCAL_SCALE;
      const s = THREE.MathUtils.lerp(collection.shrinkStartScale, targetScale, eased);
      stampRoot.scale.setScalar(s);
      stampRoot.rotation.y += dt * 6;
      stampRoot.rotation.x = THREE.MathUtils.lerp(stampRoot.rotation.x, 0, eased);
      stampRoot.rotation.z = THREE.MathUtils.lerp(stampRoot.rotation.z, 0, eased);
      if (sT >= 1) {
        collection.phase = 'settle';
        collection.settleStartSec = clock.elapsedTime;
        setState(STATES.COLLECTED);
      }
    }
    if (collection.phase === 'settle') {
      const stT = (clock.elapsedTime - collection.settleStartSec) / 0.5;
      const k = Math.min(stT, 1);
      const targetScale = baseStampScale * HUD_LOCAL_SCALE;
      const bounce = Math.sin(k * Math.PI) * 0.18 * (1 - k);
      stampRoot.scale.setScalar(targetScale * (1 + bounce));
      stampRoot.position.copy(HUD_LOCAL_POSITION);
      stampRoot.rotation.y += dt * 1.2;
      if (stT >= 1 && !collection.settleDoneFired) {
        collection.settleDoneFired = true;
        collection.phase = 'hud';
        setTimeout(showFactsModal, 1500);
      }
    }
    if (collection.phase === 'hud') {
      stampRoot.rotation.y += dt * 0.6;
      stampRoot.position.copy(HUD_LOCAL_POSITION);
    }
  }
  function easeInCubic(t)  { return t * t * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  /* ---- Particles ---- */
  let dotTex, starTex;
  function makeParticleTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
  function makeStarTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.translate(32, 32); g.fillStyle = '#fff'; g.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 28 : 12;
      const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.shadowColor = '#fff'; g.shadowBlur = 12; g.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
  function spawnParticles(originWorld) {
    if (!dotTex)  dotTex  = makeParticleTexture();
    if (!starTex) starTex = makeStarTexture();
    const COUNT = 60;
    const palette = [
      new THREE.Color(0xE8AE3D), new THREE.Color(0xE26E5F),
      new THREE.Color(0x98A773), new THREE.Color(0xffffff),
    ];
    const dots = makeParticleGroup(COUNT - 16, dotTex, palette, originWorld, false);
    const stars = makeParticleGroup(16, starTex, palette, originWorld, true);
    scene.add(dots); scene.add(stars);
    if (!particleSystem) particleSystem = [];
    particleSystem.push(dots, stars);
    collection.spawnedParticles = true;
    collection.particleStartSec = clock.elapsedTime;
  }
  function makeParticleGroup(count, texture, palette, originWorld, big) {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3]     = originWorld.x;
      positions[i3 + 1] = originWorld.y;
      positions[i3 + 2] = originWorld.z;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const speed = (big ? 1.4 : 2.1) * (0.4 + Math.random() * 0.8);
      velocities[i3]     = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i3 + 1] = Math.cos(phi) * speed + 0.4;
      velocities[i3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
      const col = palette[Math.floor(Math.random() * palette.length)];
      colors[i3]     = col.r; colors[i3 + 1] = col.g; colors[i3 + 2] = col.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: big ? 0.22 : 0.10, map: texture, vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1,
    });
    const points = new THREE.Points(geo, mat);
    points.userData = { velocities, bornSec: clock.elapsedTime, life: 0.8 };
    return points;
  }
  function updateParticles(dt) {
    if (!particleSystem || particleSystem.length === 0) return;
    for (let i = particleSystem.length - 1; i >= 0; i--) {
      const sys = particleSystem[i];
      const age = clock.elapsedTime - sys.userData.bornSec;
      const k = Math.min(age / sys.userData.life, 1);
      const pos = sys.geometry.attributes.position.array;
      const vel = sys.userData.velocities;
      for (let j = 0; j < pos.length; j += 3) {
        pos[j]     += vel[j]     * dt;
        pos[j + 1] += vel[j + 1] * dt - 1.6 * dt * age;
        pos[j + 2] += vel[j + 2] * dt;
        vel[j]     *= (1 - 1.5 * dt);
        vel[j + 1] *= (1 - 0.6 * dt);
        vel[j + 2] *= (1 - 1.5 * dt);
      }
      sys.geometry.attributes.position.needsUpdate = true;
      sys.material.opacity = 1 - k;
      if (age >= sys.userData.life) {
        scene.remove(sys); sys.geometry.dispose(); sys.material.dispose();
        particleSystem.splice(i, 1);
      }
    }
  }

  /* ---- Search detection ---- */
  const _stampWorld = new THREE.Vector3();
  const _ndc = new THREE.Vector3();
  function worldToScreen(worldVec) {
    _ndc.copy(worldVec).project(camera);
    return {
      x: (_ndc.x * 0.5 + 0.5) * window.innerWidth,
      y: (-_ndc.y * 0.5 + 0.5) * window.innerHeight,
      z: _ndc.z,
    };
  }
  function screenToCameraLocal(sx, sy, depth) {
    const ndcX = (sx / window.innerWidth) * 2 - 1;
    const ndcY = -(sy / window.innerHeight) * 2 + 1;
    const halfFovY = THREE.MathUtils.degToRad(camera.fov) / 2;
    const halfH = Math.tan(halfFovY) * depth;
    const halfW = halfH * camera.aspect;
    return new THREE.Vector3(ndcX * halfW, ndcY * halfH, -depth);
  }
  const HUD_SLOT_PX = 84, HUD_SLOT_MARGIN_RIGHT = 18, HUD_SLOT_MARGIN_BOTTOM = 18;
  function recomputeHudLocalPosition() {
    const w = window.innerWidth, h = window.innerHeight;
    const safeBottom = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')
    ) || 0;
    const cx = w - HUD_SLOT_MARGIN_RIGHT - HUD_SLOT_PX / 2;
    const cy = h - safeBottom - HUD_SLOT_MARGIN_BOTTOM - HUD_SLOT_PX / 2;
    HUD_LOCAL_POSITION = screenToCameraLocal(cx, cy, HUD_DEPTH);
  }
  function updateSearchAndPulse(dt) {
    if (!stampRoot || stampRoot.userData.isHud) return;
    stampRoot.getWorldPosition(_stampWorld);
    _ndc.copy(_stampWorld).project(camera);
    const inFront = _ndc.z < 1;
    const cx = _ndc.x, cy = _ndc.y;
    const half = CENTER_FOUND_FRACTION / 2;
    const inCenter = inFront && Math.abs(cx) < half && Math.abs(cy) < half;
    if (state === STATES.SEARCHING) {
      if (inCenter) setState(STATES.STAMP_IN_VIEW);
      updateArrowHint(inFront, cx, cy);
    } else if (state === STATES.STAMP_IN_VIEW) {
      if (!inFront || Math.abs(cx) > half * 2.2 || Math.abs(cy) > half * 2.2) {
        setState(STATES.SEARCHING);
      }
    }
    if (state === STATES.STAMP_IN_VIEW || state === STATES.GRABBING) {
      const pulse = 1 + Math.sin(clock.elapsedTime * 4) * 0.08;
      stampRoot.scale.setScalar(baseStampScale * pulse);
      stampLight.intensity = 1.6 + Math.sin(clock.elapsedTime * 4) * 1.0;
    }
  }
  function updateArrowHint(inFront, ndcX, ndcY) {
    if (inFront && Math.abs(ndcX) < 0.85 && Math.abs(ndcY) < 0.85) {
      arrowHint.classList.remove('p2-visible');
      return;
    }
    if (state !== STATES.SEARCHING) return;
    arrowHint.classList.add('p2-visible');
    const sx = inFront ? ndcX : -ndcX;
    const sy = inFront ? ndcY : -ndcY;
    const w = window.innerWidth, h = window.innerHeight;
    const cx = w / 2, cy = h / 2;
    const margin = 70;
    const dx = sx, dy = -sy;
    const len = Math.hypot(dx, dy) || 0.0001;
    const ux = dx / len, uy = dy / len;
    const maxX = (w / 2) - margin, maxY = (h / 2) - margin;
    const scale = Math.min(maxX / Math.abs(ux || 0.0001), maxY / Math.abs(uy || 0.0001));
    const px = cx + ux * scale, py = cy + uy * scale;
    const angle = Math.atan2(py - cy, px - cx);
    arrowHint.style.left = `${px}px`;
    arrowHint.style.top  = `${py}px`;
    arrowHint.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
  }

  /* ---- Idle ---- */
  let stampFadeStart = null;
  function tickIdle(dt) {
    if (!stampRoot || stampRoot.userData.isHud) return;
    if (stampFadeStart === null) stampFadeStart = clock.elapsedTime;
    const fade = Math.min((clock.elapsedTime - stampFadeStart) / 0.8, 1);
    setStampOpacity(fade);
    if (state === STATES.SEARCHING) {
      const base = stampRoot.userData.basePosition;
      stampRoot.position.x = base.x;
      stampRoot.position.y = base.y + Math.sin(clock.elapsedTime * 1.4) * 0.07;
      stampRoot.position.z = base.z;
      stampRoot.scale.setScalar(baseStampScale);
      stampLight.intensity = 1.6;
    } else if (state === STATES.STAMP_IN_VIEW || state === STATES.GRABBING) {
      const base = stampRoot.userData.basePosition;
      stampRoot.position.x = base.x;
      stampRoot.position.y = base.y + Math.sin(clock.elapsedTime * 1.4) * 0.07;
      stampRoot.position.z = base.z;
    }
    if (state === STATES.SEARCHING || state === STATES.STAMP_IN_VIEW || state === STATES.GRABBING) {
      stampRoot.rotation.y += dt * 0.6;
    }
    if (!stampRoot.userData.isHud) stampLight.position.copy(stampRoot.position);
  }

  /* ---- Animate ---- */
  let running = false;
  let animateRaf = 0;
  function animate() {
    if (!running) return;
    animateRaf = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.066);
    if (orientationSupported) updateCameraFromDevice();
    tickIdle(dt);
    updateSearchAndPulse(dt);
    if (countdown) tickCountdown();
    if (collection) tickCollection(dt);
    updateParticles(dt);
    if (handVisible && performance.now() - lastHandSeenMs > 800) {
      handVisible = false;
      handIndicator.classList.remove('p2-active');
      handIndicator.classList.remove('p2-fist');
      handIndicatorVal.textContent = '—';
      if (isFist) {
        isFist = false;
        if (state === STATES.GRABBING) {
          cancelCountdown();
          setState(STATES.STAMP_IN_VIEW);
        }
      }
    }
    if (mediapipeReady && !manualCollect.classList.contains('p2-visible') &&
        state === STATES.STAMP_IN_VIEW &&
        performance.now() - stampInViewEnteredMs > HAND_TIMEOUT_FOR_FALLBACK_MS &&
        performance.now() - lastHandSeenMs > HAND_TIMEOUT_FOR_FALLBACK_MS) {
      showManualFallback();
    }
    frameToggle = (frameToggle + 1) % 2;
    if (mediapipeReady && hands && captureVideo.readyState >= 2 && frameToggle === 0) {
      hands.send({ image: captureVideo }).catch((err) => {
        if (!mediapipeFailed) {
          console.error('[phase2-hunt] MediaPipe send error:', err);
          mediapipeFailed = true;
          showManualFallback();
        }
      });
    }
    renderer.render(scene, camera);
  }

  /* ---- Stamp viewer (live mini three.js scene shown inside the facts modal) ---- */
  let stampViewer = null;
  function initStampViewer() {
    if (stampViewer || !stampReady || !stampRoot || !stampViewerCanvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas: stampViewerCanvas, alpha: true, antialias: true, premultipliedAlpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0);

    const viewerScene = new THREE.Scene();
    viewerScene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 4); viewerScene.add(key);
    const fill = new THREE.DirectionalLight(0xE8AE3D, 0.55);
    fill.position.set(-2, 1, 2); viewerScene.add(fill);

    const root = stampRoot.clone(true);
    // The AR collection animation rotates/scales/repositions stampRoot, so the
    // clone inherits that pose. Reset to identity so the modal always shows the
    // stamp at its natural face-on orientation regardless of AR-scene state.
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    root.updateMatrix();
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const setSolid = (m) => {
        const c = m.clone();
        c.transparent = false;
        c.opacity = 1;
        if ('emissive' in c) { c.emissive.setHex(0x000000); c.emissiveIntensity = 0; }
        return c;
      };
      obj.material = Array.isArray(obj.material)
        ? obj.material.map(setSolid)
        : setSolid(obj.material);
    });

    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    root.position.sub(center);

    const pivot = new THREE.Group();
    pivot.add(root);
    viewerScene.add(pivot);

    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 0.3;
    const fov = 38;
    const dist = (radius / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * 1.45;
    const cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 100);
    cam.position.set(0, 0, dist);
    cam.lookAt(0, 0, 0);

    // Pose the stamp once with a subtle face-on tilt — no rotation animation in
    // the modal. The gentle vertical bob is provided by the CSS animation on
    // .p2-stampViewer so the WebGL scene can stay completely static.
    pivot.rotation.set(0, 0, 0);

    const renderOnce = () => {
      try { renderer.render(viewerScene, cam); } catch (_) {}
    };
    const resize = () => {
      const rect = stampViewerCanvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer.setSize(w, h, false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
      renderOnce();
    };
    const observer = (typeof ResizeObserver === 'function')
      ? new ResizeObserver(resize)
      : null;
    if (observer) observer.observe(stampViewerCanvas);

    stampViewer = {
      renderer, scene: viewerScene, camera: cam, pivot, observer,
      resize, renderOnce, running: false,
    };
    resize();
  }
  function startStampViewer() {
    if (!stampViewer) initStampViewer();
    if (!stampViewer || stampViewer.running) return;
    stampViewer.running = true;
    // Make sure the canvas has a fresh frame each time the modal opens (the
    // viewer is otherwise static).
    stampViewer.resize();
  }
  function stopStampViewer() {
    if (!stampViewer) return;
    stampViewer.running = false;
  }
  function disposeStampViewer() {
    if (!stampViewer) return;
    stopStampViewer();
    try { stampViewer.observer && stampViewer.observer.disconnect(); } catch (_) {}
    try {
      stampViewer.renderer.dispose();
      stampViewer.renderer.forceContextLoss && stampViewer.renderer.forceContextLoss();
    } catch (_) {}
    stampViewer = null;
  }

  /* ---- Facts modal ---- */
  function pickFeaturedFact() {
    if (!FUN_FACTS || FUN_FACTS.length === 0) return null;
    return FUN_FACTS[(Math.random() * FUN_FACTS.length) | 0];
  }
  function renderFeaturedFact(fact) {
    if (!featuredFactEl) return;
    featuredFactEl.innerHTML = '';
    if (!fact) return;
    if (typeof fact === 'string') {
      featuredFactEl.textContent = fact;
      return;
    }
    if (fact.lead) {
      const lead = document.createElement('strong');
      lead.className = 'p2-factLead';
      lead.textContent = fact.lead;
      featuredFactEl.appendChild(lead);
    }
    if (fact.body) {
      if (fact.lead) featuredFactEl.appendChild(document.createTextNode(' '));
      const body = document.createElement('span');
      body.className = 'p2-factBody';
      body.textContent = fact.body;
      featuredFactEl.appendChild(body);
    }
  }
  function showFactsModal() {
    renderFeaturedFact(pickFeaturedFact());
    factsBackdrop.classList.add('p2-visible');
    factsModal.classList.add('p2-visible');
    factsModal.classList.remove('p2-celebrating');
    void factsModal.offsetWidth;
    factsModal.classList.add('p2-celebrating');
    setState(STATES.FACTS_SHOWN);
    triggerCelebration();
    // Defer one frame so the canvas has a layout box before sizing the renderer.
    requestAnimationFrame(() => startStampViewer());
  }
  function hideFactsModal() {
    factsBackdrop.classList.remove('p2-visible');
    factsModal.classList.remove('p2-visible');
    factsModal.classList.remove('p2-celebrating');
    stopStampViewer();
    setState(STATES.COLLECTED);
  }

  /* ---- Celebration / confetti ---- */
  const CONFETTI_COLORS = ['#E8AE3D', '#E26E5F', '#98A773', '#452222', '#F5DCB0'];
  function triggerCelebration() {
    vibrate([60, 40, 60, 40, 120, 40, 280]);
    spawnConfetti(36);
  }
  function spawnConfetti(count) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'p2-confettiPiece';
      const angle = Math.random() * Math.PI * 2;
      const dist  = 140 + Math.random() * 180;
      const dx    = Math.cos(angle) * dist;
      const dy    = Math.sin(angle) * dist + 120;
      const sz    = 6 + Math.random() * 8;
      const rot   = (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 540);
      const col   = CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0];
      piece.style.setProperty('--dx',  `${dx.toFixed(1)}px`);
      piece.style.setProperty('--dy',  `${dy.toFixed(1)}px`);
      piece.style.setProperty('--sz',  `${sz.toFixed(1)}px`);
      piece.style.setProperty('--rot', `${rot.toFixed(0)}deg`);
      piece.style.setProperty('--col', col);
      piece.addEventListener('animationend', () => piece.remove(), { once: true });
      frag.appendChild(piece);
    }
    confettiContainer.appendChild(frag);
  }

  /* ---- Wire UI events ---- */
  const handleCollectedDismiss = () => {
    hideFactsModal();
    if (typeof onCollected === 'function') onCollected();
  };
  dismissBtn.addEventListener('click', handleCollectedDismiss);
  factsBackdrop.addEventListener('click', handleCollectedDismiss);
  factsCloseBtn?.addEventListener('click', () => {
    hideFactsModal();
    if (typeof onExitFactsViaClose === 'function') onExitFactsViaClose();
  });

  if (secondSpotStamp) {
    if (dismissBtnTitleEl) dismissBtnTitleEl.textContent = 'Done';
    if (dismissBtnSubEl) dismissBtnSubEl.hidden = true;
  }

  let touchStartY = null;
  factsModal.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      factsModal.style.transition = 'none';
    }
  }, { passive: true });
  factsModal.addEventListener('touchmove', (e) => {
    if (touchStartY === null) return;
    const dy = e.touches[0].clientY - touchStartY;
    if (dy > 0) factsModal.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  factsModal.addEventListener('touchend', (e) => {
    if (touchStartY === null) return;
    const dy = (e.changedTouches[0].clientY - touchStartY);
    factsModal.style.transition = '';
    factsModal.style.transform = '';
    if (dy > 110) handleCollectedDismiss();
    touchStartY = null;
  }, { passive: true });

  shareBtn.addEventListener('click', async () => {
    const shareData = {
      title: `I found ${STAMP_NAME}!`,
      text: `I just collected ${STAMP_NAME} on the Scrapbook stamp hunt. Can you find it too?`,
      url: location.href,
    };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
        shareBtn.textContent = 'Copied!';
        setTimeout(() => shareBtn.textContent = 'Share', 1400);
      }
    } catch (_) {}
  });

  manualCollectBtn.addEventListener('click', () => {
    if (state === STATES.SEARCHING || state === STATES.STAMP_IN_VIEW) {
      if (state === STATES.SEARCHING) setState(STATES.STAMP_IN_VIEW);
      setState(STATES.GRABBING);
      startCountdown();
    }
  });

  errorRetryBtn.addEventListener('click', () => location.reload());

  /* ---- Boot ---- */
  let stopped = false;
  hideError();
  if (loadingTitle) loadingTitle.textContent = STAMP_NAME;
  if (loadingStampImg && stampImage) {
    loadingStampImg.src = stampImage;
    loadingStampImg.alt = `${STAMP_NAME} stamp`;
  }
  loadingScreen.classList.remove('p2-hidden');
  loadingText.textContent = ownsCameraStream ? 'Firing up camera' : 'Syncing camera';

  // Keep the loading screen up long enough to actually read the heading and prompt.
  // Should comfortably outlast the staggered entrance animations (~1.55s + 0.5s).
  const LOADING_MIN_VISIBLE_MS = 3000;
  const loadingShownAt = performance.now();

  const orientPerm = requestOrientationPermission();
  const camStream = ownsCameraStream ? requestCameraStream() : Promise.resolve(null);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    running = false;
    if (animateRaf) cancelAnimationFrame(animateRaf);
    if (_ofRaf) cancelAnimationFrame(_ofRaf);
    opticalFlowActive = false;
    try { hands && hands.close && hands.close(); } catch (_) {}
    hands = null;
    if (ownsCameraStream && mediaStream) {
      try { mediaStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    }
    mediaStream = null;
    try { tplCameraVideo.srcObject = null; } catch (_) {}
    for (const { target, ev, fn, opts } of winListeners) {
      try { target.removeEventListener(ev, fn, opts); } catch (_) {}
    }
    winListeners.length = 0;
    try { disposeStampViewer(); } catch (_) {}
    try {
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss && renderer.forceContextLoss();
      }
    } catch (_) {}
    if (host) {
      host.classList.remove('phase2-hunt-host');
      host.innerHTML = '';
    }
  };

  activeInstance = { stop };

  (async () => {
    const camOK = await attachCameraStream(camStream);
    if (stopped || !camOK) return;

    loadingText.textContent = 'Setting the scene';
    initThree();
    onResize();

    loadingText.textContent = 'Loading the stamp';
    try { await loadStamp(); }
    catch (err) {
      showError('Could not load stamp',
        'The stamp asset failed to load. Check your connection and try again.',
        () => location.reload());
      return;
    }
    if (stopped) return;

    loadingText.textContent = 'Calibrating motion';
    compassHint.classList.add('p2-visible');
    await initDeviceOrientation(orientPerm);
    if (stopped) return;

    if (orientationSupported && !stampPlacedFromOrientation) {
      placeStampOffscreenFromCurrentView();
    }

    loadingText.textContent = 'Tuning hand tracking';
    await initMediaPipe();
    if (stopped) return;

    if (!orientationSupported) startOpticalFlow();
    if (!stampPlacedFromOrientation) placeStampOffscreenFromCurrentView();

    const remaining = LOADING_MIN_VISIBLE_MS - (performance.now() - loadingShownAt);
    if (remaining > 0) {
      await new Promise((r) => setTimeout(r, remaining));
      if (stopped) return;
    }

    loadingScreen.classList.add('p2-hidden');
    setState(STATES.SEARCHING);
    running = true;
    clock.start();
    animate();
  })();
}
