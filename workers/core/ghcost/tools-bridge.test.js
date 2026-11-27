// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The conformance scanner reads only JavaScript tests, so the Python tools that prove US-SPEC-24 (the workflow linter, the minutes
// watchdog and the settings script) are exercised here through their command lines, with their unit tests in tests/*.py kept.
// No network: every input is a file in a temporary directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const tool = n => path.join(ROOT, 'tools', n);
const py = spawnSync('python3', ['--version'], { encoding: 'utf8' });
const skip = py.status === 0 ? false : 'python3 is not installed here: the Python tools are not exercised';
const dir = mkdtempSync(path.join(tmpdir(), 'ghcost-bridge-'));
const file = (name, text) => { const p = path.join(dir, name); writeFileSync(p, typeof text === 'string' ? text : JSON.stringify(text)); return p; };
const PYTHON = py.status === 0 ? spawnSync('python3', ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).stdout.trim() : 'python3';
const run = (args, opts = {}) => spawnSync(PYTHON, args, { encoding: 'utf8', cwd: ROOT, ...opts });

const GOOD = `name: x
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: x-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  t:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - run: echo hi
`;

test('US-24-T01 US-24-R10 US-24-R11 US-24-R12: a workflow without permissions, concurrency and timeout-minutes gives W01, W02, W03', { skip }, () => {
  const bad = GOOD.replace(/permissions:\n  contents: read\n/, '').replace(/concurrency:\n.*\n.*\n/, '').replace('    timeout-minutes: 5\n', '');
  const r = run([tool('workflow_lint.py'), file('bad1.yml', bad)]);
  assert.equal(r.status, 1);
  for (const w of ['W01', 'W02', 'W03']) assert.match(r.stdout, new RegExp(` ${w} `));
  assert.equal(run([tool('workflow_lint.py'), file('good.yml', GOOD)]).status, 0);
});

test('US-24-T02 US-24-R14 US-24-R16 US-24-R41: schedule, pull_request_target, @main, a macOS runner and an unguarded secret give W04, W05, W06, W08, W07', { skip }, () => {
  const bad = GOOD.replace('  push:', "  schedule:\n    - cron: '0 * * * *'\n  push:").replace('  pull_request:', '  pull_request_target:').replace('checkout@v4', 'checkout@main').replace('ubuntu-latest', 'macos-latest')
    + '      - run: deploy\n        env: { T: ${{ secrets.TOKEN }} }\n';
  const r = run([tool('workflow_lint.py'), file('bad2.yml', bad)]);
  assert.equal(r.status, 1);
  for (const w of ['W04', 'W05', 'W06', 'W08']) assert.match(r.stdout, new RegExp(` ${w} `), w);
  const pr = GOOD + '      - run: deploy\n        env: { T: ${{ secrets.TOKEN }} }\n';
  assert.match(run([tool('workflow_lint.py'), file('bad3.yml', pr)]).stdout, / W07 /);
});

test('US-24-T03 US-24-R19: the repository real workflows lint clean', { skip }, () => {
  const r = run([tool('workflow_lint.py')]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /0 finding/);
});

test('US-24-R18: --sha-report lists the tag pins and exits 0, and --require-sha fails on a tag', { skip }, () => {
  const rep = run([tool('workflow_lint.py'), '--sha-report', file('tags.yml', GOOD)]);
  assert.equal(rep.status, 0);
  assert.match(rep.stdout, /W09 .*actions\/checkout@v4/);
  assert.equal(run([tool('workflow_lint.py'), '--require-sha', file('tags2.yml', GOOD)]).status, 1);
  const sha = GOOD.replace('checkout@v4', 'checkout@0123456789abcdef0123456789abcdef01234567');
  assert.equal(run([tool('workflow_lint.py'), '--require-sha', file('sha.yml', sha)]).status, 0);
});

test('US-24-T04 US-24-R23 US-24-R24 US-24-R26: the Python watchdog gives exit 1, 1, 2 at 250, 400, 500 of 500 with the non-essential workflows listed', { skip }, () => {
  const budget = file('budget.json', { linux_minute_rate_usd: 0.006, monthly_minutes_total: 500, default_per_repo: 100, per_repo: { code: 500 }, thresholds: [0.5, 0.8], non_essential_workflows: ['pages.yml', 'ci.yml:test'], essential_workflows: ['ci.yml:test'] });
  const usage = n => file(`usage${n}.json`, { usageItems: [{ date: '2026-11-10T00:00:00Z', product: 'actions', unitType: 'Minutes', quantity: n, pricePerUnit: 0.006, organizationName: 'o', repositoryName: 'code' }] });
  const at = n => { const r = run([tool('actions_budget.py'), '--from-file', usage(n), '--budget', budget]); return { code: r.status, d: JSON.parse(r.stdout) }; };
  const a = at(250), b = at(400), c = at(500);
  assert.deepEqual([a.code, a.d.decision, b.code, b.d.decision, c.code, c.d.decision], [1, 'warn50', 1, 'warn80', 2, 'over']);
  assert.deepEqual(c.d.disable_workflows, ['pages.yml'], 'the test job is never listed');
  assert.deepEqual(a.d.disable_workflows, []);
});

test('US-24-T06 US-24-R34: the settings script prints the commands and runs nothing without --apply', { skip }, () => {
  const r = run([tool('github_settings.py')], { env: { ...process.env, PATH: dir } }); // a PATH with no gh: a subprocess call would fail loudly
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN/);
  assert.match(r.stdout, /gh api -X PUT orgs\/ultrastable\/actions\/permissions\/workflow/);
  assert.doesNotMatch(r.stdout, /-> exit/);
});

test('US-24-R33: Discussions are off unless asked: the default commands do not set has_discussions and --discussions does', { skip }, () => {
  assert.doesNotMatch(run([tool('github_settings.py')]).stdout, /has_discussions/);
  assert.match(run([tool('github_settings.py'), '--discussions']).stdout, /has_discussions=true/);
});
