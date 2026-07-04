import * as THREE from './vendor/three/three.module.min.js';
import { EffectComposer } from './vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/addons/postprocessing/OutputPass.js';
import { Flipper, collideBallSegment, collideBallCircle, clamp, len } from './physics.js';
import { Sfx, unlockAudio, toggleMute, isMuted, startMusic, setMusicIntensity } from './audio.js';
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
  OUTLANES,
  SLINGSHOTS,
  DROP_TARGETS,
  SPINNER,
} from './layout.js';

// ---------- table-space <-> world-space mapping ----------
const toWorldX = (x) => x;
const toWorldZ = (y) => -y;

// ---------- renderer / scene / camera ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// bloom is too heavy without GPU acceleration — detect software GL and skip post-processing
const softwareGL = (() => {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch {
    return false;
  }
})();
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, softwareGL ? 2 : 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
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
  } else if (game.state === 'menu' || game.state === 'gameover') {
    // attract mode: a slow, dreamy drift across the table
    const t = performance.now() / 1000;
    tx = Math.sin(t * 0.21) * 4.5;
    tz = Math.cos(t * 0.13) * 2.5;
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

// ---------- post-processing (bloom is what sells the neon) ----------
let composer = null;
if (!softwareGL) {
  composer = new EffectComposer(
    renderer,
    // multisampled HalfFloat target: keeps MSAA edges and >1.0 emissive values for bloom
    new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
  );
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.4, 0.85));
  composer.addPass(new OutputPass());
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  if (composer) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- lighting ----------
scene.add(new THREE.AmbientLight(0x2b2a55, 0.5));
const keyLight = new THREE.PointLight(0x6df9ff, 1.4, 80, 2);
keyLight.position.set(0, 22, toWorldZ(20));
scene.add(keyLight);
const magentaLight = new THREE.PointLight(0xff2ad1, 1.1, 70, 2);
magentaLight.position.set(0, 16, toWorldZ(40));
scene.add(magentaLight);

// ---------- neon environment map ----------
// A tiny synthetic room of neon light panels, baked once through PMREM. This is
// what makes the chrome ball and the metallic trim actually reflect the world's
// cyan/magenta identity instead of looking flat.
{
  const envScene = new THREE.Scene();
  const panel = (color, intensity, w, h) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
    );
    envScene.add(m);
    return m;
  };
  const cyan = panel(0x36e0ff, 5, 14, 30);
  cyan.position.set(-16, 8, 0);
  cyan.rotation.y = Math.PI / 2;
  const magenta = panel(0xff2ad1, 5, 14, 30);
  magenta.position.set(16, 8, 0);
  magenta.rotation.y = -Math.PI / 2;
  const violet = panel(0x8a3dff, 3, 30, 30);
  violet.position.set(0, 18, 0);
  violet.rotation.x = Math.PI / 2;
  const white = panel(0xffffff, 8, 5, 3);
  white.position.set(0, 12, 14);
  white.rotation.x = -0.5;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.06).texture;
  pmrem.dispose();
}

// ---------- starfield void background ----------
function buildStarfield() {
  const count = 1400;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palette = [new THREE.Color(0x9be9ff), new THREE.Color(0xffffff), new THREE.Color(0xff9bea), new THREE.Color(0xb9a8ff)];
  for (let i = 0; i < count; i++) {
    const r = 90 + Math.random() * 140;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.6 + 5;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) - 30;
    const c = palette[(Math.random() * palette.length) | 0];
    const twinkle = 0.5 + Math.random() * 0.5;
    colors[i * 3] = c.r * twinkle;
    colors[i * 3 + 1] = c.g * twinkle;
    colors[i * 3 + 2] = c.b * twinkle;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.7,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return points;
}
const starfield = buildStarfield();

// ---------- animated nebula skybox ----------
// A huge inward-facing sphere with a cheap 3-octave value-noise shader: deep
// violet clouds streaked with cyan and magenta, drifting very slowly. Replaces
// the flat background color with an actual sky.
const nebulaUniforms = { uTime: { value: 0 } };
const nebulaMat = new THREE.ShaderMaterial({
  uniforms: nebulaUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vDir;
    uniform float uTime;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }
    float fbm(vec2 p) {
      float v = 0.0;
      v += 0.5 * vnoise(p);
      v += 0.25 * vnoise(p * 2.13 + 17.0);
      v += 0.125 * vnoise(p * 4.31 + 47.0);
      return v / 0.875;
    }
    void main() {
      // project direction onto a cylinder-ish uv so the poles don't pinch
      vec2 uv = vec2(atan(vDir.z, vDir.x) * 1.2, vDir.y * 2.2);
      float t = uTime * 0.008;
      float n1 = fbm(uv * 1.8 + vec2(t, -t * 0.6));
      float n2 = fbm(uv * 3.4 - vec2(t * 0.7, t));
      vec3 deep = vec3(0.012, 0.006, 0.045);
      vec3 violet = vec3(0.14, 0.03, 0.28);
      vec3 cyan = vec3(0.0, 0.32, 0.42);
      vec3 magenta = vec3(0.36, 0.02, 0.26);
      vec3 col = deep;
      col = mix(col, violet, smoothstep(0.35, 0.85, n1));
      col = mix(col, magenta, smoothstep(0.55, 0.95, n2) * 0.7);
      col = mix(col, cyan, smoothstep(0.72, 1.0, n1 * n2 * 1.6) * 0.55);
      // keep the sky darker near the horizon so the table stays the hero
      col *= 0.35 + 0.65 * smoothstep(-0.15, 0.55, vDir.y);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const nebula = new THREE.Mesh(new THREE.SphereGeometry(240, 32, 20), nebulaMat);
scene.add(nebula);

// ---------- neon grid floor (cyberspace void) ----------
// Shader plane instead of GridHelper: anti-aliased lines that fade into the
// fog, with a slow energy pulse rolling out from under the table.
const gridUniforms = { uTime: { value: 0 } };
const gridMat = new THREE.ShaderMaterial({
  uniforms: gridUniforms,
  transparent: true,
  depthWrite: false,
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vWorld;
    uniform float uTime;
    void main() {
      vec2 cell = vWorld.xz / 5.0;
      vec2 g = abs(fract(cell - 0.5) - 0.5) / fwidth(cell);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      float d = length(vWorld.xz);
      float fade = exp(-d * 0.016);
      float pulse = 0.55 + 0.45 * sin(d * 0.22 - uTime * 2.2);
      vec3 color = mix(vec3(1.0, 0.16, 0.82), vec3(0.2, 0.9, 1.0), pulse);
      float alpha = line * fade * (0.35 + 0.65 * pulse);
      gl_FragColor = vec4(color * (0.6 + pulse), alpha);
    }
  `,
});
const grid = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), gridMat);
grid.rotation.x = -Math.PI / 2;
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
  emissiveIntensity: 0.3,
  metalness: 0.5,
  roughness: 0.35,
  envMapIntensity: 0.6,
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
  emissiveIntensity: 0.45,
  metalness: 0.7,
  roughness: 0.22,
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
    color: 0x10283a,
    emissive: 0x2fc8e8,
    emissiveIntensity: 0.7,
    metalness: 0.75,
    roughness: 0.2,
    transparent: true,
    opacity: 0.92,
  });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x0a1820, emissive: 0x6dfcff, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.2 });

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
    emissiveIntensity: lit ? 2.2 : 0.55,
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
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x050308, emissive: compilerLevelColors[0], emissiveIntensity: 1.5, metalness: 0.4, roughness: 0.2 });
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
  bm.ringMat.emissiveIntensity = 1.5 + (bm.level - 1) * 0.9;
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
const firewallMat = new THREE.MeshStandardMaterial({ color: 0x2a0a14, emissive: 0xff3a2a, emissiveIntensity: 2.0, metalness: 0.5, roughness: 0.3, transparent: true, opacity: 0.9 });
const firewallLeftMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 0.6), firewallMat);
const firewallRightMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 0.6), firewallMat);
firewallGroup.add(firewallLeftMesh, firewallRightMesh);
const gapIndicatorMat = new THREE.MeshBasicMaterial({
  color: 0x2bd8ff,
  transparent: true,
  opacity: 0.5,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
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

// ---------- slingshot kickers ----------
// Classic triangular kickers above each flipper: any hit on the marked face
// fires the ball away hard. Built as extruded neon prisms with a glow rim.
function buildSlingshotMesh(sl) {
  const shape = new THREE.Shape();
  shape.moveTo(sl.verts[0][0], sl.verts[0][1]);
  shape.lineTo(sl.verts[1][0], sl.verts[1][1]);
  shape.lineTo(sl.verts[2][0], sl.verts[2][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.1, bevelSegments: 1 });
  const mat = new THREE.MeshStandardMaterial({
    color: 0x14082a,
    emissive: 0xff2ad1,
    emissiveIntensity: 0.7,
    metalness: 0.7,
    roughness: 0.25,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // shape was built in table (x, y); rotate so table y maps onto world -z
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.05;
  scene.add(mesh);
  return { mesh, mat };
}
const slingshots = SLINGSHOTS.map((sl) => {
  const { mesh, mat } = buildSlingshotMesh(sl);
  const [a, b] = sl.face;
  const fdx = b[0] - a[0];
  const fdy = b[1] - a[1];
  const flen = len(fdx, fdy);
  return {
    ...sl,
    mesh,
    mat,
    normal: { x: -fdy / flen, y: fdx / flen }, // outward kick direction
    cooldown: 0,
    pulse: 0,
  };
});

// ---------- drop target bank (R-U-N) ----------
// Three standing targets; a hit sinks the target into the playfield. Sinking
// all three starts the next hack mode and the bank pops back up.
const dropTargetMat = (up) => new THREE.MeshStandardMaterial({
  color: up ? 0x101c38 : 0x0a0a14,
  emissive: up ? 0xfffb6d : 0x333322,
  emissiveIntensity: up ? 1.2 : 0.2,
  metalness: 0.55,
  roughness: 0.3,
});
const dropTargets = DROP_TARGETS.targets.map((t, i) => {
  const midX = (t.a[0] + t.b[0]) / 2;
  const midY = (t.a[1] + t.b[1]) / 2;
  const width = len(t.b[0] - t.a[0], t.b[1] - t.a[1]);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 1.5, 0.42), dropTargetMat(true));
  mesh.position.set(toWorldX(midX), 0.75, toWorldZ(midY));
  setYRotFromTableDir(mesh, t.b[0] - t.a[0], t.b[1] - t.a[1]);
  scene.add(mesh);
  return {
    ...t,
    letter: DROP_TARGETS.letters[i],
    mesh,
    dropped: false,
    sinkAnim: 0, // 0 = fully up, 1 = fully sunk
  };
});
let dropBankResetAt = 0; // timestamp when the bank should pop back up

// ---------- spinner (mid-flipper lane) ----------
// A spinning plate the ball whips through; revolutions score and count toward
// relighting the kickback.
const spinnerState = { angle: 0, spinVel: 0, spinsOwed: 0, passCd: 0, totalSpins: 0 };
const spinnerGroup = new THREE.Group();
{
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0x0c1c30,
    emissive: 0x6dfcff,
    emissiveIntensity: 1.1,
    metalness: 0.7,
    roughness: 0.2,
    side: THREE.DoubleSide,
  });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(SPINNER.halfW * 2, 0.9, 0.07), plateMat);
  plate.position.y = 0; // rotates about the group's local x axis
  spinnerGroup.add(plate);
  // axle posts on either side
  const postMat = new THREE.MeshStandardMaterial({ color: 0x111122, metalness: 0.8, roughness: 0.3 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 8), postMat);
    post.position.set(sx * (SPINNER.halfW + 0.18), -0.35, 0);
    spinnerGroup.add(post);
  }
  spinnerGroup.position.set(toWorldX(SPINNER.x), 1.15, toWorldZ(SPINNER.y));
  scene.add(spinnerGroup);
}

// ---------- kickback coil (left outlane) ----------
const kickbackMat = new THREE.MeshStandardMaterial({
  color: 0x0a1a10,
  emissive: 0x6dffb0,
  emissiveIntensity: 1.6,
  metalness: 0.6,
  roughness: 0.25,
});
const kickbackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), kickbackMat);
kickbackMesh.position.set(toWorldX(OUTLANES.left.kickback.x), 0.45, toWorldZ(OUTLANES.left.kickback.y - 0.6));
scene.add(kickbackMesh);

// ---------- playfield insert lamps ----------
// Flat glowing inserts embedded in the playfield that broadcast game state,
// like a real machine: kickback, special, mode-ready, jackpot, and one pip
// per completed hack mode.
function makeLamp(tx, ty, colorHex, radius = 0.55) {
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(toWorldX(tx), 0.07, toWorldZ(ty));
  scene.add(mesh);
  return { mat, state: 'off', baseColor: colorHex }; // off | on | flash
}
const lamps = {
  kickback: makeLamp(OUTLANES.left.kickback.x, OUTLANES.left.kickback.y + 1.6, 0x6dffb0),
  special: makeLamp(8.2, 6.4, 0xfffb6d),
  modeReady: makeLamp(-6.0, 24.2, 0xff2ad1, 0.7),
  jackpot: makeLamp(0, FIREWALL.y - 2.2, 0xffb14b, 0.8),
  mode0: makeLamp(-1.8, 16.4, 0xb14bff, 0.42),
  mode1: makeLamp(0, 16.0, 0xb14bff, 0.42),
  mode2: makeLamp(1.8, 16.4, 0xb14bff, 0.42),
};
function updateLampVisuals(nowMs) {
  const flashOn = Math.sin(nowMs / 90) > 0;
  for (const key of Object.keys(lamps)) {
    const lamp = lamps[key];
    lamp.mat.opacity = lamp.state === 'on' ? 0.85 : lamp.state === 'flash' ? (flashOn ? 0.95 : 0.15) : 0.1;
  }
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
const MAX_BALLS = 4;
const TRAIL_LEN = 14;
const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 24);
// chrome ball: the neon environment map does the work, emissive just keeps a
// faint cyan core so it never reads as a black hole in dark corners
const ballMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0x2a6f85,
  emissiveIntensity: 0.7,
  metalness: 1.0,
  roughness: 0.08,
  envMapIntensity: 1.7,
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
      new THREE.MeshBasicMaterial({
        color: 0x6dfcff,
        transparent: true,
        opacity: 0.32 * (1 - i / TRAIL_LEN),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
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
  b.mode = mode; b.stallTime = 0; b.stallAnchorX = null; b.stallAnchorY = null;
  b.warpStart = 0; b.lastX = x; b.riftCd = 0;
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
    new THREE.MeshBasicMaterial({ color: 0x6dfcff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
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

// ---------- floating score popups ----------
// Small billboard sprites ("+5,000") that rise off the playfield and fade.
const POPUP_COUNT = 10;
const popups = Array.from({ length: POPUP_COUNT }, () => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(6.5, 2.4, 1);
  sprite.visible = false;
  scene.add(sprite);
  return { canvas, ctx, texture, sprite, life: 0, maxLife: 1, active: false };
});

function spawnPopup(tx, ty, text, colorCss = '#6dfcff') {
  const p = popups.find((q) => !q.active);
  if (!p) return;
  const { ctx, canvas } = p;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 44px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = colorCss;
  ctx.shadowBlur = 16;
  ctx.fillStyle = colorCss;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  p.texture.needsUpdate = true;
  p.sprite.position.set(toWorldX(tx), 2.2, toWorldZ(ty));
  p.sprite.material.opacity = 1;
  p.sprite.visible = true;
  p.maxLife = 1.0;
  p.life = p.maxLife;
  p.active = true;
}

function updatePopups(dt) {
  for (const p of popups) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      p.sprite.visible = false;
      continue;
    }
    const f = p.life / p.maxLife;
    p.sprite.position.y += dt * 3.2;
    p.sprite.material.opacity = Math.min(1, f * 1.6);
  }
}

// ---------- shockwave rings ----------
// Flat expanding rings on the playfield for big impacts.
const SHOCKWAVE_COUNT = 6;
const shockwaves = Array.from({ length: SHOCKWAVE_COUNT }, () => {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x6dfcff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 28), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, mat, life: 0, maxLife: 1, active: false, maxScale: 4 };
});

function spawnShockwave(tx, ty, colorHex, maxScale = 4) {
  const s = shockwaves.find((q) => !q.active);
  if (!s) return;
  s.mat.color.setHex(colorHex);
  s.mesh.position.set(toWorldX(tx), 0.15, toWorldZ(ty));
  s.mesh.scale.setScalar(0.3);
  s.mesh.visible = true;
  s.maxScale = maxScale;
  s.maxLife = 0.45;
  s.life = s.maxLife;
  s.active = true;
}

function updateShockwaves(dt) {
  for (const s of shockwaves) {
    if (!s.active) continue;
    s.life -= dt;
    if (s.life <= 0) {
      s.active = false;
      s.mesh.visible = false;
      continue;
    }
    const t = 1 - s.life / s.maxLife;
    s.mesh.scale.setScalar(0.3 + t * s.maxScale);
    s.mat.opacity = (1 - t) * 0.8;
  }
}

// ---------- lightning bolts ----------
// Jagged additive line strips, used along the rift and for mode fireworks.
const BOLT_COUNT = 5;
const bolts = Array.from({ length: BOLT_COUNT }, () => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xb14bff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  scene.add(line);
  return { line, geo, mat, life: 0, maxLife: 1, active: false };
});

function spawnBolt(tx1, ty1, tx2, ty2, colorHex = 0xb14bff) {
  const b = bolts.find((q) => !q.active);
  if (!b) return;
  const pos = b.geo.attributes.position;
  const N = 16;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = tx1 + (tx2 - tx1) * t + (i > 0 && i < N - 1 ? (Math.random() - 0.5) * 1.6 : 0);
    const y = ty1 + (ty2 - ty1) * t + (i > 0 && i < N - 1 ? (Math.random() - 0.5) * 1.6 : 0);
    pos.setXYZ(i, toWorldX(x), 0.5 + Math.random() * 1.4, toWorldZ(y));
  }
  pos.needsUpdate = true;
  b.mat.color.setHex(colorHex);
  b.line.visible = true;
  b.maxLife = 0.16;
  b.life = b.maxLife;
  b.active = true;
}

function updateBolts(dt) {
  for (const b of bolts) {
    if (!b.active) continue;
    b.life -= dt;
    if (b.life <= 0) {
      b.active = false;
      b.line.visible = false;
      continue;
    }
    b.mat.opacity = (b.life / b.maxLife) * (0.5 + Math.random() * 0.5);
  }
}

// ---------- GI light show ----------
// Briefly flood the table's key lights with an event color, then ease back.
const giBase = { key: new THREE.Color(0x6df9ff), magenta: new THREE.Color(0xff2ad1), keyIntensity: 1.4, magentaIntensity: 1.1 };
let giFlash = null; // { color, strength, until }
function flashGI(colorHex, ms = 450, strength = 2.2) {
  giFlash = { color: new THREE.Color(colorHex), until: performance.now() + ms, ms, strength };
}
function updateGI(nowMs) {
  if (!giFlash) return;
  const remain = giFlash.until - nowMs;
  if (remain <= 0) {
    keyLight.color.copy(giBase.key);
    magentaLight.color.copy(giBase.magenta);
    keyLight.intensity = giBase.keyIntensity;
    magentaLight.intensity = giBase.magentaIntensity;
    giFlash = null;
    return;
  }
  const f = remain / giFlash.ms;
  keyLight.color.copy(giBase.key).lerp(giFlash.color, f);
  magentaLight.color.copy(giBase.magenta).lerp(giFlash.color, f);
  keyLight.intensity = giBase.keyIntensity * (1 + f * (giFlash.strength - 1));
  magentaLight.intensity = giBase.magentaIntensity * (1 + f * (giFlash.strength - 1));
}

// =====================================================================
// DOT MATRIX DISPLAY (DMD)
// =====================================================================
// A classic pinball score display on the backbox neck: text is rasterized on
// a tiny offscreen canvas, then re-drawn as a grid of glowing dots. Messages
// queue up over the default score view; modes take over with a timer.
const DMD = (() => {
  const COLS = 128;
  const ROWS = 24;
  const DOT = 5; // display pixels per dot cell
  const textCanvas = document.createElement('canvas');
  textCanvas.width = COLS;
  textCanvas.height = ROWS;
  const textCtx = textCanvas.getContext('2d', { willReadFrequently: true });
  const dotCanvas = document.createElement('canvas');
  dotCanvas.width = COLS * DOT;
  dotCanvas.height = ROWS * DOT;
  const dotCtx = dotCanvas.getContext('2d');
  const texture = new THREE.CanvasTexture(dotCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const queue = []; // { line1, line2, untilMs }
  let lastRender = 0;

  function push(line1, line2 = '', ms = 1600) {
    // newest message wins; keep at most a couple queued
    queue.push({ line1, line2, untilMs: 0, ms });
    if (queue.length > 3) queue.splice(0, queue.length - 3);
  }

  function drawText(line1, line2) {
    textCtx.clearRect(0, 0, COLS, ROWS);
    textCtx.fillStyle = '#fff';
    textCtx.textAlign = 'center';
    textCtx.textBaseline = 'middle';
    if (line2) {
      textCtx.font = 'bold 10px monospace';
      textCtx.fillText(line1, COLS / 2, 6, COLS - 4);
      textCtx.fillText(line2, COLS / 2, 17, COLS - 4);
    } else {
      textCtx.font = 'bold 14px monospace';
      textCtx.fillText(line1, COLS / 2, ROWS / 2 + 1, COLS - 4);
    }
  }

  function rasterize(brightness) {
    const img = textCtx.getImageData(0, 0, COLS, ROWS).data;
    dotCtx.fillStyle = '#050208';
    dotCtx.fillRect(0, 0, dotCanvas.width, dotCanvas.height);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const a = img[(y * COLS + x) * 4 + 3];
        const on = a > 100;
        dotCtx.fillStyle = on
          ? `rgba(109, 252, 255, ${(0.85 * brightness).toFixed(2)})`
          : 'rgba(60, 40, 90, 0.22)';
        dotCtx.beginPath();
        dotCtx.arc(x * DOT + DOT / 2, y * DOT + DOT / 2, on ? DOT * 0.38 : DOT * 0.22, 0, Math.PI * 2);
        dotCtx.fill();
      }
    }
    texture.needsUpdate = true;
  }

  function update(nowMs) {
    if (nowMs - lastRender < 90) return; // ~11 fps, like real hardware
    lastRender = nowMs;

    // resolve current content: queued message > active mode > attract > score
    let line1 = '';
    let line2 = '';
    let brightness = 1;
    const msg = queue[0];
    if (msg) {
      if (!msg.untilMs) msg.untilMs = nowMs + msg.ms;
      if (nowMs > msg.untilMs) {
        queue.shift();
      } else {
        line1 = msg.line1;
        line2 = msg.line2;
        brightness = Math.sin(nowMs / 70) > -0.6 ? 1 : 0.55; // subtle flicker
      }
    }
    if (!line1) {
      if (game.mode) {
        const remain = Math.max(0, Math.ceil((game.mode.until - nowMs) / 1000));
        line1 = game.mode.name;
        line2 = `${game.mode.progress}/${game.mode.goal}   ${remain}s`;
      } else if (game.state === 'menu' || game.state === 'gameover') {
        const phase = Math.floor(nowMs / 2600) % 3;
        const hs = loadHighScores();
        if (phase === 0) line1 = 'NEON RIFT';
        else if (phase === 1) { line1 = 'HIGH SCORE'; line2 = (hs[0] || 0).toLocaleString(); }
        else line1 = 'PRESS START';
      } else {
        line1 = game.score.toLocaleString();
        line2 = game.state === 'playing' || game.state === 'ready' ? `BALL ${4 - game.balls > 0 ? 4 - game.balls : 1}  BONUS x${game.bonusX}` : '';
      }
    }
    drawText(line1, line2);
    rasterize(brightness);
  }

  return { texture, push, update };
})();

// mount the DMD on the backbox neck, just under the backglass. The neck's
// front face sits ~0.5 units in front of BACK_Z, so the panel floats just
// ahead of it.
{
  const BACK_Z = toWorldZ(TABLE_TOP + 1);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 3),
    new THREE.MeshBasicMaterial({ map: DMD.texture })
  );
  panel.position.set(0, 6.2, BACK_Z + 0.85);
  panel.rotation.x = -0.08;
  scene.add(panel);
  // thin frame behind it
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x0a0612, metalness: 0.7, roughness: 0.3, emissive: 0x2a1040, emissiveIntensity: 0.5 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(16.8, 3.8, 0.25), frameMat);
  frame.position.set(0, 6.2, BACK_Z + 0.6);
  frame.rotation.x = -0.08;
  scene.add(frame);
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
  // --- overhaul systems ---
  bonusX: 1, // end-of-ball bonus multiplier, raised by inlane rollovers
  ballStats: { bumperHits: 0, spinnerSpins: 0, nodes: 0, lanes: 0, slings: 0 },
  kickbackLit: true, // left outlane kickback (relit by the spinner / drop bank)
  specialLit: false, // right outlane SPECIAL award
  jackpotLevel: 1, // multiball jackpot escalator
  mode: null, // active hack mode: { id, name, until, progress, goal }
  modesCompleted: { storm: false, overclock: false, breach: false },
  wizardUntil: 0,
  extraBallThresholds: [250000, 750000],
  extraBallsAwarded: 0,
  lastShot: null, // { type, atMs } for shot combos
  comboCount: 0,
  replayCredit: false, // earned from the match sequence, spent on next game
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
  const wizard = performance.now() < game.wizardUntil ? 2 : 1;
  const chain = 1 + Math.min(game.chainStreak, 6) * 0.5;
  return overload * warp * wizard * chain;
}

function addScore(base) {
  game.score += Math.round(base * currentMultiplier());
  scoreEl.textContent = game.score.toLocaleString();
  // extra ball at score thresholds, once each per game
  while (
    game.extraBallsAwarded < game.extraBallThresholds.length &&
    game.score >= game.extraBallThresholds[game.extraBallsAwarded]
  ) {
    game.extraBallsAwarded++;
    game.balls++;
    showBanner('EXTRA BALL!');
    DMD.push('EXTRA BALL', '', 2000);
    Sfx.extraBall();
    flashGI(0xfffb6d, 600);
  }
}

let laneBall = null;
function resetBallToLane() {
  clearBalls();
  // fresh ball: bonus counters reset, kickback relights as a courtesy
  resetBallStats();
  game.kickbackLit = true;
  game.jackpotLevel = 1;
  game.lastShot = null;
  game.comboCount = 0;
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
  if (now < game.wizardUntil) flags.push(['overload', `OVERRIDE ${Math.ceil((game.wizardUntil - now) / 1000)}s`]);
  if (game.mode) flags.push(['ghost', `${game.mode.name} ${Math.max(0, Math.ceil((game.mode.until - now) / 1000))}s  ${game.mode.progress}/${game.mode.goal}`]);
  if (balls.length > 1) flags.push(['warp', `MULTIBALL x${balls.length}`]);
  if (balls.length > 1) flags.push(['overload', `JACKPOT ${(25000 * game.jackpotLevel).toLocaleString()}`]);
  if (now < game.ballSaveUntil && game.state === 'playing') flags.push(['slowmo', 'BALL SAVE']);
  if (now < game.overloadUntil) flags.push(['overload', 'OVERLOAD']);
  if (now < game.warpMultUntil) flags.push(['warp', 'WARP x3']);
  if (game.ghostBallReady) flags.push(['ghost', 'GHOST BALL']);
  if (game.bonusX > 1) flags.push(['slowmo', `BONUS x${game.bonusX}`]);
  if (game.kickbackLit && game.state === 'playing') flags.push(['slowmo', 'KICKBACK']);
  if (game.specialLit) flags.push(['overload', 'SPECIAL LIT']);
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
  // overhaul systems reset
  resetBallStats();
  game.kickbackLit = true;
  game.specialLit = false;
  game.jackpotLevel = 1;
  game.mode = null;
  game.modesCompleted = { storm: false, overclock: false, breach: false };
  game.wizardUntil = 0;
  game.extraBallsAwarded = 0;
  game.lastShot = null;
  game.comboCount = 0;
  // replay credit from the match sequence buys an extra ball this game
  if (game.replayCredit) {
    game.replayCredit = false;
    game.balls = 4;
    showBanner('REPLAY CREDIT — 4 BALLS', 1600);
    DMD.push('REPLAY', '4 BALLS', 2000);
  }
  for (const t of dropTargets) t.dropped = false;
  dropBankResetAt = 0;
  spinnerState.spinsOwed = 0;
  spinnerState.spinVel = 0;
  spinnerState.totalSpins = 0;
  lamps.special.state = 'off';
  updateModeLamps();
  setMusicIntensity(false);
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
  updateSlingshotState(dt);
  updateDropTargetState();
  updateSpinnerState(dt);
  updateModeState();

  // iterate a snapshot since draining despawns balls mid-loop
  for (const b of [...balls]) {
    if (b.mode !== 'live') continue;
    stepOneBall(b, dt);
  }
}

function stepOneBall(b, dt) {
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

  // slingshot kickers: collide all three edges; a face hit fires the kicker
  for (const sl of slingshots) {
    const v = sl.verts;
    let touched = false;
    for (let i = 0; i < 3; i++) {
      const p = v[i];
      const q = v[(i + 1) % 3];
      if (collideBallSegment(b, p[0], p[1], q[0], q[1], 0.14, 0.45)) touched = true;
    }
    if (touched && sl.cooldown <= 0) {
      // is the ball near the kicking face?
      const [fa, fb] = sl.face;
      const mx = (fa[0] + fb[0]) / 2;
      const my = (fa[1] + fb[1]) / 2;
      const near = len(b.x - mx, b.y - my) < len(fb[0] - fa[0], fb[1] - fa[1]) * 0.75;
      if (near) {
        b.vx = sl.normal.x * sl.kickSpeed + b.vx * 0.25;
        b.vy = sl.normal.y * sl.kickSpeed + b.vy * 0.25;
        sl.cooldown = sl.cooldownSec;
        sl.pulse = 1;
        onSlingshotHit(sl, b);
      }
    }
  }

  // drop targets: standing targets collide, then collapse
  for (const t of dropTargets) {
    if (t.dropped) continue;
    if (collideBallSegment(b, t.a[0], t.a[1], t.b[0], t.b[1], DROP_TARGETS.r, DROP_TARGETS.restitution)) {
      onDropTargetHit(t);
    }
  }

  // spinner: passing through the plate whips it around
  if (
    spinnerState.passCd <= 0 &&
    Math.abs(b.x - SPINNER.x) < SPINNER.halfW &&
    Math.abs(b.y - SPINNER.y) < SPINNER.triggerHalfH &&
    Math.abs(b.vy) > 3
  ) {
    const speed = len(b.vx, b.vy);
    const spins = Math.max(2, Math.round(SPINNER.spinsPerPass * (speed / 14)));
    spinnerState.spinsOwed += spins;
    spinnerState.spinVel = Math.sign(b.vy || 1) * Math.max(Math.abs(spinnerState.spinVel), Math.max(speed * 2.2, 20));
    spinnerState.passCd = 0.45;
    b.vy *= 0.82; // the plate saps a little momentum
  }

  // outlanes: the wall side of each divider ends in a drain slot
  const loz = OUTLANES.left.zone;
  if (b.vy < 0 && b.x > loz.xMin && b.x < loz.xMax && b.y > loz.yMin && b.y < loz.yMax) {
    if (game.kickbackLit) {
      fireKickback(b);
    }
    // unlit: the ball keeps falling and drains below
  }
  const roz = OUTLANES.right.zone;
  if (b.vy < 0 && b.x > roz.xMin && b.x < roz.xMax && b.y > roz.yMin && b.y < roz.yMax) {
    if (game.specialLit) {
      game.specialLit = false;
      lamps.special.state = 'off';
      addScore(25000);
      showBanner('SPECIAL! +25,000');
      DMD.push('SPECIAL', '+25,000', 1800);
      Sfx.jackpot();
      spawnPopup(b.x, b.y + 2, '+25,000', '#fffb6d');
    }
  }

  // inlanes: rolling through raises the end-of-ball bonus multiplier
  b.inlaneCd = Math.max(0, (b.inlaneCd || 0) - dt);
  if (b.inlaneCd <= 0 && b.vy < 0) {
    for (const z of OUTLANES.inlaneZones) {
      if (b.x > z.xMin && b.x < z.xMax && b.y > z.yMin && b.y < z.yMax) {
        b.inlaneCd = 0.8;
        onInlanePass(b);
        break;
      }
    }
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

  // anti-stall: a ball wedged between a flipper and a bumper, or sitting on
  // the centerline seam between the two main flippers, can rattle in place
  // with non-trivial instantaneous velocity that never converts into actual
  // movement (the discrete per-contact collision resolution can fight itself
  // when two surfaces close in on the ball at once) — so this tracks real
  // displacement from an anchor point rather than raw speed. It runs
  // regardless of flipper input, since a ball can be wedged while the player
  // is actively holding a flipper trying to free it. The threshold is long
  // enough to never interrupt a normal catch-and-hold trap.
  if (b.stallAnchorX == null) { b.stallAnchorX = b.x; b.stallAnchorY = b.y; }
  const driftFromAnchor = len(b.x - b.stallAnchorX, b.y - b.stallAnchorY);
  if (driftFromAnchor < 1.0) {
    b.stallTime += dt;
    if (b.stallTime > 3.5) {
      b.stallTime = 0;
      b.stallAnchorX = null;
      b.y = -3;
    }
  } else {
    b.stallTime = 0;
    b.stallAnchorX = b.x;
    b.stallAnchorY = b.y;
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
      spawnBolt(0, Math.max(RIFT.yMin, b.y - 7), 0, Math.min(RIFT.yMax, b.y + 7), 0xb14bff);
      registerShot('rift', 0, b.y);
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
  game.ballStats.bumperHits++;
  // progressive value: a leveled bumper is worth more (5x during OVERCLOCK)
  const overclock = game.mode && game.mode.id === 'overclock';
  addScore(150 * bm.level * (overclock ? 5 : 1));
  if (overclock) {
    modeProgress(1);
    spawnShockwave(COMPILER.x + COMPILER.bumpers[i].dx, COMPILER.y + COMPILER.bumpers[i].dy, 0xffb14b, 2.5);
  }

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
  game.ballStats.lanes++;
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
  // DATA STORM: every node hit scores big and immediately re-arms
  if (game.mode && game.mode.id === 'storm') {
    addScore(5000);
    game.ballStats.nodes++;
    Sfx.dataNode();
    worldBurst(node.x, node.y, 0xb14bff, 9, 9);
    spawnPopup(node.x, node.y + 1.5, '+5,000', '#cdb3ff');
    spawnBolt(node.x, node.y, 0, RIFT.yMax - 6, 0xb14bff);
    modeProgress(1);
    return;
  }
  if (node.lit) {
    addScore(100);
    Sfx.dataNodeRepeat();
    return;
  }
  node.lit = true;
  node.mesh.material = nodeMat(true);
  addScore(1000);
  game.ballStats.nodes++;
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
    DMD.push('MULTIBALL', 'GATE = JACKPOT', 2400);
    Sfx.multiball();
    setMusicIntensity(true);
    flashGI(0x6dfcff, 800, 2.6);
    worldBurst(ox, oy, 0x6dfcff, 16, 12);
    game.jackpotLevel = Math.max(game.jackpotLevel, 1);
  }
}

let slowMoUntil = 0;
function grantSlowMo() {
  slowMoUntil = performance.now() + 3500;
  showBanner('SLOW-MO PULSE');
  Sfx.slowMo();
}

// =====================================================================
// SLINGSHOTS / DROP TARGETS / SPINNER / KICKBACK / INLANES
// =====================================================================
function onSlingshotHit(sl, b) {
  addScore(75);
  game.ballStats.slings++;
  Sfx.slingshot();
  addShake(0.18);
  buzz(10);
  worldBurst((sl.verts[0][0] + sl.verts[1][0] + sl.verts[2][0]) / 3, (sl.verts[0][1] + sl.verts[1][1] + sl.verts[2][1]) / 3, 0xff2ad1, 6, 8);
  spawnShockwave(b.x, b.y, 0xff2ad1, 2.2);
}

function updateSlingshotState(dt) {
  for (const sl of slingshots) {
    sl.cooldown = Math.max(0, sl.cooldown - dt);
    if (sl.pulse > 0) {
      sl.pulse = Math.max(0, sl.pulse - dt * 5);
      sl.mat.emissiveIntensity = 0.7 + sl.pulse * 2.2;
    }
  }
}

function onDropTargetHit(t) {
  t.dropped = true;
  addScore(1500);
  Sfx.dropTarget();
  buzz(14);
  spawnPopup((t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2, t.letter, '#fffb6d');
  worldBurst((t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2, 0xfffb6d, 6, 7);
  if (dropTargets.every((d) => d.dropped)) {
    completeDropBank();
  }
}

function completeDropBank() {
  addScore(5000);
  Sfx.bankComplete();
  addShake(0.4);
  flashGI(0xfffb6d, 500);
  DMD.push('R-U-N COMPLETE', '+5,000', 1600);
  dropBankResetAt = performance.now() + DROP_TARGETS.resetDelaySec * 1000;
  // relight the kickback as a safety net...
  if (!game.kickbackLit) {
    game.kickbackLit = true;
    showBanner('KICKBACK RELIT', 1100);
  }
  // ...and arm the next hack mode (or the wizard if all three are done)
  startNextHackMode();
}

function updateDropTargetState() {
  if (dropBankResetAt && performance.now() >= dropBankResetAt) {
    dropBankResetAt = 0;
    for (const t of dropTargets) t.dropped = false;
  }
  // sink/rise animation toward the physical state
  for (const t of dropTargets) {
    const target = t.dropped ? 1 : 0;
    t.sinkAnim += (target - t.sinkAnim) * 0.25;
    t.mesh.position.y = 0.75 - t.sinkAnim * 1.45;
    t.mesh.material.emissiveIntensity = t.dropped ? 0.2 : 1.2;
  }
}

function updateSpinnerState(dt) {
  spinnerState.passCd = Math.max(0, spinnerState.passCd - dt);
  // owed spins convert into revolutions over time; each revolution scores
  if (spinnerState.spinsOwed > 0 || Math.abs(spinnerState.spinVel) > 0.5) {
    const prevTurns = Math.floor(spinnerState.angle / (Math.PI * 2));
    spinnerState.angle += spinnerState.spinVel * dt;
    spinnerState.spinVel *= 1 - Math.min(1, dt * 1.3); // friction
    const turns = Math.floor(spinnerState.angle / (Math.PI * 2));
    let completed = Math.abs(turns - prevTurns);
    while (completed > 0 && spinnerState.spinsOwed > 0) {
      completed--;
      spinnerState.spinsOwed--;
      spinnerState.totalSpins++;
      game.ballStats.spinnerSpins++;
      addScore(100);
      Sfx.spinnerTick();
      // every 10 lifetime spins relights the kickback
      if (spinnerState.totalSpins % 10 === 0 && !game.kickbackLit) {
        game.kickbackLit = true;
        showBanner('KICKBACK RELIT', 1100);
        Sfx.kickback();
      }
    }
    if (Math.abs(spinnerState.spinVel) <= 0.5) spinnerState.spinsOwed = 0;
  }
}

let kickbackCd = 0;
function fireKickback(b) {
  if (kickbackCd > 0) return;
  kickbackCd = 1.2;
  game.kickbackLit = false;
  b.x = OUTLANES.left.kickback.x;
  b.vy = 34;
  b.vx = 2.5 + Math.random() * 1.5; // angled back into the field
  addScore(500);
  showBanner('KICKBACK!', 1000);
  Sfx.kickback();
  addShake(0.3);
  buzz(25);
  worldBurst(b.x, b.y, 0x6dffb0, 10, 10);
  spawnShockwave(b.x, b.y, 0x6dffb0, 3);
}

function onInlanePass(b) {
  if (game.bonusX < 6) {
    game.bonusX++;
    showBanner(`BONUS x${game.bonusX}`, 900);
  }
  addScore(500);
  Sfx.dataNodeRepeat();
  spawnPopup(b.x, b.y + 1.5, `BONUS x${game.bonusX}`, '#6dffb0');
  // lighting both inlanes in one ball lights the right-outlane SPECIAL
  if (game.bonusX >= 3 && !game.specialLit) {
    game.specialLit = true;
    lamps.special.state = 'flash';
    showBanner('SPECIAL LIT', 1100);
  }
}

// =====================================================================
// HACK MODES (timed mini-games) + WIZARD MODE
// =====================================================================
const HACK_MODES = [
  { id: 'storm', name: 'DATA STORM', durSec: 25, goal: 8, hint: 'Hit the flashing Data Nodes!' },
  { id: 'overclock', name: 'OVERCLOCK', durSec: 20, goal: 15, hint: 'Bumpers score 5x — rip into them!' },
  { id: 'breach', name: 'FIREWALL BREACH', durSec: 25, goal: 3, hint: 'Shoot the widened Firewall gate!' },
];

function startNextHackMode() {
  if (game.mode || performance.now() < game.wizardUntil) return;
  const next = HACK_MODES.find((m) => !game.modesCompleted[m.id]);
  if (!next) {
    startWizardMode();
    return;
  }
  game.mode = {
    id: next.id,
    name: next.name,
    until: performance.now() + next.durSec * 1000,
    progress: 0,
    goal: next.goal,
  };
  showBanner(next.name + '!');
  showHint(next.hint);
  DMD.push(next.name, next.hint.toUpperCase(), 2400);
  Sfx.modeStart();
  setMusicIntensity(true);
  flashGI(0xb14bff, 700);
  addShake(0.35);
  // storm: all nodes flash and re-arm
  if (next.id === 'storm') {
    for (const n of dataNodes) {
      n.lit = false;
      n.mesh.material = nodeMat(false);
    }
    game.litNodes = 0;
  }
}

function modeProgress(amount = 1) {
  if (!game.mode) return;
  game.mode.progress += amount;
  if (game.mode.progress >= game.mode.goal) {
    completeHackMode();
  }
}

function completeHackMode() {
  const m = game.mode;
  game.modesCompleted[m.id] = true;
  game.ballStats.modes = (game.ballStats.modes || 0) + 1;
  game.mode = null;
  addScore(25000);
  showBanner(`${m.name} COMPLETE! +25,000`);
  DMD.push(m.name, 'COMPLETE +25,000', 2200);
  showHint(null);
  Sfx.modeComplete();
  setMusicIntensity(balls.length > 1);
  flashGI(0x6dffb0, 700);
  addShake(0.5);
  updateModeLamps();
}

function failHackMode() {
  const m = game.mode;
  game.mode = null;
  const consolation = m.progress * 1000;
  if (consolation > 0) addScore(consolation);
  showBanner(`${m.name} OVER  +${consolation.toLocaleString()}`, 1400);
  DMD.push(m.name, 'TIME UP', 1800);
  showHint(null);
  Sfx.modeFail();
  setMusicIntensity(balls.length > 1);
}

function updateModeState() {
  if (game.mode && performance.now() > game.mode.until) {
    failHackMode();
  }
  kickbackCd = Math.max(0, kickbackCd - 1 / 120);
}

function updateModeLamps() {
  const ids = ['storm', 'overclock', 'breach'];
  ids.forEach((id, i) => {
    lamps['mode' + i].state = game.modesCompleted[id] ? 'on' : 'off';
  });
  lamps.modeReady.state = game.mode ? 'flash' : 'on';
}

// SYSTEM OVERRIDE: the wizard mode. Everything lit, 4-ball multiball,
// all scoring doubled, ball save for the whole ride, big completion bonus.
function startWizardMode() {
  const WIZARD_MS = 40000;
  game.wizardUntil = performance.now() + WIZARD_MS;
  game.jackpotLevel = 2;
  showBanner('SYSTEM OVERRIDE!');
  DMD.push('SYSTEM OVERRIDE', 'ALL SCORES 2X', 3000);
  showHint('SYSTEM OVERRIDE — everything counts double. Survive!');
  Sfx.wizardStart();
  setMusicIntensity(true);
  flashGI(0xffffff, 1200, 3);
  addShake(0.8);
  buzz(80);
  startMultiball();
  // celebrate along the rift
  for (let i = 0; i < 4; i++) {
    setTimeout(() => spawnBolt(-8 + Math.random() * 16, 8, -8 + Math.random() * 16, 42, 0xffffff), i * 180);
  }
  // when it ends, pay out and reset the mode ladder so it can be rebuilt
  setTimeout(() => {
    if (game.state !== 'playing' && game.state !== 'ready') return;
    addScore(100000);
    showBanner('OVERRIDE SURVIVED! +100,000');
    DMD.push('OVERRIDE BONUS', '+100,000', 2600);
    Sfx.superJackpot();
    game.modesCompleted = { storm: false, overclock: false, breach: false };
    updateModeLamps();
    setMusicIntensity(balls.length > 1);
  }, WIZARD_MS);
}

// =====================================================================
// SHOT COMBOS — chaining different major shots within a window
// =====================================================================
const COMBO_WINDOW_MS = 4000;
function registerShot(type, tx, ty) {
  const now = performance.now();
  if (game.lastShot && game.lastShot.type !== type && now - game.lastShot.atMs < COMBO_WINDOW_MS) {
    game.comboCount = Math.min(game.comboCount + 1, 5);
    const award = 2000 * game.comboCount;
    addScore(award);
    showBanner(`COMBO x${game.comboCount}  +${award.toLocaleString()}`, 1000);
    DMD.push(`COMBO x${game.comboCount}`, `+${award.toLocaleString()}`, 1400);
    Sfx.comboShot();
    if (tx != null) spawnPopup(tx, ty, `COMBO x${game.comboCount}`, '#ff8cf0');
  } else if (!game.lastShot || now - game.lastShot.atMs >= COMBO_WINDOW_MS) {
    game.comboCount = 0;
  }
  game.lastShot = { type, atMs: now };
}

// =====================================================================
// END-OF-BALL BONUS + MATCH
// =====================================================================
// Classic bonus ceremony: tally the ball's work, multiply by bonus X, then
// hand control back (next ball or game over) once the count-up finishes.
// Driven from the frame loop (not timers) so browser timer throttling and
// pauses can't stall the game between balls.
let bonusSeq = null;
function runEndOfBallBonus(done) {
  const s = game.ballStats;
  const items = [
    ['BUMPERS', s.bumperHits * 50],
    ['SPINNER', s.spinnerSpins * 100],
    ['NODES', s.nodes * 500],
    ['LANES', s.lanes * 1000],
    ['MODES', (s.modes || 0) * 5000],
  ].filter(([, v]) => v > 0);
  const subtotal = items.reduce((sum, [, v]) => sum + v, 0);
  const total = subtotal * game.bonusX;

  if (total <= 0) {
    done();
    return;
  }

  game.state = 'bonus'; // physics freezes while the ceremony runs
  showHint(null);
  bonusSeq = { items, idx: 0, paid: false, subtotal, total, done, nextAt: performance.now() + 380 };
}

function updateBonusSeq(nowMs) {
  if (!bonusSeq || nowMs < bonusSeq.nextAt) return;
  if (bonusSeq.idx < bonusSeq.items.length) {
    const [label, value] = bonusSeq.items[bonusSeq.idx++];
    DMD.push(label, `+${value.toLocaleString()}`, 500);
    spawnPopup(0, 12, `${label} +${value.toLocaleString()}`, '#6dfcff');
    Sfx.bonusTick();
    bonusSeq.nextAt = nowMs + 420;
  } else if (!bonusSeq.paid) {
    bonusSeq.paid = true;
    // raw score add (live multiplier pills don't apply to bonus)
    game.score += bonusSeq.total;
    scoreEl.textContent = game.score.toLocaleString();
    showBanner(`BONUS ${bonusSeq.subtotal.toLocaleString()} x${game.bonusX} = ${bonusSeq.total.toLocaleString()}`, 1500);
    DMD.push(`BONUS x${game.bonusX}`, bonusSeq.total.toLocaleString(), 1400);
    Sfx.jackpot();
    bonusSeq.nextAt = nowMs + 950;
  } else {
    const finish = bonusSeq.done;
    bonusSeq = null;
    game.state = 'playing';
    finish();
  }
}

function resetBallStats() {
  game.ballStats = { bumperHits: 0, spinnerSpins: 0, nodes: 0, lanes: 0, slings: 0, modes: 0 };
  game.bonusX = 1;
}

// Classic match sequence at game over: ~10% chance the last two digits of
// your score come up, earning a replay credit (an extra ball next game).
function runMatchSequence() {
  const playerDigits = game.score % 100 - (game.score % 10);
  const hit = Math.random() < 0.1;
  const shown = hit ? playerDigits : (playerDigits + 10 * (1 + Math.floor(Math.random() * 8))) % 100;
  setTimeout(() => {
    DMD.push('MATCH', `${String(shown).padStart(2, '0')}  --  ${String(playerDigits).padStart(2, '0')}`, 2400);
    if (hit) {
      setTimeout(() => {
        game.replayCredit = true;
        showBanner('MATCH! FREE BALL NEXT GAME');
        DMD.push('MATCH!', 'REPLAY EARNED', 2600);
        Sfx.matchHit();
        flashGI(0xffffff, 800, 3);
        addShake(0.7);
      }, 1200);
    } else {
      setTimeout(() => Sfx.matchMiss(), 1200);
    }
  }, 800);
}

// Advance the firewall gate position/cooldown and its visuals once per step.
const firewallGap = { min: 0, max: 0, center: 0 };
function updateFirewallState(dt) {
  game.firewallCooldown = Math.max(0, game.firewallCooldown - dt);
  const t = performance.now() / 1000;
  const gateCenterX = Math.sin((t / FIREWALL.periodSec) * Math.PI * 2) * FIREWALL.slideRange;
  // FIREWALL BREACH mode blows the gate wide open
  const gapHalf = game.mode && game.mode.id === 'breach' ? FIREWALL.gapHalfWidth * 1.7 : FIREWALL.gapHalfWidth;
  firewallGap.center = gateCenterX;
  firewallGap.min = gateCenterX - gapHalf;
  firewallGap.max = gateCenterX + gapHalf;

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
    game.firewallCooldown = 1.2;
    if (game.mode && game.mode.id === 'breach') {
      // FIREWALL BREACH mode: each pass through the widened gate scores huge
      addScore(10000);
      showBanner('BREACH! +10,000');
      DMD.push('BREACH', '+10,000', 1400);
      Sfx.superJackpot();
      spawnPopup(b.x, FIREWALL.y, '+10,000', '#ff8c6a');
      modeProgress(1);
    } else if (balls.length > 1) {
      // multiball: the gate is the JACKPOT shot, escalating each collect
      const award = 25000 * game.jackpotLevel;
      addScore(award);
      game.jackpotLevel = Math.min(game.jackpotLevel + 1, 4);
      showBanner(`JACKPOT! +${award.toLocaleString()}`);
      DMD.push('JACKPOT', `+${award.toLocaleString()}`, 2000);
      Sfx.superJackpot();
      flashGI(0xffb14b, 700, 2.6);
      spawnPopup(b.x, FIREWALL.y, 'JACKPOT', '#ffb14b');
      spawnShockwave(b.x, FIREWALL.y, 0xffb14b, 5);
    } else {
      addScore(5000);
      showBanner('FIREWALL JACKPOT!');
      Sfx.firewallJackpot();
    }
    addShake(0.6);
    buzz(30);
    worldBurst(b.x, FIREWALL.y, 0xff2a2a, 14, 11);
    registerShot('firewall', b.x, FIREWALL.y);
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
  registerShot('warp', b.x, b.y);
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
    if (balls.length === 1) {
      // multiball just ended
      game.jackpotLevel = 1;
      setMusicIntensity(!!game.mode || performance.now() < game.wizardUntil);
    }
    return;
  }

  // last ball drained: any running mode ends, then the bonus ceremony runs
  // before the life is actually charged
  if (game.mode) failHackMode();
  addShake(0.4);
  buzz(60);
  runEndOfBallBonus(() => {
    game.balls--;
    if (game.balls <= 0) {
      endGame();
    } else {
      showBanner(`${game.balls} BALL${game.balls === 1 ? '' : 'S'} LEFT`, 1200);
      resetBallToLane();
    }
  });
}

function endGame() {
  game.state = 'gameover';
  showHint(null);
  setMusicIntensity(false);
  const isNew = saveHighScore(game.score);
  game.isNewHighScore = isNew;
  overlayTitleEl.textContent = isNew ? 'NEW HIGH SCORE!' : 'GAME OVER';
  overlayMsg.textContent = `Final score ${game.score.toLocaleString()} — press SPACE / START to play again`;
  renderHighScores(game.score);
  showOverlay(true, true);
  Sfx.gameOver();
  runMatchSequence();
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
  const nowMs = performance.now();
  gridUniforms.uTime.value = nowMs / 1000;
  nebulaUniforms.uTime.value = nowMs / 1000;

  // pulsing lightning rift
  const pulse = 1.2 + Math.sin(nowMs / 140) * 0.7;
  riftMat.emissiveIntensity = pulse;
  riftLight.intensity = 0.5 + pulse * 0.4;

  // bumper hit-pulse animation
  for (const bm of compilerBumpers) {
    if (bm.pulse > 0) {
      bm.pulse = Math.max(0, bm.pulse - 0.06);
      bm.group.scale.setScalar(1 + bm.pulse * 0.25);
    }
  }

  // spinner plate whirls about its axle
  spinnerGroup.children[0].rotation.x = spinnerState.angle;

  // plasma ball: the chrome goes hot magenta during multiball / wizard
  const plasma = balls.length > 1 || nowMs < game.wizardUntil;
  ballMat.emissive.setHex(plasma ? 0xa8206e : 0x2a6f85);
  ballMat.emissiveIntensity = plasma ? 1.3 : 0.7;

  // insert lamp states driven by game state
  lamps.kickback.state = game.kickbackLit ? 'on' : 'off';
  lamps.jackpot.state = balls.length > 1 ? 'flash' : game.mode && game.mode.id === 'breach' ? 'flash' : 'off';
  lamps.modeReady.state = game.mode ? 'flash' : dropTargets.some((t) => t.dropped) ? 'flash' : 'on';
  updateLampVisuals(nowMs);
  kickbackMat.emissiveIntensity = game.kickbackLit ? 1.6 : 0.25;

  updateGI(nowMs);
  DMD.update(nowMs);
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
    // wizard mode: continuous ball save for the whole ride
    if (performance.now() < game.wizardUntil) {
      game.ballSaveUntil = Math.max(game.ballSaveUntil, performance.now() + 1000);
    }
  }

  updateBonusSeq(performance.now());
  updateParticles(dt);
  updatePopups(dt);
  updateShockwaves(dt);
  updateBolts(dt);
  updateCamera();
  syncVisuals();
  if (composer) composer.render();
  else renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// kick off in menu state
renderHighScores();
updateMissionHud();
updateLanesHud();
showOverlay(true, true);
