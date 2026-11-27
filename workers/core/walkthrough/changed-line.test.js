// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-16 R31 through the console: a Need that evidence contradicted is asked again with the plain line "This changed: ...", on the walkthrough card, on the Needs-you card
// and on the page that draws them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createElicit } from '../elicit/index.js';
import { createWalkthrough } from './index.js';
import { CONSOLE_HTML } from '../src/console-ui.js';
import { buildConsole } from '../src/console.js';

const dir = p => fileURLToPath(new URL(p, import.meta.url));
const CATALOG = JSON.parse(readFileSync(dir('./catalog.json'), 'utf8'));
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
const CHANGED = 'This changed: the tool probe found the repository is private';

async function reopened() {
  const db = makeDb([dir('../elicit/migrations/'), dir('./migrations/')]); const now = () => T0;
  const elicit = createElicit({ db, now, config: { daily_cap: 20, max_open: 9, defer_below: 0 } });
  const wt = createWalkthrough({ db, elicit, now, config: { catalog: CATALOG } });
  await wt.submitIdea('ana', 'A page for my chess club');
  const first = await wt.current('ana');
  const id = first.card.need_id;
  const choice = first.card.buttons.find(b => !['Not sure', 'Tell me more'].includes(b));
  await wt.answer('ana', id, first.card.free_text ? { choice: 'Harbour Chess Club' } : { choice });
  assert.equal((await elicit.contradict('main', id, { evidence: 'the tool probe found the repository is private', source: 'probe' })).ok, true);
  return { db, wt, id };
}

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this._t = ''; this.hidden = false; this.style = {}; this.dataset = {}; this.attrs = {}; this.value = ''; }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map(c => c.textContent).join(' '); }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  walk(f) { f(this); for (const c of this.children) c.walk(f); }
  lines(cls) { const out = []; this.walk(e => { if (e.className === cls) out.push(e._t); }); return out; }
}
async function draw(consoleData, walk) {
  const script = CONSOLE_HTML.slice(CONSOLE_HTML.indexOf('<script>') + 8, CONSOLE_HTML.indexOf('</script>'));
  const els = {}; for (const m of CONSOLE_HTML.matchAll(/id="([a-z-]+)"/g)) els[m[1]] = new El('div');
  const nav = ['now', 'needs', 'prog', 'connect', 'help'].map(t => { const b = new El('button'); b.dataset.t = t; return b; });
  const doc = { documentElement: {}, createElement: t => new El(t), getElementById: id => els[id], querySelectorAll: sel => (sel === 'nav button' ? nav : []) };
  const routes = { '/api/console': consoleData, '/api/console/walkthrough': walk };
  const fetchFn = async url => ({ ok: true, status: 200, json: async () => routes[url] });
  new Function('document', 'window', 'fetch', 'location', 'setInterval', script)(doc, { confirm: () => true, scrollTo() {} }, fetchFn, {}, () => 0);
  for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r));
  return els;
}

test('US-16-R31: the walkthrough card of a reopened Need carries the plain line "This changed: ..." and an untouched Need carries none', async () => {
  const { wt, id } = await reopened();
  const step = await wt.current('ana');
  assert.equal(step.kind, 'ask'); assert.equal(step.card.need_id, id);
  assert.equal(step.card.changed, CHANGED);
  const next = (await wt.current('ana'));
  assert.ok(next.card.changed === CHANGED);
  const other = (await wt.askCards('ana')).filter(c => c.need_id !== id);
  assert.ok(other.length === 0 || other.every(c => c.changed === null), 'only the reopened Need says it changed');
});

test('US-16-R31: the Needs-you card built from a reopened Need keeps the line, and so does a gate card that stands for it', async () => {
  const { db, wt, id } = await reopened();
  const screens = await wt.screens('ana', await buildConsole(db, {}));
  const card = screens.needs_you.cards.find(c => c.need_id === id);
  assert.ok(card, 'the Ask is folded into Needs you');
  assert.equal(card.changed, CHANGED);
  db.raw.prepare("INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES (?,?,?,?,?)").run(`elicit-main-${id}`, 'answer needed', 'x', 'waits', `elicit_answered:main:${id}`);
  const setup = await wt.setupCards(await wt.askCards('ana'));
  assert.equal(setup.cards.find(c => c.need_id === id).changed, CHANGED);
});

test('US-16-R31: the console page draws the "This changed" line on its own line on the Needs-you card and on the walkthrough step, and nothing when there is none', async () => {
  const { db, wt, id } = await reopened();
  const consoleData = await buildConsole(db, {}); const screens = await wt.screens('ana', consoleData);
  const els = await draw({ ...consoleData, screens }, await wt.current('ana'));
  assert.deepEqual(els['s-needs'].lines('changed'), [CHANGED]);
  assert.deepEqual(els['s-start'].lines('changed'), [CHANGED]);
  const plainCard = { id: 'ask:z', kind: 'ask', need_id: 'z', what: 'Which z?', why: 'w', cue: 'c', default_in_effect: 'we use "a"', buttons: ['a', 'Not sure', 'Tell me more'], changed: null };
  const els2 = await draw({ ...consoleData, screens: { ...screens, needs_you: { cards: [plainCard], more: 0 } } }, { step: 2, of: 5, kind: 'ask', card: { need_id: 'z', question: 'Which z?', why: 'w', cue: 'c', buttons: ['a'], changed: null }, remaining: 1 });
  assert.deepEqual(els2['s-needs'].lines('changed'), []); assert.deepEqual(els2['s-start'].lines('changed'), []);
  assert.ok(id);
});
