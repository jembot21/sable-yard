// palette.js — every colour and surface in Sable Yard comes from here, so the
// whole game (3D scene and HUD alike) stays in one chosen palette: a freight
// yard at dusk, slate blue shadow against sodium-amber light, with cyan for
// the Wardens and signal orange for the Jackals. Textures are painted on
// canvases at load; the game ships no image files and loads nothing.

import * as THREE from 'three';

export const PAL = {
  sky: 0x1b2836, horizon: 0x51606e, fog: 0x2b3947,
  sun: 0xffb36b, hemiSky: 0x8fb4d8, hemiGround: 0x35302a,
  asphalt: '#3a3f45', concrete: '#83837e', concreteDark: '#5d5f5c',
  metal: '#5f6a72', metalDark: '#41484e', rust: '#96502f',
  wood: '#8a6a44', woodDark: '#6d5436',
  boxTeal: '#2e6f6a', boxOchre: '#a8742a', boxRed: '#8e3b31', boxBlue: '#39586e',
  wardens: 0x35c4dc, jackals: 0xff8a2a,
  wardensCss: '#35c4dc', jackalsCss: '#ff8a2a',
  ink: '#ece7db', muted: '#9aa3ab', amber: '#ffb648', danger: '#ff5348',
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// Deterministic little noise painter: fills a base colour, then freckles it
// with darker and lighter specks and a few soft stains. Seeded per texture so
// every surface looks the same on every load.
export function noiseFill(ctx, w, h, base, seed, stain = 0.16) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 90; i++) {
    const v = rnd();
    ctx.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let i = 0; i < 7; i++) {
    const x = rnd() * w, y = rnd() * h, r = 12 + rnd() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(10,10,12,${stain * rnd()})`);
    g.addColorStop(1, 'rgba(10,10,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

export function toTexture(c, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function concreteTexture(seed = 7) {
  const [c, x] = canvas(256, 256);
  noiseFill(x, 256, 256, PAL.concrete, seed);
  x.strokeStyle = 'rgba(0,0,0,0.18)';
  x.lineWidth = 2;
  x.strokeRect(1, 1, 254, 254);
  x.beginPath(); x.moveTo(0, 128); x.lineTo(256, 128); x.stroke();
  return toTexture(c);
}

export function metalTexture(seed = 21) {
  const [c, x] = canvas(256, 256);
  noiseFill(x, 256, 256, PAL.metal, seed, 0.1);
  x.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 5; i++) x.fillRect(0, i * 52 + 8, 256, 3);
  return toTexture(c);
}

// A shipping-container side: vertical ribs, a stencilled fleet number and the
// yard's own brand, so the map's art is the game's own.
export function containerTexture(base, label, seed) {
  const [c, x] = canvas(512, 256);
  noiseFill(x, 512, 256, base, seed, 0.2);
  for (let i = 0; i < 24; i++) {
    x.fillStyle = 'rgba(0,0,0,0.13)';
    x.fillRect(i * 22 + 4, 0, 7, 256);
    x.fillStyle = 'rgba(255,255,255,0.05)';
    x.fillRect(i * 22 + 12, 0, 3, 256);
  }
  x.fillStyle = 'rgba(0,0,0,0.28)';
  x.fillRect(0, 226, 512, 30);
  x.font = 'bold 44px ui-monospace, monospace';
  x.fillStyle = 'rgba(240,238,230,0.82)';
  x.fillText(label, 26, 66);
  x.font = 'bold 25px ui-monospace, monospace';
  x.fillStyle = 'rgba(240,238,230,0.5)';
  x.fillText('SABLE YARD LOGISTICS', 26, 104);
  return toTexture(c);
}

export function crateTexture(seed = 33) {
  const [c, x] = canvas(256, 256);
  noiseFill(x, 256, 256, PAL.wood, seed, 0.12);
  x.strokeStyle = PAL.woodDark;
  x.lineWidth = 14;
  x.strokeRect(7, 7, 242, 242);
  x.beginPath();
  x.moveTo(7, 7); x.lineTo(249, 249);
  x.moveTo(249, 7); x.lineTo(7, 249);
  x.stroke();
  return toTexture(c);
}

export function hazardTexture() {
  const [c, x] = canvas(256, 64);
  x.fillStyle = '#c9a227';
  x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#22242a';
  for (let i = -1; i < 6; i++) {
    x.beginPath();
    x.moveTo(i * 64, 64); x.lineTo(i * 64 + 32, 0); x.lineTo(i * 64 + 64, 0); x.lineTo(i * 64 + 32, 64);
    x.fill();
  }
  return toTexture(c, 3, 1);
}

// The dusk sky: a vertical gradient with a low sun glow in the west, drawn
// once and wrapped on the inside of a large sphere in world.js.
export function skyTexture() {
  const [c, x] = canvas(1024, 512);
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#101c2a');
  g.addColorStop(0.45, '#27394e');
  g.addColorStop(0.72, '#5d6a72');
  g.addColorStop(0.86, '#c98d4e');
  g.addColorStop(1, '#e8a95c');
  x.fillStyle = g;
  x.fillRect(0, 0, 1024, 512);
  const sun = x.createRadialGradient(180, 428, 4, 180, 428, 190);
  sun.addColorStop(0, 'rgba(255,205,130,0.95)');
  sun.addColorStop(0.25, 'rgba(255,170,90,0.45)');
  sun.addColorStop(1, 'rgba(255,170,90,0)');
  x.fillStyle = sun;
  x.fillRect(0, 200, 1024, 312);
  return toTexture(c);
}
