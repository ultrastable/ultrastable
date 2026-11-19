// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// ACCOUNT-SPLIT-2: the old account's site forwards to the primary account's site and never to itself.
import assert from "node:assert/strict";
import mod, { forwardTo } from "./worker.js";
const seen = [];
globalThis.fetch = async (req) => { seen.push({ url: req.url, host: req.headers.get("x-forwarded-host"), method: req.method }); return new Response("upstream", { status: 200 }); };
const r = await mod.fetch(new Request("https://ultrastable.io/ops?x=1"), { UPSTREAM_ORIGIN: "https://ultrastable-site.ultrastable.workers.dev" }, {});
assert.equal(await r.text(), "upstream");
assert.deepEqual(seen[0], { url: "https://ultrastable-site.ultrastable.workers.dev/ops?x=1", host: "ultrastable.io", method: "GET" });
assert.equal(forwardTo(new Request("https://ultrastable-site.ultrastable.workers.dev/ops"), "https://ultrastable-site.ultrastable.workers.dev"), null, "never forwards to itself");
let ran = false; await mod.scheduled({}, { UPSTREAM_ORIGIN: "https://x" }, { waitUntil: () => { ran = true; } });
assert.equal(ran, false, "a forwarding site runs no cron");
console.log("forward ok");

// OWNER-ROUTE-1: /connect/github-signin must reach OWNER, not TICK.
{ const mod2 = await import("./worker.js"); const hit = [];
  const env = { OWNER: { fetch: async () => { hit.push("owner"); return new Response("ok"); } }, TICK: { fetch: async () => { hit.push("tick"); return new Response("ultrastable seed worker"); } } };
  for (const p of ["/connect/github-signin", "/owner", "/auth/github-signin/callback", "/changelog"]) await mod2.default.fetch(new Request("https://ultrastable.io" + p), env, {});
  if (hit.join() !== "owner,owner,owner,owner") throw new Error("owner paths misrouted: " + hit.join()); console.log("owner routing ok"); }

// FREE-TIER-1: a GitHub delivery the tick does not act on is answered at the first hop and never forwarded
{
  const { hookEventFilter } = await import("./worker.js");
  const hook = (ev, path = "/hook/github") => new Request("https://ultrastable.io" + path, { method: "POST", headers: ev ? { "x-github-event": ev } : {}, body: "{}" });
  for (const ev of ["workflow_run", "check_run", "workflow_job", "status", ""]) { const r = hookEventFilter(hook(ev)); assert.equal(r && r.status, 202, ev + " is answered here"); }
  for (const ev of ["push", "pull_request", "issues", "issue_comment", "release", "ping"]) assert.equal(hookEventFilter(hook(ev)), null, ev + " is forwarded");
  assert.equal(hookEventFilter(hook("workflow_run", "/hook/host")), null, "only the GitHub hook is filtered");
  let forwarded = 0; const orig = globalThis.fetch; globalThis.fetch = async () => { forwarded++; return new Response("x"); };
  try { const r = await mod.fetch(hook("workflow_run"), { UPSTREAM_ORIGIN: "https://up.example" }, { waitUntil() {} }); assert.equal(r.status, 202); assert.equal(forwarded, 0, "no forward, no second Worker request"); } finally { globalThis.fetch = orig; }
  console.log("hook filter ok");
}
