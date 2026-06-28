import * as THREE from './vendor/three/three.module.min.js';
import { Flipper, collideBallSegment, collideBallCircle, clamp, len } from './physics.js';
import { Sfx, unlockAudio, toggleMute, isMuted, startMusic } from './audio.js';
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
  ROLLOVERS,
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
const CAM_BASE = new THREE.Vector3(0, 34, 26);
const CAM_LOOK = new THREE.Vector3(0, 2, toWorldZ(26));
const camOffset = new THREE.Vector3(); // smoothed pan toward the live ball
let shakeAmt = 0; // decaying screen-shake magnitude
function addShake(amt) {
  shakeAmt = Math.min(Math.max(shakeAmt, amt), 1.6);
}
function placeCamera() {
  camera.position.copy(CAM_BASE);
  camera.lookAt(CAM_LOOK);
}
function updateCamera() {
  const b = primaryBall();
  let tx = 0;
  let tz = 0;
  if (b && b.mode === 'live') {
    tx = clamp(b.x * 0.22, -5, 5);
    tz = clamp((b.y - 22) * -0.07, -3, 3);
  }
  camOffset.x += (tx - camOffset.x) * 0.05;
  camOffset.z += (tz - camOffset.z) * 0.05;
  const sx = (Math.random() * 2 - 1) * shakeAmt;
  const sy = (Math.random() * 2 - 1) * shakeAmt;
  camera.position.set(CAM_BASE.x + camOffset.x + sx, CAM_BASE.y + sy, CAM_BASE.z + camOffset.z);
  camera.lookAt(CAM_LOOK.x + camOffset.x * 0.4, CAM_LOOK.y, CAM_LOOK.z);
  shakeAmt *= 0.85;
  if (shakeAmt < 0.01) shakeAmt = 0;
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
// Level colors: bumpers brighten / shift hue as they level up (x1 -> x2 -> x3).
const compilerLevelColors = [0x6dfcff, 0xffb14b, 0xff2ad1];
const compilerBumpers = COMPILER.bumpers.map((b) => {
  const capMat = new THREE.MeshStandardMaterial({ color: 0x0c0818, emissive: compilerLevelColors[0], emissiveIntensity: 0.55, metalness: 0.6, roughness: 0.25 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x050308, emissive: compilerLevelColors[0], emissiveIntensity: 2.4, metalness: 0.4, roughness: 0.2 });
  const group = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.82, b.r * 0.82, 1.0, 16), capMat);
  group.add(cap);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(b.r * 0.82, b.r * 0.16, 10, 24), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.56;
  group.add(ring);
  group.position.set(b.dx, 0, -b.dy);
  compilerGroup.add(group);
  // progressive-value state: hits accumulate to raise the bumper's level (1..3)
  return { group, cap, ring, capMat, ringMat, hits: 0, level: 1, pulse: 0 };
});

function bumperLevelFor(hits) {
  return Math.min(3, 1 + Math.floor(hits / 6));
}

function applyBumperLevel(bm) {
  const color = compilerLevelColors[bm.level - 1];
  bm.capMat.emissive.setHex(color);
  bm.ringMat.emissive.setHex(color);
  bm.capMat.emissiveIntensity = 0.55 + (bm.level - 1) * 0.5;
  bm.ringMat.emissiveIntensity = 2.4 + (bm.level - 1) * 1.2;
}

// ---------- top rollover lanes (R-I-F-T) ----------
const rolloverMeshes = ROLLOVERS.lanes.map((lane) => {
  const group = new THREE.Group();
  // flat lane gate marker lying on the playfield
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x07121c, emissive: 0x6dfcff, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.3 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.13, 8, 22), ringMat);
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);
  // a little wire arch the ball rolls under
  const archMat = new THREE.MeshStandardMaterial({ color: 0x0a1822, emissive: 0x6dfcff, emissiveIntensity: 0.5, metalness: 0.5, roughness: 0.25 });
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 8, 22, Math.PI), archMat);
  arch.position.y = 0.05;
  group.add(arch);
  group.position.set(toWorldX(lane.x), 0.12, toWorldZ(ROLLOVERS.y));
  scene.add(group);
  return { ringMat, archMat };
});
const rolloverLit = ROLLOVERS.lanes.map(() => false);
let riftLevel = 1;

function setRolloverGlow(i, lit) {
  const m = rolloverMeshes[i];
  const intensity = lit ? 2.6 : 0.5;
  m.ringMat.emissiveIntensity = intensity;
  m.archMat.emissiveIntensity = intensity;
  m.ringMat.emissive.setHex(lit ? 0xfffb6d : 0x6dfcff);
  m.archMat.emissive.setHex(lit ? 0xfffb6d : 0x6dfcff);
}

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

// ---------- central lightning rift (scoring lane down the middle) ----------
const RIFT = { yMin: 6, yMax: 44, minSpeed: 12 };
const riftMat = new THREE.MeshStandardMaterial({
  color: 0x1a0633,
  emissive: 0xb14bff,
  emissiveIntensity: 1.4,
  metalness: 0.4,
  roughness: 0.3,
  transparent: true,
  opacity: 0.85,
});
const riftMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.12, RIFT.yMax - RIFT.yMin),
  riftMat
);
riftMesh.position.set(0, 0.12, toWorldZ((RIFT.yMin + RIFT.yMax) / 2));
scene.add(riftMesh);
const riftLight = new THREE.PointLight(0xb14bff, 0.8, 30, 2);
riftLight.position.set(0, 3, toWorldZ((RIFT.yMin + RIFT.yMax) / 2));
scene.add(riftLight);

// ---------- ball pool (supports multiball) ----------
const MAX_BALLS = 3;
const TRAIL_LEN = 14;
const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 20, 20);
const ballMat = new THREE.MeshStandardMaterial({
  color: 0xeafdff,
  emissive: 0x6dfcff,
  emissiveIntensity: 1.4,
  metalness: 0.7,
  roughness: 0.15,
});

function createBall() {
  const mesh = new THREE.Mesh(ballGeo, ballMat);
  mesh.position.y = BALL_RADIUS;
  mesh.visible = false;
  scene.add(mesh);
  const light = new THREE.PointLight(0x6dfcff, 1.0, 9, 2);
  mesh.add(light);
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
  return {
    x: PLUNGER.x, y: PLUNGER.restY, vx: 0, vy: 0, radius: BALL_RADIUS,
    mode: 'idle', stallTime: 0, warpStart: 0, lastX: PLUNGER.x, riftCd: 0,
    active: false, mesh, light, trailMeshes, trailHistory: [],
  };
}
const ballPool = Array.from({ length: MAX_BALLS }, createBall);
let balls = []; // currently-active balls in play

function spawnBall(x, y, vx, vy, mode = 'live') {
  const b = ballPool.find((p) => !p.active);
  if (!b) return null;
  b.x = x; b.y = y; b.vx = vx; b.vy = vy;
  b.mode = mode; b.stallTime = 0; b.warpStart = 0; b.lastX = x; b.riftCd = 0;
  b.active = true;
  b.mesh.visible = true;
  b.trailHistory.length = 0;
  balls.push(b);
  return b;
}

function despawnBall(b) {
  b.active = false;
  b.mode = 'idle';
  b.mesh.visible = false;
  b.trailHistory.length = 0;
  for (const tm of b.trailMeshes) tm.visible = false;
  const i = balls.indexOf(b);
  if (i >= 0) balls.splice(i, 1);
}

function clearBalls() {
  for (const b of [...balls]) despawnBall(b);
}

function primaryBall() {
  return balls.find((b) => b.mode === 'live') || balls[0] || null;
}

// ---------- particle burst pool ----------
const PARTICLE_COUNT = 96;
const particleGeo = new THREE.SphereGeometry(0.16, 6, 6);
const particles = Array.from({ length: PARTICLE_COUNT }, () => {
  const mesh = new THREE.Mesh(
    particleGeo,
    new THREE.MeshBasicMaterial({ color: 0x6dfcff, transparent: true, opacity: 1 })
  );
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, active: false };
});

function emitBurst(wx, wy, wz, colorHex, count = 12, speed = 9) {
  for (let i = 0; i < count; i++) {
    const p = particles.find((q) => !q.active);
    if (!p) return;
    p.active = true;
    p.mesh.visible = true;
    p.mesh.material.color.setHex(colorHex);
    p.mesh.material.opacity = 1;
    p.mesh.scale.setScalar(1);
    p.mesh.position.set(wx, wy, wz);
    const ang = Math.random() * Math.PI * 2;
    const sp = speed * (0.4 + Math.random() * 0.6);
    p.vx = Math.cos(ang) * sp;
    p.vz = Math.sin(ang) * sp;
    p.vy = 3 + Math.random() * speed * 0.7;
    p.maxLife = 0.45 + Math.random() * 0.35;
    p.life = p.maxLife;
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      p.mesh.visible = false;
      continue;
    }
    p.vy -= 22 * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    const f = p.life / p.maxLife;
    p.mesh.material.opacity = f;
    p.mesh.scale.setScalar(0.3 + f * 0.7);
  }
}

// world position helper for table-space (x, y)
function worldBurst(tx, ty, colorHex, count, speed) {
  emitBurst(toWorldX(tx), 1.2, toWorldZ(ty), colorHex, count, speed);
}

// short haptic pulse on mobile, guarded for support
function buzz(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// =====================================================================
// GAME STATE
// =====================================================================
const GRAVITY = -30;
const game = {
  state: 'menu', // menu | ready | playing | paused | gameover
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
  // new mechanics
  ballSaveUntil: 0,
  tiltMeter: 0,
  tiltedUntil: 0,
  missionIndex: 0,
  compilerMissionHits: 0,
  firstNodeTime: 0,
  isNewHighScore: false,
};

const BALL_SAVE_MS = 6000;

// ---------- progressive missions ----------
const MISSIONS = [
  { type: 'nodes', text: 'Light all 5 Data Nodes', bonus: 4000 },
  { type: 'compiler', text: 'Hit the Compiler x5', bonus: 5000 },
  { type: 'firewall', text: 'Breach the Firewall gate', bonus: 8000 },
  { type: 'warp', text: 'Enter the Warp Rift', bonus: 10000 },
];

function currentMission() {
  return MISSIONS[game.missionIndex % MISSIONS.length];
}

function completeMission(type) {
  if (game.state !== 'playing') return;
  if (currentMission().type !== type) return;
  const m = currentMission();
  addScore(m.bonus);
  showBanner(`MISSION COMPLETE +${m.bonus.toLocaleString()}`);
  Sfx.mission();
  game.missionIndex++;
  game.compilerMissionHits = 0;
  updateMissionHud();
}

function updateMissionHud() {
  if (missionTextEl) missionTextEl.textContent = currentMission().text;
}

function isTilted() {
  return performance.now() < game.tiltedUntil;
}

// ---------- high scores (localStorage top-5) ----------
const HS_KEY = 'neonRiftHighScores';
function loadHighScores() {
  try {
    const raw = localStorage.getItem(HS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((n) => Number.isFinite(n)).slice(0, 5) : [];
  } catch (e) {
    return [];
  }
}
function saveHighScore(score) {
  const list = loadHighScores();
  const isNew = list.length < 5 || score > list[list.length - 1];
  list.push(score);
  list.sort((a, b) => b - a);
  const top = list.slice(0, 5);
  try {
    localStorage.setItem(HS_KEY, JSON.stringify(top));
  } catch (e) {}
  return isNew && score > 0;
}
function renderHighScores(highlightScore) {
  if (!hsListEl) return;
  const list = loadHighScores();
  if (list.length === 0) {
    hsListEl.innerHTML = '<li><span class="hs-rank">—</span><span>no scores yet</span></li>';
    return;
  }
  let highlighted = false;
  hsListEl.innerHTML = list
    .map((s, i) => {
      const mine = !highlighted && s === highlightScore;
      if (mine) highlighted = true;
      return `<li class="${mine ? 'you' : ''}"><span class="hs-rank">${i + 1}</span><span>${s.toLocaleString()}</span></li>`;
    })
    .join('');
}

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

let laneBall = null;
function resetBallToLane() {
  clearBalls();
  laneBall = spawnBall(PLUNGER.x, PLUNGER.restY, 0, 0, 'idle');
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
const missionTextEl = document.getElementById('mission-text');
const lanesPipsEl = document.getElementById('lanes-pips');
const hsListEl = document.getElementById('hs-list');
const muteBtn = document.getElementById('mute-btn');

function updateLanesHud() {
  if (!lanesPipsEl) return;
  lanesPipsEl.innerHTML = ROLLOVERS.lanes
    .map((lane, i) => `<span class="${rolloverLit[i] ? 'lane-on' : 'lane-off'}">${lane.letter}</span>`)
    .join(' ');
}

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
  if (isTilted()) flags.push(['overload', 'TILT!']);
  if (balls.length > 1) flags.push(['warp', `MULTIBALL x${balls.length}`]);
  if (now < game.ballSaveUntil && game.state === 'playing') flags.push(['slowmo', 'BALL SAVE']);
  if (now < game.overloadUntil) flags.push(['overload', 'OVERLOAD']);
  if (now < game.warpMultUntil) flags.push(['warp', 'WARP x3']);
  if (game.ghostBallReady) flags.push(['ghost', 'GHOST BALL']);
  if (now < game.chainStreakUntil && game.chainStreak > 0) flags.push(['slowmo', `CHAIN x${game.chainStreak}`]);
  statusFlagsEl.innerHTML = flags.map(([cls, label]) => `<span class="status-pill ${cls}">${label}</span>`).join('');
}

// =====================================================================
// INPUT
// =====================================================================
let musicStarted = false;
function ensureAudio() {
  unlockAudio();
  if (!musicStarted) {
    startMusic();
    musicStarted = true;
  }
}

function pressFlipper(f) {
  if (isTilted()) return;
  f.pressed = true;
  Sfx.flipperPress();
}

// nudge the table: impulse to live balls + screen shake, building toward a TILT
function nudge(dir) {
  if (game.state !== 'playing' && game.state !== 'ready') return;
  if (isTilted()) return;
  for (const b of balls) {
    if (b.mode === 'live') {
      b.vx += dir * 7;
      b.vy += 2.2;
    }
  }
  addShake(0.35);
  buzz(12);
  Sfx.uiClick();
  game.tiltMeter += 0.34;
  if (game.tiltMeter >= 1) triggerTilt();
}

function triggerTilt() {
  game.tiltedUntil = performance.now() + 2500;
  game.tiltMeter = 0;
  leftFlipper.pressed = false;
  rightFlipper.pressed = false;
  midFlipper.pressed = false;
  showBanner('TILT!');
  Sfx.tilt();
  addShake(0.8);
  buzz(120);
}

const keyState = {};
window.addEventListener('keydown', (e) => {
  ensureAudio();
  if (keyState[e.code]) return;
  keyState[e.code] = true;
  handleKeyDown(e.code);
});
window.addEventListener('keyup', (e) => {
  keyState[e.code] = false;
  handleKeyUp(e.code);
});

function handleKeyDown(code) {
  if (code === 'ArrowLeft' || code === 'KeyZ') pressFlipper(leftFlipper);
  if (code === 'ArrowRight' || code === 'Slash') pressFlipper(rightFlipper);
  if (code === 'KeyX') pressFlipper(midFlipper);
  if (code === 'KeyC') nudge(-1);
  if (code === 'KeyM') nudge(1);
  if (code === 'KeyS') setMute(toggleMute());
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

function setMute(muted) {
  muteBtn.classList.toggle('muted', muted);
  muteBtn.textContent = muted ? '✕' : '♪';
}
muteBtn.addEventListener('click', () => {
  ensureAudio();
  setMute(toggleMute());
});

function launchBall() {
  game.charging = false;
  if (!laneBall || !laneBall.active) return;
  const t = clamp(game.plungerCharge / 900, 0, 1);
  const power = PLUNGER.minPower + (PLUNGER.maxPower - PLUNGER.minPower) * t;
  laneBall.vy = power;
  laneBall.vx = (Math.random() - 0.5) * 0.6;
  laneBall.mode = 'live';
  game.state = 'playing';
  game.ballSaveUntil = performance.now() + BALL_SAVE_MS;
  showHint(null);
  Sfx.launch();
  // skill shot: a perfectly-judged plunge in the sweet-spot band
  if (t >= 0.8 && t <= 0.95) {
    addScore(5000);
    showBanner('SKILL SHOT! +5,000');
    Sfx.skillShot();
  }
  laneBall = null;
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
  Sfx.uiClick();
}

startBtn.addEventListener('click', () => {
  ensureAudio();
  Sfx.uiClick();
  startGame();
});

// touch controls
function bindTouch(id, onDown, onUp) {
  const el = document.getElementById(id);
  const down = (e) => { e.preventDefault(); ensureAudio(); onDown(); };
  const up = (e) => { e.preventDefault(); onUp(); };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}
bindTouch('t-left', () => pressFlipper(leftFlipper), () => (leftFlipper.pressed = false));
bindTouch('t-right', () => pressFlipper(rightFlipper), () => (rightFlipper.pressed = false));
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
  game.ballSaveUntil = 0;
  game.tiltMeter = 0;
  game.tiltedUntil = 0;
  game.missionIndex = 0;
  game.compilerMissionHits = 0;
  game.firstNodeTime = 0;
  game.isNewHighScore = false;
  for (const n of dataNodes) {
    n.lit = false;
    n.mesh.material = nodeMat(false);
  }
  // reset rollover lanes
  riftLevel = 1;
  for (let i = 0; i < rolloverLit.length; i++) {
    rolloverLit[i] = false;
    setRolloverGlow(i, false);
  }
  // reset progressive bumper levels
  for (const bm of compilerBumpers) {
    bm.hits = 0;
    bm.level = 1;
    bm.pulse = 0;
    bm.group.scale.setScalar(1);
    applyBumperLevel(bm);
  }
  scoreEl.textContent = '0';
  updateMissionHud();
  updateLanesHud();
  resetBallToLane();
}

// =====================================================================
// PHYSICS STEP
// =====================================================================
function stepPhysics(dt) {
  leftFlipper.update(dt);
  rightFlipper.update(dt);
  midFlipper.update(dt);

  updateFirewallState(dt);

  const anyFlipperPressed = leftFlipper.pressed || rightFlipper.pressed || midFlipper.pressed;

  // iterate a snapshot since draining despawns balls mid-loop
  for (const b of [...balls]) {
    if (b.mode !== 'live') continue;
    stepOneBall(b, dt, anyFlipperPressed);
  }
}

function stepOneBall(b, dt, anyFlipperPressed) {
  b.vy += GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // speed cap to keep collisions stable
  const speed = len(b.vx, b.vy);
  const MAX_SPEED = 75;
  if (speed > MAX_SPEED) {
    b.vx = (b.vx / speed) * MAX_SPEED;
    b.vy = (b.vy / speed) * MAX_SPEED;
  }

  for (const s of boundarySegs) {
    if (collideBallSegment(b, s.a[0], s.a[1], s.b[0], s.b[1], s.r, s.restitution)) Sfx.wall();
  }

  if (leftFlipper.collide(b, 0.55)) { Sfx.flipperHit(); buzz(12); }
  if (rightFlipper.collide(b, 0.55)) { Sfx.flipperHit(); buzz(12); }
  if (midFlipper.collide(b, 0.55)) { Sfx.flipperHit(); buzz(12); }

  // anti-stall: the two main flippers' rest-position capsules overlap slightly
  // across the centerline, so an abandoned ball can settle motionless right on
  // that seam, sealed off from both the drain and the field. If nobody is
  // flipping and the ball goes dead for a few seconds, route it through the
  // normal drain check below rather than let the game appear frozen forever.
  if (!anyFlipperPressed && len(b.vx, b.vy) < 1.2) {
    b.stallTime += dt;
    if (b.stallTime > 2.5) {
      b.stallTime = 0;
      b.y = -3;
    }
  } else {
    b.stallTime = 0;
  }

  // compiler bumper banks (static twin clusters, progressive value)
  for (let i = 0; i < COMPILER.bumpers.length; i++) {
    const bm = COMPILER.bumpers[i];
    const cx = COMPILER.x + bm.dx;
    const cy = COMPILER.y + bm.dy;
    if (collideBallCircle(b, cx, cy, bm.r, COMPILER.restitution)) {
      onCompilerHit(i);
      worldBurst(cx, cy, compilerLevelColors[compilerBumpers[i].level - 1], 8, 8);
      Sfx.bumper();
      addShake(0.22);
      buzz(18);
      break; // one bumper interaction per ball per step
    }
  }

  // data nodes
  for (const n of dataNodes) {
    if (collideBallCircle(b, n.x, n.y, n.r, 0.65)) onDataNodeHit(n);
  }

  // top rollover lanes (R-I-F-T): rolling over an unlit lane lights its letter
  for (let i = 0; i < ROLLOVERS.lanes.length; i++) {
    if (rolloverLit[i]) continue;
    const lane = ROLLOVERS.lanes[i];
    const dx = b.x - lane.x;
    const dy = b.y - ROLLOVERS.y;
    if (dx * dx + dy * dy < ROLLOVERS.triggerR * ROLLOVERS.triggerR) {
      lightRollover(i);
    }
  }

  // central rift scoring lane: reward crossing the centerline at speed
  b.riftCd = Math.max(0, b.riftCd - dt);
  if (b.riftCd <= 0 && b.lastX * b.x < 0 && b.y > RIFT.yMin && b.y < RIFT.yMax) {
    if (len(b.vx, b.vy) > RIFT.minSpeed) {
      addScore(500);
      Sfx.rift();
      worldBurst(0, b.y, 0xb14bff, 6, 7);
      b.riftCd = 0.4;
    }
  }
  b.lastX = b.x;

  // firewall gate collision (gap state already advanced this step)
  collideFirewall(b);

  // warp ramp zone
  handleWarpRamp(b);

  // drain check
  if (b.y < -2.4) {
    onDrain(b);
  }
}

function onCompilerHit(i) {
  const bm = compilerBumpers[i];
  bm.hits++;
  const newLevel = bumperLevelFor(bm.hits);
  if (newLevel !== bm.level) {
    bm.level = newLevel;
    applyBumperLevel(bm);
    showBanner(`BUMPER LEVEL ${bm.level}!`, 800);
  }
  bm.pulse = 1; // visual kick, decayed in syncVisuals
  // progressive value: a leveled bumper is worth more
  addScore(150 * bm.level);

  const now = performance.now();
  if (now < game.chainStreakUntil) {
    game.chainStreak = Math.min(game.chainStreak + 1, 6);
  } else {
    game.chainStreak = 1;
  }
  game.chainStreakUntil = now + 1300;
  if (game.chainStreak >= 2) {
    showBanner(`COMBO x${game.chainStreak}!`, 900);
  }
  if (game.chainStreak === 3) {
    grantSlowMo();
  }
  // mission progress: hit the compiler five times
  game.compilerMissionHits++;
  if (game.compilerMissionHits >= 5) completeMission('compiler');
}

function lightRollover(i) {
  rolloverLit[i] = true;
  setRolloverGlow(i, true);
  addScore(250);
  Sfx.dataNodeRepeat();
  updateLanesHud();
  if (rolloverLit.every(Boolean)) completeRiftLanes();
}

function completeRiftLanes() {
  const bonus = 5000 * riftLevel;
  addScore(bonus);
  game.balls++; // extra ball reward
  showBanner(`RIFT LANES! EXTRA BALL +${bonus.toLocaleString()}`);
  Sfx.skillShot();
  addShake(0.5);
  worldBurst(0, ROLLOVERS.y, 0xfffb6d, 18, 12);
  riftLevel++;
  for (let i = 0; i < rolloverLit.length; i++) {
    rolloverLit[i] = false;
    setRolloverGlow(i, false);
  }
  updateLanesHud();
}

function onDataNodeHit(node) {
  if (node.lit) {
    addScore(100);
    Sfx.dataNodeRepeat();
    return;
  }
  node.lit = true;
  node.mesh.material = nodeMat(true);
  addScore(1000);
  Sfx.dataNode();
  worldBurst(node.x, node.y, 0xfffb6d, 7, 7);
  if (game.litNodes === 0) game.firstNodeTime = performance.now();
  game.litNodes++;
  if (game.litNodes >= dataNodes.length) {
    // fast clear bonus: all nodes lit within 8 seconds
    if (performance.now() - game.firstNodeTime < 8000) {
      addScore(3000);
      showBanner('NODE RUSH! +3,000');
    }
    completeMission('nodes');
    triggerOverload();
  }
}

function triggerOverload() {
  game.overloadUntil = performance.now() + 20000;
  game.ghostBallReady = true;
  showBanner('OVERLOAD MODE!');
  Sfx.overload();
  addShake(0.5);
  startMultiball();
  setTimeout(() => {
    for (const n of dataNodes) {
      n.lit = false;
      n.mesh.material = nodeMat(false);
    }
    game.litNodes = 0;
  }, 1200);
}

// Spawn extra balls from the compiler area, up to MAX_BALLS, for a multiball frenzy.
function startMultiball() {
  if (balls.length > 1) return; // already in multiball
  const origin = primaryBall() || balls[0];
  const ox = origin ? origin.x : COMPILER.x;
  const oy = origin ? origin.y : COMPILER.y;
  let spawned = 0;
  while (balls.length < MAX_BALLS) {
    const ang = Math.random() * Math.PI - Math.PI / 2; // upward-ish fan
    const sp = 16 + Math.random() * 8;
    if (!spawnBall(ox, oy, Math.sin(ang) * sp, Math.cos(ang) * sp + 6, 'live')) break;
    spawned++;
  }
  if (spawned > 0) {
    showBanner('MULTIBALL!');
    Sfx.multiball();
    worldBurst(ox, oy, 0x6dfcff, 16, 12);
  }
}

let slowMoUntil = 0;
function grantSlowMo() {
  slowMoUntil = performance.now() + 3500;
  showBanner('SLOW-MO PULSE');
  Sfx.slowMo();
}

// Advance the firewall gate position/cooldown and its visuals once per step.
const firewallGap = { min: 0, max: 0, center: 0 };
function updateFirewallState(dt) {
  game.firewallCooldown = Math.max(0, game.firewallCooldown - dt);
  const t = performance.now() / 1000;
  const gateCenterX = Math.sin((t / FIREWALL.periodSec) * Math.PI * 2) * FIREWALL.slideRange;
  firewallGap.center = gateCenterX;
  firewallGap.min = gateCenterX - FIREWALL.gapHalfWidth;
  firewallGap.max = gateCenterX + FIREWALL.gapHalfWidth;

  firewallLeftMesh.scale.x = Math.max((firewallGap.min - -FIREWALL.halfSpan), 0.1);
  firewallLeftMesh.position.set(toWorldX((-FIREWALL.halfSpan + firewallGap.min) / 2), 1.1, toWorldZ(FIREWALL.y));
  firewallRightMesh.scale.x = Math.max((FIREWALL.halfSpan - firewallGap.max), 0.1);
  firewallRightMesh.position.set(toWorldX((firewallGap.max + FIREWALL.halfSpan) / 2), 1.1, toWorldZ(FIREWALL.y));
  gapIndicator.scale.x = FIREWALL.gapHalfWidth * 2;
  gapIndicator.position.set(toWorldX(gateCenterX), 0.05, toWorldZ(FIREWALL.y));
}

function collideFirewall(b) {
  const { min: gapMin, max: gapMax } = firewallGap;
  const inGap = b.x > gapMin && b.x < gapMax;
  const nearLine = Math.abs(b.y - FIREWALL.y) < 0.6;

  if (nearLine && inGap && b.vy > 0 && game.firewallCooldown <= 0) {
    addScore(5000);
    game.firewallCooldown = 1.2;
    showBanner('FIREWALL JACKPOT!');
    Sfx.firewallJackpot();
    addShake(0.6);
    buzz(30);
    worldBurst(b.x, FIREWALL.y, 0xff2a2a, 14, 11);
    completeMission('firewall');
  } else if (nearLine && !inGap) {
    // solid portion: collide as two segments
    let hit;
    if (b.x <= gapMin) {
      hit = collideBallSegment(b, -FIREWALL.halfSpan, FIREWALL.y, gapMin, FIREWALL.y, FIREWALL.wallR, FIREWALL.restitution);
    } else {
      hit = collideBallSegment(b, gapMax, FIREWALL.y, FIREWALL.halfSpan, FIREWALL.y, FIREWALL.wallR, FIREWALL.restitution);
    }
    if (hit) Sfx.wall();
  }
}

const WARP_DURATION = 1000;
function handleWarpRamp(b) {
  if (b.mode !== 'live') return;
  const z = WARP_RAMP.zone;
  if (b.x > z.xMin && b.x < z.xMax && b.y > z.yMin && b.y < z.yMax) {
    const speed = len(b.vx, b.vy);
    if (speed > WARP_RAMP.minSpeed && (!WARP_RAMP.requireAscending || b.vy > 0)) {
      startWarp(b);
    }
  }
}

function startWarp(b) {
  b.mode = 'warping';
  b.warpStart = performance.now();
  addScore(3000);
  showBanner('WARP RAMP — 3x MULTIPLIER');
  Sfx.warpRamp();
  completeMission('warp');
}

function updateWarp() {
  for (const b of balls) {
    if (b.mode !== 'warping') continue;
    const t = clamp((performance.now() - b.warpStart) / WARP_DURATION, 0, 1);
    // scripted loop near the ring, purely cosmetic, then drop back into the field
    const loopX = WARP_RAMP.ringWorld.x + Math.sin(t * Math.PI * 2) * 1.4;
    const loopY = 36 + t * 8;
    b.mesh.position.set(loopX, 4 + Math.sin(t * Math.PI) * 4, toWorldZ(loopY));
    if (t >= 1) {
      b.mode = 'live';
      b.x = WARP_RAMP.zone.xMin - 1.5;
      b.y = 40;
      b.vx = -(Math.random() * 3 + 2);
      b.vy = -16;
      b.lastX = b.x;
      game.warpMultUntil = performance.now() + 15000;
    }
  }
}

function onDrain(b) {
  // ball-save grace window: routine save while the timer is live
  if (performance.now() < game.ballSaveUntil) {
    b.y = 6;
    b.vy = Math.abs(b.vy) * 0.6 + 14;
    b.vx = (Math.random() - 0.5) * 4;
    showBanner('BALL SAVED');
    Sfx.ghostBallSave();
    return;
  }
  // ghost ball: one-shot save earned from Overload
  if (game.ghostBallReady && balls.length === 1) {
    game.ghostBallReady = false;
    b.y = 6;
    b.vy = Math.abs(b.vy) * 0.6 + 14;
    showBanner('GHOST BALL SAVE');
    Sfx.ghostBallSave();
    return;
  }

  Sfx.drain();
  worldBurst(b.x, 0, 0x6dfcff, 10, 9);
  despawnBall(b);

  // in multiball, losing one ball just removes it — no life lost while others live
  if (balls.length > 0) {
    addShake(0.25);
    return;
  }

  // last ball drained: lose a life
  addShake(0.4);
  buzz(60);
  game.balls--;
  if (game.balls <= 0) {
    endGame();
  } else {
    showBanner(`${game.balls} BALL${game.balls === 1 ? '' : 'S'} LEFT`, 1200);
    resetBallToLane();
  }
}

function endGame() {
  game.state = 'gameover';
  showHint(null);
  const isNew = saveHighScore(game.score);
  game.isNewHighScore = isNew;
  overlayTitleEl.textContent = isNew ? 'NEW HIGH SCORE!' : 'GAME OVER';
  overlayMsg.textContent = `Final score ${game.score.toLocaleString()} — press SPACE / START to play again`;
  renderHighScores(game.score);
  showOverlay(true, true);
  Sfx.gameOver();
}

// =====================================================================
// RENDER / MAIN LOOP
// =====================================================================
function syncVisuals() {
  // position each active ball (warping balls are placed by updateWarp)
  for (const b of balls) {
    if (b.mode !== 'warping') {
      b.mesh.position.set(toWorldX(b.x), BALL_RADIUS, toWorldZ(b.y));
    }
    // per-ball neon trail
    if (b.mode === 'live') {
      b.trailHistory.unshift({ x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z });
      if (b.trailHistory.length > TRAIL_LEN) b.trailHistory.pop();
    } else {
      b.trailHistory.length = 0;
    }
    for (let i = 0; i < TRAIL_LEN; i++) {
      const p = b.trailHistory[i];
      if (p) {
        b.trailMeshes[i].visible = true;
        b.trailMeshes[i].position.set(p.x, p.y, p.z);
      } else {
        b.trailMeshes[i].visible = false;
      }
    }
  }

  updateFlipperVisual(leftFlipper, leftFlipperMesh);
  updateFlipperVisual(rightFlipper, rightFlipperMesh);
  updateFlipperVisual(midFlipper, midFlipperMesh);

  portalRing.rotation.z += 0.004;
  warpRing.rotation.z -= 0.01;
  starfield.rotation.y += 0.0006;

  // pulsing lightning rift
  const pulse = 1.2 + Math.sin(performance.now() / 140) * 0.7;
  riftMat.emissiveIntensity = pulse;
  riftLight.intensity = 0.5 + pulse * 0.4;

  // bumper hit-pulse animation
  for (const bm of compilerBumpers) {
    if (bm.pulse > 0) {
      bm.pulse = Math.max(0, bm.pulse - 0.06);
      bm.group.scale.setScalar(1 + bm.pulse * 0.25);
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
    // tilt meter cools off over time
    game.tiltMeter = Math.max(0, game.tiltMeter - dt * 0.45);
  }

  updateParticles(dt);
  updateCamera();
  syncVisuals();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// kick off in menu state
renderHighScores();
updateMissionHud();
updateLanesHud();
showOverlay(true, true);
