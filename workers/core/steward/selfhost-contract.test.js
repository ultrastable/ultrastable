// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Conformance tests for US-SPEC-20 (self-hosting) that run the real Python tools, so the requirement ids attach to behaviour the JS
// conformance scanner can see (core/conformance reads Python test names too; these also prove the tools from the JS side).
// T20-1 .. T20-6 are the specification's own test ids. No network: every tool is run on fixtures in a temporary directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { computeStage, checkPublished, parsePublishedStage } from './stage.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const tmp = () => mkdtempSync(path.join(tmpdir(), 'selfhost-'));
const py = (args, opts = {}) => spawnSync('python3', args, { cwd: ROOT, encoding: 'utf8', ...opts });
const GOOD = `## What\nAdds the claims module.\n\nItem: #2\nSpec: US-08-R03, US-SPEC-08\nPrediction: core_tests_passing >= 150 within 1 h\nEvidence: npm test: core 151 pass, 0 fail\nAuthor: claude-code (sonnet)\nReviewer: codex (different model)\n`;
function record(body, { author = 'someone', files = 'core/x.js', labels = '' } = {}) {
  const f = path.join(tmp(), 'pr.md'); writeFileSync(f, body);
  return py(['tools/selfhost_check.py', '--body-file', f, '--author', author, '--files', files, '--labels', labels]);
}

test('US-20-R02: a pull request with the full record passes the check, with its six fields named in the template', () => {
  const r = record(GOOD);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /contract: ok/);
  const tpl = readFileSync(path.join(ROOT, '.github', 'pull_request_template.md'), 'utf8');
  for (const f of ['Item:', 'Spec:', 'Prediction:', 'Evidence:', 'Author:', 'Reviewer:']) assert.ok(tpl.includes(f), f);
});

test('T20-2 and US-20-R03: a pull request missing any record field fails the check', () => {
  for (const field of ['Item', 'Spec', 'Prediction', 'Evidence', 'Author', 'Reviewer']) {
    const body = GOOD.split('\n').filter(l => !l.startsWith(field + ':')).join('\n');
    const r = record(body);
    assert.equal(r.status, 1, `without ${field}`);
    assert.match(r.stderr, new RegExp('^ - ' + field + ':', 'm'));
  }
  assert.equal(record('', { author: 'dependabot[bot]', files: 'package.json' }).status, 0);
  assert.equal(record('', { author: 'github-actions[bot]', files: 'AGENTS.md' }).status, 0, 'the workflow-generated refresh is exempt (US-20-R15)');
  assert.equal(record('', { author: 'a-person' }).status, 1);
});

test('T20-3 and US-20-R04: a pull request whose reviewer equals its author fails, however the name is punctuated', () => {
  for (const rev of ['claude-code (sonnet)', 'Claude Code  (Sonnet)', 'CLAUDE_CODE sonnet.']) {
    const r = record(GOOD.replace('Reviewer: codex (different model)', 'Reviewer: ' + rev));
    assert.equal(r.status, 1, rev); assert.match(r.stderr, /Reviewer: must differ from Author/);
  }
});

test('US-20-R05: evidence that describes instead of quoting output is refused', () => {
  const r = record(GOOD.replace('npm test: core 151 pass, 0 fail', 'it looks fine to me'));
  assert.equal(r.status, 1); assert.match(r.stderr, /Evidence: must quote real output/);
});

test('T20-4 and US-20-R07: a change to a protected path without Protected-change and the label fails the check; with both it passes', () => {
  const bare = record(GOOD, { files: 'agents/CONTRACT.md' });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /Protected-change: required/); assert.match(bare.stderr, /label 'protected-change'/);
  const ok = record(GOOD + 'Protected-change: tightening the review rule after a trial finding\n', { files: 'agents/CONTRACT.md,core/x.js', labels: 'protected-change' });
  assert.equal(ok.status, 0, ok.stderr);
});

test('T20-9 and US-20-R14: a deleted guard file fails the gate and an added human approver fails it only under the closed-loop flag', () => {
  const d = tmp(), body = path.join(d, 'pr.md'), ns = path.join(d, 'ns.txt'), co = path.join(d, 'co.diff');
  writeFileSync(body, GOOD + 'Protected-change: removing a guard to prove the gate refuses it\n');
  writeFileSync(ns, 'D\ttools/spec_truth.py\n'); writeFileSync(co, '+/docs/ @someone\n');
  const base = ['tools/selfhost_check.py', '--body-file', body, '--author', 'someone', '--files', 'tools/spec_truth.py', '--labels', 'protected-change'];
  assert.match(py([...base, '--name-status', ns]).stderr, /guard file is deleted/);
  assert.equal(py([...base, '--codeowners-diff', co]).status, 0);
  assert.match(py([...base, '--codeowners-diff', co, '--closed-loop']).stderr, /human approver/);
});

test('T20-8 and US-20-R08: a second open pull request on the same protected component is reported', () => {
  const d = tmp(), body = path.join(d, 'pr.md'), other = path.join(d, 'other.json');
  writeFileSync(body, GOOD + 'Protected-change: one instruction change at a time\n'); writeFileSync(other, JSON.stringify([{ number: 7, files: ['CLAUDE.md'] }]));
  const r = py(['tools/selfhost_check.py', '--body-file', body, '--author', 'someone', '--files', 'AGENTS.md', '--labels', 'protected-change', '--other-prs', other, '--number', '8']);
  assert.equal(r.status, 1); assert.match(r.stderr, /pull request #7 also touches agent-instructions/);
});

test('T20-5 and US-20-R06: a BUILT status line naming a missing file is reported by the spec-truth check, and --strict exits 1', () => {
  const d = tmp(), specs = path.join(d, 'specs'), code = path.join(d, 'code');
  mkdirSync(specs); mkdirSync(path.join(code, 'core'), { recursive: true }); writeFileSync(path.join(code, 'core', 'a.js'), 'x');
  writeFileSync(path.join(specs, 'US-SPEC-96-x.md'), '## 1. Reference implementation status\n\n- Real: BUILT in `core/a.js`.\n- Ghost: BUILT in `core/ghost.js`.\n');
  const r = py(['tools/spec_truth.py', '--spec-dir', specs, '--code-dir', code, '--strict']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /1 BUILT status line\(s\) do not match the code/);
  assert.match(r.stdout, /US-SPEC-96-x\.md:4: labelled BUILT but none of the named paths exist/);
  assert.equal(py(['tools/spec_truth.py', '--spec-dir', specs, '--code-dir', code]).status, 0, 'without --strict it reports and exits 0');
});

test('T20-1 and US-20-R01: the generated agent files equal the contract in this repository, and a hand edit is detected', () => {
  const ok = py(['tools/sync_agent_files.py', '--repo', 'workers', '--target', '.', '--check']);
  assert.equal(ok.status, 0, ok.stderr);
  const d = tmp();
  assert.equal(py(['tools/sync_agent_files.py', '--repo', 'workers', '--target', d]).status, 0);
  writeFileSync(path.join(d, 'GEMINI.md'), 'edited by hand\n');
  const bad = py(['tools/sync_agent_files.py', '--repo', 'workers', '--target', d, '--check']);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /DIFFERS GEMINI\.md/);
  for (const repo of ['spec', 'license', '.github']) {
    const t = tmp();
    assert.equal(py(['tools/sync_agent_files.py', '--repo', repo, '--target', t]).status, 0, repo);
    assert.equal(py(['tools/sync_agent_files.py', '--repo', repo, '--target', t, '--check']).status, 0, repo);
    assert.ok(readFileSync(path.join(t, '.github', 'workflows', 'selfhost.yml'), 'utf8').includes('selfhost_check.py'), repo + ' runs the record check in its own CI');
  }
});

test('T20-7 and US-20-R15: only the listed logins are exempt from the record, and the list is data', () => {
  assert.equal(record('', { author: 'dependabot[bot]', files: 'package.json' }).status, 0);
  assert.equal(record('', { author: 'github-actions[bot]', files: 'AGENTS.md' }).status, 0);
  assert.equal(record('', { author: 'some-other[bot]' }).status, 1, 'any other login needs the record');
  const listed = JSON.parse(spawnSync('python3', ['-c', 'import json,sys; sys.path.insert(0,"tools"); import selfhost_check as s; print(json.dumps(list(s.EXEMPT_AUTHORS)))'], { cwd: ROOT, encoding: 'utf8' }).stdout);
  assert.deepEqual(listed, ['dependabot[bot]', 'github-actions[bot]']);
});

test('US-20-R09: the contract does not depend on any one tool: it tells a tool that can only talk what to do', () => {
  const c = readFileSync(path.join(ROOT, 'agents', 'CONTRACT.md'), 'utf8');
  assert.match(c, /If your tool cannot do all of that/);
  for (const row of ['Only talk', 'Read and edit files', 'Use git and the GitHub CLI or API']) assert.ok(c.includes(row), row);
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursor/rules/ultrastable.mdc']) assert.ok(readFileSync(path.join(ROOT, f), 'utf8').length > 20, f);
});

// ---- the ladder (US-20-R10 .. R13, T20-6), through the stage computation ----

const MIGS = [fileURLToPath(new URL('./migrations/', import.meta.url)), fileURLToPath(new URL('../runner/migrations/', import.meta.url)), fileURLToPath(new URL('../kernel/migrations/', import.meta.url))];
const NOW = Date.parse('2026-11-20T12:00:00Z');
const stage1Only = { contract: async () => ({ record_check: { green: 3, merged: 3 }, false_built: 0 }), stage2: async () => ({ result: 'fail' }) };
const independent = { stage_authors: { 1: 'a', 2: 'a', 3: 'a', 4: 'a' }, probe_authors: { 1: 'b', 2: 'b', 3: 'b', 4: 'b' } };

test('T20-6 and US-20-R10: the published stage matches the highest stage whose evidence exists; a higher claim is reported', async () => {
  const computed = await computeStage({ db: makeDb(MIGS), now: () => NOW, probes: stage1Only, config: independent });
  assert.equal(computed.stage, 1);
  const published = parsePublishedStage(readFileSync(path.join(ROOT, 'agents', 'CONTRACT.md'), 'utf8'));
  assert.equal(published.stage, null, 'the contract states no number');
  assert.equal(published.measured, true, 'the contract says the stage is measured, never declared');
  assert.equal(checkPublished({ published, computed }).ok, true);
  const over = checkPublished({ published: { stage: 2, measured: false }, computed });
  assert.equal(over.ok, false); assert.match(over.problems[0], /exceeds the computed stage 1/);
});

test('US-20-R11: a stage is claimed only when a probe its author did not write confirms it', async () => {
  const circular = { stage_authors: { 1: 'a' }, probe_authors: { 1: 'a' } };
  const r = await computeStage({ db: makeDb(MIGS), now: () => NOW, probes: stage1Only, config: circular });
  assert.equal(r.stage, 1); assert.equal(r.claimed, 0); assert.equal(r.evidence[1].claim_blocked, 'probe_not_independent');
});

test('US-20-R12: moving up a stage does not remove a lower stage\'s check: a lost stage 1 drops everything above it', async () => {
  const lost = { ...stage1Only, contract: async () => ({ record_check: { green: 2, merged: 3 }, false_built: 0 }), stage2: async () => ({ result: 'pass' }) };
  const r = await computeStage({ db: makeDb(MIGS), now: () => NOW, probes: lost, config: independent });
  assert.equal(r.stage, 0); assert.equal(r.blocked_at, 1);
  assert.equal(r.evidence[2].ok, true, 'stage 2 evidence is read, yet it cannot count without stage 1');
});

test('US-20-R13: the project publishes its current stage and may not describe itself as higher', async () => {
  const contract = readFileSync(path.join(ROOT, 'agents', 'CONTRACT.md'), 'utf8');
  assert.match(contract, /The stage is measured, never declared/);
  const computed = await computeStage({ db: makeDb(MIGS), now: () => NOW, probes: {}, config: {} });
  assert.equal(computed.stage, 0, 'with no probe at all nothing is evidenced');
  assert.equal(checkPublished({ published: parsePublishedStage(contract), computed }).ok, true, 'a measured declaration backed by a computation is accepted');
  assert.equal(checkPublished({ published: { stage: 1, measured: false }, computed }).ok, false, 'a stage 1 claim with no evidence is reported');
});

test('US-20-R16: the bootstrap pointer is generated idempotently and the self-closed-loops lint passes on the instruction files', () => {
  const lint = py(['tools/self_closed_lint.py', '--no-diff']);
  assert.equal(lint.status, 0, lint.stdout);
  assert.match(lint.stdout, /instruction file\(s\) carry SELF-CLOSED-LOOPS-1/);
  const f = path.join(tmp(), 'A.md'); writeFileSync(f, '# Title\n\nbody\n');
  assert.equal(py(['tools/sync_agent_bootstrap.py', f]).status, 0);
  const once = readFileSync(f, 'utf8');
  assert.equal(py(['tools/sync_agent_bootstrap.py', '--check', f]).status, 0, 'a second run changes nothing');
  assert.equal(readFileSync(f, 'utf8'), once);
  assert.equal(once.split('AGENT-BOOTSTRAP-1:begin').length - 1, 1);
});
