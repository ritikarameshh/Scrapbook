# Landmark Detection — Context Document for Next Agent

**Branch:** `arnav/match-outline-flow`  
**Repo:** https://github.com/ritikarameshh/Scrapbook  
**Stack:** Vanilla JS + A-Frame 1.4.2 + MindAR (image tracking); static ES modules (no Vite on `final-app`)  

---

## App Overview

Scrapbook is a mobile AR stamp-collection app. The user navigates to a landmark, enters AR mode, and must *find* the stamp hidden in 3D space near the landmark.

The AR flow has two phases:

| Phase | Description |
|-------|-------------|
| **Phase 1** | Landmark detection — proves user is looking at the right spot |
| **Phase 2** | Stamp hunt — an AR disc hidden nearby; user taps it to collect |

Phase 2 is identical for all landmarks. Phase 1 is where the two implementations diverge.

---

## Two Phase 1 Implementations (both currently in the codebase)

### Implementation A — MindAR Image Tracking (used for prominent landmarks)

**How it works:**  
Standard MindAR detection. A `.mind` file is compiled from a reference photo of the landmark. When the user points the camera at the landmark, MindAR fires `targetFound` on the anchor entity and Phase 2 starts immediately. No alignment UI shown to the user.

**Relevant code:**  
- `mountARSceneInto(container)` in `script.js` (~line 264)  
- Uses `./targets.mind` (compiled from `Assets/EmpireStateBuilding.jpeg`)  
- Anchor entity: `#esb-anchor` with `mindar-image-target="targetIndex: 0"`  
- On `targetFound` → `transitionToPhase2(anchor)` with the anchor element passed in

**Assets required:**  
- `Assets/targets.mind` — compiled from `EmpireStateBuilding.jpeg`

**UI shown during Phase 1:**  
`#ar-phase-1` — simple viewfinder corners + "Point your camera at the Empire State Building" hint text. No interactive alignment element.

**Limitation:**  
Works well for landmarks with a strong, distinctive visual façade (like the ESB). Fails for small, generic-looking, or visually ambiguous spots — the model can't reliably fire `targetFound`.

---

### Implementation B — Outline Alignment (used for hidden gems / small landmarks)

**How it works:**  
User sees a semi-transparent silhouette outline of the landmark overlaid on the live camera feed. They physically move/angle the phone until the real-world building aligns with the outline. A scoring function measures alignment quality. When score stays below the 40% error threshold for 1 second (sustain window), Phase 2 unlocks.

**Relevant code:**  
- `mountOutlineSceneInto(container)` in `script.js` (~line 339) — mounts the A-Frame scene and kicks off validators  
- `prepareOutlineUI(outlineSrc)` (~line 407) — resets outline overlay state  
- `applyAlignmentScore(error)` (~line 430) — central state machine; drives all UI  
- `onAlignmentLocked()` (~line 459) — fires after sustain; calls `transitionToPhase2(anchorEl)`  
- `transitionToPhase2(anchorEl)` (~line 671) — accepts `null` anchor (visual path)

**UI shown during Phase 1:**  
`#ar-phase-outline` — the outline stage with:
- `.outline-img` — the landmark silhouette (recolored via CSS mask technique)
- `.sustain-ring` — SVG ring that fills up as the user holds alignment
- `.lockin-check` — ✓ badge that pops in on lock
- `.dev-controls` — in-app toggle strip (VISUAL/MINDAR + SVG/AUTO + live error %)

**Score color states** (`data-state` on `.outline-stage`):

| State | Condition | Color |
|-------|-----------|-------|
| `idle` | initial | white |
| `far` | error ≥ 70% | coral (red) |
| `near` | 40% ≤ error < 70% | mustard (yellow) |
| `aligned` | error < 40% | sage (green) |
| `locked` | sustained aligned for 1s | sage + ✓ badge |

---

## Two Validator Sub-Modes (within Implementation B)

Both are selectable via the in-app toggle (`VISUAL` / `MINDAR` buttons in `#dev-controls`).

### Validator 1 — Visual Edge Matching (Sobel + IoU)

**Algorithm:**
1. At 10Hz, grab the live camera video frame
2. Crop to the screen-space bounding box of `#outline-target`
3. Downsample to 192×256 pixels
4. Run Sobel edge detection in JS (no OpenCV) → binary edge mask
5. Compare against a pre-binarized mask built from the outline image
6. Score = `1 - IoU(cameraEdges, outlineMask)` — lower = better aligned
7. Feed score into `applyAlignmentScore(error)`

**Key functions:**  
`startVisualAlignment()` → `sobelEdgeMask(imageData)` → `iouScore(a, b)` → `applyAlignmentScore(error)`  
`buildOutlineMask(src)` — pre-binarizes the outline image once on mount

**Mind file used:** `./targets.mind` (ESB file, used only to get camera running — detections are ignored)

**Stamp placement on Phase 2:** world space (no MindAR anchor), position ahead of camera  
(`transitionToPhase2(null)`)

**Constants:**
```js
VISUAL_GRID_W = 192
VISUAL_GRID_H = 256
VISUAL_EDGE_THRESHOLD = 60   // Sobel magnitude threshold (0-255)
ALIGNMENT_THRESHOLD = 0.40   // 40% error gates Phase 2
ALIGNMENT_SUSTAIN_MS = 1000  // must hold for 1 second
ALIGNMENT_TICK_MS = 100      // runs at 10Hz
```

**Outline assets:**  
- `Assets/hidden-gem-outline.svg` — hand-crafted building silhouette (placeholder; replace with actual hidden gem outline)
- `Assets/HiddenGem.auto.png` — auto-generated edge map from `HiddenGem.png` via `scripts/generate-outline.mjs`

---

### Validator 2 — MindAR Event-Based Detection

**Algorithm:**
1. Mount A-Frame scene with `targets-hiddengem.mind` (compiled from `Assets/HiddenGem.png` only — no other targets in this file)
2. Listen to `targetFound` / `targetLost` events on the MindAR anchor
3. At 10Hz, check `gemTargetVisible` boolean
4. `applyAlignmentScore(gemTargetVisible ? 0 : 1)` — binary: either tracking (0% error) or not (100%)

**Key functions:**  
`startMindARAlignment()` — wires interval  
`gemTargetVisible` — boolean state var updated by `targetFound`/`targetLost` event handlers (set up in the `renderstart` callback inside `mountOutlineSceneInto`)

**Mind file used:** `./Assets/targets-hiddengem.mind` (HiddenGem.png compiled at targetIndex 0)

**Stamp placement on Phase 2:** anchored to the MindAR tracked image  
(`transitionToPhase2(document.getElementById('esb-anchor'))`)

**Note on "project corners" code:** There is legacy position/scale projection code still in `startMindARAlignment()` (~line 613-668) that projects the 4 corner entities of the anchor into screen space and checks overlap with `#outline-target`. This runs but the event-based path (`applyAlignmentScore(anyTracked ? 0 : 1)`) is the effective logic — the corner math rarely converges to a useful score in practice. If retaining this validator, consider either removing the corner math or making it the primary path.

---

## Outline Source Toggle (SVG vs AUTO)

Both validators support two outline sources:

| Mode | File | Description |
|------|------|-------------|
| `svg` | `Assets/hidden-gem-outline.svg` | Hand-drawn SVG silhouette. Precise but requires manual creation per landmark. |
| `auto` | `Assets/HiddenGem.auto.png` | Auto-generated edge map from `HiddenGem.png` using Sobel filter via `scripts/generate-outline.mjs`. Less visually refined but zero-effort to generate. |

The toggle switches the CSS `--outline-src` variable on `#outline-img` and rebuilds `outlineMaskCanvas` for the visual validator. Hot-switches without remounting A-Frame.

---

## Key Files

| File | Purpose |
|------|---------|
| `script.js` | All AR logic — both Phase 1 implementations, validators, state machine |
| `index.html` | All screens — `#ar-phase-1` (MindAR UI), `#ar-phase-outline` (outline UI), `#ar-phase-2` (hunt UI) |
| `styles.css` | Outline stage styles — `.outline-stage[data-state]`, `.sustain-ring`, `.lockin-check`, `.dev-controls` |
| `Assets/targets.mind` | MindAR targets for ESB (used by Implementation A and as camera-only dummy for visual validator) |
| `Assets/targets-hiddengem.mind` | MindAR targets compiled from HiddenGem.png only; used by MindAR validator |
| `Assets/HiddenGem.png` | Reference photo of the hidden gem location |
| `Assets/HiddenGem.auto.png` | Auto-generated edge map from HiddenGem.png |
| `Assets/hidden-gem-outline.svg` | Hand-drawn silhouette (placeholder) |
| `compile.html` | In-browser MindAR compiler; generates `.mind` from any image |
| `scripts/generate-outline.mjs` | Node script (uses `sharp`) to generate `.auto.png` edge maps |
| `scripts/compile-targets.mjs` | Instructions wrapper pointing to compile.html workflow |
| `mindar-image-aframe.prod.js` | MindAR A-Frame integration (local copy, served by Vite) |
| `mindar-image-three.prod.js` | MindAR Three.js / compiler (used by compile.html) |

---

## Current Gate Variable

```js
const HIDDEN_GEM_DEMO = true;  // script.js line 113
```

When `true`, `startAR()` routes to `mountOutlineSceneInto()` (Implementation B) instead of `mountARSceneInto()` (Implementation A). This is a single hardcoded flag — the long-term intention is to replace it with a per-landmark data model (see `docs/landmark-data-model.md`).

---

## A-Frame Scene Structure

Both implementations share the same A-Frame entity structure. The difference is only `imageTargetSrc` and which Phase 1 UI div is shown.

```html
<a-scene id="ar-scene" embedded [mindar-image attrs]>
  <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
  <a-entity id="esb-anchor" mindar-image-target="targetIndex: 0">
    <!-- 4 corner entities used by legacy MindAR validator position math -->
    <a-entity class="gem-corner" data-corner="tl" position="-0.5  0.5 0"></a-entity>
    <a-entity class="gem-corner" data-corner="tr" position=" 0.5  0.5 0"></a-entity>
    <a-entity class="gem-corner" data-corner="bl" position="-0.5 -0.5 0"></a-entity>
    <a-entity class="gem-corner" data-corner="br" position=" 0.5 -0.5 0"></a-entity>
  </a-entity>
  <a-entity id="stamp-entity" visible="false" stamp-billboard>
    <!-- stamp disc geometry -->
  </a-entity>
</a-scene>
```

The `compass-updater` A-Frame component (registered globally) drives the Phase 2 compass arrow by projecting the stamp world position into camera space each frame.

---

## How Both Could Work Together in the Same App

The user's intent is to use **both implementations simultaneously** within the same app — not as A/B alternatives but potentially as complementary or sequential mechanisms for the same landmark.

Some directions to consider for the next branch:

1. **Dual-confidence gating:** Run both validators in parallel. Require *both* to pass (visual AND MindAR) before unlocking Phase 2. Adds robustness — visual confirms shape, MindAR confirms exact image identity.

2. **Sequential two-step Phase 1:** Visual outline alignment first (broad location confirmation), then MindAR lock-in (precise identity check). Only unlocks Phase 2 after both confirm in sequence.

3. **Fallback/cascade:** Try MindAR first (faster when it works), fall back to visual outline if MindAR doesn't fire within a timeout.

4. **Per-landmark assignment:** Some landmarks use only Implementation A (strong façade), some use only B (hidden gems), some use both in parallel or sequence. This maps to the per-landmark data model in `docs/landmark-data-model.md`.

The current codebase already has both validators' logic side-by-side and they share the same `applyAlignmentScore()` / `onAlignmentLocked()` state machine — so combining them requires extending that scoring function to accept inputs from multiple sources, not a full rewrite.

---

## Dev Setup

```bash
npm install              # installs dependencies (sharp requires --ignore-scripts on Node 24+)
npm run dev              # static server at http://localhost:5173 (see `serve`)
npm run gen-outlines     # generate .auto.png edge maps from Assets/*.png/jpeg
```

**To compile a new `.mind` file:**  
Use the upstream MindAR compile tool in a browser (see MindAR docs), then place the generated `.mind` under `Assets/` as referenced by `ar/ar-config.js`.

**To test on phone:**  
Camera requires HTTPS. Deploy to Vercel (or another HTTPS host) and open that URL, or use a local HTTPS setup; plain `http://192.168…` will not grant camera access on most mobile browsers.

**Debug escape hatch:**  
Open browser console and run `window.__forceAlign()` to immediately trigger a perfect alignment score and skip to Phase 2.
