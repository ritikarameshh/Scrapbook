/** Static AR flow configuration */

export const LANDMARK_MIND_SRC = './met-detection/targets.mind';

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
    type: 'Art install.',
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

export const PHASE3_PIN_LAYOUT = [
  { angleDeg: -40, radius: 1.38, y: 0.12 },
  { angleDeg: 0, radius: 1.52, y: 0.42 },
  { angleDeg: 40, radius: 1.38, y: -0.12 },
];
