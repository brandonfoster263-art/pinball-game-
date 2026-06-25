// Lightweight 2D physics for the table plane (x = table x, y = "up the table").
// Everything here works in table-space units; main.js maps table-space to 3D world-space for rendering.

export function len(x, y) {
  return Math.sqrt(x * x + y * y);
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function lerpAngle(current, target, maxStep) {
  let diff = target - current;
  if (diff > maxStep) diff = maxStep;
  else if (diff < -maxStep) diff = -maxStep;
  return current + diff;
}

// Ball vs static line segment (a -> b), with a "thickness" radius on the segment itself.
// Returns true if a collision was resolved (position pushed out + velocity reflected).
export function collideBallSegment(ball, ax, ay, bx, by, segRadius, restitution) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 1e-9 ? ((ball.x - ax) * dx + (ball.y - ay) * dy) / lenSq : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  let nx = ball.x - cx;
  let ny = ball.y - cy;
  const dist = len(nx, ny);
  const minDist = ball.radius + segRadius;
  if (dist >= minDist || dist < 1e-6) return false;
  nx /= dist;
  ny /= dist;
  const penetration = minDist - dist;
  ball.x += nx * penetration;
  ball.y += ny * penetration;
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    const j = -(1 + restitution) * vn;
    ball.vx += nx * j;
    ball.vy += ny * j;
  }
  return true;
}

// Ball vs static/moving circle. circleVel optional {x,y} for moving bumpers (defaults to 0).
export function collideBallCircle(ball, cx, cy, cr, restitution, circleVel) {
  let nx = ball.x - cx;
  let ny = ball.y - cy;
  const dist = len(nx, ny);
  const minDist = ball.radius + cr;
  if (dist >= minDist) return false;
  if (dist < 1e-6) {
    nx = 0;
    ny = 1;
  } else {
    nx /= dist;
    ny /= dist;
  }
  const penetration = minDist - (dist < 1e-6 ? 0 : dist);
  ball.x += nx * penetration;
  ball.y += ny * penetration;
  const cvx = circleVel ? circleVel.x : 0;
  const cvy = circleVel ? circleVel.y : 0;
  const rvx = ball.vx - cvx;
  const rvy = ball.vy - cvy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    const j = -(1 + restitution) * vn;
    ball.vx += nx * j;
    ball.vy += ny * j;
  }
  return true;
}

// A rotating flipper modeled as a capsule (segment + radius) pivoting at (pivotX, pivotY).
export class Flipper {
  constructor({ pivotX, pivotY, length, radius, restAngleDeg, activeAngleDeg, maxOmega = 22 }) {
    this.pivotX = pivotX;
    this.pivotY = pivotY;
    this.length = length;
    this.radius = radius;
    this.restAngle = (restAngleDeg * Math.PI) / 180;
    this.activeAngle = (activeAngleDeg * Math.PI) / 180;
    this.angle = this.restAngle;
    this.prevAngle = this.restAngle;
    this.omega = 0;
    this.maxOmega = maxOmega;
    this.pressed = false;
  }

  tipX() {
    return this.pivotX + Math.cos(this.angle) * this.length;
  }
  tipY() {
    return this.pivotY + Math.sin(this.angle) * this.length;
  }

  update(dt) {
    this.prevAngle = this.angle;
    const target = this.pressed ? this.activeAngle : this.restAngle;
    const maxStep = this.maxOmega * dt;
    this.angle = lerpAngle(this.angle, target, maxStep);
    this.omega = dt > 0 ? (this.angle - this.prevAngle) / dt : 0;
  }

  // Resolve collision against a ball; imparts angular-velocity-based kick.
  collide(ball, restitution) {
    const ax = this.pivotX;
    const ay = this.pivotY;
    const bx = this.tipX();
    const by = this.tipY();
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 1e-9 ? ((ball.x - ax) * dx + (ball.y - ay) * dy) / lenSq : 0;
    t = clamp(t, 0, 1);
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    let nx = ball.x - cx;
    let ny = ball.y - cy;
    const dist = len(nx, ny);
    const minDist = ball.radius + this.radius;
    if (dist >= minDist || dist < 1e-6) return false;
    nx /= dist;
    ny /= dist;
    const penetration = minDist - dist;
    ball.x += nx * penetration;
    ball.y += ny * penetration;
    // velocity of the contact point on the rotating flipper: v = omega x r (2D)
    const rx = cx - ax;
    const ry = cy - ay;
    const pointVx = -this.omega * ry;
    const pointVy = this.omega * rx;
    const rvx = ball.vx - pointVx;
    const rvy = ball.vy - pointVy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const j = -(1 + restitution) * vn;
      ball.vx += nx * j;
      ball.vy += ny * j;
    }
    return true;
  }
}
