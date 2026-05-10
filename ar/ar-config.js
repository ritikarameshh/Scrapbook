/** Static AR flow configuration */

export const LANDMARK_MIND_SRC = './met-detection/targets.mind';

export const OUTLINE_SRC = new URL('../Assets/LexingtonCandyShop.auto.png', import.meta.url).href;

export const HIDDEN_GEMS = [
  { id: 'pub', title: 'A 100 year old pub', type: 'Pub', walkMin: 4, color: '#8C5A1A' },
  {
    id: 'gallery',
    title: 'A gallery where you can hear whispers across the room',
    type: 'Gallery',
    walkMin: 7,
    color: '#3F5532',
  },
  {
    id: 'install',
    title: 'A hidden away art installation',
    type: 'Art install.',
    walkMin: 11,
    color: '#E26E5F',
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
