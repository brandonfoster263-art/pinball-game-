import * as THREE from './vendor/three/three.module.min.js';
import { Flipper, collideBallSegment, collideBallCircle, clamp, len } from './physics.js';
import {
  TABLE_HALF_W,
  TABLE_TOP,
  BALL_RADIUS,
  buildBoundarySegments,
  PLUNGER,
  FLIPPERS,
  DATA_NODES,
  COMPILER,
  FIREWALL,
  WARP_RAMP,
  PORTAL_RING,
} from './layout.js';

// ---------- table-space <-> world-space mapping ----------
const toWorldX = (x) => x;
const toWorldZ = (y) => -y;

// ---------- renderer / scene / camera ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040212);
scene.fog = new THREE.FogExp2(0x050214, 0.006);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 300);
function placeCamera() {
  camera.position.set(0, 34, 26);
  camera.lookAt(0, 2, toWorldZ(26));
}
placeCamera();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- lighting ----------
scene.add(new THREE.AmbientLight(0x2b2a55, 0.7));
const keyLight = new THREE.PointLight(0x6df9ff, 1.4, 80, 2);
keyLight.position.set(0, 22, toWorldZ(20));
scene.add(keyLight);
const magentaLight = new THREE.PointLight(0xff2ad1, 1.1, 70, 2);
magentaLight.position.set(0, 16, toWorldZ(40));
scene.add(magentaLight);

// ---------- starfield void background ----------
function buildStarfield() {
  const count = 900;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 90 + Math.random() * 140;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.6 + 5;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) - 30;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0x9be9ff, size: 0.6, transparent: true, opacity: 0.75 });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return points;
}
const starfield = buildStarfield();

// ---------- neon grid floor (cyberspace void) ----------
const grid = new THREE.GridHelper(220, 44, 0xff2ad1, 0x1c1240);
grid.position.y = -6;
scene.add(grid);

// ---------- table bed ----------
const textureLoader = new THREE.TextureLoader();
const playfieldTexture = textureLoader.load('./assets/playfield-galaxy.jpg');
playfieldTexture.colorSpace = THREE.SRGBColorSpace;
const bedGeo = new THREE.PlaneGeometry(TABLE_HALF_W * 2 + 4, TABLE_TOP + 6);
const bedMat = new THREE.MeshStandardMaterial({
  map: playfieldTexture,
  color: 0xffffff,
  emissiveMap: playfieldTexture,
  emissive: 0xffffff,
  emissiveIntensity: 0.35,
  metalness: 0.2,
  roughness: 0.6,
});
const bed = new THREE.Mesh(bedGeo, bedMat);
bed.rotation.x = -Math.PI / 2;
bed.position.set(0, -0.05, toWorldZ((TABLE_TOP - 4) / 2 - 4));
scene.add(bed);

// faint neon outline of the playfield border
{
  const pts = [];
  const hw = TABLE_HALF_W + 1.6;
  pts.push(new THREE.Vector3(-hw, 0.02, toWorldZ(-3)));
  pts.push(new THREE.Vector3(-hw, 0.02, toWorldZ(TABLE_TOP + 1)));
  pts.push(new THREE.Vector3(hw, 0.02, toWorldZ(TABLE_TOP + 1)));
  pts.push(new THREE.Vector3(hw, 0.02, toWorldZ(-3)));
  pts.push(new THREE.Vector3(-hw, 0.02, toWorldZ(-3)));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0x6dfcff, transparent: true, opacity: 0.35 });
  scene.add(new THREE.Line(geo, mat));
}

// ---------- cabinet: black trim + headboard backglass ----------
{
  const FRONT_Z = toWorldZ(-3);      // front apron edge (near the player)
  const BACK_Z = toWorldZ(TABLE_TOP + 1); // back edge under the backbox
  const MID_Z = (FRONT_Z + BACK_Z) / 2;
  const DEPTH = FRONT_Z - BACK_Z;    // total playfield length in world z
  const RAIL_X = TABLE_HALF_W + 1.7; // black side rails sit just outside the walls

  // glossy black cabinet material (the polished machine body)
  const cabMat = new THREE.MeshStandardMaterial({
    color: 0x050409,
    emissive: 0x0b0418,
    emissiveIntensity: 0.6,
    metalness: 0.65,
    roughness: 0.35,
  });
  // thin magenta neon pinstripe that runs along the cabinet edges
  const pinkPinstripe = new THREE.MeshBasicMaterial({ color: 0xff2ad1 });
  const cyanPinstripe = new THREE.MeshBasicMaterial({ color: 0x6dfcff });

  const cabinet = new THREE.Group();
  scene.add(cabinet);

  // solid machine body below the playfield (gives the table real mass)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(RAIL_X * 2 + 1.4, 9, DEPTH + 2),
    cabMat
  );
  body.position.set(0, -4.6, MID_Z);
  cabinet.add(body);

  // left + right side rails framing the playfield, raised above the surface
  const railGeo = new THREE.BoxGeometry(1.7, 2.8, DEPTH + 2);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, cabMat);
    rail.position.set(sx * RAIL_X, 0.9, MID_Z);
    cabinet.add(rail);
    // neon pinstripe along the inner-top edge of each rail
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, DEPTH + 2),
      sx < 0 ? cyanPinstripe : pinkPinstripe
    );
    stripe.position.set(sx * (RAIL_X - 0.85), 2.25, MID_Z);
    cabinet.add(stripe);
  }

  // front apron (the lip nearest the player, below the flippers)
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(RAIL_X * 2 + 1.4, 2.8, 4),
    cabMat
  );
  apron.position.set(0, 0.9, FRONT_Z + 1.4);
  cabinet.add(apron);
  const apronStripe = new THREE.Mesh(
    new THREE.BoxGeometry(RAIL_X * 2 + 1.4, 0.16, 0.16),
    pinkPinstripe
  );
  apronStripe.position.set(0, 2.25, FRONT_Z - 0.5);
  cabinet.add(apronStripe);

  // ---------- backbox + backglass headboard ----------
  const backbox = new THREE.Group();
  backbox.position.set(0, 0, BACK_Z - 2.6);
  scene.add(backbox);

  const TILT = -0.26;     // lean the headboard back, toward the player's view
  const GLASS_W = 32;
  const GLASS_H = 10.85;  // matches the 2.95:1 backglass texture aspect
  const FRAME = 1.1;
  const BASE_Y = 11;      // bottom of the glass sits above the portal ring
  const CY = BASE_Y + GLASS_H / 2; // glass/shell center height
  // small offsets so the glass face floats just ahead of the shell, sharing tilt
  const offY = Math.sin(-TILT) * 0.75;
  const offZ = Math.cos(TILT) * 0.75;

  // black backbox cabinet shell that the glass sits in
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(GLASS_W + FRAME * 2, GLASS_H + FRAME * 2, 1.4),
    cabMat
  );
  shell.position.set(0, CY, 0);
  shell.rotation.x = TILT;
  backbox.add(shell);

  // a short black neck connecting the backbox down to the playfield deck
  const neck = new THREE.Mesh(new THREE.BoxGeometry(GLASS_W + FRAME * 2, BASE_Y, 2.2), cabMat);
  neck.position.set(0, BASE_Y / 2, 1.0);
  backbox.add(neck);

  // the glowing backglass artwork itself
  const glassTex = textureLoader.load('./assets/backglass.jpg');
  glassTex.colorSpace = THREE.SRGBColorSpace;
  const glassMat = new THREE.MeshStandardMaterial({
    map: glassTex,
    emissiveMap: glassTex,
    emissive: 0xffffff,
    emissiveIntensity: 1.2,
    metalness: 0.1,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(GLASS_W, GLASS_H), glassMat);
  glass.position.set(0, CY + offY, offZ + 0.05);
  glass.rotation.x = TILT;
  backbox.add(glass);

  // neon trim framing the backglass (magenta top, cyan bottom)
  const topTrim = new THREE.Mesh(new THREE.BoxGeometry(GLASS_W + FRAME, 0.24, 0.24), pinkPinstripe);
  topTrim.position.set(0, CY + GLASS_H / 2 + Math.sin(-TILT) * 0.85, Math.cos(TILT) * 0.85);
  topTrim.rotation.x = TILT;
  backbox.add(topTrim);
  const botTrim = new THREE.Mesh(new THREE.BoxGeometry(GLASS_W + FRAME, 0.24, 0.24), cyanPinstripe);
  botTrim.position.set(0, CY - GLASS_H / 2 + Math.sin(-TILT) * 0.85, Math.cos(TILT) * 0.85);
  botTrim.rotation.x = TILT;
  backbox.add(botTrim);

  // a soft light to make the headboard read as backlit glass
  const glassLight = new THREE.PointLight(0xb14bff, 1.4, 70, 2);
  glassLight.position.set(0, 16, BACK_Z + 6);
  scene.add(glassLight);
}

// ---------- helpers to build neon meshes ----------
const wallMat = new THREE.MeshStandardMaterial({
  color: 0x1a0a33,
  emissive: 0x6dfcff,
  emissiveIntensity: 0.9,
  metalness: 0.4,
  roughness: 0.35,
});
const wallGroup = new THREE.Group();
scene.add(wallGroup);

function addWallSegmentMesh(ax, ay, bx, by, thickness, height = 1.4) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = len(dx, dy);
  const geo = new THREE.BoxGeometry(length, height, thickness * 2);
  const mesh = new THREE.Mesh(geo, wallMat);
  const midX = toWorldX((ax + bx) / 2);
  const midZ = toWorldZ((ay + by) / 2);
  mesh.position.set(midX, height / 2, midZ);
  setYRotFromTableDir(mesh, dx, dy);
  wallGroup.add(mesh);
  return mesh;
}

// Orient a mesh (built lying along local +X) so it points along table-space direction (dx, dy).
function setYRotFromTableDir(mesh, dx, dy) {
  // table (dx, dy) -> world (dx, 0, -dy)
  const wx = dx;
  const wz = -dy;
  mesh.rotation.y = Math.atan2(-wz, wx);
}

const boundarySegs = buildBoundarySegments();
for (const s of boundarySegs) {
  addWallSegmentMesh(s.a[0], s.a[1], s.b[0], s.b[1], s.r + 0.18);
}

// ---------- flippers ----------
// Glassy white-cyan neon flippers, matching the reference cabinet's flipper finish.
function makeFlipperVisual(cfg) {
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xeafdff,
    emissive: 0x6dfcff,
    emissiveIntensity: 0.55,
    metalness: 0.2,
    roughness: 0.15,
    transparent: true,
    opacity: 0.82,
  });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x0a1820, emissive: 0x6dfcff, emissiveIntensity: 2.2, metalness: 0.3, roughness: 0.2 });

  const bodyLen = Math.max(cfg.length - cfg.radius * 2, 0.2);
  const geo = new THREE.CapsuleGeometry(cfg.radius * 0.82, bodyLen, 4, 8);
  geo.rotateZ(Math.PI / 2); // capsule default is vertical; make it horizontal along local +X
  const mesh = new THREE.Mesh(geo, bodyMat);
  mesh.position.x = cfg.length / 2; // shift so local origin = pivot end

  // thin glowing cyan rim outline tracing the flipper edge
  const rimGeo = new THREE.CapsuleGeometry(cfg.radius * 0.9, bodyLen, 4, 8);
  rimGeo.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.position.x = cfg.length / 2;
  rim.material.side = THREE.BackSide;

  const holder = new THREE.Group();
  holder.add(rim, mesh);
  scene.add(holder);
  return holder;
}

const leftFlipper = new Flipper(FLIPPERS.left);
const rightFlipper = new Flipper(FLIPPERS.right);
const midFlipper = new Flipper(FLIPPERS.mid);
const leftFlipperMesh = makeFlipperVisual(FLIPPERS.left);
const rightFlipperMesh = makeFlipperVisual(FLIPPERS.right);
const midFlipperMesh = makeFlipperVisual(FLIPPERS.mid);

function updateFlipperVisual(flipper, mesh) {
  mesh.position.set(toWorldX(flipper.pivotX), 0.75, toWorldZ(flipper.pivotY));
  const dx = Math.cos(flipper.angle);
  const dy = Math.sin(flipper.angle);
  setYRotFromTableDir(mesh, dx, dy);
}

// ---------- data nodes ----------
const nodeMat = (lit) =>
  new THREE.MeshStandardMaterial({
    color: lit ? 0x33310a : 0x0a1a22,
    emissive: lit ? 0xfffb6d : 0x2fb8d6,
    emissiveIntensity: lit ? 2.2 : 0.9,
    metalness: 0.3,
    roughness: 0.3,
  });

const dataNodes = DATA_NODES.map((n) => {
  const geo = new THREE.IcosahedronGeometry(n.r * 0.85, 1);
  const mat = nodeMat(false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(toWorldX(n.x), 1.1, toWorldZ(n.y));
  scene.add(mesh);
  return { ...n, mesh, lit: false };
});

// ---------- the compiler (twin neon pop-bumper banks) ----------
const compilerGroup = new THREE.Group();
compilerGroup.position.set(toWorldX(COMPILER.x), 1.0, toWorldZ(COMPILER.y));
scene.add(compilerGroup);
const compilerRingColors = [0x6dfcff, 0xff2ad1, 0xb14bff];
const compilerBumperMeshes = COMPILER.bumpers.map((b, i) => {
  const color = compilerRingColors[i % compilerRingColors.length];
  const capMat = new THREE.MeshStandardMaterial({ color: 0x0c0818, emissive: color, emissiveIntensity: 0.55, metalness: 0.6, roughness: 0.25 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x050308, emissive: color, emissiveIntensity: 2.4, metalness: 0.4, roughness: 0.2 });
  const group = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.82, b.r * 0.82, 1.0, 16), capMat);
  group.add(cap);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(b.r * 0.82, b.r * 0.16, 10, 24), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.56;
  group.add(ring);
  group.position.set(b.dx, 0, -b.dy);
  compilerGroup.add(group);
  return group;
});

// ---------- firewall gate ----------
const firewallGroup = new THREE.Group();
scene.add(firewallGroup);
const firewallMat = new THREE.MeshStandardMaterial({ color: 0x2a0a14, emissive: 0xff2a2a, emissiveIntensity: 1.3, metalness: 0.5, roughness: 0.3 });
const firewallLeftMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 0.6), firewallMat);
const firewallRightMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 0.6), firewallMat);
firewallGroup.add(firewallLeftMesh, firewallRightMesh);
const gapIndicatorMat = new THREE.MeshBasicMaterial({ color: 0x6dfcff, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
const gapIndicator = new THREE.Mesh(new THREE.PlaneGeometry(1, 3), gapIndicatorMat);
gapIndicator.rotation.x = -Math.PI / 2;
firewallGroup.add(gapIndicator);

// ---------- warp ramp + portal ring ----------
function buildRing(color, radius, tube, position) {
  const geo = new THREE.TorusGeometry(radius, tube, 10, 28);
  const mat = new THREE.MeshStandardMaterial({ color: 0x0a0820, emissive: color, emissiveIntensity: 1.5, metalness: 0.6, roughness: 0.25 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.rotation.x = Math.PI / 2;
  scene.add(mesh);
  return mesh;
}
const portalRing = buildRing(0xff2ad1, 5.2, 0.35, new THREE.Vector3(toWorldX(PORTAL_RING.x), 9, toWorldZ(PORTAL_RING.y)));
const warpRing = buildRing(0x6dfcff, 2.6, 0.28, new THREE.Vector3(WARP_RAMP.ringWorld.x, WARP_RAMP.ringWorld.y, WARP_RAMP.ringWorld.z));

// warp lane visual marker (glowing strip on the right edge)
{
  const geo = new THREE.BoxGeometry(0.4, 0.1, WARP_RAMP.zone.yMax - WARP_RAMP.zone.yMin);
  const mat = new THREE.MeshStandardMaterial({ color: 0x0a1a22, emissive: 0x6dfcff, emissiveIntensity: 1.2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(toWorldX(WARP_RAMP.zone.xMin), 0.1, toWorldZ((WARP_RAMP.zone.yMin + WARP_RAMP.zone.yMax) / 2));
  scene.add(mesh);
}

// ---------- plunger lane visual ----------
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x0a0820, emissive: 0xfffb6d, emissiveIntensity: 0.6 });
  const geo = new THREE.BoxGeometry(0.3, 1.2, 4);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(toWorldX(PLUNGER.x), 0.6, toWorldZ(-1));
  scene.add(mesh);
}

// ---------- ball ----------
const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 20, 20);
const ballMat = new THREE.MeshStandardMaterial({
  color: 0xeafdff,
  emissive: 0x6dfcff,
  emissiveIntensity: 1.4,
  metalness: 0.7,
  roughness: 0.15,
});
const ballMesh = new THREE.Mesh(ballGeo, ballMat);
ballMesh.position.y = BALL_RADIUS;
scene.add(ballMesh);
const ballLight = new THREE.PointLight(0x6dfcff, 1.2, 10, 2);
ballMesh.add(ballLight);

// neon trail
const TRAIL_LEN = 14;
const trailMeshes = [];
for (let i = 0; i < TRAIL_LEN; i++) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS * (1 - i / (TRAIL_LEN + 4)), 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x6dfcff, transparent: true, opacity: 0.32 * (1 - i / TRAIL_LEN) })
  );
  m.visible = false;
  scene.add(m);
  trailMeshes.push(m);
}
const trailHistory = [];

// =====================================================================
// GAME STATE
// =====================================================================
const ball = { x: PLUNGER.x, y: PLUNGER.restY, vx: 0, vy: 0, radius: BALL_RADIUS, mode: 'idle', stallTime: 0 };

const GRAVITY = -30;
const game = {
  state: 'menu', // menu | ready | playing | warping | paused | gameover
  score: 0,
  balls: 3,
  litNodes: 0,
  overloadUntil: 0,
  warpMultUntil: 0,
  ghostBallReady: false,
  chainStreak: 0,
  chainStreakUntil: 0,
  firewallCooldown: 0,
  pausedFromState: null,
  plungerCharge: 0,
  charging: false,
};

function currentMultiplier() {
  const overload = performance.now() < game.overloadUntil ? 2 : 1;
  const warp = performance.now() < game.warpMultUntil ? 3 : 1;
  const chain = 1 + Math.min(game.chainStreak, 6) * 0.5;
  return overload * warp * chain;
}

function addScore(base) {
  game.score += Math.round(base * currentMultiplier());
  scoreEl.textContent = game.score.toLocaleString();
}

function resetBallToLane() {
  ball.x = PLUNGER.x;
  ball.y = PLUNGER.restY;
  ball.vx = 0;
  ball.vy = 0;
  ball.mode = 'idle';
  ball.stallTime = 0;
  game.state = 'ready';
  showOverlay(false, false);
  showHint('Hold SPACE / LAUNCH to charge the plunger, release to fire');
}

// =====================================================================
// HUD
// =====================================================================
const scoreEl = document.getElementById('score');
const ballsEl = document.getElementById('balls');
const multEl = document.getElementById('multiplier');
const nodesPipsEl = document.getElementById('nodes-pips');
const statusFlagsEl = document.getElementById('status-flags');
const bannerEl = document.getElementById('banner');
const overlayEl = document.getElementById('overlay');
const overlayMsgEl = document.getElementById('overlay-msg');
const overlayTitleEl = document.querySelector('#overlay-panel h1');
const startBtn = document.getElementById('start-btn');
const hintEl = document.getElementById('hint');
const overlayMsg = overlayMsgEl;

function showOverlay(show, isMenu) {
  overlayEl.classList.toggle('hidden', !show);
  startBtn.style.display = isMenu ? 'inline-block' : 'none';
}

function showHint(text) {
  if (!text) {
    hintEl.classList.remove('show');
    return;
  }
  hintEl.textContent = text;
  hintEl.classList.add('show');
}

function showBanner(text, ms = 1600) {
  bannerEl.textContent = text;
  bannerEl.classList.remove('show');
  // restart animation
  void bannerEl.offsetWidth;
  bannerEl.classList.add('show');
}

function updateHud() {
  ballsEl.textContent = '●'.repeat(Math.max(game.balls, 0)) + '○'.repeat(Math.max(3 - game.balls, 0));
  multEl.textContent = 'x' + currentMultiplier().toFixed(1).replace(/\.0$/, '');
  nodesPipsEl.textContent = dataNodes.map((n) => (n.lit ? '●' : '○')).join('');

  const flags = [];
  const now = performance.now();
  if (now < game.overloadUntil) flags.push(['overload', 'OVERLOAD']);
  if (now < game.warpMultUntil) flags.push(['warp', 'WARP x3']);
  if (game.ghostBallReady) flags.push(['ghost', 'GHOST BALL']);
  if (now < game.chainStreakUntil && game.chainStreak > 0) flags.push(['slowmo', `CHAIN x${game.chainStreak}`]);
  statusFlagsEl.innerHTML = flags.map(([cls, label]) => `<span class="status-pill ${cls}">${label}</span>`).join('');
}

// =====================================================================
// INPUT
// =====================================================================
const keyState = {};
window.addEventListener('keydown', (e) => {
  if (keyState[e.code]) return;
  keyState[e.code] = true;
  handleKeyDown(e.code);
});
window.addEventListener('keyup', (e) => {
  keyState[e.code] = false;
  handleKeyUp(e.code);
});

function handleKeyDown(code) {
  if (code === 'ArrowLeft' || code === 'KeyZ') leftFlipper.pressed = true;
  if (code === 'ArrowRight' || code === 'Slash') rightFlipper.pressed = true;
  if (code === 'KeyX') midFlipper.pressed = true;
  if (code === 'Space') {
    if (game.state === 'ready') {
      game.charging = true;
      game.plungerCharge = 0;
    } else if (game.state === 'menu' || game.state === 'gameover') {
      startGame();
    }
  }
  if (code === 'KeyP') togglePause();
}
function handleKeyUp(code) {
  if (code === 'ArrowLeft' || code === 'KeyZ') leftFlipper.pressed = false;
  if (code === 'ArrowRight' || code === 'Slash') rightFlipper.pressed = false;
  if (code === 'KeyX') midFlipper.pressed = false;
  if (code === 'Space' && game.state === 'ready' && game.charging) {
    launchBall();
  }
}

function launchBall() {
  game.charging = false;
  const t = clamp(game.plungerCharge / 900, 0, 1);
  const power = PLUNGER.minPower + (PLUNGER.maxPower - PLUNGER.minPower) * t;
  ball.vy = power;
  ball.vx = (Math.random() - 0.5) * 0.6;
  ball.mode = 'live';
  game.state = 'playing';
  showHint(null);
}

function togglePause() {
  if (game.state === 'paused') {
    game.state = game.pausedFromState;
    showHint(game.state === 'ready' ? 'Hold SPACE / LAUNCH to charge the plunger, release to fire' : null);
  } else if (game.state === 'playing' || game.state === 'ready') {
    game.pausedFromState = game.state;
    game.state = 'paused';
    showHint('PAUSED — press P to resume');
  }
}

startBtn.addEventListener('click', () => startGame());

// touch controls
function bindTouch(id, onDown, onUp) {
  const el = document.getElementById(id);
  const down = (e) => { e.preventDefault(); onDown(); };
  const up = (e) => { e.preventDefault(); onUp(); };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}
bindTouch('t-left', () => (leftFlipper.pressed = true), () => (leftFlipper.pressed = false));
bindTouch('t-right', () => (rightFlipper.pressed = true), () => (rightFlipper.pressed = false));
bindTouch(
  't-launch',
  () => {
    if (game.state === 'ready') {
      game.charging = true;
      game.plungerCharge = 0;
    } else if (game.state === 'menu' || game.state === 'gameover') {
      startGame();
    }
  },
  () => {
    if (game.state === 'ready' && game.charging) launchBall();
  }
);

function startGame() {
  overlayTitleEl.textContent = 'NEON RIFT PINBALL';
  overlayMsg.textContent = 'Press SPACE / tap LAUNCH to drop the ball';
  game.score = 0;
  game.balls = 3;
  game.litNodes = 0;
  game.overloadUntil = 0;
  game.warpMultUntil = 0;
  game.ghostBallReady = false;
  game.chainStreak = 0;
  game.chainStreakUntil = 0;
  for (const n of dataNodes) {
    n.lit = false;
    n.mesh.material = nodeMat(false);
  }
  scoreEl.textContent = '0';
  resetBallToLane();
}

// =====================================================================
// PHYSICS STEP
// =====================================================================
function stepPhysics(dt) {
  leftFlipper.update(dt);
  rightFlipper.update(dt);
  midFlipper.update(dt);

  if (ball.mode !== 'live') return;

  ball.vy += GRAVITY * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // speed cap to keep collisions stable
  const speed = len(ball.vx, ball.vy);
  const MAX_SPEED = 75;
  if (speed > MAX_SPEED) {
    ball.vx = (ball.vx / speed) * MAX_SPEED;
    ball.vy = (ball.vy / speed) * MAX_SPEED;
  }

  for (const s of boundarySegs) {
    collideBallSegment(ball, s.a[0], s.a[1], s.b[0], s.b[1], s.r, s.restitution);
  }

  leftFlipper.collide(ball, 0.55);
  rightFlipper.collide(ball, 0.55);
  midFlipper.collide(ball, 0.55);

  // anti-stall: the two main flippers' rest-position capsules overlap slightly
  // across the centerline, so an abandoned ball can settle motionless right on
  // that seam, sealed off from both the drain and the field. If nobody is
  // flipping and the ball goes dead for a few seconds, route it through the
  // normal drain check below rather than let the game appear frozen forever.
  const anyFlipperPressed = leftFlipper.pressed || rightFlipper.pressed || midFlipper.pressed;
  if (!anyFlipperPressed && len(ball.vx, ball.vy) < 1.2) {
    ball.stallTime += dt;
    if (ball.stallTime > 2.5) {
      ball.stallTime = 0;
      ball.y = -3;
    }
  } else {
    ball.stallTime = 0;
  }

  // compiler bumper banks (static twin clusters)
  let compilerHit = false;
  for (const b of COMPILER.bumpers) {
    const cx = COMPILER.x + b.dx;
    const cy = COMPILER.y + b.dy;
    if (collideBallCircle(ball, cx, cy, b.r, COMPILER.restitution)) compilerHit = true;
  }
  if (compilerHit) onCompilerHit();

  // data nodes
  for (const n of dataNodes) {
    if (collideBallCircle(ball, n.x, n.y, n.r, 0.65)) onDataNodeHit(n);
  }

  // firewall gate
  handleFirewall(dt);

  // warp ramp zone
  handleWarpRamp();

  // drain check
  if (ball.y < -2.4) {
    onDrain();
  }
}

function onCompilerHit() {
  addScore(150);
  const now = performance.now();
  if (now < game.chainStreakUntil) {
    game.chainStreak = Math.min(game.chainStreak + 1, 6);
  } else {
    game.chainStreak = 1;
  }
  game.chainStreakUntil = now + 1300;
  if (game.chainStreak === 3) {
    grantSlowMo();
  }
}

function onDataNodeHit(node) {
  if (node.lit) {
    addScore(100);
    return;
  }
  node.lit = true;
  node.mesh.material = nodeMat(true);
  addScore(1000);
  game.litNodes++;
  if (game.litNodes >= dataNodes.length) {
    triggerOverload();
  }
}

function triggerOverload() {
  game.overloadUntil = performance.now() + 20000;
  game.ghostBallReady = true;
  showBanner('OVERLOAD MODE!');
  setTimeout(() => {
    for (const n of dataNodes) {
      n.lit = false;
      n.mesh.material = nodeMat(false);
    }
    game.litNodes = 0;
  }, 1200);
}

let slowMoUntil = 0;
function grantSlowMo() {
  slowMoUntil = performance.now() + 3500;
  showBanner('SLOW-MO PULSE');
}

function handleFirewall(dt) {
  game.firewallCooldown = Math.max(0, game.firewallCooldown - dt);
  const t = performance.now() / 1000;
  const gateCenterX = Math.sin((t / FIREWALL.periodSec) * Math.PI * 2) * FIREWALL.slideRange;
  const gapMin = gateCenterX - FIREWALL.gapHalfWidth;
  const gapMax = gateCenterX + FIREWALL.gapHalfWidth;

  const inGap = ball.x > gapMin && ball.x < gapMax;
  const nearLine = Math.abs(ball.y - FIREWALL.y) < 0.6;

  if (nearLine && inGap && ball.vy > 0 && game.firewallCooldown <= 0) {
    addScore(5000);
    game.firewallCooldown = 1.2;
    showBanner('FIREWALL JACKPOT!');
  } else if (nearLine && !inGap) {
    // solid portion: collide as two segments
    if (ball.x <= gapMin) {
      collideBallSegment(ball, -FIREWALL.halfSpan, FIREWALL.y, gapMin, FIREWALL.y, FIREWALL.wallR, FIREWALL.restitution);
    } else {
      collideBallSegment(ball, gapMax, FIREWALL.y, FIREWALL.halfSpan, FIREWALL.y, FIREWALL.wallR, FIREWALL.restitution);
    }
  }

  // update visuals
  firewallLeftMesh.scale.x = Math.max((gapMin - -FIREWALL.halfSpan), 0.1);
  firewallLeftMesh.position.set(toWorldX((-FIREWALL.halfSpan + gapMin) / 2), 1.1, toWorldZ(FIREWALL.y));
  firewallRightMesh.scale.x = Math.max((FIREWALL.halfSpan - gapMax), 0.1);
  firewallRightMesh.position.set(toWorldX((gapMax + FIREWALL.halfSpan) / 2), 1.1, toWorldZ(FIREWALL.y));
  gapIndicator.scale.x = FIREWALL.gapHalfWidth * 2;
  gapIndicator.position.set(toWorldX(gateCenterX), 0.05, toWorldZ(FIREWALL.y));
}

let warping = false;
let warpStartTime = 0;
const WARP_DURATION = 1000;
function handleWarpRamp() {
  if (warping) return;
  const z = WARP_RAMP.zone;
  if (ball.x > z.xMin && ball.x < z.xMax && ball.y > z.yMin && ball.y < z.yMax) {
    const speed = len(ball.vx, ball.vy);
    if (speed > WARP_RAMP.minSpeed && (!WARP_RAMP.requireAscending || ball.vy > 0)) {
      startWarp();
    }
  }
}

function startWarp() {
  warping = true;
  warpStartTime = performance.now();
  ball.mode = 'warping';
  addScore(3000);
  showBanner('WARP RAMP — 3x MULTIPLIER');
}

function updateWarp() {
  if (!warping) return;
  const t = clamp((performance.now() - warpStartTime) / WARP_DURATION, 0, 1);
  // scripted loop near the ring, purely cosmetic, then drop back into the field
  const loopX = WARP_RAMP.ringWorld.x + Math.sin(t * Math.PI * 2) * 1.4;
  const loopY = 36 + t * 8;
  ballMesh.position.set(loopX, 4 + Math.sin(t * Math.PI) * 4, toWorldZ(loopY));
  if (t >= 1) {
    warping = false;
    ball.mode = 'live';
    ball.x = WARP_RAMP.zone.xMin - 1.5;
    ball.y = 40;
    ball.vx = -(Math.random() * 3 + 2);
    ball.vy = -16;
    game.warpMultUntil = performance.now() + 15000;
  }
}

function onDrain() {
  if (game.ghostBallReady) {
    game.ghostBallReady = false;
    ball.y = 6;
    ball.vy = Math.abs(ball.vy) * 0.6 + 14;
    showBanner('GHOST BALL SAVE');
    return;
  }
  game.balls--;
  ball.mode = 'idle';
  if (game.balls <= 0) {
    game.state = 'gameover';
    showHint(null);
    overlayTitleEl.textContent = 'GAME OVER';
    overlayMsg.textContent = `Final score ${game.score.toLocaleString()} — press SPACE / START to play again`;
    showOverlay(true, true);
  } else {
    showBanner(`BALL ${3 - game.balls + 1}`, 1200);
    resetBallToLane();
  }
}

// =====================================================================
// RENDER / MAIN LOOP
// =====================================================================
function syncVisuals() {
  if (!warping) {
    ballMesh.position.set(toWorldX(ball.x), BALL_RADIUS, toWorldZ(ball.y));
  }

  updateFlipperVisual(leftFlipper, leftFlipperMesh);
  updateFlipperVisual(rightFlipper, rightFlipperMesh);
  updateFlipperVisual(midFlipper, midFlipperMesh);

  portalRing.rotation.z += 0.004;
  warpRing.rotation.z -= 0.01;
  starfield.rotation.y += 0.0006;

  // trail
  if (ball.mode === 'live') {
    trailHistory.unshift({ x: ballMesh.position.x, y: ballMesh.position.y, z: ballMesh.position.z });
    if (trailHistory.length > TRAIL_LEN) trailHistory.pop();
  } else {
    trailHistory.length = 0;
  }
  for (let i = 0; i < TRAIL_LEN; i++) {
    const p = trailHistory[i];
    if (p) {
      trailMeshes[i].visible = true;
      trailMeshes[i].position.set(p.x, p.y, p.z);
    } else {
      trailMeshes[i].visible = false;
    }
  }

  updateHud();
}

let lastTime = performance.now();
let accumulator = 0;
const FIXED_DT = 1 / 120;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  dt = Math.min(dt, 0.05);

  if (game.charging) {
    game.plungerCharge += dt * 1000;
  }

  if (game.state === 'playing' || game.state === 'ready') {
    // flippers stay live (and the lane ball stays put via ball.mode) even before launch
    const timeScale = performance.now() < slowMoUntil ? 0.4 : 1;
    accumulator += dt * timeScale;
    while (accumulator >= FIXED_DT) {
      stepPhysics(FIXED_DT);
      accumulator -= FIXED_DT;
    }
    updateWarp();
  }

  syncVisuals();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// kick off in menu state
showOverlay(true, true);
