// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../_shared/testdb.js';
import { MIGRATIONS_DIR as KERNEL_DIR, registerProgram } from '../kernel/index.js';
import { MIGRATIONS_DIR, registerPersona, createToolLayer, originate, createResearchAgent } from './index.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const GOOD = 'TITLE: Add a today summary\nWHY: usage is flat\ncode-task: site/home.js\ncode-anchor: // SUMMARY\nEDIT: render the summary';
const FILES = { 'site/home.js': 'x\n// SUMMARY\ny', 'site/twice.js': '// A\n// A\n' };
const readFile = async (p) => { if (!(p in FILES)) throw new Error('no such file'); return FILES[p]; };
async function setup(complete, o = {}) {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR]);
  await registerProgram(db, { id: 'OPS', name: 'ops' });
  await registerPersona(db, { id: 'pgm-ops', role: 'program-manager', program_id: 'OPS', scope: 's', instruction_source: 'f.md', authority: ['originate'], charter: 'keep the site running', now: NOW });
  const calls = [];
  const agent = createResearchAgent({ complete: async (r) => { calls.push(r); return complete(calls.length, r); }, readFile, ...o });
  const tools = createToolLayer({ db, now: () => NOW, ports: { research: agent, readFile } });
  return { db, tools, calls };
}
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

test('US-02-R19, US-02-R08: a research agent reply with the five fields files one roadmap item for the program', async () => {
  const { db, tools, calls } = await setup(async () => ({ text: GOOD }));
  const r = await originate(tools, 'pgm-ops', { tickId: 3 });
  assert.equal(r.filed, 'ROADMAP-OPS-20261110');
  assert.equal(calls.length, 1); assert.deepEqual([calls[0].role, calls[0].kind], ['manager', 'research']);
  assert.match(calls[0].messages[1].content, /Charter: keep the site running/); assert.match(calls[0].messages[1].content, /TITLE, WHY, code-task, code-anchor, EDIT/);
  assert.equal(one(db, `SELECT doer FROM kernel_item_meta WHERE item_id = ?`, r.filed).doer, 'code-task:site/home.js');
});

test('US-02-R19, US-02-R10: a reply naming a control-plane file, missing a field or with an anchor that occurs twice is refused by origination, with a record', async () => {
  for (const [bad, why] of [[GOOD.replace('site/home.js', 'autonomy/policy.json'), /control-plane/], [GOOD.replace('code-anchor: // SUMMARY\n', ''), /lacks: code-anchor/], [GOOD.replace('site/home.js', 'site/twice.js').replace('// SUMMARY', '// A'), /occurs 2 time/]]) {
    const { db, tools } = await setup(async () => bad, { maxRetries: 0 });
    const r = await originate(tools, 'pgm-ops', { tickId: 3 });
    assert.match(r.refused, why);
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'ROADMAP-%'`).n, 0);
    assert.match(one(db, `SELECT reason FROM staff_originations`).reason, why);
  }
});

test('US-02-R19: one retry carries the refusal back to the model and a corrected reply is filed', async () => {
  const { db, tools, calls } = await setup(async (n) => (n === 1 ? GOOD.replace('code-anchor: // SUMMARY\n', '') : GOOD));
  const r = await originate(tools, 'pgm-ops', { tickId: 3 });
  assert.equal(r.filed, 'ROADMAP-OPS-20261110'); assert.equal(calls.length, 2);
  assert.match(calls[1].messages[1].content, /Your last answer was refused: the answer lacks: code-anchor/);
  const wrongFile = await setup(async (n) => (n === 1 ? GOOD.replace('site/home.js', 'site/twice.js').replace('// SUMMARY', '// A') : GOOD));
  assert.equal((await originate(wrongFile.tools, 'pgm-ops', { tickId: 3 })).filed, 'ROADMAP-OPS-20261110');
  assert.match(wrongFile.calls[1].messages[1].content, /Candidate file site\/twice.js begins/);              // the head of the file the model chose is shown on the retry
});

test('US-02-R19: a model failure is recorded as a refused origination and the tick does not error', async () => {
  const { db, tools } = await setup(async () => { throw new Error('model unavailable'); });
  const r = await originate(tools, 'pgm-ops', { tickId: 3 });
  assert.match(r.refused, /research agent failed: model unavailable/);
  assert.match(one(db, `SELECT reason FROM staff_originations`).reason, /model unavailable/);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'ROADMAP-%'`).n, 0);
  assert.throws(() => createResearchAgent({}), /complete port/);
  const { tools: t2 } = await setup(async () => ({ nope: 1 }));
  assert.match((await originate(t2, 'pgm-ops')).refused, /returned no text/);
});
