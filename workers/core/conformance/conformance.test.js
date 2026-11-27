// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-00: the conformance manifest, its checker, and the published declaration (US-00-T01, US-00-T02).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseSpecs, scanTests, buildManifest, declaration, levels, check, testFiles, LEVELS } from './index.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ROOT, MANIFEST, readSpecs, readTests, readNamedFiles, specDir, coverageNotice } from './cli.js';

const SPEC = { file: 'US-SPEC-90-example.md', text: `# US-SPEC-90: Example
| Field | Value |
|---|---|
| Version | 0.3.0 (draft) |

- **US-90-R01 [L1]** An implementation MUST do the first thing (see US-91-R05 for the other).
- **US-90-R02 [L2]** An implementation SHOULD do the second thing.
- **US-90-R03 [L3]** An implementation MUST do the third thing.

| ID | Rule |
|---|---|
| US-90-R04 | A rule in a table MUST hold. |

**US-90-R05.** A bold rule MUST hold.

- **US-90-T01** Do it. Pass: done.

| Test | Pass condition |
|---|---|
| T90-2 | It works. |
` };
const TESTS = [
  { path: 'core/a/a.test.js', text: `// US-SPEC-90 conformance\ntest('US-90-R01: does the first thing', () => {});\ntest('US-90-T01 and R03: third thing, by the short id', () => {});\ntest('T90-2 with R04: table rule', () => {});` },
  { path: 'core/b/b.test.js', text: `// covers US-90-R02 in passing\ntest("it's fine", () => {});` },
];

test('US-00 requirement format: ids, level tags, versions and conformance-test ids are read from the specification text', () => {
  const p = parseSpecs([SPEC]);
  assert.deepEqual(p.versions, { 'US-SPEC-90': '0.3.0 (draft)' });
  assert.deepEqual(p.requirements.map(r => [r.id, r.level, r.tagged, r.must]), [['US-90-R01', 'L1', true, true], ['US-90-R02', 'L2', true, false], ['US-90-R03', 'L3', true, true], ['US-90-R04', 'L2', false, true], ['US-90-R05', 'L2', false, true]]);
  assert.deepEqual(p.tests.map(t => t.id), ['US-90-T01', 'T90-2']);
  assert.ok(!p.requirements.some(r => r.id === 'US-91-R05'), 'a cross-reference is not a definition');
});

test('tests are matched to requirements by the ids their titles cite, in full or short form; a comment-only citation is marked as such', () => {
  const c = scanTests(TESTS);
  assert.deepEqual(c['US-90-R01'], [{ file: 'core/a/a.test.js', name: 'US-90-R01: does the first thing' }]);
  assert.equal(c['US-90-R03'][0].name, 'US-90-T01 and R03: third thing, by the short id');
  assert.equal(c['US-90-R04'][0].name, 'T90-2 with R04: table rule');
  assert.deepEqual(c['US-90-R02'], [{ file: 'core/b/b.test.js', name: null }]);
  assert.equal(c['US-90-R05'], undefined);
});

test('US-00-R01, US-00-R02 and US-00-R13: the declaration names the level, each specification version and every requirement not met, with its reason', () => {
  const m = buildManifest({ specs: [SPEC], tests: TESTS, declared: 'L2', reasons: { 'US-90-R05': 'needs a live account' } });
  const d = declaration(m);
  assert.equal(d.level, 'L2'); assert.deepEqual(d.spec_versions, { 'US-SPEC-90': '0.3.0 (draft)' });
  assert.deepEqual(d.deviations, [{ id: 'US-90-R05', spec: 'US-SPEC-90', level: 'L2', must: true, reason: 'needs a live account' }]);
  assert.deepEqual(levels(m).L1, { requirements: 1, met: 1, deviations: 0, musts_unmet: 0, clean: true });
  assert.equal(levels(m).L2.deviations, 1); assert.equal(d.highest_clean_level, 'L1');
  assert.deepEqual(m.conformance_tests.map(t => [t.id, t.tests.length]), [['US-90-T01', 1], ['T90-2', 1]]);
  assert.deepEqual(testFiles(m, 'L1'), ['core/a/a.test.js']); assert.deepEqual(testFiles(m, 'L3'), ['core/a/a.test.js', 'core/b/b.test.js']);
  assert.equal(buildManifest({ specs: [SPEC], tests: [] }).requirements.every(r => r.status === 'deviation' && r.reason), true);
});

test('US-00-R03 and US-00-R13: the checker rejects an overstated manifest: a met with no test, a test file that is gone, a test that no longer cites it, a deviation with no reason', () => {
  const m = buildManifest({ specs: [SPEC], tests: TESTS, declared: 'L2', reasons: { 'US-90-R05': 'needs a live account' } });
  const files = Object.fromEntries(TESTS.map(t => [t.path, t.text]));
  assert.deepEqual(check(m, { files, specs: [SPEC], tests: TESTS }), { ok: true, problems: [], stale: [], unverified: [] });
  assert.match(check(m, { files: { 'core/b/b.test.js': TESTS[1].text } }).problems[0], /US-90-R01: test file core\/a\/a\.test\.js does not exist/);
  const renamed = { ...files, 'core/a/a.test.js': TESTS[0].text.replace('US-90-R01: does', 'does') };
  assert.ok(check(m, { files: renamed }).problems.some(p => /US-90-R01: core\/a\/a\.test\.js no longer cites it/.test(p)));
  const bad = structuredClone(m);
  bad.requirements[0].tests = []; bad.requirements[4].reason = ''; bad.requirements.push({ ...bad.requirements[1] }); bad.declared_level = 'L9';
  const problems = check(bad, { files }).problems;
  for (const re of [/US-90-R01: labelled met but names no test/, /US-90-R05: a deviation needs a reason/, /US-90-R02 is listed twice/, /declared_level must be one of/]) assert.ok(problems.some(p => re.test(p)), String(re));
  const extra = { file: SPEC.file, text: SPEC.text + '\n- **US-90-R06 [L1]** A new rule MUST hold.\n' };
  assert.ok(check(m, { files, specs: [extra] }).problems.includes('US-90-R06 is in the specification and not in the manifest'));
  assert.deepEqual(check(m, { files, tests: [...TESTS, { path: 'c.test.js', text: `test('US-90-R05: now proven', () => {});` }] }).stale, ['US-90-R05']);
});

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

test('US-00-T01: this repository publishes its level and its deviation list, and both name specification versions', () => {
  const d = declaration(manifest);
  assert.ok(LEVELS.includes(d.level));
  assert.ok(Object.keys(d.spec_versions).length >= 20);
  for (const v of Object.values(d.spec_versions)) assert.match(v, /^\d+\.\d+\.\d+/);
  assert.ok(manifest.requirements.length >= 300);
  for (const dev of d.deviations) assert.ok(dev.reason, dev.id);
  assert.equal(d.deviations.length, levels(manifest)[d.level].deviations);
});

test('US-00-T02 and US-00-R03: every requirement the manifest labels met names a test file that exists and still cites it', () => {
  const r = check(manifest, { files: readNamedFiles(manifest) });
  assert.deepEqual(r.problems, []);
  for (const f of testFiles(manifest, 'L3')) assert.ok(existsSync(path.join(ROOT, f)), f);
});

const SPECS = specDir();

test('US-00-R03: the spec-coverage check runs when the specifications sit at ../specs, ../spec/specs or US_SPEC_DIR', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'us-spec-dir-'));
  const layout = (name, ...specParts) => { const root = path.join(tmp, name, 'root'); mkdirSync(root, { recursive: true }); if (specParts.length) mkdirSync(path.join(tmp, name, ...specParts), { recursive: true }); return root; };
  try {
    assert.equal(specDir({ env: {}, root: layout('bare') }), null, 'no layout matches');
    const mono = layout('mono', 'specs');
    assert.equal(specDir({ env: {}, root: mono }), path.join(mono, '../specs'), 'the monorepo layout: <root>/../specs');
    const extracted = layout('extracted', 'spec', 'specs');
    assert.equal(specDir({ env: {}, root: extracted }), path.join(extracted, '../spec/specs'), 'the extracted layout: <root>/../spec/specs');
    const elsewhere = path.join(tmp, 'elsewhere'); mkdirSync(elsewhere);
    assert.equal(specDir({ env: { US_SPEC_DIR: elsewhere }, root: mono }), elsewhere, 'US_SPEC_DIR wins over the layouts');
    assert.equal(specDir({ explicit: path.join(mono, '../specs'), env: { US_SPEC_DIR: elsewhere }, root: mono }), path.join(mono, '../specs'), 'an explicit --spec-dir wins over everything');
    assert.equal(specDir({ env: { US_SPEC_DIR: path.join(tmp, 'missing') }, root: layout('bare2') }), null, 'a directory that does not exist is never returned');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('US-00-R03: with no specification directory the coverage check says it was not run, and the checker never reports coverage it did not read', () => {
  assert.match(coverageNotice(null), /NOT checked/);
  assert.equal(coverageNotice('/some/dir'), null);
  // check() without specs verifies the claims against the tests only: it cannot report a requirement missing from the manifest
  const extra = { file: 'US-SPEC-90-example.md', text: SPEC.text + '\n- **US-90-R06 [L1]** A new rule MUST hold.\n' };
  const m = buildManifest({ specs: [SPEC], tests: TESTS });
  assert.deepEqual(check(m, { files: Object.fromEntries(TESTS.map(t => [t.path, t.text])) }).problems, []);
  assert.ok(check(m, { files: Object.fromEntries(TESTS.map(t => [t.path, t.text])), specs: [extra] }).problems.includes('US-90-R06 is in the specification and not in the manifest'));
});

test('the manifest covers every requirement of every specification, at the level the specification tags', { skip: !SPECS && 'no specification directory: set US_SPEC_DIR or check the specifications out at ../specs or ../spec/specs' }, () => {
  const r = check(manifest, { files: readNamedFiles(manifest), specs: readSpecs(SPECS), tests: readTests() });
  assert.deepEqual(r.problems, []);
});

test('US-00-R03: a todo or skipped test is a closing probe, not a proof', () => {
  const text = [
    "test('US-91-R01 works', () => {});",
    "test('US-91-R02 (closing probe): planned', { todo: 'PLANNED: not built' }, async () => {});",
    "test.todo('US-91-R03 later');",
    "test('US-91-R04 helper', todo('the helper names todo'), async () => { assert.ok(1, 'US-91-R02 is PLANNED'); });",
    "test('US-91-R05 skipped', { skip: true }, () => {});",
    "test('US-91-R07 runs where the seed is', { skip: !hasSeed && 'no seed here' }, () => {});",
  ].join('\n');
  const c = scanTests([{ path: 'a.test.js', text }]);
  assert.deepEqual(c['US-91-R01'], [{ file: 'a.test.js', name: 'US-91-R01 works' }]);
  for (const id of ['US-91-R02', 'US-91-R03', 'US-91-R04', 'US-91-R05']) assert.ok(c[id].every(x => x.todo), id);
  assert.ok(!c['US-91-R07'][0].todo, 'a conditional skip is still a proof where it runs');
  const spec = { file: 'US-SPEC-91-x.md', text: '| Version | 1 |\n- **US-91-R01** [L1] MUST a\n- **US-91-R02** [L1] MUST b\n- **US-91-R06** [L1] MUST c\n' };
  const m = buildManifest({ specs: [spec], tests: [{ path: 'a.test.js', text }] });
  const by = Object.fromEntries(m.requirements.map(r => [r.id, r]));
  assert.equal(by['US-91-R01'].status, 'met');
  assert.equal(by['US-91-R02'].status, 'deviation');
  assert.match(by['US-91-R02'].reason, /^PLANNED: its closing probe is a todo test/);
  assert.equal(by['US-91-R06'].reason, 'no test in this repository cites this requirement');
  const claimed = { ...m, requirements: m.requirements.map(r => r.id === 'US-91-R02' ? { ...r, status: 'met', tests: [{ file: 'a.test.js', name: r.id }] } : r) };
  const res = check(claimed, { files: { 'a.test.js': text } });
  assert.ok(res.problems.some(p => /US-91-R02: a\.test\.js cites it only in a todo test/.test(p)), res.problems.join('\n'));
  assert.deepEqual(check(m, { files: { 'a.test.js': text }, tests: [{ path: 'a.test.js', text }] }).stale, []);
});

test('US-00-R03: requirement ids above R99 are read in full, never as a shorter id', () => {
  const text = "test('US-92-R100 and R101 hold', () => {});\ntest('US-92-R10 holds', () => {});";
  const c = scanTests([{ path: 'b.test.js', text }]);
  assert.deepEqual(Object.keys(c).sort(), ['US-92-R10', 'US-92-R100', 'US-92-R101']);
  const spec = { file: 'US-SPEC-92-x.md', text: '| Version | 1 |\n- **US-92-R10** [L1] MUST a\n- **US-92-R100** [L1] MUST b\n' };
  assert.deepEqual(parseSpecs([spec]).requirements.map(r => r.id), ['US-92-R10', 'US-92-R100']);
});
