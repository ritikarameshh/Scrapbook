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
  const baseScale = target.getAttribute('scale') || { x: 0.14, y: 0.14, z: 0.14 };
  const bx = baseScale.x ?? 0.14;
  const by = baseScale.y ?? 0.14;
  const bz = baseScale.z ?? 0.14;
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

function repositionPhase3PinsFacingCamera(scene) {
  if (typeof AFRAME === 'undefined' || getArPhase() !== 3) return;
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
    pinEl.setAttribute('position', `${v.x} ${v.y} ${v.z}`);
    pinEl.setAttribute('animation__bob', {
      property: 'position',
      to: `${v.x} ${v.y + 0.08} ${v.z}`,
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

    const pin = document.createElement('a-entity');
    pin.classList.add('gem-pin');
    pin.setAttribute('gem-pin', `id: ${gem.id}`);
    pin.setAttribute('position', `${x} ${y} ${z}`);
    pin.setAttribute('visible', 'true');
    pin.setAttribute('geometry', { primitive: 'sphere', radius: 0.42 });
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
    model.setAttribute('scale', '0.14 0.14 0.14');
    model.addEventListener('model-loaded', (ev) => {
      const obj = ev.detail.model;
      obj.traverse((node) => {
        if (node.isMesh && node.material) {
          node.material = node.material.clone();
          node.material.color = new AFRAME.THREE.Color(gem.color);
          node.material.metalness = 0.1;
          node.material.roughness = 0.55;
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

    worldRoot.appendChild(pin);
  });

  schedulePhase3PinRepositions(scene);
}

/** @param {import('aframe').Entity} sceneEl */
export function activatePinsPhase(sceneEl) {
  ensureGemPinComponentRegistered();
  if (!sceneEl) return;
  sceneEl.querySelectorAll('.gem-pin').forEach((n) => n.parentNode?.removeChild(n));
  spawnGemPinsInto(sceneEl);
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
