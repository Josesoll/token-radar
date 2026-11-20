// Signal Sweep — token-radar-01 entry program (Node 22, standard library only).
//
// Reads the sealed snapshot (--input <file|dir>, default /input/snapshot.json),
// prices every launch candidate with the peer-anchored model in lib/model.ts,
// then writes, into the output directory:
//   board.json    the ranked board the gate reads
//   data.js       the same board, as the dashboard's offline dataset
//   dashboard/    a copy of this repository's dashboard/
//   screenshots/  a copy of this repository's screenshots/
//   dossier.json  buildDossier from vendor/makefun-board.ts, written last
// The program is deterministic: same snapshot in, same bytes out, every run.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`signal sweep: no snapshot at ${inputFile} — pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`signal sweep: refusing to write a board the gate would reject: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`signal sweep: screenshots/ holds ${shots.length} images — hand in 3: board, detail, filtered\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`signal sweep: screenshots/${name} is not a plain dossier image name\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `signal sweep: ${radar.counts.protocols} protocols — ${radar.counts.tokenized} tokenized set aside, ` +
    `${radar.counts.not_own_launch} pre-token but not an own launch, ${board.length} ranked ` +
    `(${radar.counts.watchlist} watchlist + ${radar.counts.early} early), global peer multiple ${radar.global_peer_multiple}\n` +
    `signal sweep: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length}) and dossier.json in ${out}\n`,
);
