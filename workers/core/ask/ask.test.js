// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search, answer, groundAnswer, allow, handleAsk, chatPort, tokenize } from './index.js';

const docs = [
  { id: 'wash', url: '/solutions/wash', title: 'Chlorination of household water', text: 'Chlorinating drinking water at home cut diarrhoea by 23 percent in a review of trials.' },
  { id: 'bp', url: '/solutions/bp', title: 'Hypertension treatment in barbershops', text: 'Barbers referred men to pharmacists; systolic pressure fell by 27 mm Hg.' },
  { id: 'cash', url: '/solutions/cash', title: 'Cash transfers', text: 'Unconditional cash raised household spending on food.' },
];
const index = buildIndex(docs);

test('tokenize folds accents and bigrams CJK', () => {
  assert.deepEqual(tokenize('Café, the WATER!'), ['cafe', 'water']);
  assert.deepEqual(tokenize('清洁水'), ['清洁', '洁水']);
});

test('retrieval ranks the matching page first', () => {
  assert.equal(search(index, 'how to make drinking water safe')[0].id, 'wash');
  assert.equal(search(index, 'zzzz qqqq').length, 0);
});

test('groundAnswer drops uncited sentences, bad citations and invented numbers', () => {
  const src = [{ title: 'Chlorination', text: 'cut diarrhoea by 23 percent' }];
  const g = groundAnswer('Chlorination cut diarrhoea by 23 percent [1]. It also cures malaria [1]. Costs 5 dollars [1]. Uncited claim. Bad cite [3].', src);
  assert.equal(g.text, 'Chlorination cut diarrhoea by 23 percent [1].');
  assert.equal(g.kept, 1); assert.equal(g.dropped, 4);
});

test('a generated answer is used only when it survives grounding; otherwise extractive', async () => {
  const good = await answer('does chlorinating water help?', { index, generate: async () => 'Chlorination cut diarrhoea by 23 percent [1].' });
  assert.equal(good.mode, 'generated'); assert.equal(good.sources[0].id, 'wash');
  const bad = await answer('does chlorinating water help?', { index, generate: async () => 'It cures everything.' });
  assert.equal(bad.mode, 'extractive'); assert.ok(bad.passages[0].quote.includes('23 percent'));
  const none = await answer('chlorinating water?', { index, generate: async () => 'NO_ANSWER' });
  assert.equal(none.mode, 'none');
  const unk = await answer('quantum chromodynamics', { index, generate: async () => { throw new Error('must not be called'); } });
  assert.equal(unk.mode, 'none'); assert.deepEqual(unk.sources, []);
});

test('a question in another language is translated for retrieval and answered in that language', async () => {
  const calls = [];
  const generate = async ({ system, user }) => { calls.push(system.slice(0, 9)); return system.startsWith('Translate') ? 'chlorinating drinking water' : 'La cloración redujo la diarrea en 23 percent [1].'; };
  const r = await answer('¿el agua con cloro ayuda?', { index, generate, lang: 'es' });
  assert.equal(r.mode, 'generated'); assert.equal(r.lang, 'es'); assert.equal(calls[0], 'Translate');
});

test('rate limit and daily budget', async () => {
  const m = new Map(), store = { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } };
  assert.deepEqual(await allow(store, { caller: 'a', perMinute: 2, perDay: 1, now: 0 }), { ok: true, model: true });
  assert.deepEqual(await allow(store, { caller: 'a', perMinute: 2, perDay: 1, now: 0 }), { ok: true, model: false });
  assert.equal((await allow(store, { caller: 'a', perMinute: 2, perDay: 1, now: 0 })).ok, false);
});

test('handleAsk answers JSON, refuses bad bodies and rate-limited callers', async () => {
  const r = await handleAsk(new Request('https://x/api/ask?q=chlorinating+water'), { index, generate: async () => 'Chlorination cut diarrhoea by 23 percent [1].' });
  const j = await r.json(); assert.equal(j.mode, 'generated'); assert.ok(j.notice);
  assert.equal((await handleAsk(new Request('https://x/api/ask', { method: 'POST', body: 'nope' }), { index })).status, 400);
  const m = new Map(), store = { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } };
  const lim = { index, store, limits: { perMinute: 1 } };
  await handleAsk(new Request('https://x/api/ask?q=water'), lim);
  assert.equal((await handleAsk(new Request('https://x/api/ask?q=water'), lim)).status, 429);
});

test('chatPort reads every Workers AI answer shape', async () => {
  assert.equal(await chatPort({ run: async () => ({ response: 'a' }) }, 'm')({ system: 's', user: 'u' }), 'a');
  assert.equal(await chatPort({ run: async () => ({ choices: [{ message: { content: 'b' } }] }) }, 'm')({ system: 's', user: 'u' }), 'b');
});

test('DISCOVER-1: a semantic hook finds a page the question shares no words with, and a failing hook changes nothing', async () => {
  const q = 'How do people stop getting the runs from bad wells?';
  const none = await answer(q, { index });
  assert.ok(!none.sources.some(s => s.id === 'wash'));
  const sem = await answer(q, { index, semantic: async () => [{ id: 'wash', score: 0.81 }, { id: 'bp', score: 0.2 }] });
  assert.deepEqual(sem.sources.map(s => s.id), ['wash']);
  const broken = await answer('chlorinating water', { index, semantic: async () => { throw new Error('down'); } });
  assert.equal(broken.sources[0].id, 'wash');
});
