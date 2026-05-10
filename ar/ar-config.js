/** Static AR flow configuration */

export const LANDMARK_MIND_SRC = './met-detection/targets.mind';

/**
 * How many images are in `met-detection/targets.mind` — here, the **same** landmark (The Met)
 * from different angles for coverage. Compiler order = anchor indices `0 … count-1`.
 */
export const LANDMARK_MIND_TARGET_COUNT = 3;

/** MindAR `maxTrack` and number of `mindar-image-target` anchors — must match `.mind` image count. */
export const LANDMARK_MAX_TRACK = LANDMARK_MIND_TARGET_COUNT;

/** Phase 1 banner: all targets are this place, different reference photos. */
export const LANDMARK_PHASE1_DISPLAY_NAME = 'the Metropolitan Museum of Art';

export const OUTLINE_SRC = new URL('../Assets/LexingtonCandyShop.auto.png', import.meta.url).href;

export const HIDDEN_GEMS = [
  {
    id: 'pub',
    title: 'A 100 year old pub',
    type: 'Pub',
    walkMin: 4,
    color: '#8C5A1A',
    /** Address used when building Google Maps directions URLs. */
    mapsQuery: 'McSorleys Old Ale House, New York, NY',
  },
  {
    id: 'lexington-candy',
    title: 'A 100 year old diner famous for maintaining heritage',
    type: 'Food',
    walkMin: 7,
    color: '#3F5532',
    mapsQuery: 'Lexington Candy Shop, 1226 Lexington Ave, New York, NY',
  },
  {
    id: 'install',
    title: 'A hidden away art installation',
    type: 'Art',
    walkMin: 11,
    color: '#E26E5F',
    mapsQuery: 'The Vessel at Hudson Yards, New York, NY',
  },
];

export const SECOND_SPOT_GEM_ID = HIDDEN_GEMS[1].id;

/** glTF pin visual scale (world units) */
export const PHASE3_PIN_MODEL_SCALE = 0.14;

/** Invisible sphere for tap raycasts; keep roughly ~2× visual footprint */
export const PHASE3_PIN_HIT_SPHERE_RADIUS = 0.28;

/** World-space arc in front of camera: tighter cluster so all three read in one glance on phone. */
export const PHASE3_PIN_LAYOUT = [
  { angleDeg: -25, radius: 1.2, y: 0.06 },
  { angleDeg: 0, radius: 1.1, y: 0.14 },
  { angleDeg: 25, radius: 1.2, y: 0.02 },
];
