// weapons.js — the gunplay: weapon facts, firing, ballistics, damage and
// grenades. One rule shapes the whole table: accuracy is bought by standing
// still. Spread is smallest for a planted, crouched shooter and balloons on
// the move, in the air and across a long burst, so the tactical choice —
// stop, crouch, fire in bursts — is the winning one, as the bounty asks.

import * as THREE from 'three';
import { S, otherTeam, radio, zoneName } from './state.js';
import { WORLD, losBlocked, rayHitDistance, dirFromAngles } from './world.js';
import * as fx from './effects.js';
import * as audio from './audio.js';

export const WEAPONS = {
  p9:      { name: 'P9 Sidearm', slot: 'sidearm', price: 0,    damage: 26,  headMult: 4,   rpm: 380, auto: false, mag: 12, reserve: 60,  reload: 1.1, spreadStill: 0.010, spreadMove: 0.030, bloomShot: 0.010, falloffFrom: 20, falloffMin: 0.70, kick: 0.012, noiseR: 26 },
  kestrel: { name: 'Kestrel-9 SMG', slot: 'primary', price: 1250, damage: 24, headMult: 4,   rpm: 780, auto: true,  mag: 30, reserve: 120, reload: 1.9, spreadStill: 0.017, spreadMove: 0.044, bloomShot: 0.008, falloffFrom: 12, falloffMin: 0.50, kick: 0.008, noiseR: 30 },
  mule:    { name: 'Mule-12 Shotgun', slot: 'primary', price: 1700, damage: 9, headMult: 2.5, rpm: 68, auto: false, mag: 6, reserve: 30, reload: 2.6, spreadStill: 0.055, spreadMove: 0.070, bloomShot: 0.030, falloffFrom: 7, falloffMin: 0.22, kick: 0.055, noiseR: 38, pellets: 8 },
  ar57:    { name: 'AR-57 Rifle', slot: 'primary', price: 2700, damage: 34, headMult: 4,   rpm: 660, auto: true,  mag: 30, reserve: 120, reload: 2.2, spreadStill: 0.008, spreadMove: 0.034, bloomShot: 0.009, falloffFrom: 30, falloffMin: 0.82, kick: 0.014, noiseR: 34 },
  longbow: { name: 'Longbow DMR', slot: 'primary', price: 4350, damage: 130, headMult: 3, rpm: 50, auto: false, mag: 5, reserve: 25, reload: 2.9, spreadStill: 0.0015, spreadMove: 0.085, bloomShot: 0.05, falloffFrom: 60, falloffMin: 0.95, kick: 0.08, noiseR: 46, zoom: 3.4 },
};

export const GEAR = {
  armor:       { name: 'Vest', price: 650 },
  armorHelmet: { name: 'Vest + Helmet', price: 1000 },
  kit:         { name: 'Defuse Kit', price: 400 },
  frag:        { name: 'Frag Grenade', price: 300 },
  flash:       { name: 'Flash Grenade', price: 200 },
  smoke:       { name: 'Smoke Grenade', price: 300 },
};

export function eyeHeight(c) { return c.crouch ? 1.14 : 1.6; }
function headY(c) { return c.crouch ? 1.02 : 1.5; }

export function currentDef(c) {
  const inst = c.slots[c.current];
  return inst ? WEAPONS[inst.def] : null;
}

export function currentInst(c) {
  return c.slots[c.current];
}

// Buying: one function for the player's menu and the bots' buy logic, so the
// economy rules can never differ between them. Returns true on success.
export function buyItem(c, itemId) {
  if (WEAPONS[itemId]) {
    const def = WEAPONS[itemId];
    if (c.money < def.price) return false;
    if (c.slots[def.slot] && c.slots[def.slot].def === itemId) return false;
    c.money -= def.price;
    c.slots[def.slot] = { def: itemId, mag: def.mag, reserve: def.reserve };
    if (def.slot === 'primary') c.current = 'primary';
    return true;
  }
  const gear = GEAR[itemId];
  if (!gear || c.money < gear.price) return false;
  if (itemId === 'armor') {
    if (c.armor >= 100) return false;
    c.money -= gear.price; c.armor = 100;
    return true;
  }
  if (itemId === 'armorHelmet') {
    if (c.armor >= 100 && c.helmet) return false;
    c.money -= gear.price; c.armor = 100; c.helmet = true;
    return true;
  }
  if (itemId === 'kit') {
    if (c.kit || c.team !== 'wardens') return false;
    c.money -= gear.price; c.kit = true;
    return true;
  }
  // grenades
  if (c.grenades[itemId] >= 1) return false;
  c.money -= gear.price;
  c.grenades[itemId] += 1;
  return true;
}

// Does a smoke cloud sit on this sightline? Smoke blocks eyes, not bullets.
export function smokeBlocks(ax, ay, az, bx, by, bz) {
  for (const s of S.smokes) {
    // distance from the smoke centre (at eye-ish height) to the segment
    const cx = s.x, cy = 1.3, cz = s.z;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
    if (px * px + py * py + pz * pz < s.r * s.r) return true;
  }
  return false;
}

export function visionBlocked(ax, ay, az, bx, by, bz) {
  return losBlocked(ax, ay, az, bx, by, bz) || smokeBlocks(ax, ay, az, bx, by, bz);
}

// --- damage ----------------------------------------------------------------

export function applyDamage(victim, amount, attacker, part) {
  if (!victim.alive || S.phase === 'buy' || S.phase === 'menu') return;
  let dmg = amount;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, dmg * 0.5);
    victim.armor -= absorbed;
    dmg -= absorbed;
  }
  victim.hp -= dmg;
  victim.dmgWallT = performance.now() / 1000;
  victim.lastAttacker = attacker;
  victim.dmgFromYaw = Math.atan2(-(attacker.pos.x - victim.pos.x), -(attacker.pos.z - victim.pos.z));
  victim.dmgT = S.time;
  if (victim.isPlayer) audio.hurt();
  if (victim.hp <= 0) kill(victim, attacker, part);
}

function kill(victim, attacker, part) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths++;
  if (attacker && attacker !== victim) {
    attacker.kills++;
    attacker.money = Math.min(16000, attacker.money + 300);
    if (attacker.isPlayer) audio.killConfirm();
  }
  const headTag = part === 'head' ? ' ⌖' : '';
  S.feed.unshift({
    text: `${attacker ? attacker.name : 'The yard'}  ▸  ${victim.name}${headTag}`,
    t: S.time,
    colour: attacker ? attacker.team : 'wardens',
  });
  if (S.feed.length > 5) S.feed.pop();
  // a dead carrier drops the charge where they fell
  if (S.charge && S.charge.state === 'carried' && S.charge.carrier === victim) {
    S.charge.state = 'dropped';
    S.charge.carrier = null;
    S.charge.pos.set(victim.pos.x, 0, victim.pos.z);
    const caller = S.combatants.find((x) => x.alive && !x.isPlayer && x.team === S.playerTeam);
    if (caller) radio(caller, `Carrier down — charge dropped at ${zoneName(victim.pos.x, victim.pos.z)}`, true);
  }
}

// --- firing ------------------------------------------------------------------

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _hit = new THREE.Vector3();

function spreadFor(c, def) {
  const speedRatio = Math.min(1, c.moveSpeed / 4.4);
  let spread = def.spreadStill + (def.spreadMove - def.spreadStill) * speedRatio;
  if (!c.grounded) spread += 0.05;
  if (c.crouch && c.moveSpeed < 0.4) spread *= 0.72;
  if (c.aiming) spread *= 0.8;
  return spread + c.bloom;
}

function falloff(def, dist) {
  if (dist <= def.falloffFrom) return 1;
  const over = Math.min(1, (dist - def.falloffFrom) / 45);
  return def.falloffMin + (1 - def.falloffMin) * (1 - over);
}

// Ray vs one combatant's three hit volumes; returns the entry distance and
// which part, or null. Head sphere, chest box, leg box — headshots pay 4x.
function hitCombatant(o, d, c) {
  const px = c.pos.x, pz = c.pos.z;
  // head sphere
  const hx = px - o.x, hy = (c.pos.y + headY(c)) - o.y, hz = pz - o.z;
  const b = hx * d.x + hy * d.y + hz * d.z;
  const cc = hx * hx + hy * hy + hz * hz - 0.15 * 0.15;
  let best = Infinity, part = null;
  if (b > 0) {
    const disc = b * b - cc;
    if (disc > 0) {
      const t = b - Math.sqrt(disc);
      if (t > 0.2 && t < best) { best = t; part = 'head'; }
    }
  }
  // chest and leg boxes
  const topY = c.pos.y + (c.crouch ? 0.92 : 1.38);
  const chest = rayBox(o, d, px - 0.31, c.pos.y + 0.55, pz - 0.31, px + 0.31, topY, pz + 0.31);
  if (chest !== null && chest > 0.2 && chest < best) { best = chest; part = 'chest'; }
  const legs = rayBox(o, d, px - 0.29, c.pos.y, pz - 0.29, px + 0.29, c.pos.y + 0.56, pz + 0.29);
  if (legs !== null && legs > 0.2 && legs < best) { best = legs; part = 'legs'; }
  return part ? { dist: best, part } : null;
}

function rayBox(o, d, minX, minY, minZ, maxX, maxY, maxZ) {
  let t0 = 0, t1 = Infinity;
  const axes = [
    [o.x, d.x, minX, maxX], [o.y, d.y, minY, maxY], [o.z, d.z, minZ, maxZ],
  ];
  for (const [oo, dd, mn, mx] of axes) {
    if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) return null; }
    else {
      let ta = (mn - oo) / dd, tb = (mx - oo) / dd;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
  }
  return t0;
}

function shootOnce(c, def, inst) {
  inst.mag--;
  c.lastShotT = S.time;
  c.bloom = Math.min(0.055, c.bloom + def.bloomShot);
  c.recoilPitch = Math.min(0.16, (c.recoilPitch || 0) + def.kick);
  _eye.set(c.pos.x, c.pos.y + eyeHeight(c), c.pos.z);
  const spread = spreadFor(c, def);
  const pellets = def.pellets || 1;
  let anyHit = false, anyKill = false, anyHead = false;
  for (let p = 0; p < pellets; p++) {
    const g1 = (S.rng() + S.rng() + S.rng() - 1.5) / 1.5;
    const g2 = (S.rng() + S.rng() + S.rng() - 1.5) / 1.5;
    dirFromAngles(c.yaw + g1 * spread, c.pitch + (c.recoilPitch || 0) + g2 * spread, _dir);
    const worldDist = rayHitDistance(_eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, 220);
    let bestDist = worldDist, bestTarget = null, bestPart = null;
    for (const other of S.combatants) {
      if (!other.alive || other.team === c.team || other === c) continue;
      const hit = hitCombatant(_eye, _dir, other);
      if (hit && hit.dist < bestDist) { bestDist = hit.dist; bestTarget = other; bestPart = hit.part; }
    }
    _hit.copy(_dir).multiplyScalar(bestDist === Infinity ? 60 : bestDist).add(_eye);
    // the tracer starts at the gun, not the eye
    _muzzle.copy(_dir).multiplyScalar(0.55).add(_eye);
    _muzzle.y -= 0.14;
    if (p === 0) fx.muzzle(_muzzle);
    fx.tracer(_muzzle, _hit);
    if (bestTarget) {
      const mult = bestPart === 'head' ? def.headMult : bestPart === 'legs' ? 0.75 : 1;
      const wasAlive = bestTarget.alive;
      applyDamage(bestTarget, def.damage * mult * falloff(def, bestDist), c, bestPart);
      fx.impact(_hit, 'hit');
      if (c.isPlayer) {
        anyHit = true;
        if (bestPart === 'head') anyHead = true;
        if (wasAlive && !bestTarget.alive) anyKill = true;
      }
    } else if (bestDist !== Infinity) {
      fx.impact(_hit, 'spark');
    }
  }
  if (c.isPlayer && anyHit) { audio.hitmark(anyHead); S.playerHitT = S.time; S.playerHitHead = anyHead; }
  if (c.isPlayer && anyKill) S.playerKillT = S.time;
  audio.shotAt(inst.def, c.pos.x, c.pos.z);
  S.noises.push({ x: c.pos.x, z: c.pos.z, t: S.time, radius: def.noiseR, team: c.team });
  if (S.noises.length > 48) S.noises.shift();
  if (inst.mag === 0) startReload(c);
}

export function startReload(c) {
  const inst = currentInst(c);
  const def = currentDef(c);
  if (!inst || !def || c.reloadT > 0) return;
  if (inst.mag >= def.mag || inst.reserve <= 0) return;
  c.reloadT = def.reload;
  audio.reloadSound(c.pos.x, c.pos.z, def.mag > 12);
}

function finishReload(c) {
  const inst = currentInst(c);
  const def = currentDef(c);
  const take = Math.min(def.mag - inst.mag, inst.reserve);
  inst.mag += take;
  inst.reserve -= take;
}

// Per-step weapon housekeeping for one combatant: cooldowns, reloads,
// bloom and recoil recovery, and firing while the trigger is held (or
// freshly pressed, for semi-automatic weapons).
export function updateWeapons(c, dt) {
  if (!c.alive) { c.wantFire = false; return; }
  if (c.fireT > 0) c.fireT -= dt;
  if (c.bloom > 0 && S.time - c.lastShotT > 0.22) c.bloom = Math.max(0, c.bloom - dt * 0.075);
  if (c.recoilPitch > 0) c.recoilPitch = Math.max(0, c.recoilPitch - dt * 0.11);
  if (c.switchT > 0) {
    c.switchT -= dt;
    if (c.switchT <= 0 && c.pendingSlot) {
      c.current = c.pendingSlot;
      c.pendingSlot = null;
    }
  }
  if (c.reloadT > 0) {
    c.reloadT -= dt;
    if (c.reloadT <= 0) finishReload(c);
    c.wantFire = false;
    return;
  }
  const inst = currentInst(c);
  const def = currentDef(c);
  if (!inst || !def) { c.wantFire = false; return; }
  const trigger = c.wantFire && (def.auto || !c.fireHeld);
  c.fireHeld = c.wantFire;
  if (!trigger || c.switchT > 0) return;
  if (c.fireT > 0) return;
  if (inst.mag <= 0) {
    audio.dryFire(c.pos.x, c.pos.z);
    c.fireT = 0.3;
    startReload(c);
    return;
  }
  c.fireT = 60 / def.rpm;
  shootOnce(c, def, inst);
}

export function switchSlot(c, slot) {
  if (c.current === slot || !c.slots[slot] || c.switchT > 0) return;
  c.pendingSlot = slot;
  c.switchT = 0.38;
  c.reloadT = 0;
}

// --- grenades ----------------------------------------------------------------

export function throwGrenade(c, kind) {
  if (c.grenades[kind] <= 0) return false;
  c.grenades[kind]--;
  const eye = eyeHeight(c);
  dirFromAngles(c.yaw, c.pitch + 0.06, _dir);
  S.grenades.push({
    kind,
    pos: new THREE.Vector3(c.pos.x + _dir.x * 0.4, c.pos.y + eye, c.pos.z + _dir.z * 0.4),
    vel: new THREE.Vector3(_dir.x * 15.5, _dir.y * 15.5 + 3.2, _dir.z * 15.5),
    t: kind === 'frag' ? 1.5 : 1.35,
    owner: c, team: c.team, bounced: false, done: false,
  });
  audio.throwSound(c.pos.x, c.pos.z);
  return true;
}

const _to = new THREE.Vector3();

export function updateGrenades(dt) {
  for (let i = S.grenades.length - 1; i >= 0; i--) {
    const g = S.grenades[i];
    g.t -= dt;
    g.vel.y -= 19 * dt;
    g.pos.addScaledVector(g.vel, dt);
    if (g.pos.y < 0.12) {
      g.pos.y = 0.12;
      if (Math.abs(g.vel.y) > 1.4) { g.vel.y = -g.vel.y * 0.38; g.bounced = true; }
      else g.vel.y = 0;
      g.vel.x *= 0.72; g.vel.z *= 0.72;
      if (g.kind === 'flash' && g.bounced) g.t = Math.min(g.t, 0.55);
      if (g.kind === 'smoke' && g.bounced) g.t = Math.min(g.t, 0.4);
    }
    // bounce off walls, cheaply: if the point entered a tall collider, push
    // it back out along x or z (whichever moved less into it)
    for (const col of WORLD.colliders) {
      if (col.h < g.pos.y) continue;
      if (g.pos.x > col.minX - 0.08 && g.pos.x < col.maxX + 0.08 && g.pos.z > col.minZ - 0.08 && g.pos.z < col.maxZ + 0.08) {
        const pushL = g.pos.x - (col.minX - 0.08), pushR = (col.maxX + 0.08) - g.pos.x;
        const pushT = g.pos.z - (col.minZ - 0.08), pushB = (col.maxZ + 0.08) - g.pos.z;
        const min = Math.min(pushL, pushR, pushT, pushB);
        if (min === pushL || min === pushR) { g.pos.x = min === pushL ? col.minX - 0.08 : col.maxX + 0.08; g.vel.x = -g.vel.x * 0.4; }
        else { g.pos.z = min === pushT ? col.minZ - 0.08 : col.maxZ + 0.08; g.vel.z = -g.vel.z * 0.4; }
        g.bounced = true;
      }
    }
    if (g.t <= 0) {
      detonate(g);
      S.grenades.splice(i, 1);
    }
  }
  // smoke clouds age here, in the simulation, because they block sight
  for (let i = S.smokes.length - 1; i >= 0; i--) {
    const s = S.smokes[i];
    s.t += dt;
    if (s.t >= s.life) S.smokes.splice(i, 1);
  }
}

function detonate(g) {
  if (g.kind === 'frag') {
    fx.explosionFx(g.pos);
    audio.explosionAt(g.pos.x, g.pos.z);
    for (const c of S.combatants) {
      if (!c.alive) continue;
      _to.set(c.pos.x - g.pos.x, 0, c.pos.z - g.pos.z);
      const dist = Math.max(0.6, _to.length());
      if (dist > 5.6) continue;
      let dmg = 95 * (1 - dist / 6.2);
      if (losBlocked(g.pos.x, 0.7, g.pos.z, c.pos.x, 0.9, c.pos.z)) dmg *= 0.25;
      if (dmg > 2) applyDamage(c, dmg, g.owner, 'chest');
    }
    if (S.player) {
      const d = S.player.pos.distanceTo(g.pos);
      if (d < 9) fx.addShake(0.22 * (1 - d / 9));
    }
  } else if (g.kind === 'flash') {
    audio.flashPop(g.pos.x, g.pos.z);
    fx.muzzle(g.pos);
    for (const c of S.combatants) {
      if (!c.alive) continue;
      _to.set(g.pos.x - c.pos.x, 0, g.pos.z - c.pos.z);
      const dist = _to.length();
      if (dist > 20) continue;
      dirFromAngles(c.yaw, 0, _dir);
      _to.normalize();
      const facing = _dir.x * _to.x + _dir.z * _to.z; // 1 = staring at it
      let blind = 0;
      if (facing > 0.86) blind = 2.9;
      else if (facing > 0.45) blind = 1.7;
      else if (facing > 0) blind = 0.7;
      else blind = dist < 5 ? 0.5 : 0;
      blind *= Math.max(0.25, 1 - dist / 24);
      if (blind > 0.15) c.flashT = Math.max(c.flashT, blind);
    }
  } else if (g.kind === 'smoke') {
    S.smokes.push({ x: g.pos.x, z: g.pos.z, r: 3.1, t: 0, life: 15 });
    fx.spawnSmokeFx(g.pos.x, g.pos.z);
    audio.smokeHiss(g.pos.x, g.pos.z);
  }
}
