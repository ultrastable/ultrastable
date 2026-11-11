import { createAgenticHandler, DEFAULT_IDENTITY } from '../src/agentic/handler.js';
import { memoryStore, staticRegistries } from '../src/agentic/adapters/memory.js';
import { bearerAuth } from '../src/agentic/adapters/bearer-auth.js';

export function rig(env = { MCP_TOKEN: 's3cret' }, spans = []) {
  const h = createAgenticHandler({
    store: memoryStore({ tick: { id: 1, steps_completed: 11, steps_total: 11 }, items: [{ id: 'A', title: 't', owner_role: 'pm', status: 'ready', priority: 1 }], gates: 2 }),
    registries: staticRegistries({ glossary: [{ term: 'plus', definition: 'protected improvement' }], loops: [{ id: 'tick', name: 'heartbeat' }] }),
    auth: bearerAuth, telemetry: { span: (n, a) => spans.push({ n, a }) }, identity: DEFAULT_IDENTITY,
  });
  const post = (body, headers = {}) => h(new Request('https://org.example/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), env);
  return { h, post, spans };
}
