// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Conformance (US-SPEC-00): the level declaration, the map from every requirement to the tests that prove it, and the
// deviation list, as data a checker verifies. Pure functions over text: the caller reads the files (cli.js does, for Node).
//   parseSpecs   specification texts -> requirements with their level tag, conformance-test ids and versions
//   scanTests    test file texts -> which test cites which requirement (JavaScript: a test title; Python: a unittest method name or docstring)
//   buildManifest  the two together: each requirement is `met` (with its tests) or a `deviation` (with the reason)
//   declaration  the published level, specification versions and deviation list (US-00-R01, US-00-R02, US-00-T01)
//   check        a manifest against the tree: a `met` whose test file is gone or no longer cites it is a false claim (US-00-R03)
export const LEVELS = ['L1', 'L2', 'L3'];
export const UNTAGGED_LEVEL = 'L2'; // US-SPEC-16 and 18 tag no level; they are counted with the managed level
const REQ = /US-(\d\d)-R(\d\d)/g;
const TEST_ID = /US-(\d\d)-T(\d\d)|\bT(\d\d)-(\d+)\b/g;
const rank = l => LEVELS.indexOf(l);

/** specs: [{ file, text }] -> { versions: { 'US-SPEC-NN': version }, requirements: [...], tests: [...] } */
export function parseSpecs(specs) {
  const versions = {}; const requirements = new Map(); const tests = new Map();
  for (const { file, text } of specs) {
    const nn = /US-SPEC-(\d\d)/.exec(file)?.[1];
    if (!nn) continue;
    const spec = `US-SPEC-${nn}`;
    versions[spec] = /\|\s*Version\s*\|\s*([^|]+?)\s*\|/.exec(text)?.[1] ?? 'unversioned';
    for (const line of text.split('\n')) {
      // a definition is where the id leads a list item, a table row or a bold run; a mention elsewhere is a cross-reference
      const def = /^\s*(?:[-*]\s+)?(?:\|\s*)?\*{0,2}(US-(\d\d)-R(\d\d))\b\.?\*{0,2}\s*(\[(L\d)\])?/.exec(line);
      if (def && def[2] === nn && !requirements.has(def[1])) {
        const level = def[5] || /^\s*(?:[-*]\s+)?\*\*US-\d\d-R\d\d\s*\[(L\d)\]/.exec(line)?.[1] || null;
        requirements.set(def[1], { id: def[1], spec, level: level || UNTAGGED_LEVEL, tagged: !!level, must: /\bMUST\b/.test(line), text: line.replace(/[*|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) });
      }
      const t = /^\s*(?:[-*]\s+)?(?:\|\s*)?\*{0,2}(US-(\d\d)-T\d\d|T(\d\d)-\d+)\b/.exec(line);
      if (t && (t[2] || t[3]) === nn && !tests.has(t[1])) tests.set(t[1], { id: t[1], spec });
    }
  }
  return { versions, requirements: [...requirements.values()].sort((a, b) => a.id.localeCompare(b.id)), tests: [...tests.values()] };
}

const JS_TITLE = /\b(?:test|it)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** A unittest method name as a title the citation rules read: test_us_01_r05_and_r06_x -> `test US-01-R05 and R06 x`. */
export function pythonName(name) {
  return name.replace(/_/g, ' ').replace(/\bus (\d\d) ([rt])(\d\d)\b/gi, (_m, nn, k, mm) => `US-${nn}-${k.toUpperCase()}${mm}`).replace(/\b([rt])(\d\d)\b/gi, (_m, k, mm) => `${k.toUpperCase()}${mm}`);
}

/** The titles of the tests in a Python file: for each `def test...` its name (as pythonName) followed by its docstring, or by its first comment
 *  line when it has no docstring. A requirement is cited by a test when the name or the docstring names it (US-00-R03). */
export function pythonTitles(text) {
  const lines = text.split('\n'); const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:async\s+)?def\s+(test\w*)\s*\(/.exec(lines[i]);
    if (!m) continue;
    let j = i; while (j < lines.length - 1 && !/:\s*(?:#.*)?$/.test(lines[j])) j++;   // the signature may span lines
    const body = lines.slice(j + 1, j + 40).join('\n');
    const doc = /^\s*(?:[rRuU])?("""|''')([\s\S]*?)\1/.exec(body)?.[2] ?? /^\s*#\s*(.*)/.exec(body)?.[1] ?? '';
    out.push(`${pythonName(m[1])}${doc ? ` - ${doc.replace(/\s+/g, ' ').trim()}` : ''}`.slice(0, 160));
  }
  return out;
}
const titlesOf = (path, text) => (/\.py$/.test(path) ? pythonTitles(text) : [...text.matchAll(JS_TITLE)].map(m => m[2].replace(/\\(['"`])/g, '$1')));

/** files: [{ path, text }] -> { 'US-NN-RMM': [{ file, name }] }. A requirement counts as cited by a test when the test's title
 *  names it, in full (`US-13-R07`) or short (`R07`, resolved by the nearest full id in the title, else by the one
 *  specification the file is about). A citation only in a comment is recorded with name null. */
export function scanTests(files) {
  const out = {};
  const add = (id, file, name) => { const list = (out[id] ||= []); if (!list.some(x => x.file === file && x.name === name)) list.push({ file, name }); };
  for (const { path, text } of files) {
    const head = text.split('\n').slice(0, 12).join('\n');
    const about = [...new Set([...head.matchAll(/US-SPEC-(\d\d)/g)].map(m => m[1]))];
    const primary = about.length ? about[0] : null;
    const titles = titlesOf(path, text);
    const inTitle = new Set();
    for (const name of titles) {
      let near = [...name.matchAll(/US-(?:SPEC-)?(\d\d)/g)].map(m => ({ at: m.index, nn: m[1] }));
      for (const m of name.matchAll(REQ)) { add(m[0], path, name); inTitle.add(m[0]); }
      for (const m of name.matchAll(/(?<![-\w])R(\d\d)\b/g)) {
        const before = near.filter(n => n.at < m.index).pop();
        const nn = before?.nn ?? (/\bT(\d\d)-\d/.exec(name)?.[1]) ?? primary;
        if (nn) { add(`US-${nn}-R${m[1]}`, path, name); inTitle.add(`US-${nn}-R${m[1]}`); }
      }
    }
    for (const m of text.matchAll(REQ)) if (!inTitle.has(m[0])) add(m[0], path, null);
  }
  return out;
}

/** Which conformance-test ids (US-NN-TMM, TNN-M) the test titles cite: { id: [{ file, name }] }. */
export function scanConformanceTests(files) {
  const out = {};
  for (const { path, text } of files) {
    for (const name of titlesOf(path, text)) {
      for (const t of name.matchAll(TEST_ID)) (out[t[0]] ||= []).push({ file: path, name });
    }
  }
  return out;
}

/** Build the manifest. `declared` is the level the implementation claims; everything at or below it that no test proves is a
 *  deviation and is listed with its reason, as US-00-R02 requires. `reasons` may give a specific reason per requirement id. */
export function buildManifest({ specs, tests, declared = 'L1', reasons = {}, implementation = 'ultrastable/workers', generated_at = null } = {}) {
  const parsed = parseSpecs(specs); const cited = scanTests(tests); const conf = scanConformanceTests(tests);
  const requirements = parsed.requirements.map(r => {
    const proofs = (cited[r.id] || []).slice().sort((a, b) => (a.name === null) - (b.name === null) || a.file.localeCompare(b.file));
    const named = proofs.filter(p => p.name !== null);
    const base = { id: r.id, spec: r.spec, level: r.level, tagged: r.tagged, must: r.must };
    if (named.length) return { ...base, status: 'met', proof: 'named test', tests: named.slice(0, 5) };
    if (proofs.length) return { ...base, status: 'met', proof: 'test file cites it', tests: proofs.slice(0, 3).map(p => ({ file: p.file, name: null })) };
    return { ...base, status: 'deviation', reason: reasons[r.id] || 'no test in this repository cites this requirement', tests: [] };
  });
  return { implementation, declared_level: declared, generated_at, untagged_level: UNTAGGED_LEVEL, spec_versions: parsed.versions,
    conformance_tests: parsed.tests.map(t => ({ id: t.id, spec: t.spec, tests: (conf[t.id] || []).slice(0, 3) })), requirements };
}

/** Per level: how many requirements at or below it are met, and the deviations. */
export function levels(manifest) {
  const out = {};
  for (const l of LEVELS) {
    const rows = manifest.requirements.filter(r => rank(r.level) <= rank(l));
    const dev = rows.filter(r => r.status === 'deviation');
    out[l] = { requirements: rows.length, met: rows.length - dev.length, deviations: dev.length, musts_unmet: dev.filter(r => r.must).length, clean: dev.length === 0 };
  }
  return out;
}

/** What US-00-R01 and R02 ask to be published: the level, the version of each specification followed, and every MUST not met
 *  at or below that level. `highest_clean_level` is the highest level met with no deviation at all (null if none). */
export function declaration(manifest) {
  const lv = levels(manifest);
  const at = manifest.requirements.filter(r => rank(r.level) <= rank(manifest.declared_level));
  return {
    implementation: manifest.implementation, level: manifest.declared_level, spec_versions: manifest.spec_versions, levels: lv,
    highest_clean_level: [...LEVELS].reverse().find(l => lv[l].clean && lv[l].requirements > 0) ?? null,
    deviations: at.filter(r => r.status === 'deviation').map(r => ({ id: r.id, spec: r.spec, level: r.level, must: r.must, reason: r.reason })),
  };
}

/** Check a manifest against the tree. files: { path: text } for the test files it names (a missing key means the file is gone);
 *  specs (optional): the specification texts, to prove the manifest covers every requirement. `absentRoots`: directories (as the manifest
 *  writes them, for example '../seed/worker/test') that this checkout does not have: a proof under one cannot be read here, so it is
 *  listed in `unverified` and is neither a false claim nor a checked one (the extracted repository has no seed beside it).
 *  Returns { ok, problems, stale, unverified }. A problem is a false or missing claim; `stale` lists deviations a test now cites
 *  (the manifest may be regenerated to claim them). */
export function check(manifest, { files = {}, specs = null, tests = null, absentRoots = [] } = {}) {
  const problems = []; const stale = []; const unverified = [];
  if (!LEVELS.includes(manifest.declared_level)) problems.push(`declared_level must be one of ${LEVELS.join(', ')}`);
  if (!manifest.spec_versions || !Object.keys(manifest.spec_versions).length) problems.push('the manifest names no specification versions (US-00-R01)');
  const seen = new Set();
  for (const r of manifest.requirements) {
    if (seen.has(r.id)) problems.push(`${r.id} is listed twice`); seen.add(r.id);
    if (!LEVELS.includes(r.level)) problems.push(`${r.id}: unknown level ${r.level}`);
    if (r.status === 'deviation') { if (!String(r.reason || '').trim()) problems.push(`${r.id}: a deviation needs a reason (US-00-R02)`); continue; }
    if (r.status !== 'met') { problems.push(`${r.id}: status must be met or deviation`); continue; }
    if (!r.tests?.length) { problems.push(`${r.id}: labelled met but names no test (US-00-R03)`); continue; }
    for (const t of r.tests) {
      const text = files[t.file];
      if (text === undefined) {
        const root = absentRoots.find(a => t.file.startsWith(a.replace(/\/$/, '') + '/'));
        if (root) unverified.push(`${r.id}: ${t.file} (root ${root} is not present here)`);
        else problems.push(`${r.id}: test file ${t.file} does not exist`);
        continue;
      }
      const again = scanTests([{ path: t.file, text }])[r.id] || [];
      if (!again.length) problems.push(`${r.id}: ${t.file} no longer cites it`);
      else if (t.name !== null && !again.some(a => a.name === t.name)) problems.push(`${r.id}: ${t.file} has no test named "${t.name.slice(0, 80)}"`);
    }
  }
  if (specs) {
    const parsed = parseSpecs(specs);
    for (const r of parsed.requirements) {
      if (!seen.has(r.id)) problems.push(`${r.id} is in the specification and not in the manifest`);
      else { const m = manifest.requirements.find(x => x.id === r.id); if (m.level !== r.level) problems.push(`${r.id}: level ${m.level} in the manifest, ${r.level} in the specification`); }
    }
    const known = new Set(parsed.requirements.map(r => r.id));
    for (const id of seen) if (!known.has(id)) problems.push(`${id} is in the manifest and not in any specification`);
    for (const [spec, v] of Object.entries(parsed.versions)) if (manifest.spec_versions[spec] !== v) problems.push(`${spec}: version ${manifest.spec_versions[spec] ?? 'missing'} in the manifest, ${v} in the specification`);
  }
  if (tests) { const cited = scanTests(tests); for (const r of manifest.requirements) if (r.status === 'deviation' && cited[r.id]?.length) stale.push(r.id); }
  return { ok: problems.length === 0, problems, stale, unverified };
}

/** The distinct test files that prove a level (US-00-T02 runs these). */
export function testFiles(manifest, level = manifest.declared_level) {
  return [...new Set(manifest.requirements.filter(r => r.status === 'met' && rank(r.level) <= rank(level)).flatMap(r => r.tests.map(t => t.file)))].sort();
}
