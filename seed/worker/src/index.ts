export interface Env {
  DB: D1Database;
  AI: any;
}

export default {
  async scheduled(_event: any, env: Env, ctx: any) {
    ctx.waitUntil(tick(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/__deploy/probe") {
      // Live probe: verify AI binding is wired on the deployed worker.
      try {
        const res = await env.AI.run("@cf/meta-llama/llama-3-8b-instruct", {
          messages: [{ role: "user", content: "probe" }],
          max_tokens: 8,
        });
        const ok = res && typeof res === "object";
        return new Response(JSON.stringify({ probe: ok ? "ok" : "degraded" }), {
          status: ok ? 200 : 503,
          headers: { "content-type": "application/json" },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ probe: "fail", error: String(e) }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response("ultrastable-tick\n");
  },
};

async function tick(env: Env) {
  await env.DB.prepare("SELECT 1").run();
}
