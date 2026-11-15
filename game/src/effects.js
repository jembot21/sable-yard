// effects.js — the game's visual feedback, all pooled: tracers, muzzle
// flashes, impact sparks, explosions and smoke. Nothing here is allocated
// per shot; fixed pools are recycled, because a firefight is exactly when
// the frame budget matters. Effects are cosmetic only — the simulation
// never reads them (smoke blocks sight through state.js data, not sprites).

import * as THREE from 'three';

const MAX_TRACERS = 48;
const MAX_SPARKS = 700;

let scene = null;
let tracerLines = null;
let tracerData = [];   // { ttl }
let tracerPos = null;
let sparkPoints = null;
let sparkPos = null;
let sparkVel = null;
let sparkCol = null;
let sparkLife = null;
let flashes = [];      // pooled muzzle flash sprites + lights
let smokesFx = [];     // live smoke visuals { group, t, life }
let shakeAmp = 0;
let chargeDevice = null;

const _v = new THREE.Vector3();

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

let glowTex = null;

export function initEffects(theScene) {
  scene = theScene;
  glowTex = glowTexture();

  const geo = new THREE.BufferGeometry();
  tracerPos = new Float32Array(MAX_TRACERS * 6);
  geo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  const colAttr = new Float32Array(MAX_TRACERS * 6);
  for (let i = 0; i < MAX_TRACERS; i++) {
    colAttr[i * 6 + 0] = 1; colAttr[i * 6 + 1] = 0.85; colAttr[i * 6 + 2] = 0.55;
    colAttr[i * 6 + 3] = 1; colAttr[i * 6 + 4] = 0.85; colAttr[i * 6 + 5] = 0.55;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colAttr, 3));
  tracerLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }));
  tracerLines.frustumCulled = false;
  scene.add(tracerLines);
  tracerData = Array.from({ length: MAX_TRACERS }, () => ({ ttl: 0 }));

  const sgeo = new THREE.BufferGeometry();
  sparkPos = new Float32Array(MAX_SPARKS * 3);
  sparkVel = new Float32Array(MAX_SPARKS * 3);
  sparkCol = new Float32Array(MAX_SPARKS * 3);
  sparkLife = new Float32Array(MAX_SPARKS);
  sgeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sgeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  // the glow texture matters: unmapped points draw as hard squares, mapped
  // ones as the soft round motes a spark should be
  sparkPoints = new THREE.Points(sgeo, new THREE.PointsMaterial({ size: 0.075, map: glowTex, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  sparkPoints.frustumCulled = false;
  scene.add(sparkPoints);

  for (let i = 0; i < 3; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc873, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.scale.set(0.55, 0.55, 1);
    scene.add(sprite);
    const light = new THREE.PointLight(0xffb36b, 0, 9, 2);
    scene.add(light);
    flashes.push({ sprite, light, ttl: 0 });
  }

  // the breach charge device, hidden until planted
  chargeDevice = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.4 }));
  body.position.y = 0.11;
  chargeDevice.add(body);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2222, emissiveIntensity: 2 }));
  lamp.position.set(0.1, 0.24, 0);
  chargeDevice.add(lamp);
  chargeDevice.visible = false;
  scene.add(chargeDevice);
}

let tracerCursor = 0;
export function tracer(from, to) {
  const i = tracerCursor;
  tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
  tracerPos[i * 6 + 0] = from.x; tracerPos[i * 6 + 1] = from.y; tracerPos[i * 6 + 2] = from.z;
  tracerPos[i * 6 + 3] = to.x; tracerPos[i * 6 + 4] = to.y; tracerPos[i * 6 + 5] = to.z;
  tracerData[i].ttl = 0.055;
  tracerLines.geometry.attributes.position.needsUpdate = true;
}

let flashCursor = 0;
export function muzzle(pos) {
  const f = flashes[flashCursor];
  flashCursor = (flashCursor + 1) % flashes.length;
  f.sprite.position.copy(pos);
  f.light.position.copy(pos);
  f.ttl = 0.045;
  f.sprite.material.opacity = 0.95;
  f.light.intensity = 26;
}

let sparkCursor = 0;
function spawnSpark(x, y, z, vx, vy, vz, r, g, b, life) {
  const i = sparkCursor;
  sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
  sparkPos[i * 3] = x; sparkPos[i * 3 + 1] = y; sparkPos[i * 3 + 2] = z;
  sparkVel[i * 3] = vx; sparkVel[i * 3 + 1] = vy; sparkVel[i * 3 + 2] = vz;
  sparkCol[i * 3] = r; sparkCol[i * 3 + 1] = g; sparkCol[i * 3 + 2] = b;
  sparkLife[i] = life;
}

export function impact(pos, kind) {
  if (kind === 'hit') {
    for (let i = 0; i < 7; i++) {
      spawnSpark(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 1.6, Math.random() * 1.4, (Math.random() - 0.5) * 1.6, 0.55, 0.1, 0.08, 0.35);
    }
  } else {
    for (let i = 0; i < 6; i++) {
      spawnSpark(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 2.6, Math.random() * 2.2, (Math.random() - 0.5) * 2.6, 1, 0.8, 0.45, 0.3);
    }
  }
}

export function explosionFx(pos) {
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * 2.4, sp = 3 + Math.random() * 8;
    spawnSpark(pos.x, pos.y + 0.4, pos.z, Math.cos(a) * sp, e * 2.2, Math.sin(a) * sp, 1, 0.55 + Math.random() * 0.3, 0.15, 0.7 + Math.random() * 0.5);
  }
  const f = flashes[0];
  f.sprite.position.set(pos.x, pos.y + 0.7, pos.z);
  f.light.position.copy(f.sprite.position);
  f.sprite.scale.set(4.5, 4.5, 1);
  f.ttl = 0.22;
  f.sprite.material.opacity = 1;
  f.light.intensity = 300;
  shakeAmp = Math.min(0.5, shakeAmp + 0.3);
  setTimeout(() => { f.sprite.scale.set(0.55, 0.55, 1); }, 260);
}

export function spawnSmokeFx(x, z) {
  const group = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: glowTex, color: 0x9aa0a4, transparent: true, opacity: 0, depthWrite: false });
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(mat);
    const a = (i / 9) * Math.PI * 2;
    s.position.set(Math.cos(a) * 1.4 * Math.random(), 0.7 + Math.random() * 1.6, Math.sin(a) * 1.4 * Math.random());
    const sc = 2.4 + Math.random() * 2;
    s.scale.set(sc, sc, 1);
    group.add(s);
  }
  group.position.set(x, 0, z);
  scene.add(group);
  smokesFx.push({ group, mat, t: 0, life: 15 });
}

export function setChargeDevice(pos, blink) {
  if (!pos) { chargeDevice.visible = false; return; }
  chargeDevice.visible = true;
  chargeDevice.position.set(pos.x, pos.y, pos.z);
  chargeDevice.children[1].material.emissiveIntensity = blink ? 3.2 : 0.4;
}

export function addShake(amount) {
  shakeAmp = Math.min(0.35, shakeAmp + amount);
}

export function shakeValue() {
  return shakeAmp;
}

export function updateEffects(dt) {
  shakeAmp = Math.max(0, shakeAmp - dt * 1.4);
  for (let i = 0; i < MAX_TRACERS; i++) {
    if (tracerData[i].ttl > 0) {
      tracerData[i].ttl -= dt;
      if (tracerData[i].ttl <= 0) {
        for (let k = 0; k < 6; k++) tracerPos[i * 6 + k] = 0;
        tracerLines.geometry.attributes.position.needsUpdate = true;
      }
    }
  }
  let anySpark = false;
  for (let i = 0; i < MAX_SPARKS; i++) {
    if (sparkLife[i] <= 0) continue;
    anySpark = true;
    sparkLife[i] -= dt;
    sparkVel[i * 3 + 1] -= 5.5 * dt;
    sparkPos[i * 3] += sparkVel[i * 3] * dt;
    sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
    sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
    if (sparkPos[i * 3 + 1] < 0.03) { sparkPos[i * 3 + 1] = 0.03; sparkVel[i * 3 + 1] = 0; }
    if (sparkLife[i] <= 0) sparkPos[i * 3 + 1] = -10;
  }
  if (anySpark) {
    sparkPoints.geometry.attributes.position.needsUpdate = true;
    sparkPoints.geometry.attributes.color.needsUpdate = true;
  }
  for (const f of flashes) {
    if (f.ttl > 0) {
      f.ttl -= dt;
      if (f.ttl <= 0) { f.sprite.material.opacity = 0; f.light.intensity = 0; }
    }
  }
  for (let i = smokesFx.length - 1; i >= 0; i--) {
    const s = smokesFx[i];
    s.t += dt;
    const grow = Math.min(1, s.t / 2.2);
    const fade = s.t > s.life - 2.5 ? Math.max(0, (s.life - s.t) / 2.5) : 1;
    s.mat.opacity = 0.34 * grow * fade;
    if (s.t >= s.life) {
      scene.remove(s.group);
      smokesFx.splice(i, 1);
    }
  }
}
