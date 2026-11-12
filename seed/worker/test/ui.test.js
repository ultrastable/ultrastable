import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { QUESTIONS, nextQuestion, saveAnswer, loadAnswers, progress } from '../src/interview.js';
import { readFileSync } from 'node:fs';
import { questionScreen, needsScreen } from '../src/ui.js';

test('every question renders as clickable choices or a text box, with hints', async () => {
  for (const q of QUESTIONS) {
    const t = await questionScreen(q, {}).text();
    assert.match(t, /hint|mut/); assert.ok(t.includes(q.id));
    if (q.kind === 'choice') assert.match(t, /<button name="value"/);
    if (q.kind === 'text') assert.match(t, /<textarea/);
  }
});

test('answers persist, validate, and drive progress to complete', async () => {
  const db = makeDb(); db.raw.exec(readFileSync(new URL('../migrations/0003_interview.sql', import.meta.url), 'utf8'));
  await assert.rejects(saveAnswer(db, 'audience', 'bogus'));
  await assert.rejects(saveAnswer(db, 'nope', 'x'));
  const full = { idea: 'x', audience: 'me', stakeholders: ['owner'], success: 's', kind: 'web', data_held: ['none'], budget: '0', deadline: 'week', method: 'agile', must_not: ['spend'], risks: 'r', review_rhythm: 'daily', done: 'd' };
  for (const q of QUESTIONS) await saveAnswer(db, q.id, full[q.id]);
  const a = await loadAnswers(db);
  assert.equal(nextQuestion(a), null);
  assert.ok(Object.values(progress(a)).every(v => v === 1));
});

test('needs-you screen shows gate cards and the next question', async () => {
  const t = await needsScreen({ cards: [{ what: 'Mint token', why_gated: 'only you can', default_in_effect: 'paused' }], answers: {} }).text();
  assert.match(t, /Mint token/); assert.match(t, /href="\/start"/);
});

test('escapes user text', async () => {
  const t = await needsScreen({ cards: [{ what: '<script>x</script>', why_gated: '', default_in_effect: '' }], answers: {} }).text();
  assert.ok(!t.includes('<script>x'));
});
