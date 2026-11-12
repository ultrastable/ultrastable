// SYSTEM-1: the code-agent worker. Runs the adapter registry (seed/worker/src/codeagent.js) inside Cloudflare through the Workers AI binding.
// GET /agents/probe invokes every adapter once; GET /health reports the worker. Edits and PRs are made by the executor, which calls this route's adapters.
import { probe, ADAPTERS } from "../seed/worker/src/codeagent.js";
const VERSION = "1.0.0";
export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/health") return Response.json({ ok: true, worker: "ultrastable-agents", version: VERSION, adapters: ADAPTERS.map(a => a.id) });
    if (u.pathname === "/agents/probe") { const r = await probe(env); return Response.json({ version: VERSION, ...r }, { status: r.ok ? 200 : 503 }); }
    return new Response("ultrastable-agents: /health, /agents/probe", { status: 404 });
  }
};
