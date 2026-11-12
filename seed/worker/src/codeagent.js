// CODE-AGENTS-1 (worker side): the code agent that runs inside Cloudflare through the Workers AI binding (env.AI). The adapter list mirrors
// doctrine/code-agents.json (checked by tests/foundation/test_agents.py and test/codeagent.test.js). Cheapest known price first, unknown after.
// Returns {summary, files:[{path, content}]} for the executor to apply under its path guard. Nothing here touches GitHub: the PR step is the executor's.
export const ADAPTERS = [
  { id: 'workers-ai-glm', model: '@cf/zai-org/glm-5.3-flash', family: 'glm', price: 0.65, extra: { reasoning_effort: 'low', max_tokens: 8000 } },
  { id: 'workers-ai-llama', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', family: 'llama', price: 2.546, extra: { max_tokens: 3000 } },
  { id: 'workers-ai-qwen-coder', model: '@cf/qwen/qwen2.5-coder-32b-instruct', family: 'qwen', price: 1e6, extra: { max_tokens: 7000 } },
];

const text = r => (r && (r.response || (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content))) || '';

export async function invoke(env, adapter, prompt) {
  const r = await env.AI.run(adapter.model, { messages: [{ role: 'user', content: prompt }], ...adapter.extra });
  return text(r);
}

export function parseJson(t) {
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('no JSON in model answer');
  return JSON.parse(t.slice(s, e + 1));
}

// Authors in routed order; a failure moves to the next adapter and is recorded in `tried`.
export async function runCodeAgent(env, prompt, adapters = ADAPTERS) {
  const tried = [];
  for (const a of [...adapters].sort((x, y) => x.price - y.price)) {
    try { return { ...parseJson(await invoke(env, a, prompt)), adapter: a.id, tried }; }
    catch (e) { tried.push({ adapter: a.id, error: String(e && e.message).slice(0, 120) }); }
  }
  throw new Error('no code agent produced a change: ' + JSON.stringify(tried));
}

// Live probe: one tiny call per adapter through the binding. Used by GET /agents/probe and by the deploy workflow's verify step.
export async function probe(env, adapters = ADAPTERS) {
  if (!env.AI) return { ok: false, detail: 'AI binding missing', adapters: [] };
  const out = [];
  for (const a of adapters) {
    try { const t = await invoke(env, { ...a, extra: { ...a.extra, max_tokens: 64 } }, 'Reply with the single word: pong'); out.push({ adapter: a.id, ok: t.trim().length > 0, answer: t.trim().slice(0, 24) }); }
    catch (e) { out.push({ adapter: a.id, ok: false, error: String(e && e.message).slice(0, 100) }); }
  }
  return { ok: out.some(x => x.ok), adapters: out };
}
