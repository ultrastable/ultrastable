// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ASK-1 and CONNECT-2: the owner dashboard asks before it acts (only where the answer changes the plan), scores its own questions, and shows connections.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { route, askStats, connectorsPanel } from "../worker.js";
import { clarify, resolve, score, standing, QUESTIONS, MAX_QUESTIONS, SETTLED, PRUNE_AFTER } from "../askbar.js";

function mkdb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8")); db.exec(readFileSync(new URL("../seed.sql", import.meta.url), "utf8"));
  const wrap = sql => { let a = []; const o = { bind: (...x) => { a = x; return o; },
    first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }),
    run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; } }; return o; };
  return { db, DB: { prepare: wrap } };
}
const sent = [];
const env = extra => ({ ...mkdb(), OWNER_EMAIL: "o@example.com", NO_NET: 1, MAILER: async m => { sent.push(m); }, ...(extra || {}) });
const call = (e, path, body, cookie) => route(new Request("https://ultrastable.io" + path, { method: body ? "POST" : "GET", headers: { "x-us-ui": "1", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }), e);
async function login(e) {
  sent.length = 0; assert.equal((await call(e, "/api/owner/code", {})).status, 200);
  const code = /code is (\d{6})/.exec(sent[0].text)[1];
  return (await call(e, "/api/owner/verify", { code })).headers.get("set-cookie").split(";")[0];
}
const ctx = { commands: ["status", "help", "tasks"], tenants: ["ps", "Practical Solutions"], stats: {} };

test("a direction whose answer would change the plan gets a question; a question or a command gets none", () => {
  assert.deepEqual(clarify("stop the outreach lane", ctx).questions.map(q => q.id), ["pause-or-remove", "one-or-all"]);
  assert.deepEqual(clarify("Which pages got the most views in the last 7 days?", ctx).questions, []);
  assert.deepEqual(clarify("status", ctx).questions, []);
  assert.deepEqual(clarify("pause the outreach lane for now on Practical Solutions", ctx).questions, [], "the direction already answers both questions");
  assert.deepEqual(clarify("outreach", ctx).questions.map(q => q.id), ["show-or-change"]);
});

test("never more than three questions, each an either/or; the rest take their default and say so", () => {
  for (const q of QUESTIONS) assert.equal(q.options.length, 2, q.id), assert.ok(q.options.includes(q.default), q.id);
  const c = clarify("build a thing and remove the old one", ctx);
  assert.ok(c.questions.length <= MAX_QUESTIONS);
  const all = clarify("build a thing and remove the old one", { ...ctx });
  assert.equal(all.questions.length + all.assumed.length, QUESTIONS.filter(q => q.when("build a thing and remove the old one", ctx)).length, "nothing is dropped silently");
});

test("resolve waits for every answer, then says what it understood and refines the line; a non-default answer is a changed plan", () => {
  const p = resolve("stop the outreach lane", { "pause-or-remove": "Pause" }, ctx);
  assert.deepEqual(p.pending.map(q => q.id), ["one-or-all"]);
  const r = resolve("stop the outreach lane", { "pause-or-remove": "Remove", "one-or-all": "Only Ultrastable" }, ctx);
  assert.match(r.line, /^stop the outreach lane\. Remove it for good\. Apply it to Ultrastable itself only\.$/);
  assert.match(r.understood, /You said: stop the outreach lane\./);
  assert.deepEqual(r.log.map(l => [l.qid, l.answer, l.changed]), [["pause-or-remove", "Remove", 1], ["one-or-all", "Only Ultrastable", 0]]);
  assert.equal(resolve("stop the outreach lane", { "pause-or-remove": "Maybe", "one-or-all": "Every system" }, ctx).pending.length, 1, "an answer that is not one of the options is not an answer");
});

test("a question the record can already answer is not asked; a question whose answer never changed the plan is pruned", () => {
  const q = QUESTIONS.find(x => x.id === "pause-or-remove");
  const settled = { "pause-or-remove": { asked: SETTLED, changed: SETTLED, recent: Array(SETTLED).fill("Remove") } };
  assert.deepEqual(standing(q, settled), { answer: "Remove", source: "record" });
  const c = clarify("stop the outreach lane", { ...ctx, stats: settled });
  assert.deepEqual(c.questions.map(x => x.id), ["one-or-all"]); assert.equal(c.assumed[0].answer, "Remove");
  assert.match(resolve("stop the outreach lane", { "one-or-all": "Only Ultrastable" }, { ...ctx, stats: settled }).understood, /Assumed Remove .* because your last answers to this agreed\./);
  const mixed = { "one-or-all": { asked: PRUNE_AFTER, changed: 0, recent: ["Only Ultrastable", "Only Ultrastable"] } };
  assert.deepEqual(standing(QUESTIONS.find(x => x.id === "one-or-all"), mixed), { answer: "Only Ultrastable", source: "pruned" });
  assert.equal(standing(q, { "pause-or-remove": { asked: 2, changed: 1, recent: ["Pause", "Remove"] } }), null, "answers that disagree keep the question");
  assert.equal(score(mixed).find(x => x.id === "one-or-all").state, "pruned");
});

test("POST /api/owner/ask: questions first with nothing recorded, then the answers are logged and the refined line runs through the audited command path", async () => {
  const e = env(), c = await login(e);
  assert.equal((await call(e, "/api/owner/ask", { direction: "stop the outreach lane" })).status, 401, "needs a session");
  const first = await (await call(e, "/api/owner/ask", { direction: "stop the outreach lane" }, c)).json();
  assert.equal(first.ask, true); assert.deepEqual(first.questions.map(q => q.id), ["pause-or-remove", "one-or-all"]); assert.match(first.understood, /You said: stop the outreach lane/);
  assert.equal(e.db.prepare("SELECT COUNT(*) n FROM ask_log").get().n, 0, "asking records nothing");
  assert.equal(e.db.prepare("SELECT COUNT(*) n FROM audit").get().n, 0, "and runs nothing");
  const done = await (await call(e, "/api/owner/ask", { direction: "stop the outreach lane", answers: { "pause-or-remove": "Remove", "one-or-all": "Only Ultrastable" } }, c)).json();
  assert.equal(done.ask, undefined); assert.match(done.line, /Remove it for good/); assert.match(done.understood, /Remove \(Pause it so it can be resumed/);
  assert.deepEqual(e.db.prepare("SELECT qid, answer, changed FROM ask_log ORDER BY id").all().map(r => [r.qid, r.answer, r.changed]), [["pause-or-remove", "Remove", 1], ["one-or-all", "Only Ultrastable", 0]]);
  const st = await askStats(e); assert.equal(st["pause-or-remove"].asked, 1); assert.equal(st["pause-or-remove"].changed, 1);
  const sc = await (await call(e, "/api/owner/ask/score", null, c)).json(); assert.equal(sc.questions.find(q => q.id === "pause-or-remove").changed_share, 1);
});

test("POST /api/owner/ask: a registered command and a plain question go straight through with no question", async () => {
  const e = env(), c = await login(e);
  const r = await (await call(e, "/api/owner/ask", { direction: "status" }, c)).json();
  assert.equal(r.ask, undefined); assert.equal(r.ok, true); assert.equal(r.understood, undefined);
  assert.equal(e.db.prepare("SELECT cmd FROM audit ORDER BY id DESC LIMIT 1").get().cmd, "status");
  assert.equal(e.db.prepare("SELECT COUNT(*) n FROM ask_log").get().n, 0);
});

test("the owner page renders the pill ask bar and the connections panel", async () => {
  const t = await (await call(env(), "/owner")).text();
  assert.match(t, /<form id="cmd" class="us-ask" role="search">/); assert.match(t, /\.us-ask\{[^}]*border-radius:28px/); assert.match(t, /id="mic"/);
  assert.match(t, /\/api\/owner\/ask/); assert.match(t, /<h2>Connections<\/h2>/); assert.match(t, /\/api\/owner\/connectors/);
});

test("connections panel: reads /auth/connectors from the tick Worker, passes no secret material on, links each unlinked service, and degrades in plain words", async () => {
  const seen = [];
  const TICK = { fetch: async req => { seen.push(new URL(req.url).pathname); return Response.json({ linked: [{ provider: "github-app", status: "ok", expires_at: 1, last_error: null, meta: "secret-ish" }, { provider: "oauth:google", status: "ok", last_error: "invalid_grant: token abc" }],
    available: [{ id: "github", title: "GitHub", type: "github-app", connect: "/connect/github", ready: true, linked: true }, { id: "mastodon", title: "Mastodon", type: "oauth", ready: true, linked: false }, { id: "google", title: "Google", type: "oauth", ready: false, linked: false, needs: "oauth-apps" }] }); } };
  const p = await connectorsPanel({ TICK }, "https://ultrastable.io");
  assert.deepEqual(seen, ["/auth/connectors"]);
  // the statuses are the ones the seed's credential store writes (ok, pending, failed: seed/worker/src/auth/store.js)
  assert.deepEqual(p.linked, [{ provider: "github-app", status: "ok", expires_at: 1, reconnect: false }, { provider: "oauth:google", status: "ok", expires_at: null, reconnect: true }]);
  assert.ok(!JSON.stringify(p).includes("invalid_grant") && !JSON.stringify(p).includes("secret-ish"), "raw backend text and metadata stay on the server");
  assert.equal(p.available.find(a => a.id === "mastodon").connect, "https://ultrastable.io/connect/mastodon");
  const down = await connectorsPanel({ TICK: { fetch: async () => new Response("x", { status: 503 }) } }, "https://ultrastable.io");
  assert.match(down.error, /not reachable right now/); assert.deepEqual(down.linked, []);
  const e = env({ TICK }), c = await login(e);
  assert.equal((await call(e, "/api/owner/connectors")).status, 401);
  assert.equal((await (await call(e, "/api/owner/connectors", null, c)).json()).linked.length, 2);
});
