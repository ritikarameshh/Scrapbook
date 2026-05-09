/**
 * Single persistent MindAR + A-Frame scene for the whole AR flow.
 * Phase modules toggle camera look-controls and entities; this file only mounts once per session.
 */

import { LANDMARK_MIND_SRC } from './ar-config.js';
import { setArSceneEl } from './session-state.js';

export function getMindARVideoFromScene(sceneEl) {
  if (!sceneEl) return null;
  return sceneEl.querySelector('video') || document.querySelector('#ar-scan-container video');
}

/**
 * @param {HTMLElement} container
 * @param {{ onArError?: (detail: string) => void }} [opts]
 * @returns {Promise<import('aframe').Entity | null>}
 */
export function mountPersistentMindARScene(container, opts = {}) {
  if (container.querySelector('#ar-scene')) {
    const existing = document.getElementById('ar-scene');
    setArSceneEl(existing);
    return Promise.resolve(existing);
  }

  container.innerHTML = `
    <a-scene id="ar-scene" embedded
      mindar-image="imageTargetSrc: ${LANDMARK_MIND_SRC}; uiScanning: no; uiLoading: no; uiError: no;"
      vr-mode-ui="enabled: false"
      device-orientation-permission-ui="enabled: true"
      renderer="alpha: true"
      style="position:absolute;top:0;left:0;width:100%;height:100%;">
      <a-assets></a-assets>
      <a-light type="ambient" color="#ffffff" intensity="0.9"></a-light>
      <a-entity id="phase3-world-root" position="0 0 0"></a-entity>
      <a-camera id="ar-flow-camera" position="0 0 0"
        look-controls="enabled: false; touchEnabled: false; mouseEnabled: false; magicWindowTrackingEnabled: true">
        <a-entity cursor="rayOrigin: mouse; fuse: false" raycaster="objects: .gem-pin; far: 50"></a-entity>
      </a-camera>
      <a-entity id="landmark-anchor-0" mindar-image-target="targetIndex: 0"></a-entity>
    </a-scene>`;

  const sceneEl = document.getElementById('ar-scene');
  setArSceneEl(sceneEl);
  if (!sceneEl) return Promise.resolve(null);

  sceneEl.addEventListener(
    'arError',
    (e) => {
      const code = e.detail?.error ?? '';
      let sub = 'Tap “Enable camera”, choose Allow, and use Safari/Chrome.';
      if (!window.isSecureContext) sub = 'Serve the app over HTTPS or localhost.';
      else if (code === 'VIDEO_FAIL') {
        sub = 'Try “Enable camera” again, open in Safari, or use a real device.';
      } else if (code === 'INVALID_TARGET_URL' || code === 'TARGET_LOAD_FAIL') {
        sub = 'Landmark targets missing: met-detection/targets.mind';
      }
      opts.onArError?.(sub);
    },
    false,
  );

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (sceneEl?.renderer) sceneEl.renderer.setClearColor(0x000000, 0);
      resolve(sceneEl);
    };
    sceneEl.addEventListener('renderstart', done, { once: true });
    sceneEl.addEventListener('loaded', () => requestAnimationFrame(done), { once: true });
  });
}

/** Hide/show the MindAR root scene (camera keeps running; used when Phase 3 stacks its own scene). */
export function setMindARSceneVisibility(sceneEl, visible) {
  const el = sceneEl || document.getElementById('ar-scene');
  if (!el) return;
  el.style.visibility = visible ? '' : 'hidden';
  el.style.pointerEvents = visible ? '' : 'none';
}

export function setMindARCameraLookControlsEnabled(sceneEl, enabled) {
  let cam = sceneEl?.querySelector('#ar-flow-camera');
  if (!cam && sceneEl?.camera?.el) cam = sceneEl.camera.el;
  if (!cam) cam = sceneEl?.querySelector('a-camera');
  if (!cam) return;
  cam.setAttribute('look-controls', {
    enabled,
    touchEnabled: false,
    mouseEnabled: false,
    magicWindowTrackingEnabled: true,
  });
}

export function teardownMindARSession(container) {
  const sceneEl = document.getElementById('ar-scene');
  if (sceneEl) {
    try {
      sceneEl.systems?.['mindar-image-system']?.stop();
    } catch (_) {}
  }
  setArSceneEl(null);
  if (container) container.innerHTML = '';
}
