/**
 * Phase 3 — gem pins in the shared MindAR A-Frame scene (magic-window camera).
 */

import { HIDDEN_GEMS, PHASE3_PIN_LAYOUT } from './ar-config.js';
import { getArPhase } from './session-state.js';

let currentGemId = null;
let gemToastTimer = null;

export function getCurrentGemId() {
  return currentGemId;
}

export function ensureGemPinComponentRegistered() {
  if (typeof AFRAME === 'undefined' || AFRAME.components['gem-pin']) return;
  AFRAME.registerComponent('gem-pin', {
    schema: { id: { type: 'string' } },
    init() {
      this.onClick = () => {
        if (getArPhase() !== 3) return;
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

function playPinClickFx(pinEl) {
  const target = pinEl.querySelector('[gltf-model]') || pinEl;
  const baseScale = target.getAttribute('scale') || { x: 0.24, y: 0.24, z: 0.24 };
  const bx = baseScale.x ?? 0.24;
  const by = baseScale.y ?? 0.24;
  const bz = baseScale.z ?? 0.24;
  const sx = bx * 0.7;
  const sy = by * 0.7;
  const sz = bz * 0.7;

  target.removeAttribute('animation__click');
  target.removeAttribute('animation__clickback');
  target.setAttribute('animation__click', {
    property: 'scale',
    to: `${sx} ${sy} ${sz}`,
    dur: 110,
    easing: 'easeOutQuad',
  });
  target.setAttribute('animation__clickback', {
    property: 'scale',
    to: `${bx} ${by} ${bz}`,
    dur: 180,
    delay: 110,
    easing: 'easeOutBack',
  });
}

/**
 * MindAR + look-controls: world-space pins + camera matrix remaps were unreliable (pins off-screen).
 * Parent pins to the *active* camera in local space so they stay in the frustum in front of the user.
 */
function getActiveCameraEl(scene) {
  if (!scene) return null;
  return scene.camera?.el || scene.querySelector('#ar-flow-camera') || scene.querySelector('a-camera');
}

/** Keep cursor / raycaster on whichever camera is actually rendering (MindAR may swap active camera). */
function ensureRaycasterOnActiveCamera(scene) {
  const camEl = getActiveCameraEl(scene);
  if (!camEl) return;
  const ray = scene.querySelector('[raycaster]');
  if (ray && ray.parentNode !== camEl) camEl.appendChild(ray);
  const cursor = scene.querySelector('[cursor]');
  if (cursor && cursor !== ray && cursor.parentNode !== camEl) camEl.appendChild(cursor);
  const rayComp = ray?.components?.raycaster;
  if (rayComp && typeof rayComp.setDirty === 'function') rayComp.setDirty();
}

function spawnGemPinsInto(scene) {
  const parent = getActiveCameraEl(scene) || scene.querySelector('#phase3-world-root') || scene;
  ensureRaycasterOnActiveCamera(scene);

  HIDDEN_GEMS.forEach((gem, i) => {
    const { angleDeg, radius, y } = PHASE3_PIN_LAYOUT[i] || PHASE3_PIN_LAYOUT[0];
    const a = (angleDeg * Math.PI) / 180;
    const x = Math.sin(a) * radius;
    const z = -Math.cos(a) * radius;

    const pin = document.createElement('a-entity');
    pin.classList.add('gem-pin');
    pin.setAttribute('gem-pin', `id: ${gem.id}`);
    pin.setAttribute('position', `${x} ${y} ${z}`);
    pin.setAttribute('visible', 'true');
    pin.setAttribute('geometry', { primitive: 'sphere', radius: 0.55 });
    pin.setAttribute('material', {
      shader: 'flat',
      color: '#ffffff',
      opacity: 0,
      transparent: true,
      depthWrite: false,
    });

    pin.setAttribute('animation__bob', {
      property: 'position',
      to: `${x} ${y + 0.08} ${z}`,
      dir: 'alternate',
      dur: 1400 + i * 120,
      easing: 'easeInOutSine',
      loop: true,
    });

    const model = document.createElement('a-entity');
    model.setAttribute('gltf-model', 'url(./Assets/pin.gltf)');
    model.setAttribute('scale', '0.24 0.24 0.24');
    model.addEventListener('model-loaded', (ev) => {
      const obj = ev.detail.model;
      obj.traverse((node) => {
        if (node.isMesh && node.material) {
          node.material = node.material.clone();
          node.material.color = new AFRAME.THREE.Color(gem.color);
          node.material.metalness = 0.1;
          node.material.roughness = 0.55;
          node.renderOrder = 40;
        }
      });
    });
    model.addEventListener('model-error', () => {
      const disc = document.createElement('a-circle');
      disc.setAttribute('radius', '0.34');
      disc.setAttribute('material', `shader: flat; color: ${gem.color}; side: double`);
      pin.appendChild(disc);
    });
    pin.appendChild(model);

    model.setAttribute('animation__spin', {
      property: 'rotation',
      from: '0 0 0',
      to: '0 360 0',
      dur: 6000,
      easing: 'linear',
      loop: true,
    });

    parent.appendChild(pin);
  });
}

/** @param {import('aframe').Entity} sceneEl */
export function activatePinsPhase(sceneEl) {
  ensureGemPinComponentRegistered();
  if (!sceneEl) return;
  sceneEl.querySelectorAll('.gem-pin').forEach((n) => n.parentNode?.removeChild(n));
  const run = () => {
    spawnGemPinsInto(sceneEl);
    requestAnimationFrame(() => ensureRaycasterOnActiveCamera(sceneEl));
  };
  if (sceneEl.hasLoaded) run();
  else sceneEl.addEventListener('loaded', run, { once: true });
}

/** @param {import('aframe').Entity | null} sceneEl */
export function deactivatePinsPhase(sceneEl) {
  if (!sceneEl) return;
  sceneEl.querySelectorAll('.gem-pin').forEach((n) => n.parentNode?.removeChild(n));
}

export function openGemCard(id) {
  const gem = HIDDEN_GEMS.find((g) => g.id === id);
  if (!gem) return;
  currentGemId = id;

  const card = document.getElementById('gem-detail-card');
  const titleEl = card?.querySelector('[data-gem-title]');
  const typeEl = card?.querySelector('[data-gem-type]');
  const walkEl = card?.querySelector('[data-gem-walk]');
  if (titleEl) titleEl.textContent = gem.title;
  if (typeEl) typeEl.textContent = gem.type;
  if (walkEl) walkEl.textContent = `${gem.walkMin} min walk`;
  if (card) card.hidden = false;
}

export function closeGemCard() {
  const card = document.getElementById('gem-detail-card');
  if (card) card.hidden = true;
  currentGemId = null;
}

export function showGemToast(msg) {
  const toast = document.getElementById('gem-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  if (gemToastTimer) clearTimeout(gemToastTimer);
  gemToastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 1600);
}

export function clearGemToastTimer() {
  if (gemToastTimer) {
    clearTimeout(gemToastTimer);
    gemToastTimer = null;
  }
}
