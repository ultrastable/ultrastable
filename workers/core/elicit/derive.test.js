// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-16 R01 (derivation before asking), R16 (quiet period in local time, low-priority defaulting) and section 4 (contradiction reopens a need).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createElicit, DEFAULT_DEFER_BELOW } from './index.js';
import { createWalkthrough } from '../walkthrough/index.js';

const dir = p => fileURLToPath(new URL(p, import.meta.url));
const MIGS = [dir('./migrations/'), dir('./outcomes/migrations/')];
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const P = 'demo';
const need = (id, extra = {}) => ({ id, label: `Thing ${id}`, artifact: 'charter', question: `Which ${id} do you want?`, why: `This changes the ${id} we build.`, cue: 'Similar projects pick the first one.',
  options: ['first', 'second', 'third'], default: 'first', default_consequence: 'We rebuild one page; change it any time.', p_wrong: 0.5, ...extra });
const mk = (config = {}, t = { v: T0 }) => { const db = makeDb(MIGS); return { db, t, e: createElicit({ db, now: () => t.v, config: { defer_below: 0, ...config } }) }; };
const attempts = (db, id) => db.raw.prepare('SELECT surface, result FROM elicit_derivations WHERE need_id=? ORDER BY id').all(id).map(r => `${r.surface}:${r.result}`);

test('T16-1, US-16-R01 and US-16-R30: a need answerable from a record or a tool probe is derived and never asked, with an attempts row per surface', async () => {
  const { db, e } = mk();
  await e.registerNeeds(P, [need('host'), need('repo'), need('colour', { derive_from: 'blue' })], { idea: 'a bakery page' });
  const out = await e.derive(P, { records: { host: async () => 'second' }, probes: { repo: async () => 'third' } });
  assert.deepEqual(out.derived.map(d => [d.need_id, d.value, d.provenance, d.source]), [['host', 'second', 'derived', 'record'], ['repo', 'third', 'derived', 'probe']]);
  assert.deepEqual((await e.nextAsks(P)).map(c => c.need_id), ['colour']);
  assert.deepEqual(attempts(db, 'host'), ['idea:miss', 'record:hit']);
  assert.deepEqual(attempts(db, 'colour'), ['idea:miss', 'record:miss', 'probe:miss', 'research:miss']);
  assert.equal((await e.readBack(P)).statements.find(s => s.need_id === 'host').provenance, 'derived');
});

test('US-16-R30: research with a source derives with provenance researched and the URL; research without a source is logged no_source and the need stays open', async () => {
  const { db, e } = mk();
  await e.registerNeeds(P, [need('a'), need('b')]);
  const research = async n => (n.id === 'a' ? { value: 'second', sources: [{ url: 'https://example.org/guide', title: 'Guide' }] } : { value: 'third', sources: [] });
  const out = await e.derive(P, { research });
  assert.deepEqual(out.derived, [{ need_id: 'a', value: 'second', provenance: 'researched', source: 'https://example.org/guide' }]);
  assert.equal(db.raw.prepare("SELECT state FROM elicit_needs WHERE id='b'").get().state, 'open');
  assert.deepEqual(attempts(db, 'b').slice(-1), ['research:no_source']);
  assert.equal((await e.readBack(P)).statements[0].provenance, 'researched');
  assert.equal((await e.derive(P, { research: async () => ({ value: 'not an option', sources: [{ url: 'https://x.example/' }] }) })).derived.length, 0, 'a value that is not an option is never applied');
});

test('US-16-R30: a failing port is logged as an error and the next surface is still tried', async () => {
  const { db, e } = mk();
  await e.registerNeeds(P, [need('a')]);
  const out = await e.derive(P, { records: { a: async () => { throw new Error('store is down'); } }, probes: { a: async () => 'second' } });
  assert.equal(out.derived[0].source, 'probe');
  assert.deepEqual(attempts(db, 'a'), ['idea:miss', 'record:error', 'probe:hit']);
  assert.match(db.raw.prepare("SELECT detail FROM elicit_derivations WHERE result='error'").get().detail, /store is down/);
});

test('US-16-R30: with require_exhaustion a need is not asked or gated until every configured surface has an attempt row', async () => {
  const { e } = mk({ require_exhaustion: true });
  await e.registerNeeds(P, [need('a'), need('risky', { reversible: false })]);
  const before = await e.nextAsks(P);
  assert.deepEqual(before.map(c => c.need_id), []); assert.deepEqual(before.awaiting_derivation.sort(), ['a', 'risky']);
  await e.derive(P, {});
  const after = await e.nextAsks(P);
  assert.deepEqual(after.map(c => c.need_id).sort(), ['a', 'risky']); assert.deepEqual(after.awaiting_derivation, []);
  const part = mk({ require_exhaustion: true, derive_surfaces: ['idea', 'record'] });
  await part.e.registerNeeds(P, [need('a')]); await part.e.derive(P, {});
  assert.equal((await part.e.nextAsks(P)).length, 1, 'only the configured surfaces are required');
});

test('T16-11 and US-16-R31: a stated answer contradicted by evidence returns to open, keeps its history, lowers readiness and queues a re-run', async () => {
  const { db, e } = mk(); await e.registerNeeds(P, [need('a'), need('b')]); await e.nextAsks(P);
  await e.answer(P, 'a', { choice: 'second', text: 'the second' }); await e.answer(P, 'b', { choice: 'first' });
  assert.equal((await e.readiness(P)).score, 1);
  const r = await e.contradict(P, 'a', { evidence: 'the tool probe found the repository is private', source: 'probe' });
  assert.deepEqual(r, { ok: true, state: 'open', rerun: ['ELICIT-RERUN-DEMO-CHARTER'] });
  assert.equal((await e.readiness(P)).score, 0.5);
  const row = db.raw.prepare("SELECT state, value, provenance, answered_at, answer_text, revisit FROM elicit_needs WHERE id='a'").get();
  assert.deepEqual({ ...row }, { state: 'open', value: null, provenance: null, answered_at: null, answer_text: 'the second', revisit: 'This changed: the tool probe found the repository is private' });
  const log = db.raw.prepare("SELECT value, reason, revisit_trigger, superseded_at FROM elicit_assumptions WHERE need_id='a'").get();
  assert.equal(log.value, 'second'); assert.equal(log.reason, 'contradicted'); assert.match(log.revisit_trigger, /^contradicted by probe: the tool probe/); assert.ok(log.superseded_at);
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id='ELICIT-RERUN-DEMO-CHARTER'").get().status, 'open');
  const [card] = await e.nextAsks(P);
  assert.equal(card.need_id, 'a'); assert.equal(card.changed, 'This changed: the tool probe found the repository is private');
});

test('T16-11: a derived need is reopened the same way and is asked again; contradicting with no evidence is refused; repeating the same evidence adds no second row or item', async () => {
  const { db, e } = mk(); await e.registerNeeds(P, [need('a')]);
  await e.derive(P, { records: { a: async () => 'third' } });
  assert.equal((await e.nextAsks(P)).length, 0);
  assert.equal((await e.contradict(P, 'a', { evidence: '  ' })).ok, false);
  assert.equal((await e.contradict(P, 'a', { evidence: 'the record was stale' })).ok, true);
  assert.deepEqual((await e.contradict(P, 'a', { evidence: 'the record was stale' })).already, true);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM elicit_assumptions WHERE reason='contradicted'").get().n, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'ELICIT-RERUN%'").get().n, 1);
  assert.equal((await e.nextAsks(P)).length, 1, 'asked again');
  assert.equal((await e.contradict(P, 'a', { evidence: 'something else' })).ok, false, 'an open need has nothing to contradict');
  assert.equal((await e.derive(P, { records: { a: async () => 'third' } })).derived.length, 0, 'the value the evidence ruled out is not derived again');
});

test('US-16-R16: with timezone Pacific/Auckland no Ask opens between 22:00 and 07:00 local and opens at 09:00 local; without a time zone nothing is silenced', async () => {
  const cat = ['a', 'b'].map(id => need(id));
  const nz = mk({ timezone: 'Pacific/Auckland' }, { v: Date.UTC(2026, 10, 12, 10, 0, 0) }); // 23:00 in Auckland (UTC+13)
  await nz.e.registerNeeds(P, cat);
  assert.equal((await nz.e.nextAsks(P)).length, 0);
  nz.t.v = Date.UTC(2026, 10, 12, 20, 0, 0);                                                 // 09:00 next day in Auckland
  assert.equal((await nz.e.nextAsks(P)).length, 2);
  const none = mk({}, { v: Date.UTC(2026, 10, 12, 23, 30, 0) }); await none.e.registerNeeds(P, cat);
  assert.equal((await none.e.nextAsks(P)).length, 2, 'no time zone and no configured period: nothing silenced');
  const explicit = mk({ quiet: { from: 1, to: 5 } }, { v: Date.UTC(2026, 10, 12, 2, 0, 0) }); await explicit.e.registerNeeds(P, cat);
  assert.equal((await explicit.e.nextAsks(P)).length, 0, 'a configured period still wins');
});

test('US-16-R26 and US-16-R16: the time zone is part of the profile; a reversible need below defer_below is defaulted without asking and shown first in the read-back', async () => {
  assert.equal(DEFAULT_DEFER_BELOW, 0.15);
  const db = makeDb([...MIGS, dir('../walkthrough/migrations/')]); const t = { v: Date.UTC(2026, 10, 12, 10, 0, 0) };
  const elicit = createElicit({ db, now: () => t.v });                                       // defaults: defer_below 0.15
  const wt = createWalkthrough({ db, elicit, now: () => t.v, config: { catalog: [need('big', { p_wrong: 0.9, rework: 3, dependents: 2 }), need('small', { p_wrong: 0.1, rework: 0.5, dependents: 1 }), need('risky', { p_wrong: 0.01, reversible: false })] } });
  assert.equal((await wt.setProfile('ana', { timezone: 'Not/AZone' })).ok, false);
  await wt.submitIdea('ana', 'a page for my club');
  assert.equal((await wt.setProfile('ana', { timezone: 'Pacific/Auckland' })).profile.timezone, 'Pacific/Auckland');
  assert.equal(elicit.config.timezone, 'Pacific/Auckland');
  assert.deepEqual((await wt.askCards('ana')).map(c => c.need_id), ['risky'], 'at 23:00 local the Ask for big stays unopened; only the gate card for risky is shown');
  t.v = Date.UTC(2026, 10, 12, 20, 0, 0);
  const cards = await wt.askCards('ana');
  assert.deepEqual(cards.map(c => c.need_id).sort(), ['big', 'risky']);
  const small = db.raw.prepare("SELECT state, provenance FROM elicit_needs WHERE id='small'").get();
  assert.deepEqual({ ...small }, { state: 'defaulted', provenance: 'default' });
  assert.equal(db.raw.prepare("SELECT reason FROM elicit_assumptions WHERE need_id='small'").get().reason, 'low_priority');
  assert.match((await elicit.readBack('main')).statements[0].text, /We assumed thing small/i);
});

test('T16-6, US-16-R11 and US-16-R25: every statement of a drafted artifact carries a tag and every default tag links to a live assumption log entry; unsettled needs are open questions, not facts', async () => {
  const { db, e } = mk(); await e.registerNeeds(P, [need('a'), need('b'), need('c'), need('d'), need('e')]);
  await e.derive(P, { records: { c: async () => 'second' }, research: async n => (n.id === 'd' ? { value: 'first', sources: [{ url: 'https://example.org/x' }] } : null) });
  await e.nextAsks(P); await e.answer(P, 'a', { choice: 'third' }); await e.answer(P, 'b', { choice: 'Not sure' });
  const d = await e.draft(P, 'charter');
  assert.deepEqual(d.statements.map(s => s.provenance), ['default', 'stated', 'derived', 'researched'], 'defaults first');
  assert.ok(d.markdown.split('## Open questions')[0].split('\n').filter(l => l.startsWith('- ')).every(l => /\[(stated|derived: .+|researched: .+|default: A-INI-4#\d+)\]$/.test(l)));
  assert.match(d.markdown, /\[default: A-INI-4#1\]/); assert.match(d.markdown, /\[researched: https:\/\/example\.org\/x\]/); assert.match(d.markdown, /\[derived: record\]/);
  assert.match(d.markdown, /## Open questions\n- Thing e/); assert.ok(!/Thing e: /.test(d.markdown));
  assert.deepEqual(await e.lintDraft(P, d.markdown), { ok: true, problems: [] });
});

test('US-16-R25: lintDraft rejects an untagged statement and a default tag with no assumption entry or a superseded one', async () => {
  const { e } = mk(); await e.registerNeeds(P, [need('a')]); await e.nextAsks(P); await e.answer(P, 'a', { choice: 'Not sure' });
  const bad = await e.lintDraft(P, '# A-INI-2\n- Thing a: first\n- Thing b: "x" [default: A-INI-4#99]\n- Thing a: first [default: A-INI-4#1]\n\n## Open questions\n- anything here');
  assert.equal(bad.ok, false); assert.deepEqual(bad.problems.map(p => p.problem), ['a statement without a provenance tag', 'the default tag names no live assumption log entry (A-INI-4#99)']);
  await e.correct(P, 'a', 'second');
  assert.equal((await e.lintDraft(P, '- Thing a: first [default: A-INI-4#1]')).ok, false, 'a superseded entry is not live');
});

test('US-16-R13, US-16-R25 and A-INI-4: after a correction the redrafted artifact shows the corrected need as stated, and the assumption log lists every default with its revert path', async () => {
  const { db, e } = mk(); await e.registerNeeds(P, [need('a'), need('b')]); await e.nextAsks(P); await e.answer(P, 'a', { choice: 'Not sure' }); await e.answer(P, 'b', { choice: 'Not sure' });
  const log = await e.assumptionLog(P);
  assert.equal(log.statements.length, 2); assert.match(log.markdown, /revert path: the person changes it in the read-back/); assert.match(log.markdown, /if it is wrong: We rebuild one page/);
  assert.deepEqual(await e.lintDraft(P, log.markdown), { ok: true, problems: [] });
  await e.correct(P, 'a', 'third');
  const d = await e.draft(P, 'charter');
  assert.equal(d.statements.find(s => s.need_id === 'a').provenance, 'stated'); assert.match(d.markdown, /Thing a: third \[stated\]/);
  assert.equal((await e.assumptionLog(P)).statements.length, 1, 'the superseded default leaves the live log');
  assert.match(db.raw.prepare("SELECT done_check FROM items WHERE id='ELICIT-RERUN-DEMO-CHARTER'").get().done_check, /lintDraft/);
  assert.equal((await e.draft(P, 'A-INI-4')).artifact, 'A-INI-4');
});

test('US-16-R30: a value that evidence contradicted is not derived again while the need is open, but another value is', async () => {
  const { db, e } = mk(); await e.registerNeeds(P, [need('a')]);
  await e.derive(P, { records: { a: async () => 'third' } });
  await e.contradict(P, 'a', { evidence: 'the record was stale' }); // back to open, not yet asked
  assert.equal(db.raw.prepare("SELECT state FROM elicit_needs WHERE id='a'").get().state, 'open');
  const again = await e.derive(P, { records: { a: async () => 'third' } });
  assert.equal(again.derived.length, 0, 'the same ruled-out value from the same source is refused');
  assert.equal(db.raw.prepare("SELECT state FROM elicit_needs WHERE id='a'").get().state, 'open');
  assert.deepEqual(attempts(db, 'a').filter(x => x.startsWith('record')).slice(-1), ['record:miss']);
  assert.match(db.raw.prepare("SELECT detail FROM elicit_derivations WHERE need_id='a' AND surface='record' ORDER BY id DESC LIMIT 1").get().detail, /later contradicted by evidence/);
  const other = await e.derive(P, { records: { a: async () => 'second' } });
  assert.deepEqual(other.derived.map(d => d.value), ['second'], 'a different value is accepted');
});
