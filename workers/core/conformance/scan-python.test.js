// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-00 R03, R06, T02: the manifest attaches Python tests and tests in the seed and foundation roots beside this repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanTests, scanConformanceTests, buildManifest, check, pythonName, pythonTitles } from './index.js';
import { readTests, readExtraTests, runPlan, EXTRA_ROOTS } from './cli.js';

const SPEC = { file: 'US-SPEC-90-example.md', text: `# US-SPEC-90: Example
| Field | Value |
|---|---|
| Version | 0.3.0 (draft) |

- **US-90-R01 [L1]** An implementation MUST do the first thing.
- **US-90-R02 [L1]** An implementation MUST do the second thing.
- **US-90-R03 [L2]** An implementation SHOULD do the third thing.
- **US-90-R04 [L2]** An implementation SHOULD do the fourth thing.
- **US-90-R05 [L2]** An implementation SHOULD do the fifth thing.
- **US-90-R06 [L3]** An implementation MAY do the sixth thing.
- **US-90-T01** Do it. Pass: done.
` };
const PY = `# US-SPEC-90 conformance, Python side
import unittest

class Seed(unittest.TestCase):
    def test_us_90_r01_does_the_first_thing(self):
        pass

    def test_idempotent(self):
        """US-90-R02: the second thing; and R03 by its short id"""
        pass

    def test_fourth(self):
        # US-90-R04 named by the first comment line
        pass

    def test_us_90_t01_conformance_test(self):
        pass

    def helper(self):
        """US-90-R05 is only mentioned in a helper, which is not a test"""

    def test_nothing_to_cite(self):
        assert True
`;

test('US-00-R06: a Python test whose method name or docstring cites a requirement attaches to that requirement', () => {
  const c = scanTests([{ path: 'tests/test_seed.py', text: PY }]);
  assert.equal(c['US-90-R01'][0].name, 'test US-90-R01 does the first thing');
  assert.match(c['US-90-R02'][0].name, /^test idempotent - US-90-R02: the second thing/);
  assert.equal(c['US-90-R03'][0].name, c['US-90-R02'][0].name, 'the short id R03 resolves to the specification named just before it');
  assert.match(c['US-90-R04'][0].name, /first comment line/);
  assert.deepEqual(c['US-90-R05'], [{ file: 'tests/test_seed.py', name: null }], 'a mention outside a test is marked as only a file-level citation');
  assert.equal(c['US-90-R06'], undefined);
  assert.equal(pythonName('test_us_01_r05_and_r06_x'), 'test US-01-R05 and R06 x');
  assert.equal(pythonTitles(PY).length, 5, 'five tests, the helper is not one');
});

test('US-00-R06: the conformance-test ids a Python test names are listed beside the JavaScript ones', () => {
  const conf = scanConformanceTests([{ path: 'tests/test_seed.py', text: PY }, { path: 'a.test.js', text: `test('US-90-T01 in js', () => {});` }]);
  assert.deepEqual(conf['US-90-T01'].map(x => x.file).sort(), ['a.test.js', 'tests/test_seed.py']);
});

test('US-00-R06: a manifest built over JavaScript and Python tests lists each as the proof, and the checker re-reads both', () => {
  const js = { path: 'core/a/a.test.js', text: `test('US-90-R06: the sixth thing', () => {});` };
  const py = { path: 'tests/test_seed.py', text: PY };
  const m = buildManifest({ specs: [SPEC], tests: [js, py], declared: 'L3' });
  const by = Object.fromEntries(m.requirements.map(r => [r.id, r]));
  assert.equal(by['US-90-R01'].status, 'met'); assert.equal(by['US-90-R01'].tests[0].file, 'tests/test_seed.py');
  assert.equal(by['US-90-R06'].tests[0].file, 'core/a/a.test.js');
  assert.equal(by['US-90-R05'].proof, 'test file cites it');
  const files = { [js.path]: js.text, [py.path]: py.text };
  assert.deepEqual(check(m, { files, specs: [SPEC], tests: [js, py] }).problems, []);
  assert.ok(check(m, { files: { ...files, [py.path]: PY.replace('test_us_90_r01_does_the_first_thing', 'test_renamed') } }).problems.some(p => /US-90-R01: tests\/test_seed\.py no longer cites it/.test(p)));
});

test('US-00-R03: a met proof under an absent optional root is reported unverified, not failed, and a proof under a present root that is gone still fails', () => {
  const seedTest = { path: '../seed/worker/test/spec-03-tick.test.js', text: `test('US-90-R01: the first thing', () => {});` };
  const m = buildManifest({ specs: [SPEC], tests: [seedTest], declared: 'L1' });
  assert.equal(m.requirements.find(r => r.id === 'US-90-R01').tests[0].file, seedTest.path);
  const absent = check(m, { files: {}, absentRoots: ['../seed/worker/test'] });
  assert.deepEqual(absent.problems, []);
  assert.deepEqual(absent.unverified, ['US-90-R01: ../seed/worker/test/spec-03-tick.test.js (root ../seed/worker/test is not present here)']);
  assert.ok(check(m, { files: {} }).problems.some(p => /test file \.\.\/seed\/worker\/test\/spec-03-tick\.test\.js does not exist/.test(p)), 'with the root present a missing file is a false claim');
  assert.ok(check(m, { files: {}, absentRoots: ['../tests/foundation'] }).problems.length > 0, 'an absent root excuses only the files under it');
});

test('US-00-R03: the roots beside this repository are read when they exist, and the ones that do not are named, never ignored', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'us-roots-'));
  try {
    const root = path.join(tmp, 'workers'); mkdirSync(root);
    mkdirSync(path.join(tmp, 'seed/worker/test'), { recursive: true });
    writeFileSync(path.join(tmp, 'seed/worker/test/a.test.js'), `test('US-90-R01: x', () => {});`);
    writeFileSync(path.join(tmp, 'seed/worker/test/not-a-test.js'), 'x');
    const r = readExtraTests(root);
    assert.deepEqual(r.tests.map(t => t.path), ['../seed/worker/test/a.test.js']);
    assert.deepEqual(r.absent, EXTRA_ROOTS.map(x => x.dir).filter(d => d !== '../seed/worker/test'));
    writeFileSync(path.join(root, 'test_local.py'), 'def test_us_90_r01_x(self):\n    pass\n');
    writeFileSync(path.join(root, 'a.test.mjs'), '');
    assert.deepEqual(readTests(root).map(t => t.path).sort(), ['a.test.mjs', 'test_local.py']);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('US-00-T02: the proof files run with the right runner, each Python suite from the directory it expects, and a failing Python proof fails the run', () => {
  const root = '/r/workers';
  const plan = runPlan(['core/a/a.test.js', 'tests/test_seed.py', '../seed/tests/test_system.py', '../tests/foundation/test_kernel.py', '../seed/worker/test/spec-03-tick.test.js'], root);
  assert.deepEqual(plan.js, ['core/a/a.test.js', '../seed/worker/test/spec-03-tick.test.js']);
  assert.deepEqual(plan.py.map(p => [p.cwd, p.args.slice(-4).join(' ')]), [
    ['/r/workers', '-s tests -p test_seed.py'], ['/r/seed', '-s tests -p test_system.py'], ['/r', '-s tests/foundation -p test_kernel.py']]);
  const tmp = mkdtempSync(path.join(tmpdir(), 'us-run-'));
  try {
    mkdirSync(path.join(tmp, 'tests'));
    writeFileSync(path.join(tmp, 'tests/test_ok.py'), 'import unittest\nclass T(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n');
    writeFileSync(path.join(tmp, 'tests/test_bad.py'), 'import unittest\nclass T(unittest.TestCase):\n    def test_bad(self):\n        self.assertTrue(False)\n');
    const run = f => { const p = runPlan([f], tmp, []).py[0]; return spawnSync('python3', p.args, { cwd: p.cwd, encoding: 'utf8' }).status; };
    assert.equal(run('tests/test_ok.py'), 0);
    assert.notEqual(run('tests/test_bad.py'), 0);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
