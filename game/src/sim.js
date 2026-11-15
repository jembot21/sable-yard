// sim.js — the match itself: rounds, phases, the economy's round awards,
// the breach charge, and win checks. It advances the state in fixed steps
// (main.js owns the clock), drives every combatant through their brain or
// the player's input, and lets weapons.js resolve the violence. Rendering
// reads what is left behind.

import * as THREE from 'three';
import { S, PHASE, TEAM, makeCombatant, makeWeaponInstance, otherTeam, aliveOf, radio, zoneName } from './state.js';
import { WORLD } from './world.js';
import { WEAPONS, updateWeapons, updateGrenades, buyItem } from './weapons.js';
import { updatePlayer } from './player.js';
import { updateBot, makeBrain, assignPlans, botBuy, botName } from './bots.js';
import { input } from './input.js';
import * as audio from './audio.js';
import * as fx from './effects.js';

const BUY_TIME = 12;
const ROUND_TIME = 100;
const CHARGE_TIME = 35;
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5;
const DEFUSE_TIME_KIT = 2.5;

export function createCombatants(playerTeam) {
  S.combatants.length = 0;
  let id = 0;
  const player = makeCombatant(id++, playerTeam, 'YOU', true);
  S.player = player;
  S.combatants.push(player);
  const seen = { wardens: 0, jackals: 0 };
  for (const team of [TEAM.WARDENS, TEAM.JACKALS]) {
    const count = team === playerTeam ? 4 : 5;
    for (let i = 0; i < count; i++) {
      const bot = makeCombatant(id++, team, botName(team, seen[team]++), false);
      bot.brain = makeBrain(bot);
      S.combatants.push(bot);
    }
  }
  return S.combatants;
}

function resetLoadout(c, keepGear) {
  if (!keepGear) {
    c.slots.primary = null;
    c.slots.sidearm = makeWeaponInstance('p9');
    c.current = 'sidearm';
    c.armor = 0;
    c.helmet = false;
    c.kit = false;
    c.grenades = { frag: 0, flash: 0, smoke: 0 };
  }
  const side = c.slots.sidearm;
  if (side) { side.mag = WEAPONS[side.def].mag; side.reserve = WEAPONS[side.def].reserve; }
  if (!c.slots.sidearm) c.slots.sidearm = makeWeaponInstance('p9');
  const inst = c.slots[c.current];
  if (!inst) c.current = c.slots.primary ? 'primary' : 'sidearm';
}

export function startMatch(playerTeam) {
  S.playerTeam = playerTeam;
  createCombatants(playerTeam);
  S.score.wardens = 0;
  S.score.jackals = 0;
  S.round = 1;
  for (const c of S.combatants) {
    c.money = 800;
    c.kills = 0;
    c.deaths = 0;
    resetLoadout(c, false);
  }
  startRound();
}

export function startRound() {
  S.feed.length = 0;
  S.grenades.length = 0;
  S.smokes.length = 0;
  S.noises.length = 0;
  S.targetSite = S.rng() < 0.5 ? 'A' : 'B';
  // spawns and fresh bodies; survivors of last round keep their gear
  for (const team of [TEAM.WARDENS, TEAM.JACKALS]) {
    const spawns = WORLD.spawns[team];
    let slot = 0;
    for (const c of S.combatants) {
      if (c.team !== team) continue;
      const [sx, sz] = spawns[slot++ % spawns.length];
      if (!c.pos) { c.pos = new THREE.Vector3(); c.vel = new THREE.Vector3(); }
      c.pos.set(sx, 0, sz);
      c.vel.set(0, 0, 0);
      c.yaw = team === TEAM.JACKALS ? -Math.PI / 2 : Math.PI / 2;
      c.pitch = 0;
      const survived = c.alive;
      c.hp = 100;
      c.alive = true;
      c.crouch = false;
      c.bloom = 0;
      c.reloadT = 0;
      c.fireT = 0;
      c.flashT = 0;
      c.moveSpeed = 0;
      c.wantFire = false;
      c.chargeCarrying = false;
      resetLoadout(c, survived);
    }
  }
  // the charge: the player carries it when attacking, else a random Jackal
  const jackals = S.combatants.filter((c) => c.team === TEAM.JACKALS && c.alive);
  const carrier = S.player.team === TEAM.JACKALS ? S.player : jackals[Math.floor(S.rng() * jackals.length)];
  S.charge = { state: 'carried', carrier, pos: new THREE.Vector3(), t: 0, progress: 0, beepT: 0 };
  carrier.chargeCarrying = true;
  fx.setChargeDevice(null);
  S.phase = PHASE.BUY;
  S.phaseT = BUY_TIME;
  S.banner = { title: `ROUND ${S.round}`, sub: S.playerTeam === TEAM.JACKALS ? `Plant the charge at Site ${S.targetSite}` : `Defend the sites — the Jackals are coming for ${S.targetSite}`, t: 2.6 };
  for (const c of S.combatants) if (!c.isPlayer) botBuy(c);
  // the round's plan goes out on the radio while the teams shop
  const caller = S.combatants.find((x) => x.alive && !x.isPlayer && x.team === S.playerTeam);
  if (caller) radio(caller, S.playerTeam === TEAM.JACKALS ? `Hit Site ${S.targetSite} — stick with the carrier` : `Hold the sites — intel says Site ${S.targetSite}`, true);
}

function endRound(winner, reason) {
  S.score[winner]++;
  const loser = otherTeam(winner);
  for (const c of S.combatants) {
    const award = c.team === winner ? 2700 : 1900;
    c.money = Math.min(16000, c.money + award);
  }
  if (reason === 'detonation') {
    for (const c of S.combatants) if (c.team === TEAM.JACKALS) c.money = Math.min(16000, c.money + 300);
  }
  S.winner = winner;
  S.roundReason = reason;
  const won = winner === S.playerTeam;
  S.banner = {
    title: winner === TEAM.WARDENS ? 'WARDENS TAKE THE ROUND' : 'JACKALS TAKE THE ROUND',
    sub: reasonText(reason),
    t: 4.2,
  };
  audio.roundStinger(won);
  if (S.score[winner] >= S.winsNeeded || S.round >= 13) {
    S.phase = PHASE.MATCH_END;
    S.phaseT = 999;
    S.banner = {
      title: winner === TEAM.WARDENS ? 'WARDENS WIN THE MATCH' : 'JACKALS WIN THE MATCH',
      sub: `Final score ${S.score.wardens} — ${S.score.jackals}. Click to play again.`,
      t: 999,
    };
  } else {
    S.phase = PHASE.ROUND_END;
    S.phaseT = 5;
  }
}

function reasonText(reason) {
  switch (reason) {
    case 'elimination': return 'The other team was eliminated';
    case 'detonation': return 'The charge detonated';
    case 'defused': return 'The charge was defused';
    case 'time': return 'The round clock ran out';
    default: return '';
  }
}

// --- the charge ---------------------------------------------------------------

function updateCharge(dt) {
  const charge = S.charge;
  if (!charge) return;
  if (charge.state === 'carried') {
    charge.pos.copy(charge.carrier.pos);
    return;
  }
  if (charge.state === 'dropped') {
    fx.setChargeDevice(charge.pos, false);
    for (const c of S.combatants) {
      if (!c.alive || c.team !== TEAM.JACKALS) continue;
      if (Math.hypot(c.pos.x - charge.pos.x, c.pos.z - charge.pos.z) < 1.15) {
        charge.state = 'carried';
        charge.carrier = c;
        c.chargeCarrying = true;
        fx.setChargeDevice(null);
        break;
      }
    }
    return;
  }
  if (charge.state === 'planted') {
    charge.t -= dt;
    charge.beepT -= dt;
    const interval = charge.t > 10 ? 1 : charge.t > 5 ? 0.5 : 0.25;
    if (charge.beepT <= 0) {
      charge.beepT = interval;
      audio.plantBeep(charge.t <= 0.3);
      fx.setChargeDevice(charge.pos, true);
    }
    if (charge.t <= 0) {
      charge.state = 'exploded';
      fx.explosionFx(charge.pos);
      audio.explosionAt(charge.pos.x, charge.pos.z);
      fx.setChargeDevice(null);
      endRound(TEAM.JACKALS, 'detonation');
    }
    return;
  }
}

// Who is channeling what this step: bots flag channelKind, the player holds
// E. Planting needs the carrier inside the site; defusing needs a Warden on
// the planted charge. Progress resets the moment the channel breaks.
function updateChannels(dt) {
  const charge = S.charge;
  if (!charge) return;
  if (S.phase === PHASE.LIVE && charge.state === 'carried') {
    const carrier = charge.carrier;
    const site = WORLD.sites[S.targetSite];
    const inSite = carrier && carrier.alive && Math.hypot(carrier.pos.x - site.x, carrier.pos.z - site.z) < site.r;
    const channeling = inSite && (carrier.isPlayer ? input.keys.has('KeyE') : carrier.channelKind === 'plant');
    if (channeling) {
      charge.progress += dt;
      charge.progressNeed = PLANT_TIME;
      if (charge.progress >= PLANT_TIME) {
        charge.state = 'planted';
        charge.t = CHARGE_TIME;
        charge.pos.set(carrier.pos.x, 0, carrier.pos.z);
        carrier.chargeCarrying = false;
        carrier.plants++;
        carrier.money = Math.min(16000, carrier.money + 300);
        S.phase = PHASE.PLANTED;
        S.phaseT = CHARGE_TIME;
        S.banner = { title: 'CHARGE PLANTED', sub: `Site ${S.targetSite} — ${CHARGE_TIME} seconds to detonation`, t: 2.4 };
        // the plant is called on both radios: settle in, or retake now
        const caller2 = S.combatants.find((x) => x.alive && !x.isPlayer && x.team === S.playerTeam);
        if (caller2) radio(caller2, S.playerTeam === TEAM.JACKALS ? `Charge is live at Site ${S.targetSite} — hold it` : `Charge planted at Site ${S.targetSite} — retake, now`, true);
        audio.plantBeep(true);
        fx.setChargeDevice(charge.pos, true);
      }
    } else {
      charge.progress = 0;
    }
  }
  if (S.phase === PHASE.PLANTED && charge.state === 'planted') {
    let defuser = null;
    for (const c of S.combatants) {
      if (!c.alive || c.team !== TEAM.WARDENS) continue;
      if (Math.hypot(c.pos.x - charge.pos.x, c.pos.z - charge.pos.z) > 1.7) continue;
      if (c.isPlayer ? input.keys.has('KeyE') : c.channelKind === 'defuse') { defuser = c; break; }
    }
    if (defuser) {
      // the first hands on the charge get a callout: his own if he is a
      // bot, a covering teammate's if the player is defusing
      if (charge.progress === 0 && !charge.calledDefuse) {
        charge.calledDefuse = true;
        const caller3 = defuser.isPlayer ? S.combatants.find((x) => x.alive && !x.isPlayer && x.team === defuser.team) : defuser;
        if (caller3) radio(caller3, defuser.isPlayer ? 'Covering your defuse — go' : 'Defusing — cover me', true);
      }
      charge.progress += dt;
      const need = defuser.kit ? DEFUSE_TIME_KIT : DEFUSE_TIME;
      charge.progressNeed = need;
      if (charge.progress >= need) {
        charge.state = 'defused';
        fx.setChargeDevice(null);
        endRound(TEAM.WARDENS, 'defused');
      }
    } else {
      charge.progress = 0;
    }
  }
}

// --- the fixed step -------------------------------------------------------------

export function step(dt) {
  S.time += dt;
  if (S.banner && S.banner.t < 900) {
    S.banner.t -= dt;
    if (S.banner.t <= 0) S.banner = null;
  }
  switch (S.phase) {
    case PHASE.BUY: {
      S.phaseT -= dt;
      // the player may still look around; nobody moves or shoots in buy time
      if (S.player) { S.player.yaw = input.yaw; S.player.pitch = input.pitch; }
      if (S.phaseT <= 0) {
        S.phase = PHASE.LIVE;
        S.phaseT = ROUND_TIME;
        assignPlans();
      }
      return;
    }
    case PHASE.LIVE:
    case PHASE.PLANTED: {
      if (S.phase === PHASE.LIVE) {
        S.phaseT -= dt;
        if (S.phaseT <= 0) { endRound(TEAM.WARDENS, 'time'); return; }
      } else {
        S.phaseT = S.charge ? S.charge.t : 0;
      }
      for (const c of S.combatants) {
        if (c.flashT > 0) c.flashT -= dt;
        if (c.isPlayer) updatePlayer(c, dt);
        else updateBot(c, dt);
      }
      for (const c of S.combatants) updateWeapons(c, dt);
      updateGrenades(dt);
      updateChannels(dt);
      updateCharge(dt);
      if (S.phase !== PHASE.LIVE && S.phase !== PHASE.PLANTED) return; // a channel ended it
      const wardens = aliveOf(TEAM.WARDENS);
      const jackals = aliveOf(TEAM.JACKALS);
      if (S.phase === PHASE.LIVE) {
        if (jackals === 0) endRound(TEAM.WARDENS, 'elimination');
        else if (wardens === 0) endRound(TEAM.JACKALS, 'elimination');
      } else if (wardens === 0) {
        endRound(TEAM.JACKALS, 'elimination');
      }
      return;
    }
    case PHASE.ROUND_END: {
      updateGrenades(dt);
      S.phaseT -= dt;
      if (S.phaseT <= 0) {
        S.round++;
        startRound();
      }
      return;
    }
    default:
      return;
  }
}
