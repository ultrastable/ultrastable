// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb as d1 } from './d1shim.js';
import { DATAGRAPH_DDL as GDDL } from '../src/datagraph.js';
import { graphAiStep, readGraphAi, budget } from '../src/graphai.js';

const fakeAi = { run: async (m, inp) => inp.text ? { data: inp.text.map(() => [0.1, 0.2]) } : inp.messages[1].content.startsWith('Text') ? { response: '[{"dst":"Q-ONE-1","rel":"blocks"}]' } : { response: 'Records about deploys.' } };

test('graph AI embeds new nodes, proposes extracted edges, summarizes communities and records cost', async () => {
  const db = d1();
  for (const s of GDDL) await db.prepare(s).run();
  const t = '2026-11-25T00:00:00Z';
  await db.prepare(`INSERT INTO kg_nodes (id, kind, label, first_seen, changed_at) VALUES ('items:Q-TWO-2','items','Q-TWO-2 waits on Q-ONE-1',?,?),('items:Q-ONE-1','items','first',?,?)`).bind(t, t, t, t).run();
  await db.prepare(`INSERT INTO kg_insights (id, kind, subject, text, state, first_seen, last_seen) VALUES ('c1','community','c:1','deploy items',?,?,?)`).bind('open', t, t).run();
  const r = await graphAiStep({ db, ai: fakeAi, now: Date.parse('2026-11-25T01:00:00Z') });
  assert.equal(r.embedded, 2); assert.equal(r.proposed, 1); assert.equal(r.summarized, 1);
  const again = await graphAiStep({ db, ai: fakeAi, now: Date.parse('2026-11-25T02:00:00Z') });
  assert.equal(again.embedded, 0, 'cursor: only new rows');
  const v = await readGraphAi(db, Date.parse('2026-11-25T03:00:00Z'));
  assert.ok(v.cost_today.neurons > 0); assert.equal(v.embedded, 2);
});

test('throttle shrinks batches but never to zero; no binding skips', async () => {
  assert.equal(budget({ embed_max: 64, extract_max: 8, summarize_max: 4 }, { knobs: { pace: 100 } }).embed, 1);
  assert.equal((await graphAiStep({ db: d1(), ai: null })).skipped, 'no AI binding');
});
