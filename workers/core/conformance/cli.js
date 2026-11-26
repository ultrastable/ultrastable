// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The conformance suite runner (US-SPEC-00).
//   node core/conformance/cli.js --spec-dir ../specs --write             regenerate core/conformance/manifest.json (or --out FILE)
//   node core/conformance/cli.js [--spec-dir ../specs] --check           verify the manifest against the tree (exit 1 on a false claim)
//   node core/conformance/cli.js --declare                               print the level, versions and deviation list (US-00-T01)
//   node core/conformance/cli.js --run [L1|L2|L3]                        run the test files that prove a level (US-00-T02)
//   node core/conformance/cli.js --running --ledger FILE                 check every RUNNING label against a production ledger of JSON lines (US-00-T03)
//   node core/conformance/cli.js --attest OUT --by NAME                  write an attestation of this tree (US-00-R03)
//   node core/conformance/cli.js --verify FILE                           an outside party re-derives the manifest from its own checkout
// Without --spec-dir the specifications are looked for at US_SPEC_DIR, ../specs (the monorepo) and ../spec/specs (the extracted repository);
// --manifest FILE reads another manifest instead of core/conformance/manifest.json. Tests are read from this repository (JavaScript *.test.js and
// *.test.mjs, Python test_*.py) and from the roots beside it that hold the seed's and the foundation's tests (EXTRA_ROOTS); a root that is not
// there is printed as skipped, and a proof under it is reported as unverified, never as checked and never as false.
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildManifest, check, declaration, testFiles } from './index.js';
import { runningLabels, checkRunning, jsonlLedger } from './running.js';
import { attest, verifyAttestation } from './attest.js';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MANIFEST = path.join(ROOT, 'core/conformance/manifest.json');
const SKIP = new Set(['node_modules', '.git', '.wrangler', 'dist', '__pycache__']);
const JS_TEST = /\.test\.(js|mjs)$/;
const PY_TEST = /^test_.*\.py$/;

/** Roots beside this repository that hold tests proving requirements implemented there (the seed kernel and the foundation commands). `cwd` is where
 *  their own suites are run from (the seed's tests assume the seed; the foundation's, the repository root). */
export const EXTRA_ROOTS = [
  { dir: '../seed/worker/test', test: JS_TEST, cwd: '../seed/worker' },
  { dir: '../seed/worker/src', test: JS_TEST, cwd: '../seed/worker' },
  { dir: '../seed/tests', test: PY_TEST, cwd: '../seed' },
  { dir: '../tests/foundation', test: PY_TEST, cwd: '..' },
];

/** Where the specifications are (US-00-R03: the check must run in every layout, never skip silently). The first directory that exists,
 *  from `explicit`, the US_SPEC_DIR variable, <root>/../specs and <root>/../spec/specs; null when there is none (the caller says so). */
export function specDir({ explicit = null, env = process.env, root = ROOT } = {}) {
  for (const d of [explicit, env && env.US_SPEC_DIR, path.join(root, '../specs'), path.join(root, '../spec/specs')]) {
    if (d && existsSync(d) && statSync(d).isDirectory()) return d;
  }
  return null;
}

/** What the CLI says when it found no specifications: the manifest was checked against the tests only. null when it found them. */
export function coverageNotice(dir) {
  return dir ? null : 'no specification directory found: the manifest is checked against the tests only, and its coverage of the specifications is NOT checked';
}

export function readSpecs(dir) {
  return readdirSync(dir).filter(f => /^US-SPEC-\d\d.*\.md$/.test(f)).sort().map(f => ({ file: f, text: readFileSync(path.join(dir, f), 'utf8') }));
}

function walkTests(dir, root, match, out) {
  for (const n of readdirSync(dir).sort()) {
    if (SKIP.has(n)) continue;
    const p = path.join(dir, n); const s = statSync(p);
    if (s.isDirectory()) walkTests(p, root, match, out);
    else if (match(n)) out.push({ path: path.relative(root, p).split(path.sep).join('/'), text: readFileSync(p, 'utf8') });
  }
}

/** The test files of this repository: JavaScript (*.test.js, *.test.mjs) and Python (test_*.py), as { path (relative to root), text }. */
export function readTests(root = ROOT) {
  const out = [];
  walkTests(root, root, n => JS_TEST.test(n) || PY_TEST.test(n), out);
  return out;
}

/** The tests of the roots beside this repository: { tests, absent }, `absent` listing the roots that are not there (printed by the CLI, never ignored). */
export function readExtraTests(root = ROOT, roots = EXTRA_ROOTS) {
  const tests = []; const absent = [];
  for (const r of roots) {
    const dir = path.resolve(root, r.dir);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) { absent.push(r.dir); continue; }
    const found = [];
    walkTests(dir, dir, n => r.test.test(n), found);
    for (const f of found) tests.push({ path: path.posix.join(r.dir, f.path), text: f.text });
  }
  return { tests, absent };
}

export function readNamedFiles(manifest, root = ROOT) {
  const files = {};
  for (const f of new Set(manifest.requirements.flatMap(r => (r.tests || []).map(t => t.file)))) { const p = path.join(root, f); if (existsSync(p)) files[f] = readFileSync(p, 'utf8'); }
  return files;
}

/** The commands that run a set of proof files: node --test for JavaScript, python -m unittest discover for each Python file, each from the directory its suite expects. */
export function runPlan(files, root = ROOT, roots = EXTRA_ROOTS) {
  const js = []; const py = [];
  for (const f of files) {
    const extra = roots.find(r => f.startsWith(r.dir + '/'));
    const cwd = extra ? path.resolve(root, extra.cwd) : root;
    if (/\.py$/.test(f)) { const abs = path.resolve(root, f); py.push({ cwd, args: ['-m', 'unittest', 'discover', '-s', path.relative(cwd, path.dirname(abs)) || '.', '-p', path.basename(abs)] }); }
    else js.push(f);
  }
  return { js, py };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const has = n => process.argv.includes(n);
  const arg = n => { const i = process.argv.indexOf(n); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null; };
  const dir = specDir({ explicit: arg('--spec-dir') });
  const manifestPath = arg('--manifest') || MANIFEST;
  const outPath = arg('--out') || MANIFEST;
  const everyTest = () => { const extra = readExtraTests(); for (const r of extra.absent) console.log(`skipped root ${r}: not present`); return { tests: [...readTests(), ...extra.tests], absent: extra.absent }; };
  if (has('--write')) {
    if (!dir || !readSpecs(dir).length) { console.error('conformance: unmeasured, no specification text' + (dir ? ` in ${dir}` : '') + ' (DISCLOSE-1): pass --spec-dir, or set US_SPEC_DIR to the private specification; the manifest was not written'); process.exit(2); }
    const prev = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
    const reasons = Object.fromEntries((prev.requirements || []).filter(r => r.status === 'deviation' && r.reason && !/^no test in this repository/.test(r.reason)).map(r => [r.id, r.reason]));
    const m = buildManifest({ specs: readSpecs(dir), tests: everyTest().tests, declared: arg('--level') || prev.declared_level || 'L1', reasons, generated_at: new Date().toISOString().slice(0, 10) });
    writeFileSync(outPath, JSON.stringify(m, null, 1) + '\n');
    const d = declaration(m);
    console.log(`wrote ${path.relative(ROOT, outPath)}: ${m.requirements.length} requirements, level ${d.level} with ${d.deviations.length} deviations`);
  }
  const manifest = JSON.parse(readFileSync(has('--write') ? outPath : manifestPath, 'utf8'));
  if (has('--declare')) console.log(JSON.stringify(declaration(manifest), null, 1));
  if (has('--check')) {
    const specsRead = dir ? readSpecs(dir) : [];
    if (!specsRead.length) console.log(coverageNotice(null));
    const { tests, absent } = everyTest();
    const r = check(manifest, { files: { ...readNamedFiles(manifest), ...Object.fromEntries(tests.map(t => [t.path, t.text])) }, specs: specsRead.length ? specsRead : null, tests, absentRoots: absent });
    console.log(`${r.problems.length} problem(s), ${r.stale.length} deviation(s) a test now cites, ${r.unverified.length} proof(s) unverified here`);
    for (const p of r.problems) console.log('  ' + p);
    for (const u of r.unverified) console.log('  unverified: ' + u);
    if (!r.ok) process.exit(1);
  }
  if (has('--run')) {
    const plan = runPlan(testFiles(manifest, arg('--run') || manifest.declared_level).filter(f => existsSync(path.join(ROOT, f))));
    let status = 0;
    if (plan.js.length) status ||= spawnSync(process.execPath, ['--test', '--no-warnings', ...plan.js], { cwd: ROOT, stdio: 'inherit' }).status ?? 1;
    for (const p of plan.py) status ||= spawnSync('python3', p.args, { cwd: p.cwd, stdio: 'inherit' }).status ?? 1;
    process.exit(status);
  }
  if (has('--running')) {
    if (!dir) { console.error('--running needs the specifications'); process.exit(2); }
    const ledgerFile = arg('--ledger');
    let ledger = null; let why = 'no --ledger given';
    if (ledgerFile) { try { ledger = jsonlLedger(readFileSync(ledgerFile, 'utf8')); } catch (e) { why = `ledger ${ledgerFile}: ${e.message}`; } }
    const labels = runningLabels(readSpecs(dir));
    const res = await checkRunning({ labels, ledger, now: Date.now() });
    if (!ledger) console.log(`every RUNNING label is unmeasured: ${why}`);
    for (const x of res.results) console.log(`${x.status.padEnd(10)} ${x.spec} ${x.key}${x.reason ? ` (${x.reason})` : x.newest ? ` (newest ${x.newest})` : ''}`);
    console.log(`${res.results.filter(x => x.status === 'found').length} of ${res.results.length} RUNNING labels have a production row since ${res.window_from}`);
    process.exit(res.ok ? 0 : 1);
  }
  if (has('--attest')) {
    const out = arg('--attest'); const by = arg('--by');
    if (!out || !by) { console.error('--attest needs an output file and --by NAME (who attests)'); process.exit(2); }
    if (!dir) { console.error('--attest needs the specifications'); process.exit(2); }
    const specs = readSpecs(dir); const tests = everyTest().tests;
    const att = await attest({ manifest, specs, tests, attested_by: by });
    const self = await verifyAttestation(att, { specs, tests });      // never attest a manifest that the tree itself does not bear out
    if (!self.ok) { console.error('the published manifest does not match this tree, so it is not attested; regenerate it first (--write):'); for (const p of self.problems) console.error('  ' + p); process.exit(1); }
    writeFileSync(out, JSON.stringify(att, null, 1) + '\n');
    console.log(`wrote ${out}: attested by ${att.attested_by}, level ${att.declaration.level}, unsigned (a signer adds the signature)`);
  }
  if (has('--verify')) {
    const file = arg('--verify');
    if (!file) { console.error('--verify needs the attestation file'); process.exit(2); }
    if (!dir) { console.error('--verify needs the specifications of the checkout being verified'); process.exit(2); }
    const att = JSON.parse(readFileSync(file, 'utf8'));
    const r = await verifyAttestation(att, { specs: readSpecs(dir), tests: everyTest().tests });
    console.log(`${r.problems.length} problem(s); independent: ${r.independent}; signed: ${r.signed} (this command has no signature check); certified: ${r.certified}`);
    for (const p of r.problems) console.log('  ' + p);
    process.exit(r.ok ? 0 : 1);
  }
}
