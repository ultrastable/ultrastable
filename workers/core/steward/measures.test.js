// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the self-hosting measures (US-SPEC-20 s6): computed from merged pull requests, unmeasured is null and never zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measures, recordProblems, field, party, PROTECTED, EXEMPT_AUTHORS } from './measures.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NOW = Date.parse('2026-11-20T00:00:00Z');
const GOOD = `## What\nAdds the claims module.\n\nItem: #2\nSpec: US-08-R03, US-SPEC-08\nPrediction: core_tests_passing >= 150 within 1 h\nEvidence: npm test: core 151 pass, 0 fail\nAuthor: claude-code (sonnet)\nReviewer: codex (different model)\n`;
const pr = (n, o = {}) => ({ number: n, author: 'someone', body: GOOD, labels: [], files: ['core/x.js'], merged_at: '2026-11-18T00:00:00Z', ...o });
const m = (prs, extra = {}) => measures({ prs, now: NOW, window_days: 30, ...extra });

test('US-20-R02: a merged PR without Item is not counted as covered', () => {
  const r = m([pr(1), pr(2, { body: GOOD.replace('Item: #2', 'Item: <issue>') }), pr(3), pr(4, { body: '' })]);
  assert.equal(r.merged, 4);
  assert.equal(r.contract_coverage, 0.5);
});

test('US-20-R02, US-20-R03, US-20-R05: a blank Evidence or Reviewer field does not take the next line as its value', () => {
  assert.equal(field(GOOD.replace('Evidence: npm test: core 151 pass, 0 fail', 'Evidence:'), 'Evidence'), null);
  assert.ok(recordProblems(GOOD.replace('Evidence: npm test: core 151 pass, 0 fail', 'Evidence:'), 'someone', ['core/x.js'], []).length > 0);
  assert.ok(recordProblems(GOOD.replace('Reviewer: codex (different model)', 'Reviewer:') + 'Protected-change: pending\n', 'someone', ['core/x.js'], []).length > 0);
});

test('US-20-R04: a PR whose reviewer equals its author after normalisation counts in the self-review rate', () => {
  const same = GOOD.replace('Reviewer: codex (different model)', 'Reviewer: Claude Code  sonnet');
  const r = m([pr(1), pr(2, { body: same }), pr(3), pr(4)]);
  assert.equal(r.self_review_rate, 0.25);
  assert.equal(party('Claude-Code (sonnet)'), party('claude code sonnet'));
});

test('US-20-R07: a merged PR touching AGENTS.md without Protected-change is counted', () => {
  const ok = GOOD + 'Protected-change: tightening the review rule after a trial finding\n';
  const r = m([
    pr(1, { files: ['AGENTS.md'] }),                                                   // no reason, no label: counted
    pr(2, { files: ['AGENTS.md'], body: ok, labels: ['protected-change'] }),            // complete: not counted
    pr(3, { files: ['AGENTS.md'], body: ok }),                                          // reason but no label: counted
    pr(4),                                                                              // unprotected
    pr(5, { files: ['.github/workflows/x.yml'], author: 'github-actions[bot]', body: '' }), // exempt generated change: not counted
  ]);
  assert.equal(r.protected_change_reviews, 2);
});

test('US-20-R18: unmeasured inputs return null with a reason, never 0', () => {
  const r = measures({ now: NOW });
  assert.equal(r.contract_coverage, null); assert.equal(r.self_review_rate, null); assert.equal(r.protected_change_reviews, null);
  assert.equal(r.spec_truth, null); assert.equal(r.execution_ratio, null);
  for (const k of ['contract_coverage', 'spec_truth', 'execution_ratio', 'self_review_rate', 'protected_change_reviews']) assert.ok(r.not_measured[k], k);
  const none = m([]);
  assert.equal(none.contract_coverage, null, 'no merged PR: coverage is unmeasured');
  assert.equal(none.protected_change_reviews, 0, 'a completely read, empty window really holds zero protected-change merges');
  const old = m([pr(1, { merged_at: '2026-01-01T00:00:00Z' })]);
  assert.equal(old.merged, 0);
  const meas = m([pr(1)], { spec_truth: 0, execution: { merged: 4, traced: 3 } });
  assert.equal(meas.spec_truth, 0, 'a measured zero is kept as zero');
  assert.equal(meas.execution_ratio, 0.75);
  assert.equal(m([pr(1)], { execution: { merged: 0, traced: 0 } }).execution_ratio, null);
});

test('US-20-R18: incomplete pagination yields not_measured', () => {
  const r = m([pr(1), pr(2)], { complete: false });
  assert.equal(r.contract_coverage, null); assert.equal(r.protected_change_reviews, null); assert.equal(r.self_review_rate, null);
  assert.match(r.not_measured.contract_coverage, /bounded/);
});

test('every merged PR from an exempt author leaves the self-review rate unmeasured, not 0', () => {
  const r = m([pr(1, { author: 'dependabot[bot]', body: '' })]);
  assert.equal(r.contract_coverage, 1);
  assert.equal(r.self_review_rate, null);
});

// ---- parity with the authority: tools/selfhost_check.py -------------------------------------------------------------------
const FIXTURES = [
  ['complete', GOOD, 'someone', ['core/x.js'], []],
  ['blank evidence', GOOD.replace('Evidence: npm test: core 151 pass, 0 fail', 'Evidence:'), 'someone', ['core/x.js'], []],
  ['blank reviewer', GOOD.replace('Reviewer: codex (different model)', 'Reviewer:'), 'someone', ['core/x.js'], []],
  ['no item', GOOD.replace('Item: #2', 'Item: <issue>'), 'someone', ['core/x.js'], []],
  ['bad prediction', GOOD.replace('core_tests_passing >= 150 within 1 h', 'it will probably work'), 'someone', ['core/x.js'], []],
  ['na prediction with reason', GOOD.replace('core_tests_passing >= 150 within 1 h', 'n/a documentation only'), 'someone', ['core/x.js'], []],
  ['evidence is a description', GOOD.replace('npm test: core 151 pass, 0 fail', 'looks good'), 'someone', ['core/x.js'], []],
  ['own reviewer, punctuation differs', GOOD.replace('Reviewer: codex (different model)', 'Reviewer: Claude-Code (Sonnet).'), 'someone', ['core/x.js'], []],
  ['protected without reason', GOOD, 'someone', ['agents/CONTRACT.md'], []],
  ['protected complete', GOOD + 'Protected-change: tightening the review rule after a trial finding\n', 'someone', ['tools/sync_agent_files.py'], ['protected-change']],
  ['bot is exempt', '', 'dependabot[bot]', ['package.json'], []],
  ['autonomy directory is protected', GOOD, 'someone', ['autonomy/limits.json'], []],
];

test('parity: JS record verdicts equal python3 tools/selfhost_check.py on the fixture bodies', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'measures-parity-'));
  FIXTURES.forEach(([name, body, author, files, labels], i) => {
    const bodyFile = path.join(dir, `pr-${i}.md`); writeFileSync(bodyFile, body);
    const r = spawnSync('python3', [path.join(ROOT, 'tools/selfhost_check.py'), '--body-file', bodyFile, '--author', author, '--files', files.join(','), '--labels', labels.join(',')], { encoding: 'utf8' });
    assert.equal(recordProblems(body, author, files, labels).length === 0, r.status === 0, `${name}: python exit ${r.status}: ${r.stderr}`);
  });
});

test('parity: the protected paths and exempt authors are the lists tools/selfhost_check.py holds', () => {
  const py = JSON.parse(execFileSync('python3', ['-c', 'import json,sys; sys.path.insert(0,"tools"); import selfhost_check as s; print(json.dumps({"p": list(s.PROTECTED), "e": list(s.EXEMPT_AUTHORS)}))'], { cwd: ROOT, encoding: 'utf8' }));
  assert.deepEqual([...PROTECTED].sort(), [...py.p].sort());
  assert.deepEqual([...EXEMPT_AUTHORS].sort(), [...py.e].sort());
});
