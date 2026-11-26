// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Conformance tests for US-SPEC-23 (the closed system): each requirement is shown by running the code that makes it true.
// The Python loop closer is run through its own unit tests by name (a filter that matches nothing is a failure, never a pass).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { load, validate, renderGlossary, glossaryDrift } from './index.js';
import { buildSelfModel } from '../describe/index.js';
import { watchOwnerSteps } from '../runner/ownerwatch.js';
import { mirrorDecisions, mirrorClaims, adopt, compareStore } from '../../adapters/github/stage2.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const dir = rel => fileURLToPath(new URL(rel, import.meta.url));

/** Run the loop closer's unit tests whose name contains `filter`; returns how many ran. */
function loopCloserTests(filter) {
  const r = spawnSync('python3', ['-m', 'unittest', 'tests.test_loop_closer', '-k', filter], { cwd: ROOT, encoding: 'utf8' });
  const ran = Number(/Ran (\d+) test/.exec(r.stderr)?.[1] ?? 0);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(ran >= 1, `no loop closer test matches "${filter}"`);
  return ran;
}

const kernelDb = () => makeDb([dir('../kernel/migrations/'), dir('../steward/migrations/'), dir('../runner/migrations/')]);

test('US-23-R01: a decision written as a row reaches the tracker as its own issue in the same sweep, so it is not only in a conversation', async () => {
  const db = kernelDb();
  db.raw.prepare(`INSERT INTO kernel_decisions (id, decision, authority, prediction, revert_path, status, decided_at) VALUES ('D-1','Raise the daily cap','portfolio-manager','spend <= 5 within 24 h','set the cap back','open','2026-11-19 00:00:00')`).run();
  const issues = [];
  const tracker = { name: 'github', upsertIssue: async (i, prev) => { issues.push(i); return { ref: prev || String(100 + issues.length) }; }, comment: async () => ({ ref: '1' }) };
  const r = await mirrorDecisions({ db, now: () => Date.parse('2026-11-20T00:00:00Z'), tracker });
  assert.equal(r.synced, 1);
  assert.match(issues[0].title, /^Decision D-1: Raise the daily cap/);
  assert.match(issues[0].body, /Revert path: set the cap back/);
});

test('T23-1 and US-23-R03: an issue with a passing closing probe is closed by the closer with the evidence recorded', () => { loopCloserTests('t23_1'); });
test('T23-2 and US-23-R04: an issue with no probe and no linked pull request past its grace period is labelled and reported', () => { loopCloserTests('t23_2'); });
test('T23-3 and US-23-R04: an epic files and tracks a child for each of its items and closes when all are closed', () => { assert.ok(loopCloserTests('t23_3') >= 2); });
test('US-23-R02: an issue with a linked pull request or a probe is a closed loop (and one with neither is not)', () => { loopCloserTests('us_23_r02'); loopCloserTests('us_23_r04'); });
test('US-23-R06: a loop that can detect a defect but cannot read what it needs files exactly one capability gap, closed by its probe', () => { assert.ok(loopCloserTests('us_23_r06') >= 5); });

test('US-23-R05: the system reads its own backlog, predictions, outcomes and trust, so managers can act on what the loops produced', async () => {
  const db = makeDb([dir('../describe/migrations/')]);
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('I-1','a','staff','x','done'),('I-2','b','staff','x','blocked')`);
  db.raw.exec(`INSERT INTO predictions (id, metric, op, target, due_at, observed, verdict) VALUES ('p1','m','>=',1,'2026-11-10',2,'hit')`);
  db.raw.exec(`INSERT INTO outcomes (item_id, surface, action_class, result) VALUES ('I-1','repo','merge','verified')`);
  db.raw.exec(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes) VALUES ('repo','merge','assisted',0.9,3)`);
  const m = await buildSelfModel({ db, now: Date.parse('2026-11-20T00:00:00Z') });
  assert.equal(m.facts.performance.items_done, 1);
  assert.equal(m.facts.performance.predictions_hit, 1);
  assert.equal(m.facts.performance.verified_outcomes, 1);
  assert.deepEqual(m.facts.limits.blocked_items, ['I-2']);
  assert.deepEqual(m.facts.performance.autonomy_rungs, [{ surface: 'repo', action_class: 'merge', rung: 'assisted' }]);
});

test('US-23-R07: a directive with neither an enforcer nor a tracking issue is an open loop the register refuses', () => {
  const reg = { tagline: 't', glossary: [], failures: [], directives: [{ id: 'D-X', date: '2026-11-11', owner_words: 'w', meaning: 'm', status: 'planned', enforced_by: [] }] };
  assert.ok(validate(reg).some(e => /D-X: planned directive needs a tracking_issue/.test(e)));
});

test('T23-5 and US-23-R08: editing the generated glossary document by hand, without the register, is detected as drift', () => {
  const reg = load(), rendered = renderGlossary(reg);
  assert.equal(glossaryDrift(rendered, reg), null, 'the document exactly as rendered has no drift');
  assert.equal(glossaryDrift(rendered.replace(/\n/g, '\r\n'), reg), null, 'line endings are not drift');
  const edited = rendered.replace('## Terms', '## Terms\n\n**Hand-added term.** Not in the register.');
  assert.notEqual(edited, rendered);
  const d = glossaryDrift(edited, reg);
  assert.ok(d && /Hand-added term/.test(d.document), 'a hand-added term is reported at the line it appears');
  const changed = rendered.replace(/(\| D-[A-Z-]+ \| [^|]+ \| )enforced/, '$1planned');
  assert.ok(glossaryDrift(changed, reg), 'a hand-changed directive status is reported');
  assert.ok(glossaryDrift(rendered.slice(0, -40), reg), 'a truncated document is reported');
});

test('T23-6 and US-23-R07: an unenforced directive without a tracking issue fails validation, and with one it passes', () => {
  const mk = extra => ({ tagline: 't', glossary: [], failures: [], directives: [{ id: 'D-Y', date: '2026-11-11', owner_words: 'w', meaning: 'm', status: 'partial', enforced_by: [], ...extra }] });
  assert.ok(validate(mk({})).length >= 1);
  assert.deepEqual(validate(mk({ tracking_issue: 13 })), []);
});

test('US-23-R09: what a session learns is written back as a record: the register carries the failures with the code that keeps each from recurring', () => {
  const reg = load();
  assert.ok((reg.failures || []).length >= 1);
  for (const f of reg.failures) { assert.ok(f.fix && f.closing_probe, f.id); assert.ok((f.enforced_by || []).length, f.id + ' has enforcing code'); }
});

test('US-23-R10: an external agent\'s work is accepted only as a record: an issue that exists only on the tracker is adopted as an item, nothing else crosses', async () => {
  const db = makeDb([dir('../steward/migrations/')]);
  const tracker = { name: 'github' };
  const id = await adopt({ db, now: () => Date.parse('2026-11-20T00:00:00Z'), tracker }, { number: '41', title: 'Found by an outside agent', body: 'Owner role: staff\nDone check: the page loads\nClosing probe: http:https://x.example/' });
  assert.equal(id, 'GH-41');
  const row = db.raw.prepare(`SELECT title, owner_role, done_check, closing_probe FROM items WHERE id='GH-41'`).get();
  assert.deepEqual({ ...row }, { title: 'Found by an outside agent', owner_role: 'staff', done_check: 'the page loads', closing_probe: 'http:https://x.example/' });
  assert.equal(db.raw.prepare(`SELECT ref FROM steward_mirror WHERE item_id='GH-41'`).get().ref, '41', 'linked to its issue so the loops can read it');
  const cmp = compareStore([{ id: 'GH-41', status: 'open' }], [{ item_id: 'GH-41', sink: 'github', ref: '41' }], [{ number: '41' }]);
  assert.equal(cmp.match, true);
});

test('US-23-R11: the only exit is an identity-bound gate card, and it closes when its probe sees the step done', async () => {
  const db = makeDb([dir('../runner/migrations/')]);
  const ctx = { db, now: () => Date.parse('2026-11-20T00:00:00Z'), config: {}, env: {} };
  db.raw.prepare(`INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES ('G-1','sign the account agreement','identity-bound','staged','env:ACCOUNT_SIGNED')`).run();
  assert.equal((await watchOwnerSteps(ctx)).closed, 0);
  assert.equal(db.raw.prepare(`SELECT status FROM gate_cards WHERE id='G-1'`).get().status, 'open');
  ctx.env.ACCOUNT_SIGNED = 'yes'; ctx.now = () => Date.parse('2026-11-20T02:00:00Z');
  assert.equal((await watchOwnerSteps(ctx)).closed, 1);
  assert.equal(db.raw.prepare(`SELECT status FROM gate_cards WHERE id='G-1'`).get().status, 'closed');
});

test('US-23-R03: a mirror of claims is idempotent (closure by code never re-posts what already exists)', async () => {
  const db = kernelDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check) VALUES ('I-1','t','staff','d')`);
  db.raw.exec(`INSERT INTO steward_mirror (item_id, sink, ref, hash, synced_at) VALUES ('I-1','github','5','h','2026-11-20 00:00:00')`);
  db.raw.exec(`INSERT INTO claims (item_id, agent, claimed_at) VALUES ('I-1','a','2026-11-20 00:00:00')`);
  let posts = 0;
  const ctx = { db, now: () => Date.parse('2026-11-20T00:00:00Z'), tracker: { name: 'github', comment: async () => { posts++; return { ref: 'c' }; } } };
  assert.equal((await mirrorClaims(ctx)).posted, 1);
  assert.equal((await mirrorClaims(ctx)).posted, 0);
  assert.equal(posts, 1);
});
