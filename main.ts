// Sable Yard — entry program for the make.fun three.js tactical FPS bounty.
//
// The game itself is the game/ folder next to this file: plain static files
// (ES modules, three.js 0.187.0 vendored under game/vendor/three) that any
// static server can host and desktop Chrome can play offline. This program
// is only the courier. It copies game/ and screenshots/ into the output
// directory and writes dossier.json there with the kit's vendored library —
// the dossier (screenshots plus a source listing) is what the judge reads.
//
// In the grader the output directory is /output; anywhere else the
// MAKEFUN_OUTPUT_DIR environment variable names it instead:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps below are the gate's own (see the kit's RULES.txt): the dossier
// text is capped at 160 KiB, at most 4 screenshots of at most 256 KiB each,
// and game/ holds at most 993 entries and 48 MiB. buildDossier refuses
// anything the gate would refuse, so a bad build fails here, not later.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
