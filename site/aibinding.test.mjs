// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// AI-BINDING-1: model calls through /__internal/cf use the AI binding, so a deploy token without Workers AI permission cannot 401 the executor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cfProxy } from "./deployer.js";

const req = (path, body) => new Request("https://x/__internal/cf", { method: "POST", headers: { "x-cf-method": "POST", "x-cf-path": path, "content-type": "application/json" }, body: JSON.stringify(body) });

test("ai/run goes through env.AI and never calls the API with the deploy token", async () => {
  let called = null, fetched = false;
  const env = { CF_ACCOUNT_ID: "a", CF_DEPLOY_TOKEN: "t", AI: { run: async (m, b) => { called = [m, b]; return { response: "ok" }; } } };
  const r = await cfProxy(req("ai/run/@cf/zai-org/glm-4.7-flash", { messages: [{ role: "user", content: "hi" }] }), env, async () => { fetched = true; return new Response("{}", { status: 401 }); });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.success, true);
  assert.equal(j.result.response, "ok");
  assert.equal(called[0], "@cf/zai-org/glm-4.7-flash");
  assert.equal(fetched, false);
});

test("a binding error is a 502 with a plain error code, not a silent pass", async () => {
  const env = { CF_ACCOUNT_ID: "a", CF_DEPLOY_TOKEN: "t", AI: { run: async () => { throw new Error("5028 model deprecated"); } } };
  const r = await cfProxy(req("ai/run/@cf/x/y", {}), env, async () => new Response("{}"));
  assert.equal(r.status, 502);
  const e = (await r.json()).errors[0];
  assert.equal(e.code, "ai_run_failed");
  assert.match(e.detail, /5028 model deprecated/);  // LADDER-DETAIL-1: the caller's log says why
});
