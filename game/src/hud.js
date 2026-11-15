// hud.js — everything drawn over the 3D view: the HUD (health, armour,
// ammunition, money, timer, scores), the kill feed, the buy menu, the
// scoreboard, the radar, banners and the full-screen flashes and vignettes.
// It only reads state and writes DOM; the simulation never reads it back.

import { S, PHASE, TEAM, aliveOf } from './state.js';
import { WORLD } from './world.js';
import { WEAPONS, GEAR, buyItem, currentDef, currentInst } from './weapons.js';
import { isScoped } from './player.js';
import { input } from './input.js';
import * as audio from './audio.js';

const el = {};
let buyOpen = false;
let lastPhase = '';
let minimapT = 0;
export const hud = { onPlay: null };

export function initHud() {
  for (const id of ['menu', 'hud', 'crosshair', 'hitmarker', 'hp-num', 'hp-bar', 'armor-bar', 'money',
    'weapon-name', 'ammo', 'grenades-line', 'timer', 'score-line', 'round-line', 'feed', 'banner',
    'banner-title', 'banner-sub', 'objective', 'channel', 'channel-fill', 'buymenu', 'buy-money',
    'buy-grid', 'scoreboard', 'score-rows', 'vignette', 'dmgdir', 'flashfx', 'scopefx', 'minimap',
    'status-line', 'alive-line']) {
    el[id] = document.getElementById(id);
  }
  document.getElementById('play-wardens').addEventListener('click', () => { audio.initAudio(); audio.uiClick(); if (hud.onPlay) hud.onPlay(TEAM.WARDENS); });
  document.getElementById('play-jackals').addEventListener('click', () => { audio.initAudio(); audio.uiClick(); if (hud.onPlay) hud.onPlay(TEAM.JACKALS); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyB' && S.phase === PHASE.BUY) { buyOpen = !buyOpen; audio.uiClick(); }
    if (e.code === 'Escape') buyOpen = false;
  });
  buildBuyGrid();
}

function buildBuyGrid() {
  const items = [
    ...Object.entries(WEAPONS).filter(([, d]) => d.price > 0),
    ...Object.entries(GEAR),
  ];
  el['buy-grid'].innerHTML = '';
  for (const [id, def] of items) {
    const b = document.createElement('button');
    b.className = 'buy-item';
    b.dataset.item = id;
    b.innerHTML = `<span class="buy-name">${def.name}</span><span class="buy-price">$${def.price}</span>`;
    b.addEventListener('click', () => {
      const p = S.player;
      if (!p) return;
      if (id === 'kit' && p.team !== TEAM.WARDENS) { audio.denyBuzz(); return; }
      if (buyItem(p, id)) audio.buyConfirm(); else audio.denyBuzz();
    });
    el['buy-grid'].appendChild(b);
  }
}

function fmtTime(t) {
  t = Math.max(0, Math.ceil(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function updateHud(dt) {
  const p = S.player;
  const inGame = S.phase !== PHASE.MENU;
  el.menu.style.display = inGame ? 'none' : 'flex';
  el.hud.style.display = inGame ? 'block' : 'none';
  if (!inGame || !p) return;

  // phase changes drive the buy menu
  if (S.phase !== lastPhase) {
    buyOpen = S.phase === PHASE.BUY;
    lastPhase = S.phase;
  }
  el.buymenu.style.display = buyOpen && S.phase === PHASE.BUY ? 'block' : 'none';
  const matchEnd = S.phase === PHASE.MATCH_END;
  el.scoreboard.style.display = (matchEnd || input.scorePressed) ? 'block' : 'none';
  // at match end the win banner and the scoreboard share the screen: the
  // banner rides higher, the panel lower, and the objective line (which
  // only repeats the banner's sub-line there) steps aside
  el.scoreboard.style.top = matchEnd ? '60%' : '';
  el.banner.style.top = matchEnd ? '15%' : '';
  el.objective.style.display = matchEnd ? 'none' : '';

  // top centre: scores, timer, round
  el['score-line'].innerHTML =
    `<span class="w">WARDENS ${S.score.wardens}</span><span class="sep">·</span><span class="j">${S.score.jackals} JACKALS</span>`;
  el['round-line'].textContent = `ROUND ${S.round} — FIRST TO ${S.winsNeeded}`;
  el.timer.textContent = S.phase === PHASE.BUY ? `BUY ${fmtTime(S.phaseT)}` : fmtTime(S.phaseT);
  el.timer.className = S.phase === PHASE.PLANTED ? 'danger' : '';
  el['alive-line'].textContent = `${aliveOf(TEAM.WARDENS)} ◈ vs ◈ ${aliveOf(TEAM.JACKALS)}`;

  // banner
  if (S.banner) {
    el.banner.style.opacity = '1';
    el['banner-title'].textContent = S.banner.title;
    el['banner-sub'].textContent = S.banner.sub;
  } else {
    el.banner.style.opacity = '0';
  }

  // objective line
  el.objective.textContent = objectiveText(p);

  // bottom left: health and armour
  el['hp-num'].textContent = Math.max(0, Math.ceil(p.hp));
  el['hp-bar'].style.width = `${Math.max(0, p.hp)}%`;
  el['hp-bar'].style.background = p.hp < 35 ? 'var(--danger)' : 'var(--ink)';
  el['armor-bar'].style.width = `${Math.max(0, p.armor)}%`;
  el['status-line'].textContent = statusText(p);

  // bottom right: weapon, ammunition, money, grenades
  const def = currentDef(p);
  const inst = currentInst(p);
  el['weapon-name'].textContent = def ? def.name : '—';
  el.ammo.innerHTML = inst ? `<b>${inst.mag}</b> / ${inst.reserve}` : '';
  el.money.textContent = `$${p.money}`;
  el['grenades-line'].textContent = grenadeText(p);

  // crosshair spread follows the same things the ballistics punish
  const gap = 5 + p.moveSpeed * 1.5 + p.bloom * 300 + (p.grounded ? 0 : 7);
  el.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  el.crosshair.style.opacity = isScoped(p) ? '0' : p.alive ? '1' : '0';
  const hitAge = S.time - (S.playerHitT || -9);
  el.hitmarker.style.opacity = hitAge < 0.14 ? '1' : '0';
  el.hitmarker.style.setProperty('--hm', S.playerHitHead ? '#ff5348' : '#ece7db');

  // damage feedback: vignette, direction tick, low-health pulse
  const dmgAge = performance.now() / 1000 - (p.dmgWallT || 0);
  let vig = dmgAge < 0.4 ? 0.55 * (1 - dmgAge / 0.4) : 0;
  if (p.alive && p.hp < 35) vig = Math.max(vig, 0.28 + Math.sin(performance.now() / 300) * 0.07);
  if (!p.alive) vig = 0.5;
  el.vignette.style.opacity = String(Math.min(0.85, vig));
  if (dmgAge < 1.1 && p.dmgFromYaw !== undefined) {
    el.dmgdir.style.opacity = String(1 - dmgAge / 1.1);
    el.dmgdir.style.transform = `translate(-50%,-50%) rotate(${((p.dmgFromYaw - p.yaw) * 180 / Math.PI).toFixed(0)}deg)`;
  } else {
    el.dmgdir.style.opacity = '0';
  }
  el.flashfx.style.opacity = String(Math.min(1, p.flashT * 0.95));
  el.scopefx.style.opacity = isScoped(p) ? '1' : '0';

  // channel bar (planting or defusing), captioned for the one it is
  const ch = S.charge;
  if (ch && ch.progress > 0.02 && ch.progressNeed) {
    el.channel.style.opacity = '1';
    el['channel-fill'].style.width = `${Math.min(100, ch.progress / ch.progressNeed * 100)}%`;
    const cap = S.phase === PHASE.PLANTED ? 'DEFUSING THE CHARGE' : 'PLANTING THE CHARGE';
    if (el.channel._cap !== cap) { el.channel._cap = cap; el.channel.querySelector('.cap').textContent = cap; }
  } else {
    el.channel.style.opacity = '0';
  }

  // kill feed
  const feedHtml = S.feed.map((f) => {
    const age = S.time - f.t;
    const o = age > 4 ? Math.max(0, 1 - (age - 4)) : 1;
    return `<div class="feed-line ${f.colour}" style="opacity:${o.toFixed(2)}">${f.text}</div>`;
  }).join('');
  if (el.feed._last !== feedHtml) { el.feed.innerHTML = feedHtml; el.feed._last = feedHtml; }

  // buy menu affordability
  if (buyOpen && S.phase === PHASE.BUY) {
    el['buy-money'].textContent = `$${p.money} — click to buy, B to close`;
    for (const b of el['buy-grid'].children) {
      const id = b.dataset.item;
      const price = (WEAPONS[id] || GEAR[id]).price;
      b.classList.toggle('cant', p.money < price);
    }
  }

  if (el.scoreboard.style.display === 'block') renderScoreboard();

  minimapT -= dt;
  if (minimapT <= 0) { minimapT = 0.12; drawMinimap(p); }
}

function statusText(p) {
  if (!p.alive) return 'ELIMINATED — spectating your team';
  const bits = [];
  if (p.helmet) bits.push('HELMET');
  if (p.kit) bits.push('DEFUSE KIT');
  if (p.chargeCarrying) bits.push('⚠ YOU CARRY THE CHARGE');
  return bits.join(' · ');
}

function grenadeText(p) {
  const sel = p.grenadeSel || 'frag';
  const parts = [];
  for (const [kind, label] of [['frag', 'FRAG'], ['flash', 'FLASH'], ['smoke', 'SMOKE']]) {
    if (p.grenades[kind] > 0) parts.push(kind === sel ? `[${label}]` : label);
  }
  return parts.length ? `G throw · 3 select — ${parts.join('  ')}` : '';
}

function objectiveText(p) {
  const site = S.targetSite;
  switch (S.phase) {
    case PHASE.BUY:
      return p.team === TEAM.JACKALS ? `Buy phase — your team attacks Site ${site}` : `Buy phase — intel says the Jackals want Site ${site}`;
    case PHASE.LIVE: {
      if (p.team === TEAM.JACKALS) {
        if (S.charge?.state === 'carried' && S.charge.carrier === p) return `Reach Site ${site} and hold E to plant the charge`;
        if (S.charge?.state === 'carried') return `Escort the charge carrier to Site ${site}`;
        if (S.charge?.state === 'dropped') return 'The charge is down — recover it';
        return `Attack Site ${site}`;
      }
      return 'Defend the sites — hold the angles, call the rotations';
    }
    case PHASE.PLANTED:
      return p.team === TEAM.JACKALS ? 'The charge is live — defend it' : 'Retake and defuse — hold E on the charge';
    case PHASE.ROUND_END:
      return S.roundReason ? '' : '';
    case PHASE.MATCH_END:
      return 'Match over — click to play again';
    default:
      return '';
  }
}

function renderScoreboard() {
  const rows = [...S.combatants].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  el['score-rows'].innerHTML = rows.map((c) =>
    `<div class="score-row ${c.team} ${c.alive ? '' : 'dead'}"><span>${c.isPlayer ? '★ ' : ''}${c.name}</span><span>${c.team === TEAM.WARDENS ? 'WARDENS' : 'JACKALS'}</span><span>${c.kills} / ${c.deaths}</span><span>$${c.money}</span></div>`,
  ).join('');
}

// The radar: the yard from above, your team as dots, the player as an
// arrow, gunfire as a fading blip on the enemy's side. Drawn from the same
// collider list the world was built with, so it can never lie about walls.
function drawMinimap(p) {
  const cv = el.minimap;
  const x = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const sx = (mx) => (mx - WORLD.minX) / (WORLD.maxX - WORLD.minX) * W;
  const sz = (mz) => (mz - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ) * H;
  x.fillStyle = '#12181f';
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#2c343c';
  for (const c of WORLD.colliders) {
    if (c.h < 0.9) continue;
    x.fillRect(sx(c.minX), sz(c.minZ), Math.max(1.5, sx(c.maxX) - sx(c.minX)), Math.max(1.5, sz(c.maxZ) - sz(c.minZ)));
  }
  for (const [key, site] of Object.entries(WORLD.sites)) {
    x.strokeStyle = key === 'A' ? '#ff8a2a' : '#35c4dc';
    x.lineWidth = 1.5;
    x.beginPath(); x.arc(sx(site.x), sz(site.z), site.r * (W / 76), 0, Math.PI * 2); x.stroke();
    x.fillStyle = x.strokeStyle;
    x.font = 'bold 9px system-ui';
    x.textAlign = 'center';
    x.fillText(key, sx(site.x), sz(site.z) + 3);
  }
  // enemy gunfire blips
  for (const n of S.noises) {
    if (n.team === p.team) continue;
    const age = S.time - n.t;
    if (age > 2.2) continue;
    x.fillStyle = `rgba(255,83,72,${(1 - age / 2.2).toFixed(2)})`;
    x.beginPath(); x.arc(sx(n.x), sz(n.z), 3, 0, Math.PI * 2); x.fill();
  }
  // the charge
  if (S.charge && (S.charge.state === 'planted' || S.charge.state === 'dropped')) {
    x.fillStyle = '#ffb648';
    x.fillRect(sx(S.charge.pos.x) - 2.5, sz(S.charge.pos.z) - 2.5, 5, 5);
  }
  // teammates
  for (const c of S.combatants) {
    if (!c.alive || c.team !== p.team || c.isPlayer) continue;
    x.fillStyle = p.team === TEAM.WARDENS ? '#35c4dc' : '#ff8a2a';
    x.beginPath(); x.arc(sx(c.pos.x), sz(c.pos.z), 2.6, 0, Math.PI * 2); x.fill();
  }
  // the player, an arrow facing their view (canvas y is world z, and the
  // forward vector is (-sin yaw, -cos yaw), so the arrow turns by -yaw)
  const px = sx(p.pos.x), pz = sz(p.pos.z);
  x.save();
  x.translate(px, pz);
  x.rotate(-p.yaw);
  x.fillStyle = '#ece7db';
  x.beginPath();
  x.moveTo(0, -5); x.lineTo(3.4, 4); x.lineTo(-3.4, 4);
  x.closePath(); x.fill();
  x.restore();
}
