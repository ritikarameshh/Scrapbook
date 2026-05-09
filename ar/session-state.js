/** Mutable AR session state shared across phase modules. */

let arPhase = 0;
let arSceneEl = null;

export function getArPhase() {
  return arPhase;
}

export function setArPhase(p) {
  arPhase = p;
}

export function getArSceneEl() {
  return arSceneEl;
}

export function setArSceneEl(el) {
  arSceneEl = el;
}
