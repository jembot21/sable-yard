// models.js — the fighters and the first-person weapon, built from boxes in
// the yard's palette. A soldier is a small rig of named parts (legs, torso,
// head, gun arm) that updateSoldier poses each frame from the combatant's
// simulation state: walk swing, crouch, aim pitch, a fall when killed. The
// viewmodel is one stylised gun per weapon, swapped as the player switches.

import * as THREE from 'three';
import { PAL } from './palette.js';

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

// Materials are per-soldier (cheap at ten fighters) so a hit can flash the
// vest without touching anyone else's.
export function buildSoldier(team) {
  const teamColour = team === 'wardens' ? PAL.wardens : PAL.jackals;
  const uniform = new THREE.MeshStandardMaterial({ color: team === 'wardens' ? 0x3d4a55 : 0x55483a, roughness: 0.92 });
  const vest = new THREE.MeshStandardMaterial({ color: teamColour, roughness: 0.8, emissive: teamColour, emissiveIntensity: 0 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.7, metalness: 0.3 });

  const group = new THREE.Group();
  const rig = new THREE.Group(); // everything above the ankles; drops when crouching
  group.add(rig);

  const legL = new THREE.Group(); legL.position.set(-0.11, 0.86, 0);
  legL.add(box(0.17, 0.86, 0.2, uniform, 0, -0.43, 0));
  const legR = new THREE.Group(); legR.position.set(0.11, 0.86, 0);
  legR.add(box(0.17, 0.86, 0.2, uniform, 0, -0.43, 0));
  group.add(legL, legR);

  const torso = box(0.48, 0.62, 0.27, uniform, 0, 1.17, 0);
  const vestMesh = box(0.52, 0.46, 0.33, vest, 0, 1.2, 0);
  const head = new THREE.Group(); head.position.set(0, 1.52, 0);
  head.add(box(0.25, 0.27, 0.25, skin, 0, 0.1, 0));
  head.add(box(0.31, 0.13, 0.31, vest, 0, 0.26, 0)); // helmet in team colour
  head.add(box(0.3, 0.06, 0.12, dark, 0, 0.16, -0.14)); // visor shade

  const armR = new THREE.Group(); armR.position.set(0.3, 1.38, 0);
  armR.add(box(0.13, 0.13, 0.52, uniform, 0, -0.04, -0.2));
  const gun = new THREE.Group(); gun.position.set(0.02, -0.06, -0.42);
  gun.add(box(0.08, 0.14, 0.66, dark, 0, 0, -0.1));
  gun.add(box(0.05, 0.05, 0.3, dark, 0, 0.05, -0.5));
  armR.add(gun);
  const armL = box(0.13, 0.13, 0.44, uniform, -0.28, 1.3, -0.18);
  armL.rotation.x = -0.5;

  // the breach charge rides on the carrier's back, visible to both teams
  const pack = box(0.34, 0.24, 0.14, dark, 0, 1.22, 0.22);
  const packLamp = box(0.07, 0.05, 0.03, new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2222, emissiveIntensity: 2 }), 0.08, 1.36, 0.3);
  pack.visible = packLamp.visible = false;

  rig.add(torso, vestMesh, head, armR, armL, pack, packLamp);
  group.userData = { rig, legL, legR, head, armR, vest, pack, packLamp, walk: 0, fallT: 0 };
  return group;
}

const _targetQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();

export function updateSoldier(c, dt) {
  const g = c.mesh;
  if (!g) return;
  const u = g.userData;
  g.position.copy(c.pos);
  if (!c.alive) {
    // fall where killed, over half a second, then lie still
    u.fallT = Math.min(1, u.fallT + dt * 2.2);
    g.rotation.set(-(Math.PI / 2) * u.fallT * 0.92, c.yaw, 0);
    g.position.y = c.pos.y + 0.12 * u.fallT;
    return;
  }
  u.fallT = 0;
  g.rotation.set(0, c.yaw, 0);
  const speed = c.moveSpeed;
  u.walk += dt * (2.1 + speed * 1.35) * (speed > 0.15 ? 1 : 0);
  const swing = Math.sin(u.walk) * Math.min(0.55, speed * 0.16);
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  const crouchDrop = c.crouch ? 0.44 : 0;
  u.rig.position.y = -crouchDrop + Math.abs(Math.sin(u.walk)) * Math.min(0.05, speed * 0.012);
  u.legL.rotation.x += c.crouch ? 0.85 : 0;
  u.legR.rotation.x += c.crouch ? 0.5 : 0;
  u.armR.rotation.x = -c.pitch * 0.8;
  u.head.rotation.x = -c.pitch * 0.5;
  // a white-red flash on the vest the moment damage lands
  const sinceHit = performance.now() / 1000 - (c.dmgWallT || 0);
  u.vest.emissiveIntensity = sinceHit < 0.09 ? 0.85 : 0;
  const carries = !!(c.chargeCarrying);
  u.pack.visible = u.packLamp.visible = carries;
}

// --- the first-person weapon ----------------------------------------------

const GUN_SHAPES = {
  p9:      { body: [0.07, 0.11, 0.34], barrel: [0.04, 0.04, 0.1], mag: 0.12, sight: 0.05 },
  kestrel: { body: [0.08, 0.13, 0.52], barrel: [0.045, 0.045, 0.16], mag: 0.2, sight: 0.06 },
  mule:    { body: [0.09, 0.13, 0.62], barrel: [0.06, 0.06, 0.2], mag: 0.1, sight: 0.04 },
  ar57:    { body: [0.08, 0.14, 0.58], barrel: [0.045, 0.045, 0.22], mag: 0.19, sight: 0.07 },
  longbow: { body: [0.08, 0.13, 0.74], barrel: [0.04, 0.04, 0.3], mag: 0.14, sight: 0.12, scope: true },
};

export function buildViewmodels() {
  const group = new THREE.Group();
  const byDef = {};
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.45, metalness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a332a, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 });
  for (const [defId, shape] of Object.entries(GUN_SHAPES)) {
    const gun = new THREE.Group();
    const [w, h, d] = shape.body;
    gun.add(box(w, h, d, dark, 0, 0, -d / 2));
    gun.add(box(shape.barrel[0], shape.barrel[1], shape.barrel[2], dark, 0, 0.02, -d - shape.barrel[2] / 2));
    gun.add(box(0.06, shape.mag, 0.09, grip, 0, -h / 2 - shape.mag / 2 + 0.02, -0.06)); // magazine
    gun.add(box(0.055, 0.16, 0.07, grip, 0, -0.1, 0.09)); // grip
    gun.add(box(0.02, shape.sight, 0.03, dark, 0, h / 2 + shape.sight / 2, -d * 0.55)); // front post
    if (shape.scope) {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.11, -0.2);
      gun.add(scope);
    }
    // hands: one on the grip, one under the barrel
    gun.add(box(0.07, 0.07, 0.12, skin, 0.01, -0.13, 0.09));
    gun.add(box(0.07, 0.06, 0.13, skin, -0.01, -0.06, -d * 0.62));
    gun.position.set(0.21, -0.21, -0.42);
    gun.visible = false;
    group.add(gun);
    byDef[defId] = gun;
  }
  return { group, byDef };
}
