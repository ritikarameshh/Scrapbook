# Landmark data model — future work

Right now the AR flow is hardcoded around a single landmark (Empire State Building) plus a flag for one demo "hidden gem" spot. This works for the prototype demo but doesn't scale past 2–3 entries.

This doc captures the proper data structure to migrate to once the outline-alignment feature has settled on a single validator and a single outline-source pipeline.

## Proposed shape

```js
const LANDMARKS = [
  {
    id: 'empire-state',
    city: 'New York City',
    name: 'Empire State Building',
    stamp: { code: 'EMPIRE', sub: 'NYC · MAY' },

    // Phase 1 strategy
    phase1: {
      mode: 'image',                 // 'image' | 'outline'
      target: { mindIndex: 0 },      // for mode 'image': index in targets.mind
    },

    // Phase 2 stamp config (already implicit today)
    stamp3D: {
      radiusMin: 0.48, radiusMax: 0.90,
      yLiftMin: 0.18, yLiftMax: 0.46,
    },

    // Fact + task screen content
    fact: 'The Empire State Building has its own zip code — 10118 …',
    task: { label: 'Tiny task', body: 'Grab an egg cream …' },
  },

  {
    id: 'hidden-gem-1',
    city: 'New York City',
    name: 'Hidden gem',
    stamp: { code: 'GEM', sub: 'NYC · MAY' },

    phase1: {
      mode: 'outline',
      validator: 'visual',           // 'visual' | 'mindar'
      outline: {
        source: 'svg',               // 'svg' | 'auto'
        svg: 'Assets/hidden-gem-outline.svg',
        autoPng: 'Assets/hidden-gem-outline.auto.png',
      },
      // Only used when validator === 'mindar'
      mindarTarget: { mindIndex: 1 },
      // Tolerance for the 5%-error gate
      threshold: 0.05,
      sustainMs: 1000,
    },

    fact: '…',
    task: { label: 'Tiny task', body: '…' },
  },
];
```

## How `startAR()` should branch

Today (after the prototype lands) `startAR()` reads a `HIDDEN_GEM_DEMO` constant. After migration:

```js
function startAR(landmarkId) {
  const landmark = LANDMARKS.find(l => l.id === landmarkId);
  if (!landmark) return;
  if (landmark.phase1.mode === 'image')  mountARSceneInto(container, landmark);
  if (landmark.phase1.mode === 'outline') mountOutlineSceneInto(container, landmark);
}
```

The `home` screen would be parameterised on a `currentLandmarkId` (e.g. picked from the user's GPS or from a "next stop in the trip" list). The `ar-fact` and `collected` screens read their copy out of `landmark.fact` / `landmark.task` / `landmark.stamp` rather than being baked into HTML.

## Migration steps (when ready)

1. Pick the winning validator (visual vs. mindar) — drop the loser + the `?validator` toggle in `script.js`.
2. Pick the winning outline source (svg vs. auto) — drop the loser + the `?outline` toggle.
3. Move all hardcoded Empire State copy out of `index.html` into a single `LANDMARKS` array in `script.js` (or a separate `landmarks.js`).
4. Replace the `HIDDEN_GEM_DEMO` flag with a real lookup in `startAR()`.
5. Update `ar-fact` and `collected` screen markup to be templated from the active landmark.
6. Add a tiny "stop picker" to the home card so a demo can step through 2+ landmarks without page reload.

## Why not now

Doing this before deciding which validator/outline pipeline wins would commit the data shape prematurely. The decision happens after on-device testing (see verification section in the implementation plan), so the data model lands cleanest as a follow-up.
