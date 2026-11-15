// state.js — the one place the game's state lives. Every module reads and
// writes the single object S; nothing keeps a private copy of match facts.
// The simulation (sim.js) advances S in fixed steps; rendering only reads.

export const TEAM = { WARDENS: 'wardens', JACKALS: 'jackals' };

export const PHASE = {
  MENU: 'menu', BUY: 'buy', LIVE: 'live', PLANTED: 'planted',
  ROUND_END: 'roundEnd', MATCH_END: 'matchEnd',
};

// A tiny seeded RNG (mulberry32). A match seeds it from the clock; the
// screenshot scenes seed it fixed, so a staged frame is the same every load.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const S = {
  phase: PHASE.MENU,
  phaseT: 0,          // seconds left in timed phases / elapsed in others
  time: 0,             // match clock, seconds of simulation
  round: 1,
  winsNeeded: 7,       // first to 7 rounds takes the match (at most 13 played)
  score: { wardens: 0, jackals: 0 },
  playerTeam: TEAM.WARDENS,
  targetSite: 'A',     // the site the Jackals are sent to this round
  combatants: [],      // the player and every bot, one shape for all
  player: null,
  charge: null,        // the breach charge: { state, carrier, pos, t }
  grenades: [],        // thrown grenades in flight or fusing
  smokes: [],          // live smoke clouds { x, z, r, t }
  noises: [],          // recent sounds { x, z, t, radius, team }
  feed: [],            // kill feed lines { text, t, colour }
  banner: null,        // round/match banner { title, sub, t }
  winner: null,        // team that won the round or the match
  roundReason: '',
  mvpLine: '',
  rng: mulberry32(1),
  shot: null,          // 'start' | 'play' | 'end' when staging screenshots
  timeScale: 1,
};

export function otherTeam(team) {
  return team === TEAM.WARDENS ? TEAM.JACKALS : TEAM.WARDENS;
}

export function aliveOf(team) {
  let n = 0;
  for (const c of S.combatants) if (c.team === team && c.alive) n++;
  return n;
}

// A fresh combatant. The player and the bots share this exact shape; only the
// brain differs (input.js drives the player, bots.js drives the rest), which
// keeps damage, movement and weapons code single-pathed.
export function makeCombatant(id, team, name, isPlayer) {
  return {
    id, team, name, isPlayer,
    pos: null,           // THREE.Vector3, feet position (set at spawn)
    vel: null,           // THREE.Vector3
    yaw: 0, pitch: 0,
    hp: 100, armor: 0, helmet: false,
    alive: true, crouch: false, grounded: true,
    money: 800, kit: false,
    slots: { primary: null, sidearm: null },  // weapon instance ids
    current: 'sidearm',
    grenades: { frag: 0, flash: 0, smoke: 0 },
    fireT: 0, reloadT: 0, bloom: 0, lastShotT: -9,
    moveSpeed: 0, heardT: -9,
    kills: 0, deaths: 0, plants: 0,
    brain: null,         // bot-only AI state (bots.js)
    mesh: null,          // three.js group (models.js builds it)
    flashT: 0,           // flashbang blindness remaining
    healBlockT: 0,
  };
}

// Per-instance weapon state: ammunition and reload live here, the static
// facts live in weapons.js WEAPONS.
export function makeWeaponInstance(defId) {
  return { def: defId, mag: 0, reserve: 0 };
}
