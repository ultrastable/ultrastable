import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADAPTERS, runCodeAgent, probe, parseJson } from '../src/codeagent.js';
import { runExecutor, PROVIDERS } from '../src/executor.js';

const ai = (fail = []) => ({ calls: [], async run(model, body) { this.calls.push(model); if (fail.some(f => model.includes(f))) throw new Error('model down'); return { response: '```json\n{"summary":"ok","files":[{"path":"a.txt","content":"x"}]}\n```' }; } });

test('adapters mirror doctrine/code-agents.json (model ids and families)', () => {
  const d = JSON.parse(readFileSync(new URL('../../../doctrine/code-agents.json', import.meta.url), 'utf8'));
  for (const a of ADAPTERS) { const m = d.adapters.find(x => x.id === a.id); assert.ok(m, a.id); assert.equal(m.model, a.model); assert.equal(m.family, a.family); }
});
test('routes cheapest first and returns files', async () => {
  const env = { AI: ai() }; const r = await runCodeAgent(env, 'p');
  assert.equal(r.adapter, 'workers-ai-glm'); assert.equal(r.files[0].path, 'a.txt'); assert.equal(env.AI.calls.length, 1);
});
test('falls back to the next adapter and records the failure', async () => {
  const env = { AI: ai(['glm']) }; const r = await runCodeAgent(env, 'p');
  assert.equal(r.adapter, 'workers-ai-llama'); assert.equal(r.tried[0].adapter, 'workers-ai-glm');
});
test('all adapters failing throws with the record', async () => {
  await assert.rejects(runCodeAgent({ AI: ai(['@cf']) }, 'p'), /no code agent produced a change/);
});
test('probe invokes every adapter; missing binding is reported', async () => {
  const env = { AI: ai() }; const r = await probe(env); assert.equal(r.adapters.length, ADAPTERS.length); assert.ok(r.ok);
  assert.equal((await probe({})).ok, false);
});
test('executor provider workers-ai-agent runs and does not stop later providers', async () => {
  const res = await runExecutor({ AI: ai() }, { providers: PROVIDERS });
  const r = res.find(x => x.provider === 'workers-ai-agent'); assert.ok(r.ok); assert.match(r.detail, /workers-ai-glm/);
});
test('parseJson rejects prose', () => assert.throws(() => parseJson('nothing')));
