// player.js — the human fighter: pointer-lock look, acceleration movement
// with crouch and a small jump, collision against the yard, footsteps that
// other fighters can hear, and the weapon controls (fire, reload, switch,
// grenades, scope). The rules live elsewhere; this turns input into the
// same combatant fields the bots use.

import * as THREE from 'three';
import { S, PHASE } from './state.js';
import { input, moveAxes, wantsCrouch, wantsSprint, endStepInput } from './input.js';
import { groundAt, collideMove } from './world.js';
import { currentDef, startReload, switchSlot, throwGrenade, eyeHeight } from './weapons.js';
import * as audio from './audio.js';

const WALK = 4.4, SPRINT = 5.9, CROUCH_SPEED = 1.9;
const _wish = new THREE.Vector3();

let stepAcc = 0;   // distance since the last footstep sound
let bobPhase = 0;

export function playerEye(c, out) {
  const bob = c.alive && c.grounded ? Math.sin(bobPhase * 2) * 0.028 * Math.min(1, c.moveSpeed / WALK) : 0;
  out.set(c.pos.x, c.pos.y + eyeHeight(c) + bob, c.pos.z);
  return out;
}

export function isScoped(c) {
  const def = currentDef(c);
  return !!(def && def.zoom && input.aiming && c.alive);
}

export function updatePlayer(c, dt) {
  c.yaw = input.yaw;
  c.pitch = input.pitch;
  c.aiming = input.aiming;
  if (!c.alive || S.phase === PHASE.BUY || S.phase === PHASE.MENU || S.phase === PHASE.MATCH_END) {
    c.wantFire = false;
    c.moveSpeed = 0;
    endStepInput();
    return;
  }

  const { f, r } = moveAxes();
  c.crouch = wantsCrouch();
  const sprinting = wantsSprint() && f > 0 && !c.crouch && !input.aiming;
  c.sprinting = sprinting;
  const topSpeed = c.crouch ? CROUCH_SPEED : sprinting ? SPRINT : WALK;

  // wish direction in world space (yaw 0 faces -z)
  const sin = Math.sin(c.yaw), cos = Math.cos(c.yaw);
  _wish.set(-sin * f + cos * r, 0, -cos * f - sin * r);
  if (_wish.lengthSq() > 1) _wish.normalize();

  const accel = c.grounded ? 42 : 7;
  c.vel.x += _wish.x * accel * dt;
  c.vel.z += _wish.z * accel * dt;
  if (c.grounded && _wish.lengthSq() === 0) {
    const drag = Math.max(0, 1 - 11 * dt);
    c.vel.x *= drag;
    c.vel.z *= drag;
  }
  const hSpeed = Math.hypot(c.vel.x, c.vel.z);
  if (hSpeed > topSpeed) {
    c.vel.x *= topSpeed / hSpeed;
    c.vel.z *= topSpeed / hSpeed;
  }

  if (input.jumpPressed && c.grounded && !c.crouch) {
    c.vel.y = 7.4;
    c.grounded = false;
  }
  c.vel.y -= 22 * dt;

  c.pos.x += c.vel.x * dt;
  c.pos.z += c.vel.z * dt;
  collideMove(c.pos, 0.35);
  c.pos.y += c.vel.y * dt;
  const ground = groundAt(c.pos.x, c.pos.z, c.pos.y);
  if (c.pos.y <= ground) {
    c.pos.y = ground;
    c.vel.y = 0;
    c.grounded = true;
  } else if (c.pos.y > ground + 0.02) {
    c.grounded = false;
  }
  c.moveSpeed = Math.hypot(c.vel.x, c.vel.z);

  // footsteps: running is loud, walking is heard close, crouching is silent
  if (c.grounded && c.moveSpeed > 0.4) {
    stepAcc += c.moveSpeed * dt;
    bobPhase += dt * c.moveSpeed * 1.6;
    const stride = sprinting ? 3.1 : 2.3;
    if (stepAcc > stride) {
      stepAcc = 0;
      audio.footstep(c.pos.x, c.pos.z, sprinting);
      if (!c.crouch) {
        S.noises.push({ x: c.pos.x, z: c.pos.z, t: S.time, radius: sprinting ? 11 : 5.5, team: c.team });
        if (S.noises.length > 48) S.noises.shift();
      }
    }
  }

  // weapons
  c.wantFire = input.firing && !sprinting;
  if (input.reloadPressed) startReload(c);
  if (input.slotPressed === 1) switchSlot(c, 'primary');
  if (input.slotPressed === 2) switchSlot(c, 'sidearm');
  if (input.slotPressed === 3) cycleGrenade(c);
  if (input.throwPressed) throwGrenade(c, c.grenadeSel || firstGrenade(c));
  endStepInput();
}

function firstGrenade(c) {
  for (const kind of ['frag', 'flash', 'smoke']) if (c.grenades[kind] > 0) return kind;
  return 'frag';
}

function cycleGrenade(c) {
  const kinds = ['frag', 'flash', 'smoke'];
  const owned = kinds.filter((k) => c.grenades[k] > 0);
  if (!owned.length) return;
  const cur = owned.indexOf(c.grenadeSel);
  c.grenadeSel = owned[(cur + 1) % owned.length];
}
