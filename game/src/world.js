// world.js — the Sable Yard map: one freight yard at dusk, built from boxes,
// cylinders and painted canvas. Every solid prop registers an axis-aligned
// collider as it is placed, so the visible map and the collision map are the
// same list and can never drift apart. The module also owns the spatial
// questions the rest of the game asks: what blocks a sightline or a bullet,
// where the floor is, and which waypoints a bot may walk between.
//
// Layout (metres, x east, z south): the Jackals spawn at the west dock and
// attack two sites at the east end — A, a fuel depot to the north, and B, a
// gantry yard to the south. Three lanes join them: a container alley north,
// a warehouse through the middle, and a rail line south, with two connectors
// on the east side for rotations.

import * as THREE from 'three';
import { PAL, noiseFill, toTexture, concreteTexture, metalTexture, containerTexture, crateTexture, hazardTexture, skyTexture } from './palette.js';

export const WORLD = {
  colliders: [],   // { minX, maxX, minZ, maxZ, h } — solid from y=0 to y=h
  sites: {
    A: { x: 27, z: -20, r: 6.5, name: 'Site A — Fuel Depot' },
    B: { x: 27, z: 20, r: 6.5, name: 'Site B — Gantry Yard' },
  },
  spawns: {
    jackals: [[-34, -4], [-34, 0], [-34, 4], [-32.5, -7], [-32.5, 7]],
    wardens: [[34, -3], [34, 1], [34, 5], [32.5, -6], [32.5, 8]],
  },
  navNodes: [],
  minX: -38, maxX: 38, minZ: -30, maxZ: 30,
};

const boxGeoCache = new Map();
function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let g = boxGeoCache.get(key);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); boxGeoCache.set(key, g); }
  return g;
}

let scene = null;
const mats = {};

function materials() {
  if (mats.done) return mats;
  mats.done = true;
  mats.concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(7), roughness: 0.95 });
  mats.concreteDark = new THREE.MeshStandardMaterial({ map: concreteTexture(12), color: 0x9a9a94, roughness: 0.95 });
  mats.metal = new THREE.MeshStandardMaterial({ map: metalTexture(21), roughness: 0.6, metalness: 0.55 });
  mats.metalDark = new THREE.MeshStandardMaterial({ map: metalTexture(27), color: 0x8a9298, roughness: 0.65, metalness: 0.5 });
  mats.crate = new THREE.MeshStandardMaterial({ map: crateTexture(33), roughness: 0.9 });
  mats.crate2 = new THREE.MeshStandardMaterial({ map: crateTexture(48), roughness: 0.9 });
  mats.hazard = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.8 });
  mats.rust = new THREE.MeshStandardMaterial({ color: PAL.rust, roughness: 0.85, metalness: 0.3 });
  mats.tank = new THREE.MeshStandardMaterial({ color: 0xb9bcb4, roughness: 0.45, metalness: 0.6 });
  mats.dark = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.9 });
  mats.containers = {};
  const defs = [
    ['teal', PAL.boxTeal, 'SY-2041'], ['ochre', PAL.boxOchre, 'SY-0873'],
    ['red', PAL.boxRed, 'SY-5520'], ['blue', PAL.boxBlue, 'SY-3314'],
  ];
  for (const [name, colour, label] of defs) {
    mats.containers[name] = new THREE.MeshStandardMaterial({ map: containerTexture(colour, label, label.charCodeAt(3) * 13 + 5), roughness: 0.7, metalness: 0.35 });
  }
  return mats;
}

// Place a solid box: mesh + collider in one call, so they always agree.
// (cx, cz) is the centre, w/d the footprint, h the height from the ground.
export function solid(cx, cz, w, d, h, mat, y0 = 0) {
  const mesh = new THREE.Mesh(boxGeo(w, h, d), mat);
  mesh.position.set(cx, y0 + h / 2, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (y0 === 0) WORLD.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
  return mesh;
}

function visual(cx, cy, cz, w, h, d, mat) {
  const mesh = new THREE.Mesh(boxGeo(w, h, d), mat);
  mesh.position.set(cx, cy, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function cylinder(cx, cz, r, h, mat, colliderH = null) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 18), mat);
  mesh.position.set(cx, h / 2, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (colliderH !== null) {
    WORLD.colliders.push({ minX: cx - r * 0.92, maxX: cx + r * 0.92, minZ: cz - r * 0.92, maxZ: cz + r * 0.92, h: colliderH });
  }
  return mesh;
}

function barrel(cx, cz, colour) {
  const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6, metalness: 0.4 });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.95, 12), mat);
  mesh.position.set(cx, 0.475, cz);
  mesh.castShadow = true;
  scene.add(mesh);
  WORLD.colliders.push({ minX: cx - 0.3, maxX: cx + 0.3, minZ: cz - 0.3, maxZ: cz + 0.3, h: 0.95 });
}

function container(cx, cz, colour, alongX = true, stack = 1) {
  const m = materials();
  const w = alongX ? 6.1 : 2.6, d = alongX ? 2.6 : 6.1;
  for (let i = 0; i < stack; i++) {
    const mesh = new THREE.Mesh(boxGeo(w, 2.6, d), m.containers[colour]);
    mesh.position.set(cx, 1.3 + i * 2.6, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  WORLD.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h: 2.6 * stack });
}

function crate(cx, cz, stack = 1, size = 1.08) {
  const m = materials();
  for (let i = 0; i < stack; i++) {
    const mesh = new THREE.Mesh(boxGeo(size, size, size), i % 2 ? m.crate2 : m.crate);
    mesh.position.set(cx, size / 2 + i * size, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  WORLD.colliders.push({ minX: cx - size / 2, maxX: cx + size / 2, minZ: cz - size / 2, maxZ: cz + size / 2, h: size * stack });
}

// A low cover wall, chest-high: standing shots pass over it, a crouched
// fighter is hidden behind it. The tactical furniture of both sites.
function coverWall(cx, cz, w, d) {
  solid(cx, cz, w, d, 1.05, materials().concreteDark);
  visual(cx, 1.09, cz, w, 0.08, d, materials().hazard);
}

// The ground is one big painted canvas: asphalt with concrete aprons, the
// rail line in the south lane, painted site circles and lane markings. It is
// the cheapest texture in the game and does most of the wayfinding work — a
// player reads the yard from its paint before they learn its geometry.
function groundTexture() {
  const W = 2048, H = 1616; // 76 m x 60 m at ~27 px per metre
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const px = (mx) => (mx - WORLD.minX) / (WORLD.maxX - WORLD.minX) * W;
  const pz = (mz) => (mz - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ) * H;
  noiseFill(x, W, H, PAL.asphalt, 99, 0.22);
  // concrete aprons: mid warehouse floor and the east yard
  x.fillStyle = 'rgba(150,150,144,0.5)';
  x.fillRect(px(-10), pz(-11), px(14) - px(-10), pz(11) - pz(-11));
  x.fillRect(px(18), pz(-29), px(38) - px(18), pz(29) - pz(-29));
  x.fillStyle = 'rgba(120,120,116,0.35)';
  x.fillRect(px(-38), pz(-10), px(-22) - px(-38), pz(10) - pz(-10));
  // rail line along the south lane: two steel strips and sleepers
  x.fillStyle = 'rgba(20,20,22,0.55)';
  x.fillRect(0, pz(20.2), W, pz(23.8) - pz(20.2));
  x.fillStyle = '#6d6a63';
  for (let mx = -38; mx < 38; mx += 1.1) x.fillRect(px(mx), pz(20.5), 10, pz(23.5) - pz(20.5));
  x.fillStyle = '#a8adb2';
  x.fillRect(0, pz(20.9), W, 4);
  x.fillRect(0, pz(23.1), W, 4);
  // lane centrelines
  x.strokeStyle = 'rgba(230,225,210,0.28)';
  x.lineWidth = 5;
  x.setLineDash([26, 20]);
  x.beginPath(); x.moveTo(px(-36), pz(-21)); x.lineTo(px(20), pz(-21)); x.stroke();
  x.beginPath(); x.moveTo(px(-36), pz(14)); x.lineTo(px(20), pz(14)); x.stroke();
  x.setLineDash([]);
  // site circles and letters
  for (const [key, site] of Object.entries(WORLD.sites)) {
    x.strokeStyle = key === 'A' ? 'rgba(255,138,42,0.85)' : 'rgba(53,196,220,0.85)';
    x.lineWidth = 7;
    x.beginPath(); x.arc(px(site.x), pz(site.z), site.r * 27, 0, Math.PI * 2); x.stroke();
    x.font = 'bold 120px system-ui, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = key === 'A' ? 'rgba(255,138,42,0.5)' : 'rgba(53,196,220,0.5)';
    x.fillText(key, px(site.x), pz(site.z));
  }
  // spawn chevrons
  x.fillStyle = 'rgba(255,138,42,0.4)';
  x.font = 'bold 54px system-ui, sans-serif';
  x.fillText('JACKALS', px(-33), pz(11));
  x.fillStyle = 'rgba(53,196,220,0.4)';
  x.fillText('WARDENS', px(33.4), pz(-10));
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function floodlight(cx, cz, warm = true) {
  const m = materials();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7.4, 8), m.metalDark);
  pole.position.set(cx, 3.7, cz);
  pole.castShadow = true;
  scene.add(pole);
  const head = visual(cx, 7.45, cz, 1.1, 0.3, 0.5, m.dark);
  head.material = m.dark;
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x554a33, emissive: warm ? 0xffb36b : 0xbcd6ff, emissiveIntensity: 2.4 });
  visual(cx, 7.28, cz, 0.95, 0.1, 0.4, lampMat);
  const light = new THREE.PointLight(warm ? 0xffc98a : 0xcfe4ff, 60, 26, 1.8);
  light.position.set(cx, 7.1, cz);
  scene.add(light);
  WORLD.colliders.push({ minX: cx - 0.14, maxX: cx + 0.14, minZ: cz - 0.14, maxZ: cz + 0.14, h: 7.4 });
}

export function buildWorld(theScene) {
  scene = theScene;
  const m = materials();

  // sky, fog and light: a low warm sun from the west, cool sky fill
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(240, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
  scene.fog = new THREE.Fog(PAL.fog, 55, 190);
  const sun = new THREE.DirectionalLight(PAL.sun, 3.1);
  sun.position.set(-60, 34, -28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.2));
  // a cool fill from the east, so shadow sides keep their shapes
  const fill = new THREE.DirectionalLight(0x9db8d6, 0.55);
  fill.position.set(50, 26, 30);
  scene.add(fill);

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.maxX - WORLD.minX, WORLD.maxZ - WORLD.minZ),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // perimeter: boundary walls with warehouse sheds behind them (silhouette)
  solid(0, -30.6, 78, 1.2, 4.4, m.concreteDark);
  solid(0, 30.6, 78, 1.2, 4.4, m.concreteDark);
  solid(-38.6, 0, 1.2, 62, 4.4, m.concreteDark);
  solid(38.6, 0, 1.2, 62, 4.4, m.concreteDark);
  for (const [x, z, w] of [[-20, -33.5, 22], [8, -33.5, 26], [24, 33.5, 20], [-14, 33.5, 24]]) {
    visual(x, 3.4, z, w, 6.8, 5.5, m.metalDark);
    visual(x, 7.1, z, w * 0.98, 0.5, 6, m.dark);
  }

  buildWarehouse(m);
  buildNorthLane(m);
  buildSouthLane(m);
  buildSiteA(m);
  buildSiteB(m);
  buildWestYard(m);
  buildEastYard(m);
  floodlight(-24, -13);
  floodlight(16, -26);
  floodlight(20, 14, false);
  floodlight(-18, 26);
  floodlight(30, 0);
  buildNav();
  return WORLD;
}

function buildWarehouse(m) {
  const h = 5;
  // walls with door gaps (north door x 2..5, south door x 0..3.4, west
  // loading gap z -2..2.5, east door z -1..2)
  solid(-3, -9, 10, 0.5, h, m.concrete); solid(8.5, -9, 7, 0.5, h, m.concrete);
  solid(-4, 9, 8, 0.5, h, m.concrete); solid(7.7, 9, 8.6, 0.5, h, m.concrete);
  solid(-8, -5.5, 0.5, 7, h, m.concrete); solid(-8, 6.2, 0.5, 5.6, h, m.concrete);
  solid(12, -5.5, 0.5, 7, h, m.concrete); solid(12, 5.5, 0.5, 7, h, m.concrete);
  // roof and its beams (visual only — the fight stays on the floor)
  visual(2, 5.35, 0, 21.5, 0.35, 19.5, m.metalDark);
  for (const bx of [-6, 0, 6, 11]) visual(bx, 4.9, 0, 0.4, 0.5, 18.6, m.dark);
  // glowing strip lights under the roof
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x444033, emissive: 0xffd9a0, emissiveIntensity: 1.8 });
  for (const lx of [-4, 2, 8]) visual(lx, 4.6, 0, 2.6, 0.12, 0.5, lampMat);
  const inLight = new THREE.PointLight(0xffd9a0, 50, 24, 1.7);
  inLight.position.set(2, 4.2, 0);
  scene.add(inLight);
  // interior cover: crate clusters and a forklift-shaped stack of boxes
  crate(-3, -4, 2); crate(-1.8, -4, 1); crate(5.5, 3.5, 2); crate(5.5, 5, 1);
  crate(8, -4.5, 1); crate(-5, 5.5, 1);
  solid(-6.2, 0.8, 2.6, 1.4, 1.5, m.rust);           // forklift body
  visual(-7.2, 1.9, 0.8, 0.25, 2.4, 1.3, m.dark);    // its mast
  barrel(9.5, 6.5, 0x7a4a26); barrel(10.2, 5.8, 0x5d6a72);
}

function buildNorthLane(m) {
  container(-20, -21, 'teal');
  container(-26, -25.5, 'ochre', false);
  container(-2, -24.5, 'red');
  crate(-2, -17.5, 1); crate(-0.8, -17.5, 2);
  container(9, -21, 'blue');
  container(15, -25.5, 'teal', false);
  crate(13.5, -16.5, 2); crate(19, -18, 1);
  barrel(-12, -18.4, 0x7a4a26); barrel(-11.3, -18.9, 0x96502f);
  // a scaffold platform visual over the lane's middle (no collider up top)
  visual(3, 3.1, -21, 5, 0.25, 3, m.metalDark);
  for (const [lx, lz] of [[0.8, -22.2], [5.2, -22.2], [0.8, -19.8], [5.2, -19.8]]) {
    visual(lx, 1.5, lz, 0.18, 3, 0.18, m.metalDark);
  }
}

function buildSouthLane(m) {
  // two rail wagons with a crossing gap between them
  solid(-14, 22, 11, 2.8, 2.9, m.metalDark);
  visual(-14, 3.15, 22, 11.4, 0.3, 3.1, m.rust);
  solid(7, 22, 11, 2.8, 2.9, m.metalDark);
  visual(7, 3.15, 22, 11.4, 0.3, 3.1, m.rust);
  container(-24, 17.5, 'red', false);
  crate(-24, 24.5, 2); crate(-19, 18.5, 1);
  crate(1, 17.8, 1); crate(2.2, 17.8, 2);
  container(16, 26, 'ochre');
  barrel(13, 18.2, 0x5d6a72); barrel(13.7, 18.8, 0x7a4a26);
}

function buildSiteA(m) {
  // fuel depot: one standing tank, two horizontal tanks on saddles
  cylinder(31, -25.5, 2.2, 5.2, m.tank, 5.2);
  const horiz = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 5.6, 16), m.tank);
  horiz.rotation.z = Math.PI / 2;
  horiz.position.set(24.5, 1.9, -26.5);
  horiz.castShadow = true;
  scene.add(horiz);
  WORLD.colliders.push({ minX: 21.8, maxX: 27.2, minZ: -28, maxZ: -25, h: 3.4 });
  visual(22.6, 0.5, -26.5, 0.5, 1, 1.6, m.dark);
  visual(26.4, 0.5, -26.5, 0.5, 1, 1.6, m.dark);
  coverWall(22.5, -15.5, 4.4, 0.6);
  coverWall(30, -19, 0.6, 4.2);
  coverWall(25, -23.5, 0.6, 3.4);
  crate(28.5, -13.8, 1); crate(20.8, -22, 2);
  barrel(24, -17.5, 0x96502f); barrel(24.7, -18.1, 0x7a4a26);
  solid(33.5, -21, 2.2, 6, 3.2, m.metal); // pump house
}

function buildSiteB(m) {
  // gantry yard: a crane frame over the plant zone (visual), containers as walls
  for (const [lx, lz] of [[21.5, 15.5], [32.5, 15.5], [21.5, 24.5], [32.5, 24.5]]) {
    visual(lx, 3.4, lz, 0.45, 6.8, 0.45, m.rust);
    WORLD.colliders.push({ minX: lx - 0.24, maxX: lx + 0.24, minZ: lz - 0.24, maxZ: lz + 0.24, h: 6.8 });
  }
  visual(27, 6.9, 15.5, 11.6, 0.5, 0.6, m.rust);
  visual(27, 6.9, 24.5, 11.6, 0.5, 0.6, m.rust);
  visual(27, 6.9, 20, 0.6, 0.5, 9.6, m.rust);
  visual(27, 5.6, 20, 1.1, 1.1, 1.1, m.dark); // the hook block
  container(27, 27.2, 'teal');
  container(19.5, 20, 'ochre', false);
  coverWall(24, 15.8, 4.2, 0.6);
  coverWall(31.5, 21.5, 0.6, 4);
  crate(23.5, 23.8, 2); crate(30, 17, 1);
  barrel(29.2, 24.6, 0x5d6a72);
}

function buildWestYard(m) {
  container(-29.5, -7, 'red', false);
  container(-29.5, 8, 'blue', false, 2);
  crate(-24, -3, 1); crate(-24, 3.5, 2); crate(-21, 0, 1);
  barrel(-26.5, -11, 0x7a4a26); barrel(-25.8, -11.5, 0x96502f);
  solid(-36.5, 14, 2.6, 5, 2.2, m.metal); // dock office container-office
}

function buildEastYard(m) {
  solid(34.5, 6, 3, 3, 3, m.concrete); // guard hut between the sites
  visual(34.5, 3.25, 6, 3.5, 0.3, 3.5, m.dark);
  crate(30.5, -6, 1); crate(30.5, 9.5, 2); crate(24, 0, 1);
  coverWall(28, -9, 3.6, 0.6);
  coverWall(28, 10.5, 3.6, 0.6);
  barrel(35, -12, 0x7a4a26);
}

// Waypoints: hand-placed along the lanes and through the doors; edges are
// derived, not listed — two nodes are linked when they are close and the
// straight walk between them clears every collider (tested with a margin),
// so a route can never ask a bot to walk through a wall.
const NAV_POINTS = [
  [-33, 0], [-26, -8], [-26, 8], [-24, 0],
  [-20, -21], [-12, -21], [-4, -20], [4, -21], [12, -20], [3, -13],
  [-20, 20], [-12, 21], [-4, 18.6], [4, 21], [12, 20], [1, 12.5],
  [-11, 0], [3, -6], [2, 0], [1, 6.5], [14.5, 0.5], [20, 0],
  [17, -12], [18, -19], [23, -20], [28, -16.5], [26, -8.5],
  [17, 12], [18, 19], [23, 20], [28, 23], [26, 8.5],
  [33, 0], [30, -13], [30, 13],
];

function segmentClear(ax, az, bx, bz, margin) {
  // 2D segment vs each collider's footprint, inflated by the margin
  for (const c of WORLD.colliders) {
    if (c.h < 0.5) continue;
    const minX = c.minX - margin, maxX = c.maxX + margin;
    const minZ = c.minZ - margin, maxZ = c.maxZ + margin;
    if (segmentHitsBox(ax, az, bx, bz, minX, minZ, maxX, maxZ)) return false;
  }
  return true;
}

function segmentHitsBox(ax, az, bx, bz, minX, minZ, maxX, maxZ) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) { if (ax < minX || ax > maxX) return false; }
  else {
    let ta = (minX - ax) / dx, tb = (maxX - ax) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az < minZ || az > maxZ) return false; }
  else {
    let ta = (minZ - az) / dz, tb = (maxZ - az) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

function buildNav() {
  WORLD.navNodes = NAV_POINTS.map(([x, z], i) => ({ i, x, z, next: [] }));
  for (const a of WORLD.navNodes) {
    for (const b of WORLD.navNodes) {
      if (a.i >= b.i) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 16) continue;
      if (segmentClear(a.x, a.z, b.x, b.z, 0.55)) {
        a.next.push(b.i);
        b.next.push(a.i);
      }
    }
  }
}

export function nearestNode(x, z) {
  let best = 0, bestD = Infinity;
  for (const n of WORLD.navNodes) {
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bestD) { bestD = d; best = n.i; }
  }
  return best;
}

// Does a 3D segment stay clear of every solid box? Sightlines and bullets
// both ask this; the boxes stand from y=0 to their height h.
export function losBlocked(ax, ay, az, bx, by, bz) {
  for (const c of WORLD.colliders) {
    if (segmentHitsBox3D(ax, ay, az, bx, by, bz, c)) return true;
  }
  return false;
}

function segmentHitsBox3D(ax, ay, az, bx, by, bz, c) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) { if (ax < c.minX || ax > c.maxX) return false; }
  else {
    let ta = (c.minX - ax) / dx, tb = (c.maxX - ax) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az < c.minZ || az > c.maxZ) return false; }
  else {
    let ta = (c.minZ - az) / dz, tb = (c.maxZ - az) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dy) < 1e-9) { if (ay < 0 || ay > c.h) return false; }
  else {
    let ta = (0 - ay) / dy, tb = (c.h - ay) / dy;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// Nearest distance at which a ray meets the world (a collider or the
// ground), or Infinity. Used to stop bullets and place impact effects.
export function rayHitDistance(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  if (dy < -1e-6) {
    const t = -oy / dy;
    if (t > 0 && t < best) best = t;
  }
  for (const c of WORLD.colliders) {
    const t = rayBoxEntry(ox, oy, oz, dx, dy, dz, c);
    if (t !== null && t < best) best = t;
  }
  return best === maxDist ? Infinity : best;
}

function rayBoxEntry(ox, oy, oz, dx, dy, dz, c) {
  let t0 = 0, t1 = Infinity;
  if (Math.abs(dx) < 1e-9) { if (ox < c.minX || ox > c.maxX) return null; }
  else {
    let ta = (c.minX - ox) / dx, tb = (c.maxX - ox) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < c.minZ || oz > c.maxZ) return null; }
  else {
    let ta = (c.minZ - oz) / dz, tb = (c.maxZ - oz) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < 0 || oy > c.h) return null; }
  else {
    let ta = (0 - oy) / dy, tb = (c.h - oy) / dy;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

const STEP = 0.55; // the tallest lip a fighter steps up without jumping

// The floor under a point: the top of the highest low collider there (a
// crate top is a floor), else the ground itself.
export function groundAt(x, z, feetY) {
  let g = 0;
  for (const c of WORLD.colliders) {
    if (c.h <= feetY + STEP && c.h > g && x > c.minX - 0.28 && x < c.maxX + 0.28 && z > c.minZ - 0.28 && z < c.maxZ + 0.28) {
      g = c.h;
    }
  }
  return g;
}

// Push a circle (a fighter's footprint) out of every tall collider. Called
// after integrating horizontal movement; resolves one axis penetration at a
// time by the smallest push.
export function collideMove(pos, radius) {
  for (const c of WORLD.colliders) {
    if (c.h <= pos.y + STEP) continue;
    const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * radius;
      pos.z = nz + (dz / d) * radius;
    } else {
      // centre inside the box: leave by the nearest face
      const left = pos.x - c.minX, right = c.maxX - pos.x;
      const top = pos.z - c.minZ, bottom = c.maxZ - pos.z;
      const min = Math.min(left, right, top, bottom);
      if (min === left) pos.x = c.minX - radius;
      else if (min === right) pos.x = c.maxX + radius;
      else if (min === top) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
    }
  }
  pos.x = Math.max(WORLD.minX + 0.4, Math.min(WORLD.maxX - 0.4, pos.x));
  pos.z = Math.max(WORLD.minZ + 0.4, Math.min(WORLD.maxZ - 0.4, pos.z));
}

// A unit direction from yaw and pitch (yaw 0 faces -z, pitch up positive).
// One helper so the camera, the bots and the ballistics all agree.
export function dirFromAngles(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  return out;
}

export function yawOf(dx, dz) {
  return Math.atan2(-dx, -dz);
}
