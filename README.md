# Sable Yard — a three.js tactical FPS

A round-based tactical shooter in the style Counter-Strike made famous,
built as static files on three.js 0.187.0: two teams of five, short rounds
won by elimination or by a breach charge planted and defended, money earned
each round and spent in a buy menu, and gunplay where stopping to aim beats
spraying on the move. Single-player against bots, no network, no build step.

## Play it

```
node serve.ts          # then open http://localhost:8080
```

Pick a side. The **Wardens** defend two sites — a fuel depot (A) and a
gantry yard (B). The **Jackals** carry the charge: plant it at a site, hold
for 35 seconds, or simply eliminate the defence. First to 7 rounds.

Controls: WASD + mouse, click to fire, right mouse to aim/scope, R reload,
Shift sprint, Ctrl crouch, B buy menu, 1/2 weapons, 3 select grenade,
G throw, E (hold) plant/defuse, Tab scoreboard.

## How it is built

- `game/` — the game itself: `index.html` plus ES modules under `game/src/`,
  three.js vendored byte-for-byte under `game/vendor/three/`.
- `game/src/sim.js` — the match, advanced in fixed 1/60 s steps: phases,
  rounds, the economy, the charge, win checks.
- `game/src/bots.js` — bot perception (sight cones, line of sight, hearing),
  team plans, and gunfight behaviour.
- `game/src/weapons.js` — the gunplay table, ballistics with head/chest/leg
  hit volumes, and grenades (frag, flash, smoke — smoke blocks sightlines).
- `game/src/world.js` — the map: every prop registers its own collider, and
  the waypoint graph's edges are derived from clearance tests.
- `main.ts` — the entry program: copies `game/` and `screenshots/` to the
  output directory and writes `dossier.json` with the kit's library.
- `screenshots/` — real renders of the game, staged by its own `?shot=`
  scenes (see `shots.json`).

The map, the teams, the names and the art are this game's own; all textures
are painted on canvases at load and all sounds are synthesised with
WebAudio, so the game ships no asset files at all.

MIT licensed — see `LICENSE`.
