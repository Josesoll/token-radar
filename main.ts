// Launch Radar v2 — entry program (Node 22, standard library only).
//
// What a run does, in order:
//   1. locate the sealed snapshot (--input <file|dir>, default /input)
//   2. parse it and build the radar (lib/model.ts fits the model on the
//      snapshot itself, so there is nothing else to load)
//   3. refuse to write anything if the board would fail the gate's rules
//   4. write board.json and data.js into the output directory
//   5. copy dashboard/ and screenshots/ beside them, checking the
//      screenshot count and names the dossier will accept
//   6. write dossier.json last, with the vendored buildDossier, so the
//      dossier describes exactly the files written before it
//
// The output directory is --output, else $MAKEFUN_OUTPUT_DIR, else /output.
// The program is deterministic: same snapshot in, same bytes out.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_MAX = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const DASH_LIMITS = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string): never {
  process.stderr.write(`launch radar v2: ${message}\n`);
  process.exit(1);
}

/** Command-line flags of the form --name value and --name=value. */
function flag(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const joined = args.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Copy the regular files directly inside one directory (no recursion,
 *  dotfiles skipped), returning the names copied, in directory order. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    names.push(name);
  }
  return names;
}

const inputFlag = flag('input', '/input');
const snapshotFile = inputFlag.endsWith('.json') ? inputFlag : join(inputFlag, 'snapshot.json');
if (!existsSync(snapshotFile)) {
  process.stderr.write(`launch radar v2: no snapshot at ${snapshotFile} — pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const outputDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`refusing to write a board the gate would reject: ${issue}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

const dashNames = copyFlat(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
const shotNames = copyFlat(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
if (shotNames.length < 3 || shotNames.length > 4) {
  fail(`screenshots/ holds ${shotNames.length} images — hand in 3: board, detail, filtered`);
}
for (const name of shotNames) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name} is not a plain dossier image name`);
}

writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, { text_max_bytes: DOSSIER_TEXT_MAX, screenshots: SHOT_LIMITS, dashboard: DASH_LIMITS }),
);

const [firstSplit, secondSplit] = radar.model.validation;
const [firstBase, secondBase] = radar.model.tvl_only_validation;
process.stdout.write(
  `launch radar v2: ${radar.counts.protocols} protocols — ${radar.counts.tokenized} record a token, ` +
    `${radar.counts.not_own_launch} pre-token but not an own launch, ${board.length} ranked ` +
    `(${radar.counts.watchlist} watchlist + ${radar.counts.early} early), fitted on ${radar.model.fit_n} peers ` +
    `(logTVL coef ${radar.model.coef_log_tvl})\n` +
    `launch radar v2: held-out median abs log error ${firstSplit!.median_abs_log_error} (split A) / ` +
    `${secondSplit!.median_abs_log_error} (split B); TVL-only baseline ` +
    `${firstBase!.median_abs_log_error} / ${secondBase!.median_abs_log_error}\n` +
    `launch radar v2: wrote board.json, data.js, dashboard/ (${dashNames.length} files), screenshots/ (${shotNames.length}) and dossier.json in ${outputDir}\n`,
);
