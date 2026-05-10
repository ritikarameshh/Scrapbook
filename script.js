/**
 * MindAR requests getUserMedia with `facingMode: "environment"` only. On many iPhones,
 * simulators, or in-app browsers that fails with OverconstrainedError — MindAR then
 * emits arError VIDEO_FAIL. Retry once with any available camera.
 */
import * as arOrchestrator from './ar/ar-orchestrator.js';
import * as savedSpots from './saved-spots.js';
import { syncHomeMetStampFromSession, syncNearStampVisibilityFromSession } from './home-stamp-state.js';

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
const screens = document.querySelectorAll('.screen');
const navHistory = ['splash'];

/** When true, the next AR session skips MindAR phase 1 and opens phase 4 (outline) for testing. */
let nextArStartTestPhase4 = false;

const MAIN_TAB_SCREENS = new Set(['home', 'spots', 'feed', 'you']);

/** Shared bottom dock (stamp alert + tab bar) on main tabs only; stamp banner clears body padding when hidden. */
function syncAppTabDock(screenName) {
  const dock = document.getElementById('app-tab-dock');
  if (!dock) return;
  const onMainTab = MAIN_TAB_SCREENS.has(screenName);
  dock.hidden = !onMainTab;
  const stamp = document.getElementById('stamp-alert');
  const stampShowing = onMainTab && stamp && !stamp.hidden;
  document.body.classList.toggle('app-dock-stamp-visible', !!stampShowing);
}

function show(name) {
  const target = document.querySelector(`.screen[data-screen="${name}"]`);
  if (!target) return;

  const prev = document.querySelector('.screen.active');

  if (prev && prev.dataset.screen === 'ar-scan') stopAR();

  screens.forEach((s) => s.classList.remove('active'));
  target.classList.add('active');

  const body = target.querySelector('.screen-body');
  if (body) body.scrollTop = 0;
  const homeMain = target.querySelector('.home-stamps');
  if (homeMain) homeMain.scrollTop = 0;

  if (name === 'spots') savedSpots.renderSpotsScreen();
  syncAppTabDock(name);
  syncTabbarActive(name);

  if (name === 'ar-scan') startAR();
}

/**
 * Update the shared bottom tab bar active state to match the current screen.
 * The "Book" tab is home/stamps.
 */
function syncTabbarActive(screenName) {
  const tabName = screenName === 'home' ? 'home' : screenName;
  document.querySelectorAll('[data-app-tabbar]').forEach((bar) => {
    bar.querySelectorAll('.tab-btn').forEach((btn) => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  });
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
  const goBtn = e.target.closest('[data-go]');
  const backBtn = e.target.closest('[data-back]');
  const camRetry = e.target.closest('[data-ar-cam-retry]');
  if (camRetry) {
    hideARCameraError();
    stopAR();
    startAR();
    return;
  }
  if (goBtn) {
    nextArStartTestPhase4 =
      goBtn.dataset.testPhase4 === 'true' || goBtn.dataset.jumpPhase4 === 'true';
    go(goBtn.dataset.go);
    return;
  }
  if (backBtn) {
    const onArScan = document.querySelector('.screen.screen-ar-scan.active');
    if (onArScan && arOrchestrator.interceptRepeatedStampHuntBackToBook()) return;
    back();
    return;
  }
});

// ============ Mode toggle (You screen) ============
let currentMode = 'local';
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('[data-mode-toggle] .mode-toggle-opt').forEach((opt) => {
    opt.classList.toggle('active', opt.dataset.mode === mode);
  });
}
document.addEventListener('click', (e) => {
  const opt = e.target.closest('[data-mode-toggle] .mode-toggle-opt');
  if (opt) setMode(opt.dataset.mode);
});

// ============ Home — stamp filter tabs (All / Landmarks / Gems) ============
document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-stamp-tabs] .home-stamp-tab');
  if (!tab) return;
  const tabBar = tab.closest('[data-stamp-tabs]');
  const filter = tab.dataset.stampFilter;
  tabBar.querySelectorAll('.home-stamp-tab').forEach((t) => {
    const active = t === tab;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.home-stamp-grid').forEach((grid) => {
    grid.dataset.stampFilter = filter;
  });
});

// ============ AR (delegates to ar/ar-orchestrator.js — single MindAR session) ============

function hideARCameraError() {
  const box = document.getElementById('ar-camera-error');
  if (box) box.hidden = true;
}

function showARCameraError(msg) {
  const box = document.getElementById('ar-camera-error');
  const sub = box?.querySelector('.ar-camera-error-sub');
  if (sub && msg) sub.textContent = msg;
  if (box) box.hidden = false;
}

function showARError(msg) {
  const hint = document.querySelector('#ar-phase-outline .ar-hint');
  if (hint) hint.textContent = msg;
}

function stopAR() {
  arOrchestrator.stopARSession();
}

function startAR() {
  const testJumpPhase4 = nextArStartTestPhase4;
  nextArStartTestPhase4 = false;
  arOrchestrator.startARSession({
    go,
    showCameraError: showARCameraError,
    hideCameraError: hideARCameraError,
    showHintError: showARError,
    testJumpPhase4,
  });
}

// ============ Saved spots ============
savedSpots.bindSpotsScreen();
savedSpots.renderSpotsScreen();

// ============ Boot ============
syncHomeMetStampFromSession();
syncNearStampVisibilityFromSession();
show('splash');
