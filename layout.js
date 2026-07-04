// Table-space layout: all coordinates are in "table units" (x = left/right, y = up the table).
// main.js maps (x, y) -> 3D world (x, 0, -y).

export const TABLE_HALF_W = 13;
export const TABLE_TOP = 51;
export const TABLE_BOTTOM = -2.2; // below this (outside the lane), the ball drains
export const BALL_RADIUS = 0.55;

export const LANE_INNER_X = 10; // plunger lane inner wall
export const LANE_OPEN_Y = 42; // lane merges into the main field above this y

// Static boundary segments: { a:[x,y], b:[x,y], r: thickness radius, restitution }
export function buildBoundarySegments() {
  const segs = [];
  const wallR = 0.25;
  const wallRest = 0.55;

  // left wall: vertical run down to the outlane region
  segs.push({ a: [-TABLE_HALF_W, 46], b: [-TABLE_HALF_W, 12], r: wallR, restitution: wallRest });
  // left outlane outer guide: hugs the wall, ends above the open drain slot
  segs.push({ a: [-TABLE_HALF_W, 12], b: [-11.0, 5.6], r: wallR, restitution: wallRest });
  // left outlane/inlane divider (a raised lane guide with rounded post ends)
  segs.push({ a: [OUTLANES.left.dividerTop[0], OUTLANES.left.dividerTop[1]], b: [OUTLANES.left.dividerBot[0], OUTLANES.left.dividerBot[1]], r: 0.3, restitution: wallRest });
  // left inlane inner wall guiding into the flipper
  segs.push({ a: [OUTLANES.left.dividerBot[0], OUTLANES.left.dividerBot[1]], b: [-7, 4], r: wallR, restitution: wallRest });

  // right wall (outer): vertical for the lane, continues up around the top
  segs.push({ a: [TABLE_HALF_W, -2], b: [TABLE_HALF_W, 46], r: wallR, restitution: wallRest });

  // right inner field wall below the lane merge point, then the right outlane
  segs.push({ a: [LANE_INNER_X, LANE_OPEN_Y], b: [LANE_INNER_X, 12], r: wallR, restitution: wallRest });
  // right outlane outer guide
  segs.push({ a: [LANE_INNER_X, 12], b: [8.6, 5.6], r: wallR, restitution: wallRest });
  // right outlane/inlane divider
  segs.push({ a: [OUTLANES.right.dividerTop[0], OUTLANES.right.dividerTop[1]], b: [OUTLANES.right.dividerBot[0], OUTLANES.right.dividerBot[1]], r: 0.3, restitution: wallRest });
  // right inlane inner wall guiding into the flipper
  segs.push({ a: [OUTLANES.right.dividerBot[0], OUTLANES.right.dividerBot[1]], b: [7, 4], r: wallR, restitution: wallRest });

  // top arc, approximated with segments
  const arcSegments = 10;
  const prevPoint = [-TABLE_HALF_W, 46];
  let last = prevPoint;
  for (let i = 1; i <= arcSegments; i++) {
    const t = i / arcSegments;
    const angle = Math.PI - t * Math.PI; // PI -> 0
    const x = Math.cos(angle) * TABLE_HALF_W;
    const y = 46 + Math.sin(angle) * (TABLE_TOP - 46);
    segs.push({ a: last, b: [x, y], r: wallR, restitution: wallRest });
    last = [x, y];
  }

  // mid-table left lane guard wall (small wall above the mid flipper to shape the lane)
  segs.push({ a: [-TABLE_HALF_W, 30], b: [-10.2, 24], r: wallR, restitution: wallRest });

  return segs;
}

// Outlane / inlane geometry (classic bottom-of-table lanes).
// The divider is a raised guide rail: wall side of it = outlane (drains through
// the open slot at its foot), field side = inlane (feeds the flipper).
export const OUTLANES = {
  left: {
    dividerTop: [-10.0, 10.0],
    dividerBot: [-8.6, 5.2],
    // sensor zone that counts as "ball is in the outlane" (kickback territory)
    zone: { xMin: -11.6, xMax: -8.8, yMin: 3.4, yMax: 5.4 },
    kickback: { x: -9.9, y: 4.2 }, // kicker position at the foot of the outlane
  },
  right: {
    dividerTop: [7.6, 10.0],
    dividerBot: [6.9, 5.2],
    zone: { xMin: 7.1, xMax: 9.2, yMin: 3.4, yMax: 5.4 },
  },
  // inlane sensor strips (rolling through one boosts the bonus multiplier)
  inlaneZones: [
    { xMin: -8.8, xMax: -7.0, yMin: 4.6, yMax: 6.2 },
    { xMin: 6.9, xMax: 8.4, yMin: 4.6, yMax: 6.2 },
  ],
};

// Slingshot kickers: triangles above each flipper. face = the kicking edge
// (a -> b), kick direction is that edge's outward normal.
export const SLINGSHOTS = [
  {
    verts: [[-6.1, 9.6], [-4.6, 6.6], [-7.1, 6.8]],
    face: [[-6.1, 9.6], [-4.6, 6.6]],
    kickSpeed: 19,
    cooldownSec: 0.22,
  },
  {
    verts: [[6.1, 9.6], [4.6, 6.6], [7.1, 6.8]],
    face: [[4.6, 6.6], [6.1, 9.6]],
    kickSpeed: 19,
    cooldownSec: 0.22,
  },
];

// Drop target bank on the left mid-field, spelling R-U-N. Each target is a
// short wall segment that collapses when struck; completing the bank starts
// the next hack mode and pops the targets back up.
export const DROP_TARGETS = {
  letters: ['R', 'U', 'N'],
  resetDelaySec: 1.4,
  targets: [
    { a: [-8.2, 27.8], b: [-7.1, 27.2] },
    { a: [-6.6, 26.9], b: [-5.5, 26.3] },
    { a: [-5.0, 26.0], b: [-3.9, 25.4] },
  ],
  r: 0.28,
  restitution: 0.7,
};

// Spinner across the left-wall descent corridor: balls hugging the left wall
// (rollover exits, orbit shots) whip through it. Each revolution scores.
export const SPINNER = {
  x: -12.25,
  y: 33.0,
  halfW: 0.95,
  triggerHalfH: 0.7,
  spinsPerPass: 6, // base revolutions per pass, scaled by ball speed
};

export const PLUNGER = {
  x: (LANE_INNER_X + TABLE_HALF_W) / 2,
  restY: -1.2,
  // tuned against GRAVITY (-30) so a full charge clears the LANE_OPEN_Y (42) lane merge
  // point with speed to spare, while a weak plunge falls back and drains in the lane.
  minPower: 24,
  maxPower: 58,
};

export const FLIPPERS = {
  left: {
    pivotX: -6.5,
    pivotY: 4,
    length: 5.6,
    radius: 0.75,
    restAngleDeg: -12,
    activeAngleDeg: 58,
    maxOmega: 26,
  },
  right: {
    pivotX: 6.5,
    pivotY: 4,
    length: 5.6,
    radius: 0.75,
    restAngleDeg: 192,
    activeAngleDeg: 122,
    maxOmega: 26,
  },
  mid: {
    pivotX: -10.4,
    pivotY: 23.5,
    length: 4.1,
    radius: 0.65,
    restAngleDeg: -118,
    activeAngleDeg: -8,
    maxOmega: 28,
  },
};

export const DATA_NODES = [
  { x: -8.2, y: 29.5, r: 1.0 },
  { x: -4.2, y: 33.4, r: 1.0 },
  { x: 0, y: 35.4, r: 1.0 },
  { x: 4.2, y: 33.4, r: 1.0 },
  { x: 8.2, y: 29.5, r: 1.0 },
];

// Two static bumper clusters flanking the central lane, mirroring the reference
// cabinet's left/right pop-bumper banks instead of one spinning center cluster.
export const COMPILER = {
  x: 0,
  y: 22,
  bumpers: [
    { dx: -4.4, dy: 1.7, r: 1.15 },
    { dx: -4.4, dy: -0.3, r: 1.0 },
    { dx: -4.0, dy: -2.3, r: 0.9 },
    { dx: 4.4, dy: 1.7, r: 1.15 },
    { dx: 4.4, dy: -0.3, r: 1.0 },
    { dx: 4.0, dy: -2.3, r: 0.9 },
  ],
  restitution: 0.92,
};

export const FIREWALL = {
  y: 38.5,
  halfSpan: 9,
  gapHalfWidth: 2.3,
  slideRange: 5.6,
  periodSec: 4.2,
  wallR: 0.25,
  restitution: 0.5,
};

// Ramp entry sits just inside the field-side of the lane wall (x < LANE_INNER_X)
// so it's a deliberate flipper shot, never triggered by the plunger lane itself.
export const WARP_RAMP = {
  zone: { xMin: 7.2, xMax: LANE_INNER_X - 0.2, yMin: 18, yMax: 40 },
  minSpeed: 11,
  requireAscending: true,
  ringWorld: { x: 8.4, y: 8, z: -38 },
};

// Top rollover lanes spelling R-I-F-T. Rolling the ball over a lane lights its
// letter; completing RIFT awards a scaling bonus + an extra ball.
export const ROLLOVERS = {
  y: 44,
  triggerR: 1.4, // proximity radius that counts as "rolling over" the lane
  lanes: [
    { x: -7.5, letter: 'R' },
    { x: -2.5, letter: 'I' },
    { x: 2.5, letter: 'F' },
    { x: 7.5, letter: 'T' },
  ],
};

export const PORTAL_RING = { x: 0, y: 49, z: 0 };

export const DRAIN_GAP = { xMin: -7, xMax: 7 };
