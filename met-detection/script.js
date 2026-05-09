import { MindARThree } from 'mindar-image-three';

// scrapbook scanner — finds the met two ways at once:
//   1. mindar — point camera at the printed/displayed reference image
//   2. gps    — check if you're standing within 80m of the building
// either one fires the same "you're at the met" modal.


// ---- mindar setup ----
// compile ref images at https://hiukim.github.io/mind-ar-js-doc/tools/compile/
// drop the .mind file in as targets.mind. order in this array MUST match the
// order i uploaded them to the compiler (index 0 = first image, etc).
const MINDAR_FILE = 'targets.mind';
// targets.mind has 3 met images compiled in. all 3 indices map to "the_met"
// so any of the 3 images triggers the same modal.
const MINDAR_TARGETS = ['the_met', 'the_met', 'the_met'];

// ---- gps setup ----
// coords + radius in meters per landmark.
// (find coords: google maps -> right-click -> "what's here?")
const GEO_LANDMARKS = {
  the_met: { lat: 40.7794, lng: -73.9632, radius_m: 80 },
};

// info shown in the detection modal
const LOCATIONS = {
  the_met: {
    title: 'The Met',
    area: 'Upper East Side, New York',
    sub: '1000 5th Ave · founded 1870 · 2M+ artworks',
  },
};


// ---- tiny screen router ----
const screens = document.querySelectorAll('.screen');
const history = ['splash'];

function show(name) {
  const target = document.querySelector(`.screen[data-screen="${name}"]`);
  if (!target) return;
  const prev = document.querySelector('.screen.active');
  screens.forEach(s => s.classList.remove('active'));
  target.classList.add('active');

  const body = target.querySelector('.screen-body');
  if (body) body.scrollTop = 0;

  // turn camera + scanners on/off depending on the screen
  if (target.hasAttribute('data-needs-camera')) {
    startCamera(target);
  } else if (prev && prev.hasAttribute('data-needs-camera')) {
    stopCamera();
    resetScanUI();
  }
}

function go(name) {
  if (history[history.length - 1] !== name) history.push(name);
  show(name);
}

function back() {
  if (history.length > 1) {
    history.pop();
    show(history[history.length - 1]);
  }
}

document.addEventListener('click', (e) => {
  const goBtn   = e.target.closest('[data-go]');
  const backBtn = e.target.closest('[data-back]');
  if (goBtn)   { go(goBtn.dataset.go); return; }
  if (backBtn) { back(); return; }
});


// ---- mindar camera + image tracking ----
// mindar makes its own <video> inside #ar-mount. we hide its webgl canvas
// since we don't render any 3d on top — just want the detection callback.
let mindar = null;
let mindarRunning = false;

async function startCamera(screenEl) {
  const mount = screenEl.querySelector('#ar-mount');
  const perm  = screenEl.querySelector('.ar-perm');
  if (!mount) return;

  if (mindar && mindarRunning) {
    if (perm) perm.hidden = true;
    return;
  }

  if (typeof MindARThree === 'undefined') {
    console.warn("mindar didn't load — check the import map in index.html");
    if (perm) perm.hidden = false;
    return;
  }

  try {
    mindar = new MindARThree({
      container: mount,
      imageTargetSrc: MINDAR_FILE,
      maxTrack: MINDAR_TARGETS.length,
      warmupTolerance: 1, // fire after 1 frame, not 5 (more responsive)
      missTolerance: 8,   // hold the match a bit longer if camera shakes
      uiLoading: 'no',
      uiScanning: 'no',
      uiError: 'no',
    });

    // we don't render 3d, hide the canvases mindar adds
    mindar.renderer.domElement.style.display = 'none';
    mindar.cssRenderer.domElement.style.display = 'none';

    MINDAR_TARGETS.forEach((key, i) => {
      const anchor = mindar.addAnchor(i);
      anchor.onTargetFound = () => fireMatch(key, 'matched');
    });

    setStatus('Loading reference images…');
    await mindar.start();
    mindarRunning = true;
    if (perm) perm.hidden = true;
    setStatus('Scanning…');
    setConfidence(0, 'Scanning your location…');

    startGeoWatch();
  } catch (err) {
    console.warn('mindar failed to start:', err);
    if (perm) perm.hidden = false;
    mindar = null;
    mindarRunning = false;
  }
}

async function stopCamera() {
  stopGeoWatch();
  if (!mindar) return;
  try { await mindar.stop(); } catch {}
  // mindar.stop() removes its <video> but leaves its canvases — wipe
  // the mount so a fresh start() lays out cleanly next time.
  const mount = document.getElementById('ar-mount');
  if (mount) mount.innerHTML = '';
  mindar = null;
  mindarRunning = false;
}


// ---- gps watch ----
// browser asks for location permission once. each update gets compared
// against GEO_LANDMARKS. inside the radius -> fire the modal.
let geoWatchId = null;

function startGeoWatch() {
  if (geoWatchId !== null || !navigator.geolocation) return;
  geoWatchId = navigator.geolocation.watchPosition(
    onGeoUpdate,
    (err) => console.warn('gps error:', err.message),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );
}

function stopGeoWatch() {
  if (geoWatchId === null) return;
  navigator.geolocation.clearWatch(geoWatchId);
  geoWatchId = null;
}

function onGeoUpdate(pos) {
  if (activeMatch) return;
  const { latitude, longitude } = pos.coords;
  for (const [key, loc] of Object.entries(GEO_LANDMARKS)) {
    if (!LOCATIONS[key]) continue;
    const dist = haversineMeters(latitude, longitude, loc.lat, loc.lng);
    if (dist <= loc.radius_m) {
      fireMatch(key, 'GPS match');
      return;
    }
  }
}

// distance between two lat/lng coords, in meters
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}


// ---- shared "match found" helper ----
// called from mindar, gps, and the simulate button. label is the little
// caption under the confidence bar (e.g. "matched", "GPS match", "simulated")
function fireMatch(key, label) {
  if (!LOCATIONS[key]) return;
  setConfidence(1, `${LOCATIONS[key].title} · ${label}`);
  showDetectionModal(key);
}


// ---- retry camera button + tab visibility ----
document.addEventListener('click', (e) => {
  const retry = e.target.closest('[data-cam-retry]');
  if (!retry) return;
  const screen = retry.closest('.screen');
  if (screen) startCamera(screen);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCamera();
  } else {
    const active = document.querySelector('.screen.active');
    if (active && active.hasAttribute('data-needs-camera')) startCamera(active);
  }
});


// ---- ui helpers (status text + confidence bar at top of camera screen) ----
const statusEl  = () => document.getElementById('scan-status');
const confFill  = () => document.getElementById('conf-fill');
const confLabel = () => document.getElementById('conf-label');

function setStatus(text) {
  if (statusEl()) statusEl().textContent = text;
}

function setConfidence(p, label) {
  if (confFill())  confFill().style.width = `${Math.round(p * 100)}%`;
  if (confLabel()) confLabel().textContent = label;
}

function resetScanUI() {
  setStatus('Scanning…');
  setConfidence(0, 'Looking…');
  hideDetectionModal();
}


// ---- detection modal (orange frame + bottom "you're at X" card) ----
const detectedEl     = () => document.getElementById('ar-detected');
const detectedNameEl = () => document.getElementById('ar-detected-name');
const detectedTitle  = () => document.getElementById('ar-detected-title');
const detectedSub    = () => document.getElementById('ar-detected-sub');
const cameraScreen   = () => document.querySelector('.screen-camera');

let activeMatch = null;

function showDetectionModal(key) {
  const loc = LOCATIONS[key];
  if (!loc || activeMatch) return; // ignore if already showing

  activeMatch = { key, ...loc };
  detectedNameEl().textContent = loc.title;
  detectedTitle().textContent  = loc.title;
  detectedSub().textContent    = loc.area || loc.sub;
  detectedEl().hidden = false;
  cameraScreen()?.classList.add('detecting');
}

function hideDetectionModal() {
  if (detectedEl()) detectedEl().hidden = true;
  cameraScreen()?.classList.remove('detecting');
  activeMatch = null;
}

// tap the bottom card -> confirm and go to the "you made it" screen
document.getElementById('ar-detected-card')?.addEventListener('click', () => {
  if (!activeMatch) return;
  const match = activeMatch;
  hideDetectionModal();
  document.getElementById('confirmed-title').textContent = `You're at ${match.title}`;
  document.getElementById('confirmed-sub').textContent = "Great — you're at the right landmark.";
  go('confirmed');
});

// tap "wrong place" -> dismiss and keep scanning
document.getElementById('ar-detected-dismiss')?.addEventListener('click', () => {
  hideDetectionModal();
  setStatus('Scanning…');
});


// ---- simulate button (fakes a detection so i can demo without the met) ----
document.getElementById('simulate-btn')?.addEventListener('click', () => {
  const key = Object.keys(LOCATIONS)[0];
  fireMatch(key, 'simulated');
});


// ---- boot ----
show('splash');
