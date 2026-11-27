// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The served console page script, run in a fake DOM (no browser, no dependencies): the page draws the walkthrough, Ask cards,
// the read-back step and the profile-composed screens, asks for confirmation only before a change, and never leaves its own origin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSOLE_HTML } from '../src/console-ui.js';

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this._t = ''; this.hidden = false; this.style = {}; this.dataset = {}; this.attrs = {}; this.value = ''; }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map(c => c.textContent).join(' '); }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  walk(f) { f(this); for (const c of this.children) c.walk(f); }
  buttons() { const out = []; this.walk(e => { if (e.tag === 'button') out.push(e); }); return out; }
  button(label) { return this.buttons().find(b => b._t === label); }
}

function boot(routes, { confirm = () => true } = {}) {
  const script = CONSOLE_HTML.slice(CONSOLE_HTML.indexOf('<script>') + 8, CONSOLE_HTML.indexOf('</script>'));
  const els = {};
  for (const m of CONSOLE_HTML.matchAll(/id="([a-z-]+)"/g)) els[m[1]] = new El('div');
  const nav = ['now', 'needs', 'prog', 'connect', 'help'].map(t => { const b = new El('button'); b.dataset.t = t; return b; });
  const doc = { documentElement: {}, createElement: t => new El(t), getElementById: id => els[id], querySelectorAll: sel => (sel === 'nav button' ? nav : []) };
  const calls = []; const state = { confirms: 0, scrolled: 0, href: null };
  const win = { confirm: () => { state.confirms++; return confirm(); }, scrollTo: () => { state.scrolled++; } };
  const fetchFn = async (url, init = {}) => {
    const method = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const h = routes[`${method} ${url}`];
    const r = typeof h === 'function' ? h(body) : h || { status: 404, json: { error: 'not found' } };
    return { ok: r.status === undefined ? true : r.status < 400, status: r.status || 200, json: async () => r.json };
  };
  const loc = { set href(v) { state.href = v; } };
  new Function('document', 'window', 'fetch', 'location', 'setInterval', script)(doc, win, fetchFn, loc, () => 0);
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
  return { els, nav, doc, calls, state, flush, text: id => els[id].textContent };
}

const base = (extra = {}) => ({
  org: 'x', headline: 'Running well. 1 thing needs you.', ok: true, last_check: '2026-11-15 12:00:01',
  now: { open: 2, done: 1, blocked: 1, working_on: [{ id: 'A', title: 'Build the booking page', owner: 'the planning manager' }], working_on_more: 2, stuck: [{ id: 'C', title: 'Needs a thing', blocker: 'waiting on a work item' }], stuck_more: 0 },
  needs_you: { cards: [{ id: 'G1', what: 'Approve a monthly spend', default_in_effect: 'spend stays at zero', kind: 'manual' }], more: 0 },
  progress: { done_lately: [{ title: 'Old thing', updated_at: '2026-11-14' }], done_lately_more: 0, predictions: { hit: 1, scored: 2 }, autonomy: [{ what: 'merging a reviewed change', level: 'acts after a second check' }], autonomy_more: 0 },
  suggestions: ['What do you need from me?', 'What is stuck?'], connections: [], help: [], ...extra,
});
const ASK = { id: 'ask:colour', kind: 'ask', need_id: 'colour', what: 'Which colour?', why: 'It changes the look.', cue: 'Most pick the first.', default_in_effect: 'we use "first"; one page changes', buttons: ['first', 'second', 'Not sure', 'Tell me more'], free_text: false };
const WT_IDEA = { step: 1, of: 5, kind: 'idea', question: 'What do you want to exist, and for whom?', example: 'For example: a page for my chess club.', free_text: true, suggestions: ['A page for my club', 'A tracker I check every day'] };

test('US-18-R02 and US-18-R11: the page opens on the step the server reports and every step of the first screen is completable by pressing buttons', async () => {
  const sent = [];
  const routes = {
    'GET /api/console': { json: base() },
    'GET /api/console/walkthrough': () => ({ json: WT_IDEA }),
    'POST /api/console/walkthrough/idea': b => { sent.push(b); return { json: { ok: true } }; },
  };
  const ui = boot(routes); await ui.flush();
  const start = ui.els['s-start'];
  assert.equal(start.hidden, false); assert.match(start.textContent, /step 1 of 5/); assert.match(start.textContent, /What do you want to exist, and for whom\?/);
  assert.ok(start.button('A page for my club') && start.button('A tracker I check every day'));
  start.button('A page for my club').onclick(); await ui.flush();
  assert.equal(ui.state.confirms, 1);
  assert.deepEqual(sent, [{ text: 'A page for my club', confirm: true }]);
});

test('US-18-R11 and US-18-R02: an Ask step shows every option, Not sure and Tell me more as buttons; Tell me more asks for no confirmation; an answer does', async () => {
  const sent = [];
  const card = { need_id: 'colour', question: 'Which colour?', why: 'It changes the look.', cue: 'Most pick the first.', default: 'first', default_consequence: 'One page changes.', buttons: ['first', 'second', 'Not sure', 'Tell me more'], free_text: false };
  const routes = {
    'GET /api/console': { json: base() },
    'GET /api/console/walkthrough': { json: { step: 2, of: 5, kind: 'ask', card, remaining: 4, setup: { cards: [{ id: 's', what: 'Add your model key' }], more: 0 } } },
    'POST /api/console/walkthrough/answer': b => { sent.push(b); return b.choice === 'Tell me more' ? { json: { ok: true, explain: 'It changes the look. For example: Most pick the first.' } } : { json: { ok: true } }; },
  };
  const ui = boot(routes); await ui.flush();
  const start = ui.els['s-start'];
  assert.deepEqual(start.buttons().map(b => b._t), ['first', 'second', 'Not sure', 'Tell me more']);
  assert.match(start.textContent, /If you do nothing: we use "first"/); assert.match(start.textContent, /And 3 more questions after this one/); assert.match(start.textContent, /Only you can do: Add your model key/);
  start.button('Tell me more').onclick(); await ui.flush();
  assert.equal(ui.state.confirms, 0, 'Tell me more changes nothing, so it asks nothing');
  assert.match(ui.text('say'), /For example: Most pick the first/);
  start.button('Not sure').onclick(); await ui.flush();
  assert.equal(ui.state.confirms, 1);
  assert.deepEqual(sent.map(b => b.choice), ['Tell me more', 'Not sure']); assert.ok(sent.every(b => b.need_id === 'colour'));
});

test('US-18-R07: an Ask card in Needs you states what happens if the person does nothing and carries its options, not I did it or Use the default', async () => {
  const screens = base({ needs_you: { cards: [ASK, { id: 'G1', what: 'Approve a monthly spend', default_in_effect: 'spend stays at zero', kind: 'manual' }], more: 0 } });
  const routes = { 'GET /api/console': { json: base({ screens }) }, 'GET /api/console/walkthrough': { status: 404, json: { error: 'not found' } } };
  const ui = boot(routes); await ui.flush();
  assert.equal(ui.els['s-start'].hidden, true, 'no walkthrough route: the page still renders the screens');
  const needs = ui.els['s-needs'];
  assert.match(needs.textContent, /Which colour\?/); assert.match(needs.textContent, /If you do nothing: we use "first"/);
  const askCard = needs.children.find(c => c.textContent.includes('Which colour?'));
  assert.deepEqual(askCard.buttons().map(b => b._t), ['first', 'second', 'Not sure', 'Tell me more']);
  const manual = needs.children.find(c => c.textContent.includes('Approve a monthly spend'));
  assert.deepEqual(manual.buttons().map(b => b._t), ['I did it', 'Use the default', 'What does this mean?']);
});

test('US-18-R12: the final step lists what runs and what does not yet and can be dismissed; the read-back step offers Read it and This is right', async () => {
  const sent = [];
  let wt = { step: 4, of: 5, kind: 'readback', readback: { defaults: 2, statements: [] }, later: 1, setup: { cards: [], more: 0 } };
  const routes = { 'GET /api/console': { json: base() }, 'GET /api/console/walkthrough': () => ({ json: wt }), 'POST /api/console/readback': b => { sent.push(b); wt = { step: 5, of: 5, kind: 'done', works: { runs: ['The regular check runs.'], not_yet: ['There is no live page yet.'] }, later: 2, setup: { cards: [], more: 0 } }; return { json: { ok: true, message: 'Thank you. That is what we will build.' } }; } };
  const ui = boot(routes); await ui.flush();
  const start = ui.els['s-start'];
  assert.match(start.textContent, /2 of these were assumed for you/);
  start.button('Read it').onclick(); assert.equal(ui.state.href, '/console/readback');
  start.button('This is right').onclick(); await ui.flush();
  assert.deepEqual(sent, [{ confirm_readback: true, confirm: true }]);
  assert.match(start.textContent, /step 5 of 5/); assert.match(start.textContent, /The regular check runs\./); assert.match(start.textContent, /Not yet: There is no live page yet\./); assert.match(start.textContent, /2 smaller questions are left for later/);
  start.button('Got it').onclick();
  assert.equal(start.hidden, true);
});

test('US-18-R05: every cut list says how many are left; the composed numbers and the autonomy list use the person\'s words', async () => {
  const screens = base({ now: { ...base().now, numbers: [{ metric: 'waiting_on_you', value: 3 }, { metric: 'done', value: 1 }] } });
  const ui = boot({ 'GET /api/console': { json: base({ screens }) }, 'GET /api/console/walkthrough': { status: 404, json: {} } }); await ui.flush();
  const now = ui.els['s-now'].textContent;
  assert.match(now, /3 Waiting on you/); assert.match(now, /And 2 more\./); assert.match(now, /the planning manager/);
  assert.match(ui.els['s-prog'].textContent, /merging a reviewed change/); assert.match(ui.els['s-prog'].textContent, /Level: acts after a second check/);
  assert.ok(!/portfolio-manager|branch_commit_push|delegated/.test(ui.els['s-now'].textContent + ui.els['s-prog'].textContent));
});

test('US-18-R04 and US-18-R03: a suggestion is answered from the records and switches to the screen that shows it; typed words are sent whole', async () => {
  const asked = [];
  const routes = { 'GET /api/console': { json: base() }, 'GET /api/console/walkthrough': { status: 404, json: {} },
    'POST /api/console/ask': b => { asked.push(b); return { json: { answered: true, answer: 'Stuck: Needs a thing.', screen: 'now' } }; } };
  const ui = boot(routes); await ui.flush();
  const chips = ui.els.chips.buttons(); assert.deepEqual(chips.map(b => b._t), ['What do you need from me?', 'What is stuck?']);
  chips[1].onclick(); await ui.flush();
  assert.equal(ui.state.confirms, 0, 'a question changes nothing, so it asks nothing');
  assert.match(ui.text('say'), /Stuck: Needs a thing/); assert.equal(asked[0].text, 'What is stuck?');
  assert.equal(ui.els['s-now'].hidden, false);
  ui.els.asktext.value = 'Please add a map  of the grounds'; ui.els.askform.onsubmit({ preventDefault() {} }); await ui.flush();
  assert.equal(asked[1].text, 'Please add a map  of the grounds'); assert.equal(ui.state.confirms, 1);
});

test('US-18-R09: an explain press asks no confirmation, a change does; a card with an owner link offers one button for it and an unsafe link is not drawn', async () => {
  const sent = [];
  const cards = [{ id: 'G1', what: 'Approve a spend', default_in_effect: 'stays at zero', kind: 'manual' }, { id: 'G2', what: 'Add the key', default_in_effect: 'dry run', kind: 'secret', link: '/owner/model' }, { id: 'G3', what: 'Odd card', default_in_effect: 'waits', kind: 'manual', link: 'javascript:alert(1)' }];
  const routes = { 'GET /api/console': { json: base({ needs_you: { cards, more: 0 } }) }, 'GET /api/console/walkthrough': { status: 404, json: {} }, 'POST /api/console/card': b => { sent.push(b); return { json: b.choice === 'explain' ? { explain: 'Plain words.' } : { ok: true } }; } };
  const ui = boot(routes); await ui.flush();
  const g1 = ui.els['s-needs'].children.find(c => c.textContent.includes('Approve a spend'));
  g1.button('What does this mean?').onclick(); await ui.flush();
  assert.equal(ui.state.confirms, 0); assert.match(ui.text('say'), /Plain words/);
  g1.button('I did it').onclick(); await ui.flush();
  assert.equal(ui.state.confirms, 1); assert.deepEqual(sent.map(b => b.choice), ['explain', 'done']);
  const g2 = ui.els['s-needs'].children.find(c => c.textContent.includes('Add the key'));
  g2.button('Do it').onclick(); assert.equal(ui.state.href, '/owner/model');
  const g3 = ui.els['s-needs'].children.find(c => c.textContent.includes('Odd card'));
  assert.equal(g3.button('Do it'), undefined);
});

test('US-18-R10: the page script only ever requests paths on its own origin', async () => {
  const routes = { 'GET /api/console': { json: base({ screens: base({ needs_you: { cards: [ASK], more: 0 } }) }) }, 'GET /api/console/walkthrough': { json: WT_IDEA }, 'POST /api/console/walkthrough/idea': { json: { ok: true } }, 'POST /api/console/ask': { json: { message: 'ok' } } };
  const ui = boot(routes); await ui.flush();
  ui.els['s-start'].button('A page for my club').onclick(); ui.els.chips.buttons()[0].onclick(); await ui.flush();
  assert.ok(ui.calls.length >= 4);
  for (const c of ui.calls) assert.ok(/^\/(?!\/)/.test(c.url), c.url);
});

test('US-18-R18 and US-18 section 6 language: the page uses the language table of the person\'s screens, English where a string is missing, and sets the page direction', async () => {
  const messages = { 'tab.now': 'Agora', 'tab.needs': 'Precisa de você', 'h.needs': 'Precisa de você', 'b.did': 'Eu fiz', 't.donothing': 'Se você não fizer nada: ' };
  const screens = base({ i18n: { lang: 'pt-BR', dir: 'ltr', messages }, needs_you: { cards: [{ id: 'G1', what: 'Approve a spend', default_in_effect: 'stays at zero', kind: 'manual' }], more: 0 } });
  const ui = boot({ 'GET /api/console': { json: base({ screens }) }, 'GET /api/console/walkthrough': { status: 404, json: {} } }); await ui.flush();
  assert.equal(ui.nav[0].textContent, 'Agora'); assert.equal(ui.nav[1].textContent, 'Precisa de você'); assert.equal(ui.nav[2].textContent, '', 'a tab with no string keeps the page\'s own text');
  const needs = ui.els['s-needs'];
  assert.match(needs.textContent, /Precisa de você/); assert.match(needs.textContent, /Se você não fizer nada: stays at zero/);
  const card = needs.children.find(c => c.textContent.includes('Approve a spend'));
  assert.deepEqual(card.buttons().map(b => b._t), ['Eu fiz', 'Use the default', 'What does this mean?'], 'untranslated buttons stay English; none is removed');
  assert.equal(ui.doc.documentElement.dir, 'ltr'); assert.equal(ui.doc.documentElement.lang, 'pt-BR');
});

test('US-18-R17: Help is drawn from the help sections of the console data beside the three screens', async () => {
  const help = [{ title: 'Adding a model key', text: 'First paragraph.' + String.fromCharCode(10, 10) + 'Second paragraph.' }];
  const ui = boot({ 'GET /api/console': { json: base({ help }) }, 'GET /api/console/walkthrough': { status: 404, json: {} } }); await ui.flush();
  assert.match(ui.els['s-help'].textContent, /Adding a model key/); assert.match(ui.els['s-help'].textContent, /Second paragraph\./);
  assert.deepEqual(ui.nav.map(b => b.dataset.t), ['now', 'needs', 'prog', 'connect', 'help']);
});
