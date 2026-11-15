// main.js — boot and the frame loop. It builds the scene, runs the
// simulation in fixed steps of 1/60 s from an accumulator (so the game's
// speed never depends on the display's refresh rate), then points the
// camera and poses the models from whatever the simulation decided.
// Rendering never feeds back into the rules.
//
// The ?shot=start|play|end scenes stage the three screenshots with the
// game's own code and a fixed seed: the menu, a mid-round firefight in the
// warehouse, and the match-end screen.

import * as THREE from 'three';
import { S, PHASE, TEAM, mulberry32 } from './state.js';
import { buildWorld } from './world.js';
import { initEffects, updateEffects, shakeValue, spawnSmokeFx } from './effects.js';
import { buildSoldier, updateSoldier, buildViewmodels } from './models.js';
import { bindInput, input } from './input.js';
import { initHud, updateHud, hud } from './hud.js';
import { startMatch, createCombatants, step } from './sim.js';
import { playerEye, isScoped } from './player.js';
import { buyItem, currentDef } from './weapons.js';
import * as audio from './audio.js';

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
if (shot) {
  S.shot = shot;
  S.rng = mulberry32(Number(params.get('seed') || 1));
}

const canvasHost = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 500);
camera.rotation.order = 'YXZ';
scene.add(camera);

buildWorld(scene);
initEffects(scene);
const viewmodels = buildViewmodels();
camera.add(viewmodels.group);

initHud();
bindInput(renderer.domElement, () => audio.initAudio());

// --- combatant meshes ---------------------------------------------------------

function ensureMeshes() {
  for (const c of S.combatants) {
    if (c.isPlayer || c.mesh) continue;
    c.mesh = buildSoldier(c.team);
    scene.add(c.mesh);
  }
}

// --- the menu backdrop: two squads posed in the yard --------------------------

const menuProps = [];
function buildMenuScene() {
  const poses = [
    ['wardens', 24, -2, -Math.PI / 2], ['wardens', 25.5, 2.5, -Math.PI / 2 + 0.4],
    ['jackals', -25, 1, Math.PI / 2], ['jackals', -23.5, -3.5, Math.PI / 2 - 0.5],
    ['wardens', 6, -4.5, Math.PI], ['jackals', -8, 3, 0.6],
  ];
  for (const [team, x, z, yaw] of poses) {
    const mesh = buildSoldier(team);
    scene.add(mesh);
    menuProps.push({
      pos: new THREE.Vector3(x, 0, z), yaw, pitch: 0, alive: true, crouch: false,
      moveSpeed: 0, mesh, chargeCarrying: false, dmgWallT: 0,
    });
  }
}
buildMenuScene();

// --- starting a match -----------------------------------------------------------

hud.onPlay = (team) => {
  for (const p of menuProps) p.mesh.visible = false;
  startMatch(team);
  ensureMeshes();
  renderer.domElement.requestPointerLock();
};

renderer.domElement.addEventListener('click', () => {
  if (S.phase === PHASE.MATCH_END) {
    startMatch(S.playerTeam);
    ensureMeshes();
    renderer.domElement.requestPointerLock();
  }
});

// --- screenshot staging -----------------------------------------------------------

let shotT = 0;
function stageShot() {
  if (shot === 'start') return; // the menu over the posed yard is the shot
  for (const p of menuProps) p.mesh.visible = false;
  startMatch(TEAM.WARDENS);
  ensureMeshes();
  const p = S.player;
  if (shot === 'play') {
    S.phase = PHASE.LIVE;
    S.phaseT = 63;
    S.targetSite = 'B';
    S.banner = null;
    for (const c of S.combatants) { c.money = 6000; buyItem(c, 'ar57'); buyItem(c, 'armorHelmet'); c.money = 2140; }
    // a firefight in the warehouse: the player and two Wardens hold the east
    // door while three Jackals push the west door through smoke
    place(p, 9.5, 2.2, Math.PI / 2 + 0.12);
    input.yaw = p.yaw; input.pitch = -0.01;
    const mates = S.combatants.filter((c) => c.team === TEAM.WARDENS && !c.isPlayer);
    place(mates[0], 7.5, -3.4, Math.PI / 2);
    place(mates[1], 11.5, 5.2, Math.PI / 2 - 0.3);
    const foes = S.combatants.filter((c) => c.team === TEAM.JACKALS);
    place(foes[0], -3.5, -1.2, -Math.PI / 2);
    place(foes[1], -5.5, 2.4, -Math.PI / 2);
    place(foes[2], -1.5, 4.6, -Math.PI / 2);
    place(foes[3], -14, -14, -Math.PI / 2);
    place(foes[4], 2, 14, Math.PI);
    for (const f of foes.slice(0, 3)) { f.brain.enemy = p; f.brain.spotReadyT = 0; }
    for (const m of mates) { m.brain.enemy = foes[0]; m.brain.spotReadyT = 0; }
    // everyone else holds the spot they were placed on
    for (const c of S.combatants) {
      if (c.isPlayer) continue;
      c.brain.plan = 'hold';
      c.brain.target = { x: c.pos.x, z: c.pos.z };
      c.brain.holdYaw = c.yaw;
    }
    // the charge rides with the point man in the warehouse
    if (S.charge.carrier) S.charge.carrier.chargeCarrying = false;
    S.charge.carrier = foes[0];
    foes[0].chargeCarrying = true;
    S.smokes.push({ x: -6.5, z: 0.4, r: 3.1, t: 2, life: 15 });
    spawnSmokeFx(-6.5, 0.4);
  }
  if (shot === 'end') {
    S.score.wardens = 7;
    S.score.jackals = 4;
    S.round = 11;
    const stats = [[9, 3], [7, 5], [6, 6], [4, 7], [3, 8], [8, 4], [5, 6], [4, 5], [2, 9], [1, 7]];
    S.combatants.forEach((c, i) => { c.kills = stats[i][0]; c.deaths = stats[i][1]; });
    S.phase = PHASE.MATCH_END;
    S.winner = TEAM.WARDENS;
    S.banner = { title: 'WARDENS WIN THE MATCH', sub: 'Final score 7 — 4. Click to play again.', t: 999 };
    place(p, 30, 0, Math.PI / 2);
    input.yaw = p.yaw; input.pitch = 0.02;
  }
}

function place(c, x, z, yaw) {
  c.pos.set(x, 0, z);
  c.yaw = yaw;
  c.vel.set(0, 0, 0);
}

if (shot) stageShot();

// --- the frame loop -----------------------------------------------------------------

const STEP = 1 / 60;
let last = performance.now() / 1000;
let accumulator = 0;
const _eye = new THREE.Vector3();
let deathT = 0;
let vmBob = 0;
let wasBuy = false;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  let dt = Math.min(0.1, now - last);
  last = now;

  if (S.phase !== PHASE.MENU) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      step(STEP);
      accumulator -= STEP;
      steps++;
    }
    if (steps === 5) accumulator = 0;
  }
  shotT += dt;
  if (shot === 'play') {
    // the staged player returns fire in bursts
    input.firing = shotT > 0.7 && shotT < 1.5 || shotT > 2.3 && shotT < 3.1;
  }

  updateEffects(dt);
  for (const c of S.combatants) updateSoldier(c, dt);
  for (const p of menuProps) if (p.mesh.visible) updateSoldier(p, dt);

  poseCamera(dt);
  updateViewmodel(dt);
  if (S.player) audio.setListener(S.player.pos.x, S.player.pos.z, S.player.yaw);

  // the buy menu needs a free cursor; the fight needs the lock back
  const isBuy = S.phase === PHASE.BUY;
  if (isBuy && !wasBuy && document.pointerLockElement) document.exitPointerLock();
  wasBuy = isBuy;

  updateHud(dt);
  renderer.render(scene, camera);
}

function poseCamera(dt) {
  const p = S.player;
  if (S.phase === PHASE.MENU || !p) {
    // a slow dolly from the gantry yard toward the warehouse, the whole
    // yard — containers, floodlights, both lanes — reading at a glance
    const t = shot ? 0.3 : (performance.now() / 1000) * 0.014 % 1;
    camera.position.set(27 - t * 15, 5.2 - t * 1.6, 26 - t * 9);
    camera.lookAt(-10, 1, -8);
    camera.fov += (62 - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    return;
  }
  let subject = p;
  if (!p.alive && (S.phase === PHASE.LIVE || S.phase === PHASE.PLANTED)) {
    const mate = S.combatants.find((c) => c.team === p.team && c.alive && !c.isPlayer);
    if (mate) subject = mate;
    deathT += dt;
  } else {
    deathT = 0;
  }
  playerEye(subject, _eye);
  if (subject !== p) { _eye.y = subject.pos.y + 1.6; }
  if (!p.alive) _eye.y = Math.max(0.5, _eye.y - Math.min(0.9, deathT * 1.4));
  camera.position.copy(_eye);
  const shake = shakeValue();
  camera.position.x += (Math.random() - 0.5) * shake * 0.14;
  camera.position.y += (Math.random() - 0.5) * shake * 0.14;
  camera.rotation.y = subject.yaw;
  camera.rotation.x = subject.pitch + (subject === p ? (p.recoilPitch || 0) : 0);
  camera.rotation.z = !p.alive ? Math.min(0.35, deathT * 0.5) : 0;
  const targetFov = isScoped(p) && subject === p ? 24 : 78;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 11);
  camera.updateProjectionMatrix();
}

function updateViewmodel(dt) {
  const p = S.player;
  const show = !!p && p.alive && S.phase !== PHASE.MENU && S.phase !== PHASE.MATCH_END;
  viewmodels.group.visible = show;
  if (!show) return;
  const def = currentDef(p);
  for (const [defId, gun] of Object.entries(viewmodels.byDef)) {
    gun.visible = def && defId === p.slots[p.current]?.def;
  }
  if (!def) return;
  const gun = viewmodels.byDef[p.slots[p.current].def];
  vmBob += dt * (2 + p.moveSpeed * 1.7);
  const bobY = Math.sin(vmBob * 2) * 0.011 * Math.min(1, p.moveSpeed / 4);
  const bobX = Math.cos(vmBob) * 0.008 * Math.min(1, p.moveSpeed / 4);
  const scoped = isScoped(p);
  gun.position.x += ((scoped ? 0 : 0.21) + bobX - gun.position.x) * Math.min(1, dt * 14);
  gun.position.y += ((scoped ? -0.145 : -0.21) + bobY - gun.position.y) * Math.min(1, dt * 14);
  gun.position.z = -0.42 + (p.recoilPitch || 0) * 0.55;
  let dip = 0;
  if (p.reloadT > 0) dip = Math.sin((1 - p.reloadT / def.reload) * Math.PI) * 0.55;
  if (p.switchT > 0) dip = Math.max(dip, Math.sin((p.switchT / 0.38) * Math.PI) * 0.4);
  gun.rotation.x = dip + (p.recoilPitch || 0) * 0.7;
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

frame();
