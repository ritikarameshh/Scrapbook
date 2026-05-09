/**
 * Phase 3 — true “floating in space” pins: plain A-Frame + gyro on a mirrored MindAR stream.
 * MindAR’s own WebGL pass does not reliably composite custom entities; we hide that scene
 * visually (stream keeps running) and stack a classic magic-window scene on top.
 */

import { HIDDEN_GEMS, PHASE3_PIN_LAYOUT } from './ar-config.js';
import * as mindarHost from './ar-mindar-host.js';
import { getArPhase } from './session-state.js';

let gemPinRegistered = false;

function ensureGemPinComponent() {
  if (typeof AFRAME === 'undefined') return;
  if (AFRAME.components['gem-pin']) {
    gemPinRegistered = true;
    return;
  }
  AFRAME.registerComponent('gem-pin', {
    schema: { id: { type: 'string' } },
    init() {
      this.onClick = () => {
        if (getArPhase() !== 3) return;
        playPinClickFx(this.el);
        import('./ar-phase-pins.js').then((m) => m.openGemCard(this.data.id));
      };
      this.el.addEventListener('click', this.onClick);
    },
    remove() {
      this.el.removeEventListener('click', this.onClick);
    },
  });
  gemPinRegistered = true;
}

function playPinClickFx(pinEl) {
  const target = pinEl.querySelector('[gltf-model]') || pinEl;
  const baseScale = target.getAttribute('scale') || { x: 0.22, y: 0.22, z: 0.22 };
  const bx = baseScale.x ?? 0.22;
  const by = baseScale.y ?? 0.22;
  const bz = baseScale.z ?? 0.22;
  const sx = bx * 0.72;
  const sy = by * 0.72;
  const sz = bz * 0.72;
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

function repositionPinsFacingCamera(scene) {
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
  const rayComp = rayEl?.components?.raycaster;
  if (rayComp && typeof rayComp.setDirty === 'function') rayComp.setDirty();
}

function schedulePinRepositions(scene) {
  repositionPinsFacingCamera(scene);
  [32, 120, 280, 550].forEach((ms) => {
    setTimeout(() => repositionPinsFacingCamera(scene), ms);
  });
}

function spawnPinsInto(scene) {
  const worldRoot = scene.querySelector('#phase3-mw-world-root') || scene;

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
    model.setAttribute('scale', '0.22 0.22 0.22');
    model.addEventListener('model-loaded', (ev) => {
      const obj = ev.detail.model;
      obj.traverse((node) => {
        if (node.isMesh && node.material) {
          node.material = node.material.clone();
          node.material.color = new AFRAME.THREE.Color(gem.color);
          node.material.metalness = 0.1;
          node.material.roughness = 0.55;
          node.renderOrder = 25;
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

  schedulePinRepositions(scene);
}

/**
 * @param {HTMLElement | null} container
 * @param {HTMLVideoElement | null} mindarVideoEl
 * @param {import('aframe').Entity | null} mindarSceneEl
 */
export function mount(container, mindarVideoEl, mindarSceneEl) {
  if (!container || typeof AFRAME === 'undefined') return;

  unmount(container, mindarSceneEl);

  const stream = mindarVideoEl?.srcObject;
  if (!stream) {
    console.warn('[phase3-magic-window] no MediaStream on MindAR video');
  }

  mindarHost.setMindARSceneVisibility(mindarSceneEl, false);

  const stack = document.createElement('div');
  stack.id = 'phase3-magic-stack';
  stack.className = 'phase3-magic-stack';

  const video = document.createElement('video');
  video.className = 'phase3-mw-video';
  video.setAttribute('autoplay', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  if (stream) video.srcObject = stream;

  stack.innerHTML = `
    <a-scene id="phase3-mw-scene" embedded
      vr-mode-ui="enabled: false"
      device-orientation-permission-ui="enabled: true"
      renderer="alpha: true"
      style="position:absolute;top:0;left:0;width:100%;height:100%;">
      <a-entity id="phase3-mw-world-root" position="0 0 0"></a-entity>
      <a-light type="ambient" color="#ffffff" intensity="0.92"></a-light>
      <a-camera position="0 0 0"
        look-controls="enabled: true; touchEnabled: false; mouseEnabled: false; magicWindowTrackingEnabled: true">
        <a-entity cursor="rayOrigin: mouse; fuse: false" raycaster="objects: .gem-pin; far: 50"></a-entity>
      </a-camera>
    </a-scene>`;

  stack.insertBefore(video, stack.firstChild);
  container.appendChild(stack);

  if (stream) {
    video.play().catch((e) => console.warn('[phase3-magic-window] mirror play:', e));
  }

  const mwScene = document.getElementById('phase3-mw-scene');
  if (!mwScene) return;

  mwScene.addEventListener(
    'renderstart',
    () => {
      if (mwScene.renderer) mwScene.renderer.setClearColor(0x000000, 0);
    },
    { once: true },
  );

  const spawn = () => {
    ensureGemPinComponent();
    spawnPinsInto(mwScene);
  };
  if (mwScene.hasLoaded) spawn();
  else mwScene.addEventListener('loaded', spawn, { once: true });
}

/**
 * @param {HTMLElement | null} container
 * @param {import('aframe').Entity | null} mindarSceneEl
 */
export function unmount(container, mindarSceneEl) {
  const stack = container?.querySelector('#phase3-magic-stack');
  if (stack) {
    const sc = stack.querySelector('#phase3-mw-scene');
    if (sc) {
      try {
        sc.querySelectorAll('.gem-pin').forEach((n) => n.parentNode?.removeChild(n));
      } catch (_) {}
    }
    const mirror = stack.querySelector('.phase3-mw-video');
    if (mirror) {
      try {
        mirror.pause();
        mirror.srcObject = null;
      } catch (_) {}
    }
    stack.remove();
  }
  mindarHost.setMindARSceneVisibility(mindarSceneEl, true);
}
