// bots.js — the fighters who are not the player: perception, plans and
// gunfights. A bot sees through a field-of-view and line-of-sight test on a
// staggered tick, hears through the same noise events the player makes, and
// remembers where an enemy was last seen. First sightings are called out on
// the team radio (state.js). Teams play a plan each round: the
// Jackals send a carrier and escorts to the called site, the Wardens hold
// angles on both sites and rotate on information. After the plant, the
// Jackals hold the site and the Wardens retake it, one defusing, the rest
// covering. Skill is per-bot: reaction time, aim error and burst discipline.

import * as THREE from 'three';
import { S, PHASE, TEAM, otherTeam, radio, zoneName } from './state.js';
import { WORLD, groundAt, collideMove, dirFromAngles, yawOf } from './world.js';
import { nextStepToward } from './nav.js';
import { WEAPONS, buyItem, startReload, switchSlot, throwGrenade, visionBlocked, eyeHeight } from './weapons.js';

const NAMES = {
  wardens: ['Voss', 'Ibarra', 'Kade', 'Moss', 'Petra'],
  jackals: ['Rook', 'Sable', 'Havoc', 'Juno', 'Mira'],
};

export function botName(team, index) {
  return NAMES[team][index % NAMES[team].length];
}

const HOLD_SPOTS = {
  A: [
    { x: 22.3, z: -14.2, yaw: yawOf(-1, 0.25) },
    { x: 31.8, z: -16.6, yaw: yawOf(-1, -0.3) },
  ],
  B: [
    { x: 23.8, z: 14.2, yaw: yawOf(-1, -0.25) },
    { x: 32.2, z: 21.8, yaw: yawOf(-1, 0.3) },
  ],
  MID: [{ x: 8, z: -5, yaw: yawOf(-1, 0.1) }],
};

const LANE_STAGING = {
  A: [{ x: -4, z: -20 }, { x: 3, z: -6 }, { x: 12, z: -20 }],
  B: [{ x: -4, z: 18.6 }, { x: 1, z: 6.5 }, { x: 12, z: 20 }],
};

export function makeBrain(c) {
  const rng = S.rng;
  return {
    state: 'route',
    enemy: null,
    lastSeen: null,
    lastSeenT: -99,
    spotReadyT: 0,
    perceiveT: rng() * 0.1,
    burstLeft: 0,
    burstPauseT: 0,
    nadeT: 0,              // next time this bot may throw a grenade
    faceAwayT: 0,          // until when it looks away from its own flash
    radioT: 0,             // next time this bot may call a contact
    strafeDir: 1,
    strafeT: 0,
    aimSettle: 0,
    target: null,          // { x, z } current movement goal
    stage: 0,              // progress through the plan's waypoints
    holdYaw: 0,
    skill: {
      react: 0.34 + rng() * 0.3,
      aimErr: 0.016 + rng() * 0.03,
      burst: 3 + Math.floor(rng() * 4),
    },
    stuckT: 0,
    lastX: 0, lastZ: 0,
    plan: null,
    grenadeT: 6 + rng() * 14,
  };
}

// The round plan, assigned by sim.js when a round is set up. Attackers get a
// staging lane each and converge on the called site; defenders split.
export function assignPlans() {
  const site = WORLD.sites[S.targetSite];
  const lanes = LANE_STAGING[S.targetSite];
  let laneIdx = 0;
  for (const c of S.combatants) {
    if (c.isPlayer || !c.brain) continue;
    const b = c.brain;
    b.state = 'route';
    b.stage = 0;
    b.enemy = null;
    b.lastSeen = null;
    if (c.team === TEAM.JACKALS) {
      const isCarrier = S.charge && S.charge.carrier === c;
      b.plan = isCarrier ? 'carry' : laneIdx % 3 === 2 ? 'flank' : 'push';
      b.target = { x: lanes[laneIdx % lanes.length].x, z: lanes[laneIdx % lanes.length].z };
      laneIdx++;
      if (isCarrier) b.target = { x: site.x - 4, z: site.z };
    } else {
      const wardens = S.combatants.filter((w) => w.team === TEAM.WARDENS && !w.isPlayer);
      const idx = wardens.indexOf(c);
      const spot = idx === 0 ? HOLD_SPOTS.A[0] : idx === 1 ? HOLD_SPOTS.A[1] : idx === 2 ? HOLD_SPOTS.B[0] : idx === 3 ? HOLD_SPOTS.B[1] : HOLD_SPOTS.MID[0];
      b.plan = 'hold';
      b.target = { x: spot.x, z: spot.z };
      b.holdYaw = spot.yaw;
      b.holdSpot = spot;
    }
  }
}

// What a bot buys in the buy phase: a rifle when the team can afford it,
// armour with what is left, a grenade or two, a kit for one Warden. After a
// loss with little money it saves — the economy is the same for everyone.
export function botBuy(c) {
  const rng = S.rng;
  // team save round: keep the money together — at most a grenade
  if (S.saveTeam[c.team]) {
    if (c.money >= 600 && rng() < 0.4) buyItem(c, 'frag');
    if (c.slots.primary) switchSlot(c, 'primary');
    return;
  }
  const hasPrimary = !!c.slots.primary;
  if (!hasPrimary) {
    if (c.money >= 4350 && S.round >= 3 && rng() < 0.35) buyItem(c, 'longbow');
    else if (c.money >= 3350) buyItem(c, 'ar57');
    else if (c.money >= 2700 && rng() < 0.75) buyItem(c, 'ar57');
    else if (c.money >= 1900) buyItem(c, rng() < 0.5 ? 'mule' : 'kestrel');
    else if (c.money >= 1250 && S.score[c.team] > S.score[otherTeam(c.team)]) buyItem(c, 'kestrel');
  }
  if (c.money >= 1000 && !c.helmet) buyItem(c, 'armorHelmet');
  else if (c.money >= 650 && c.armor < 60) buyItem(c, 'armor');
  if (c.team === TEAM.WARDENS && !c.kit && c.brain.plan === 'hold' && c.money >= 400 && rng() < 0.5) buyItem(c, 'kit');
  if (c.money >= 600 && rng() < 0.55) buyItem(c, 'frag');
  if (c.money >= 500 && rng() < 0.4) buyItem(c, 'smoke');
  if (c.money >= 450 && rng() < 0.4) buyItem(c, 'flash');
  if (c.slots.primary) switchSlot(c, 'primary');
}

// --- perception ---------------------------------------------------------------

const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();

function perceive(c, dt) {
  const b = c.brain;
  b.perceiveT -= dt;
  if (b.perceiveT > 0) return;
  b.perceiveT = 0.1;
  if (c.flashT > 0.4) { b.enemy = null; return; }
  const eyeY = c.pos.y + eyeHeight(c);
  dirFromAngles(c.yaw, 0, _dir);
  let best = null, bestDist = Infinity;
  for (const e of S.combatants) {
    if (!e.alive || e.team === c.team) continue;
    const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 68) continue;
    _to.set(dx, 0, dz).normalize();
    const facing = _dir.x * _to.x + _dir.z * _to.z;
    if (facing < 0.25 && dist > 4.5) continue;   // outside the view cone
    if (visionBlocked(c.pos.x, eyeY, c.pos.z, e.pos.x, e.pos.y + 1.2, e.pos.z)) continue;
    if (dist < bestDist) { bestDist = dist; best = e; }
  }
  if (best) {
    if (b.enemy !== best) {
      b.enemy = best;
      // rubber-band, gently: a team far behind reacts a touch faster
      const behind = S.score[c.team] + 3 < S.score[otherTeam(c.team)] ? -0.06 : 0;
      b.spotReadyT = S.time + Math.max(0.16, b.skill.react + behind);
      b.aimSettle = 0;
      // a first sighting gets called out on the team radio
      if (S.time >= b.radioT) {
        b.radioT = S.time + 18;
        radio(c, `Contact — ${zoneName(best.pos.x, best.pos.z)}`);
      }
    }
    b.lastSeen = { x: best.pos.x, z: best.pos.z };
    b.lastSeenT = S.time;
  } else if (b.enemy && S.time - b.lastSeenT > 0.4) {
    b.enemy = null; // lost them; lastSeen still points where they were
  }
  // hearing: an enemy's noise within its radius pulls a look that way
  if (!b.enemy) {
    for (const n of S.noises) {
      if (n.team === c.team || S.time - n.t > 1.2) continue;
      const d = Math.hypot(n.x - c.pos.x, n.z - c.pos.z);
      if (d < n.radius) {
        b.lastSeen = { x: n.x, z: n.z };
        b.lastSeenT = S.time;
      }
    }
  }
}

// --- movement -------------------------------------------------------------------

const _scratch = new THREE.Vector3();

function moveToward(c, tx, tz, speed, dt) {
  const b = c.brain;
  const hop = nextStepToward(c.pos.x, c.pos.z, tx, tz, _scratch);
  const gx = hop ? hop.x : tx, gz = hop ? hop.z : tz;
  const dx = gx - c.pos.x, dz = gz - c.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.35) { c.vel.x = 0; c.vel.z = 0; c.moveSpeed = 0; return true; }
  const want = Math.min(speed, dist / dt * 0.8);
  const vx = (dx / dist) * want, vz = (dz / dist) * want;
  const blend = Math.min(1, 14 * dt);
  c.vel.x += (vx - c.vel.x) * blend;
  c.vel.z += (vz - c.vel.z) * blend;
  c.pos.x += c.vel.x * dt;
  c.pos.z += c.vel.z * dt;
  collideMove(c.pos, 0.35);
  c.pos.y = groundAt(c.pos.x, c.pos.z, c.pos.y);
  c.moveSpeed = Math.hypot(c.vel.x, c.vel.z);
  // stuck? if we meant to move and barely did, repath from the nearest node
  b.stuckT += dt;
  if (b.stuckT > 0.8) {
    const moved = Math.hypot(c.pos.x - b.lastX, c.pos.z - b.lastZ);
    if (moved < 0.12 && speed > 0) {
      c.pos.x += (S.rng() - 0.5) * 0.6;
      c.pos.z += (S.rng() - 0.5) * 0.6;
      collideMove(c.pos, 0.35);
    }
    b.stuckT = 0;
    b.lastX = c.pos.x; b.lastZ = c.pos.z;
  }
  return dist < 1.1 && !hop;
}

function faceToward(c, tx, tz, dt, rate = 9) {
  const want = yawOf(tx - c.pos.x, tz - c.pos.z);
  let diff = want - c.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
}

// --- the brain ------------------------------------------------------------------

export function updateBot(c, dt) {
  const b = c.brain;
  c.wantFire = false;
  c.channelKind = null;
  if (!c.alive) return;
  if (S.phase !== PHASE.LIVE && S.phase !== PHASE.PLANTED) {
    c.moveSpeed = 0;
    return;
  }
  perceive(c, dt);
  const site = WORLD.sites[S.targetSite];

  // combat takes over whenever an enemy is in view
  if (b.enemy && b.enemy.alive) return combat(c, dt);

  // after the plant: attackers hold the site, defenders retake it
  if (S.phase === PHASE.PLANTED && S.charge && S.charge.state === 'planted') {
    if (c.team === TEAM.JACKALS) {
      const near = Math.hypot(c.pos.x - S.charge.pos.x, c.pos.z - S.charge.pos.z);
      if (near > 7) { moveToward(c, S.charge.pos.x + (c.id % 3 - 1) * 3, S.charge.pos.z + (c.id % 2 ? 3 : -3), 3.6, dt); }
      else { c.moveSpeed = 0; faceToward(c, c.pos.x - 8, c.pos.z, dt, 3); }
      return;
    }
    // wardens retake: the closest (or the kit holder) defuses, others cover
    const defuser = pickDefuser();
    if (defuser === c) {
      const d = Math.hypot(c.pos.x - S.charge.pos.x, c.pos.z - S.charge.pos.z);
      if (d > 1.5) moveToward(c, S.charge.pos.x, S.charge.pos.z, 4.1, dt);
      else { c.moveSpeed = 0; c.channelKind = 'defuse'; faceToward(c, S.charge.pos.x, S.charge.pos.z, dt); }
    } else {
      const d = Math.hypot(c.pos.x - S.charge.pos.x, c.pos.z - S.charge.pos.z);
      if (d > 8) moveToward(c, S.charge.pos.x, S.charge.pos.z, 3.8, dt);
      else { c.moveSpeed = 0; faceToward(c, S.charge.pos.x - 6, S.charge.pos.z, dt, 3); }
    }
    return;
  }

  // the carrier plants when they reach the site
  if (c.team === TEAM.JACKALS && S.charge && S.charge.carrier === c && S.phase === PHASE.LIVE) {
    const d = Math.hypot(c.pos.x - site.x, c.pos.z - site.z);
    if (d < site.r - 1.2) {
      c.moveSpeed = 0;
      c.channelKind = 'plant';
      faceToward(c, site.x + 6, site.z, dt);
      return;
    }
    moveToward(c, site.x, site.z, 3.9, dt);
    faceToward(c, c.pos.x + c.vel.x, c.pos.z + c.vel.z, dt);
    maybeGrenade(c, dt, site);
    return;
  }

  // a dropped charge gets picked up by the nearest attacker (bots walk over it)
  // — pickup itself is sim.js's job; here they just route to it
  if (c.team === TEAM.JACKALS && S.charge && S.charge.state === 'dropped' && b.plan !== 'hold') {
    moveToward(c, S.charge.pos.x, S.charge.pos.z, 3.9, dt);
    faceToward(c, c.pos.x + c.vel.x, c.pos.z + c.vel.z, dt);
    return;
  }

  // investigate a sound or a last sighting before resuming the plan
  if (b.lastSeen && S.time - b.lastSeenT < 6 && b.state !== 'hold') {
    const d = Math.hypot(c.pos.x - b.lastSeen.x, c.pos.z - b.lastSeen.z);
    if (d > 2.2) {
      moveToward(c, b.lastSeen.x, b.lastSeen.z, 3.4, dt);
      faceToward(c, b.lastSeen.x, b.lastSeen.z, dt);
      return;
    }
    b.lastSeen = null;
  }

  // the plan itself
  if (b.plan === 'hold') {
    const arrived = moveToward(c, b.target.x, b.target.z, 3.8, dt);
    if (arrived) {
      c.moveSpeed = 0;
      c.crouch = c.id % 2 === 0;
      let diff = b.holdYaw - c.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      c.yaw += Math.max(-3 * dt, Math.min(3 * dt, diff));
    }
    return;
  }

  // attackers pushing: staging lane first, then the site
  const arrived = moveToward(c, b.target.x, b.target.z, 3.9, dt);
  faceToward(c, c.pos.x + c.vel.x, c.pos.z + c.vel.z, dt);
  maybeGrenade(c, dt, b.target);
  if (arrived) {
    if (b.stage === 0) {
      b.stage = 1;
      b.target = { x: site.x - 5 + (c.id % 3) * 2, z: site.z + (c.id % 2 ? 3 : -3) };
    } else {
      // on site: take a cover-ish spot and watch the entrances
      c.moveSpeed = 0;
      faceToward(c, c.pos.x - 9, c.pos.z, dt, 3);
    }
  }
}

function pickDefuser() {
  let best = null, bestD = Infinity;
  for (const c of S.combatants) {
    if (c.team !== TEAM.WARDENS || !c.alive || c.isPlayer) continue;
    const d = Math.hypot(c.pos.x - S.charge.pos.x, c.pos.z - S.charge.pos.z) - (c.kit ? 6 : 0);
    if (d < bestD) { bestD = d; best = c; }
  }
  // the player may be the defuser instead — sim.js lets them channel too;
  // bots defer when the player is already on the charge
  if (S.player && S.player.alive && S.player.team === TEAM.WARDENS) {
    const pd = Math.hypot(S.player.pos.x - S.charge.pos.x, S.player.pos.z - S.charge.pos.z);
    if (pd < 1.7) return null;
  }
  return best;
}

function maybeGrenade(c, dt, toward) {
  const b = c.brain;
  b.grenadeT -= dt;
  if (b.grenadeT > 0) return;
  b.grenadeT = 9 + S.rng() * 12;
  // smoke the lane ahead when pushing, flash a corner now and then
  if (c.grenades.smoke > 0 && S.rng() < 0.6) {
    c.yaw = yawOf(toward.x - c.pos.x, toward.z - c.pos.z);
    c.pitch = 0.12;
    throwGrenade(c, 'smoke');
    c.pitch = 0;
  } else if (c.grenades.flash > 0 && S.rng() < 0.4) {
    c.pitch = 0.1;
    throwGrenade(c, 'flash');
    c.pitch = 0;
  }
}

// --- grenades ---------------------------------------------------------------
// Bots buy grenades in botBuy; this is where they spend them. A frag goes
// at a seen enemy in the mid-range band when no teammate is standing near
// the target (frags hurt everyone). A flash goes in early in a fight, and
// the thrower looks away from his own pop, then pushes on it. A smoke goes
// down between a hurt bot and its enemy as a screen to break off behind.
function throwAt(c, kind, tx, tz, pitch) {
  const keepYaw = c.yaw, keepPitch = c.pitch;
  c.yaw = yawOf(tx - c.pos.x, tz - c.pos.z);
  c.pitch = pitch;
  const ok = throwGrenade(c, kind);
  c.yaw = keepYaw; c.pitch = keepPitch;
  if (ok) c.brain.nadeT = S.time + 8 + S.rng() * 6;
  return ok;
}

function maybeThrowNade(c, e, dist) {
  const b = c.brain;
  if (S.time < b.nadeT || S.time < b.spotReadyT) return false;
  const rng = S.rng;
  const tx = e.pos.x, tz = e.pos.z;
  if (c.grenades.smoke > 0 && c.hp <= 38 && dist > 5 && dist < 22) {
    return throwAt(c, 'smoke', c.pos.x + (tx - c.pos.x) * 0.35, c.pos.z + (tz - c.pos.z) * 0.35, -0.55);
  }
  // frags and flashes fly an arc: if a wall eats the throw, keep them
  const arcClear = !visionBlocked(c.pos.x, c.pos.y + 2.1, c.pos.z, tx, 1.6, tz);
  if (!arcClear) return false;
  if (c.grenades.frag > 0 && dist > 7 && dist < 19 && rng() < 0.5) {
    let mateNear = false;
    for (const m of S.combatants) {
      if (m.alive && m.team === c.team && m !== c && Math.hypot(m.pos.x - tx, m.pos.z - tz) < 3.2) { mateNear = true; break; }
    }
    if (!mateNear) return throwAt(c, 'frag', tx, tz, 0.05 + dist * 0.008);
  }
  if (c.grenades.flash > 0 && dist > 9 && dist < 26 && b.aimSettle < 0.4 && rng() < 0.6) {
    if (throwAt(c, 'flash', tx, tz, 0.05 + dist * 0.008)) {
      b.faceAwayT = S.time + 0.95;
      b.spotReadyT = Math.max(b.spotReadyT, S.time + 1.0);
      return true;
    }
  }
  return false;
}

function combat(c, dt) {
  const b = c.brain;
  const e = b.enemy;
  const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z;
  const dist = Math.hypot(dx, dz);
  // a bot that just threw a flash looks away until it pops, and holds fire
  if (S.time < b.faceAwayT) {
    faceToward(c, c.pos.x - dx, c.pos.z - dz, dt, 11);
    c.wantFire = false;
    return;
  }
  b.aimSettle = Math.min(1, b.aimSettle + dt * 1.6);

  // aim at the chest, with an error that shrinks as the aim settles; a
  // strafing target is harder to track, a crouched one sits lower
  const err = b.skill.aimErr * (1.6 - b.aimSettle) * (e.moveSpeed > 1 ? 1.5 : 1);
  const aimX = e.pos.x + (S.rng() - 0.5) * 2 * err * dist + e.vel.x * 0.12;
  const aimZ = e.pos.z + (S.rng() - 0.5) * 2 * err * dist + e.vel.z * 0.12;
  faceToward(c, aimX, aimZ, dt, 11);
  const aimY = e.pos.y + (e.crouch ? 0.72 : 1.12);
  const eyeY = c.pos.y + eyeHeight(c);
  c.pitch = Math.atan2(aimY - eyeY, dist);

  // movement in a fight: strafe in bursts, sometimes crouch, keep a sane
  // distance for the weapon in hand
  const defId = c.slots[c.current]?.def;
  const def = WEAPONS[defId] || WEAPONS.p9;
  b.strafeT -= dt;
  if (b.strafeT <= 0) { b.strafeT = 0.5 + S.rng() * 0.7; b.strafeDir = -b.strafeDir; if (S.rng() < 0.3) b.strafeDir = 0; }
  const tooClose = dist < (def.pellets ? 7 : 5);
  const tooFar = def.pellets && dist > 15;
  let mx = 0, mz = 0;
  const px = -dz / (dist || 1), pz = dx / (dist || 1);
  mx += px * b.strafeDir;
  mz += pz * b.strafeDir;
  if (tooClose) { mx -= dx / dist; mz -= dz / dist; }
  if (tooFar) { mx += dx / dist; mz += dz / dist; }
  const mLen = Math.hypot(mx, mz);
  if (mLen > 0.1 && defId !== 'longbow') {
    c.vel.x = (mx / mLen) * 2.3;
    c.vel.z = (mz / mLen) * 2.3;
    c.pos.x += c.vel.x * dt;
    c.pos.z += c.vel.z * dt;
    collideMove(c.pos, 0.35);
    c.pos.y = groundAt(c.pos.x, c.pos.z, c.pos.y);
    c.moveSpeed = 2.3;
  } else {
    c.moveSpeed = 0;
    c.vel.x = 0; c.vel.z = 0;
  }
  c.crouch = b.aimSettle > 0.6 && dist > 14 && c.id % 2 === 0;

  // a grenade, when the moment fits, instead of the next burst
  if (maybeThrowNade(c, e, dist)) { c.wantFire = false; return; }

  // fire control: bursts with pauses, only once the reaction time has run
  // and the line is clear this instant
  if (S.time < b.spotReadyT) { c.wantFire = false; return; }
  if (b.burstPauseT > 0) {
    b.burstPauseT -= dt;
    c.wantFire = false;
    return;
  }
  if (b.burstLeft <= 0) {
    b.burstLeft = Math.max(1, Math.round(b.skill.burst * (def.auto ? 1 : 0.4)));
    if (def.pellets) b.burstLeft = 1;
  }
  const clear = !visionBlocked(c.pos.x, eyeY, c.pos.z, e.pos.x, e.pos.y + 1.1, e.pos.z);
  if (!clear) { c.wantFire = false; b.enemy = null; return; }
  c.wantFire = true;
  // count the burst down by watching the magazine (weapons.js fires it)
  const inst = c.slots[c.current];
  if (inst) {
    if (b.lastMag === undefined) b.lastMag = inst.mag;
    if (inst.mag < b.lastMag) {
      b.burstLeft -= b.lastMag - inst.mag;
      b.lastMag = inst.mag;
      if (b.burstLeft <= 0) b.burstPauseT = 0.26 + S.rng() * 0.4;
    }
    if (inst.mag === 0 && inst.reserve > 0) startReload(c);
  }
}
