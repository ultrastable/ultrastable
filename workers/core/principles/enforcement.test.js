// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './index.js';
import { CHECKS, checkDirectives, checkScopeAndPacks, checkOutreachAsLoops, checkIgnoranceAssumed, checkNoOpenLoops, checkNothingInChat, openDirectivesProbe, unprovenEnforced, readPacks } from './enforcement.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** A copy of the real packs in a temporary root, so a test can break one. */
function copyPacks(ids = ['email', 'social', 'video', 'drafts']) {
  const d = mkdtempSync(path.join(tmpdir(), 'enf-'));
  for (const id of ids) cpSync(path.join(ROOT, 'packs', id), path.join(d, 'packs', id), { recursive: true });
  mkdirSync(path.join(d, 'core')); mkdirSync(path.join(d, 'adapters'));
  const edit = (id, fn) => { const f = path.join(d, 'packs', id, 'pack.json'); const m = JSON.parse(readFileSync(f, 'utf8')); fn(m); writeFileSync(f, JSON.stringify(m)); };
  return { d, edit };
}

test('US-23-R07 the directives for ignorance elicitation and outbound packs are enforced: their checks pass on this checkout', () => {
  const reg = load();
  assert.deepEqual(checkDirectives(reg, ROOT), {});
  for (const id of Object.keys(CHECKS)) {
    const d = reg.directives.find(x => x.id === id);
    assert.equal(d.status, 'enforced', id);
    assert.ok(d.enforced_by.some(e => e.path === 'core/principles/enforcement.js'), `${id} names its check`);
  }
  assert.deepEqual(unprovenEnforced(reg), []);
  assert.ok(readPacks(ROOT).length >= 6, 'the check reads the real packs');
});

test('US-23-R07 a directive called enforced without naming its check is reported', () => {
  const reg = { directives: [{ id: 'D-SCOPE-AND-PACKS', status: 'enforced', enforced_by: [{ kind: 'file', path: 'SCOPE.md' }] }, { id: 'D-OTHER', status: 'enforced', enforced_by: [] }] };
  assert.deepEqual(unprovenEnforced(reg), ['D-SCOPE-AND-PACKS']);
});

test('D-SCOPE-AND-PACKS fails when a class C pack gains an outbound loop, a manifest breaks or core imports a pack', () => {
  const a = copyPacks();
  assert.deepEqual(checkScopeAndPacks(a.d), []);
  a.edit('drafts', m => { m.loops.push({ id: 'file_it', every_ticks: 1, entry: './loops.js#x', outbound: true }); });
  assert.ok(checkScopeAndPacks(a.d).some(p => /packs\/drafts/.test(p) && /class C|outbound/.test(p)));
  const b = copyPacks();
  b.edit('email', m => { m.scope.does.push('Buys ads and enters payment details for the person'); delete m.enable_gate; });
  const probs = checkScopeAndPacks(b.d).join('\n');
  assert.match(probs, /packs\/email: scope\.does is out of bounds/);
  assert.match(probs, /packs\/email: .*enable.?gate/i);
  const c = copyPacks();
  writeFileSync(path.join(c.d, 'core', 'tick.js'), "import '../packs/email/service.js';\n");
  assert.ok(checkScopeAndPacks(c.d).some(p => /imports pack module/.test(p)));
  const empty = mkdtempSync(path.join(tmpdir(), 'enf-'));
  assert.match(checkScopeAndPacks(empty)[0], /no pack manifest found/);
});

test('D-OUTREACH-AS-LOOPS fails when an outreach pack is missing, loses its loops, its caps, its suppression or its charter metrics', () => {
  const a = copyPacks();
  assert.deepEqual(checkOutreachAsLoops(a.d), []);
  rmSync(path.join(a.d, 'packs', 'video'), { recursive: true });
  assert.deepEqual(checkOutreachAsLoops(a.d), ['pack video is missing']);
  const b = copyPacks();
  b.edit('social', m => { m.outbound.suppression = false; m.outbound.caps = {}; m.charter.guard_metrics = []; });
  b.edit('email', m => { m.loops = []; });
  const probs = checkOutreachAsLoops(b.d).join('\n');
  for (const want of [/packs\/social: suppression is not on/, /packs\/social: channel \w+ has no daily and weekly cap/, /packs\/social: no guard metric/, /packs\/email: no code loop/, /packs\/email: no outbound loop/]) assert.match(probs, want);
  const c = copyPacks();
  c.edit('video', m => { m.loops[0].entry = './gone.js#run'; });
  assert.ok(checkOutreachAsLoops(c.d).some(p => /names a module that does not exist/.test(p)));
});

test('D-IGNORANCE-ASSUMED holds: the ask-card rules refuse recall-only, default-less and jargon cards and accept a plain one', () => {
  assert.deepEqual(checkIgnoranceAssumed(), []);
});

test('T23-4 (US-SPEC-23) removing the code a directive names as its enforcer fails: the check module is itself a named enforcer that must exist', async () => {
  const { missingEnforcers } = await import('./index.js');
  const reg = load();
  assert.deepEqual(missingEnforcers(reg, ROOT), []);
  const gone = mkdtempSync(path.join(tmpdir(), 'enf-'));
  assert.ok(missingEnforcers(reg, gone).some(m => /D-OUTREACH-AS-LOOPS: file core\/principles\/enforcement\.js/.test(m)));
});

// ---------- J-19: the checks for D-NO-OPEN-LOOPS and D-NOTHING-IN-CHAT, the register's trackers, the enforcers of D-RUN-ON-ITSELF ----------

/** A temporary root holding exactly what the two checks read, copied from this checkout, so a test can break one thing. */
function loopRoot() {
  const d = mkdtempSync(path.join(tmpdir(), 'enf-loops-'));
  for (const rel of ['products/gaplint', 'tools/loop_closer.py', 'tests/test_loop_closer.py', 'AGENTS.md', 'agents/CONTRACT.md', '.github/workflows/loops.yml']) cpSync(path.join(ROOT, rel), path.join(d, rel), { recursive: true });
  return d;
}

test('US-23-R07: D-NO-OPEN-LOOPS is executed on this checkout (gaplint with the workers configuration and the loop closer tests) and passes', () => {
  assert.deepEqual(checkNoOpenLoops(ROOT), []);
  assert.deepEqual(checkNoOpenLoops(loopRoot()), [], 'the copied fixture is a faithful baseline');
});

test('US-23-R07: D-NO-OPEN-LOOPS check fails when gaplint reports a finding on a fixture checkout', () => {
  const d = loopRoot();
  writeFileSync(path.join(d, 'AGENTS.md'), '# AGENTS\n\nWork is an item.\n');
  const probs = checkNoOpenLoops(d);
  assert.ok(probs.some(p => /^gaplint GL003 AGENTS\.md:\d+/.test(p)), probs.join('\n'));
  assert.ok(probs.some(p => /^gaplint GL010 AGENTS\.md/.test(p)));
  mkdirSync(path.join(d, 'docs', 'handoff'), { recursive: true });
  writeFileSync(path.join(d, 'docs', 'handoff', 'a.md'), 'Done. Needs you to decide the pricing.\n');
  assert.ok(checkNoOpenLoops(d).some(p => /GL004/.test(p)), 'a handoff that assigns a step to a person is an open loop');
});

test('US-23-R07: D-NO-OPEN-LOOPS fails when the linter or the loop closer is gone or broken, never passing by absence', () => {
  const d = loopRoot();
  writeFileSync(path.join(d, 'tools', 'loop_closer.py'), 'raise SystemExit("broken")\n');
  assert.ok(checkNoOpenLoops(d).some(p => /loop closer's own tests fail/.test(p)));
  rmSync(path.join(d, 'tools', 'loop_closer.py'));
  assert.ok(checkNoOpenLoops(d).some(p => /tools\/loop_closer\.py is missing/.test(p)));
  rmSync(path.join(d, 'products', 'gaplint', 'configs'), { recursive: true });
  assert.ok(checkNoOpenLoops(d).some(p => /configs\/workers\.json is missing/.test(p)));
  rmSync(path.join(d, 'products'), { recursive: true });
  assert.ok(checkNoOpenLoops(d).some(p => /products\/gaplint is missing/.test(p)));
  assert.ok(checkNoOpenLoops(mkdtempSync(path.join(tmpdir(), 'enf-'))).length >= 2);
});

test('US-23-R09: D-NOTHING-IN-CHAT holds on this checkout and fails when the rule, the workflow or the closer disappears', () => {
  assert.deepEqual(checkNothingInChat(ROOT), []);
  const d = loopRoot();
  writeFileSync(path.join(d, 'agents', 'CONTRACT.md'), '# contract without the rule\n');
  assert.ok(checkNothingInChat(d).some(p => /Nothing exists only in chat/.test(p)));
  writeFileSync(path.join(d, '.github', 'workflows', 'loops.yml'), 'name: loops\n');
  assert.ok(checkNothingInChat(d).some(p => /no longer runs tools\/loop_closer\.py/.test(p)));
  rmSync(path.join(d, '.github'), { recursive: true });
  assert.ok(checkNothingInChat(d).some(p => /loops\.yml is missing/.test(p)));
});

test('US-23-R07: both newly executed directives name this file as an enforcer, so calling them enforced is proven', () => {
  const reg = load();
  for (const id of ['D-NO-OPEN-LOOPS', 'D-NOTHING-IN-CHAT']) {
    assert.ok(CHECKS[id], id);
    assert.ok(reg.directives.find(d => d.id === id).enforced_by.some(e => e.path === 'core/principles/enforcement.js'), id);
  }
  assert.deepEqual(unprovenEnforced(reg), []);
});

test('US-23-R07: a tracking issue that is closed while its directive is partial is reported; an unreadable tracker is unknown, not passed', async () => {
  const reg = { directives: [
    { id: 'D-A', status: 'partial', tracking_issue: 1 }, { id: 'D-B', status: 'partial', tracking_issue: 2 },
    { id: 'D-C', status: 'planned', tracking_issue: 3 }, { id: 'D-D', status: 'planned', tracking_issue: 4 }, { id: 'D-E', status: 'enforced', enforced_by: [] }] };
  const tracker = { getIssue: async n => { if (n === 3) return null; if (n === 4) throw new Error('http 503'); return { number: n, state: n === 1 ? 'open' : 'closed' }; } };
  const r = await openDirectivesProbe({ reg, tracker });
  assert.equal(r.checked, 4, 'an enforced directive is not looked up');
  assert.deepEqual(r.open_loops.map(x => [x.id, x.tracking_issue]), [['D-B', 2], ['D-C', 3]]);
  assert.match(r.open_loops[0].reason, /closed while the directive is partial/);
  assert.match(r.open_loops[1].reason, /does not exist/);
  assert.deepEqual(r.unknown.map(x => [x.id, x.reason]), [['D-D', 'http 503']]);
});

test('T23-4: removing core/steward/stage.js (an enforcer of D-RUN-ON-ITSELF) fails the vanished-enforcer check', async () => {
  const { missingEnforcers } = await import('./index.js');
  const reg = load();
  const d = mkdtempSync(path.join(tmpdir(), 'enf-'));
  for (const dir of [...reg.directives, ...(reg.failures || [])]) for (const e of dir.enforced_by || []) { const f = path.join(d, e.path); mkdirSync(path.dirname(f), { recursive: true }); if (!existsSync(f)) writeFileSync(f, ''); }
  assert.deepEqual(missingEnforcers(reg, d), []);
  rmSync(path.join(d, 'core', 'steward', 'stage.js'));
  assert.deepEqual(missingEnforcers(reg, d), ['D-RUN-ON-ITSELF: file core/steward/stage.js']);
  const run = reg.directives.find(x => x.id === 'D-RUN-ON-ITSELF').enforced_by.map(e => e.path);
  for (const want of ['core/specloop/index.js', 'core/runner/selfdoer.js', 'adapters/github/stage2.js', 'core/steward/stage.js']) assert.ok(run.includes(want), want);
});
