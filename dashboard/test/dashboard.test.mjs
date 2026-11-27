import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { sha256, route, tick, digestDue, ensureSnapshots, runProbes } from "../worker.js";

function mkdb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8")); db.exec(readFileSync(new URL("../seed.sql", import.meta.url), "utf8"));
  const wrap = sql => { let a = []; const o = { bind: (...x) => { a = x; return o; },
    first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }),
    run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; } }; return o; };
  return { db, DB: { prepare: wrap } };
}
const sent = [];
const env = () => ({ ...mkdb(), OWNER_EMAIL: "o@example.com", NO_NET: 1, MAILER: async m => { sent.push(m); } });
const call = (e, path, body, cookie) => route(new Request("https://ultrastable.io" + path, { method: body ? "POST" : "GET", headers: { "x-us-ui": "1", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }), e);

async function login(e) {
  sent.length = 0; assert.equal((await call(e, "/api/owner/code", {})).status, 200);
  const code = /code is (\d{6})/.exec(sent[0].text)[1];
  const v = await call(e, "/api/owner/verify", { code }); assert.equal(v.status, 200);
  return v.headers.get("set-cookie").split(";")[0];
}
test("public page is generic and noindex", async () => {
  const r = await call(env(), "/"); const t = (await r.text()).toLowerCase();
  assert.match(r.headers.get("x-robots-tag"), /noindex/);
  for (const w of ["probe", "revert", "prediction", "trust ledger", "plussing", "work claim", "virtual manager", "self-governing"]) assert.ok(!t.includes(w), w);
});
test("owner api needs a session; wrong code is refused and counted", async () => {
  const e = env(); assert.equal((await call(e, "/api/owner/state")).status, 401);
  await call(e, "/api/owner/code", {}); assert.equal((await call(e, "/api/owner/verify", { code: "000000" })).status, 401);
});
test("POST without x-us-ui header is refused", async () => {
  const r = await route(new Request("https://ultrastable.io/api/owner/code", { method: "POST" }), env()); assert.equal(r.status, 400);
});
test("code request is rate limited to 5 per 10 minutes", async () => {
  const e = env(); let last; for (let i = 0; i < 6; i++) last = await call(e, "/api/owner/code", {}); assert.equal(last.status, 429);
});
test("US-13-R17: login, one-tap done, undo, delegate, step-up expiry", async () => {
  const e = env(); const ck = await login(e);
  const st = await (await call(e, "/api/owner/state", null, ck)).json(); assert.ok(st.owner.length >= 4);
  let r = await (await call(e, "/api/owner/run", { cmd: "done gh-22" }, ck)).json(); assert.equal(r.ok, true);
  assert.equal(e.db.prepare("SELECT state FROM tasks WHERE id='gh-22'").get().state, "done");
  r = await (await call(e, "/api/owner/run", { cmd: "undo" }, ck)).json(); assert.equal(e.db.prepare("SELECT state FROM tasks WHERE id='gh-22'").get().state, "open");
  r = await (await call(e, "/api/owner/run", { cmd: "fix gh-23" }, ck)).json(); assert.match(r.out, /queued/);
  assert.equal(e.db.prepare("SELECT COUNT(*) c FROM fleet_queue WHERE status='queued'").get().c, 1);
  r = await (await call(e, "/api/owner/run", { cmd: "delegate own-file" }, ck)).json(); assert.equal(r.ok, false); assert.match(r.out, /identity-bound/);
  e.db.exec("UPDATE sessions SET stepup_at=stepup_at-1000000"); // lapse the 15-minute step-up
  r = await (await call(e, "/api/owner/run", { cmd: "done gh-24" }, ck)).json(); assert.equal(r.needs_code, true);
  r = await (await call(e, "/api/owner/run", { cmd: "tasks owner" }, ck)).json(); assert.equal(r.ok, true); // reads need no code
  assert.ok(e.db.prepare("SELECT COUNT(*) c FROM audit").get().c >= 4);
});
test("tick emails the owner about a failing check and new owner items, once", async () => {
  const e = env(); delete e.OWNER_EMAIL; await tick(e, "*/10 * * * *"); assert.equal(sent.length, 0 + sent.length);
  const e2 = env(); sent.length = 0; e2.OWNER_EMAIL = "o@example.com"; await tick(e2, "*/10 * * * *"); const n = sent.length; assert.ok(n >= 1);
  const before=sent.map(m=>m.subject); await tick(e2, "*/10 * * * *"); assert.equal(sent.length, n, JSON.stringify([before, sent.map(m=>m.subject)]));
});
test("unknown command and empty command", async () => {
  const e = env(); const ck = await login(e);
  assert.equal((await call(e, "/api/owner/run", { cmd: "rm -rf /" }, ck)).status, 404);
  assert.equal((await call(e, "/api/owner/run", { cmd: "" }, ck)).status, 400);
});
test("fleet snapshot: token required, stored, shown to the owner, and rendered text is escaped client-side", async () => {
  const e = { ...env(), FLEET_TOKEN: "tok" };
  const post = (body, auth) => route(new Request("https://ultrastable.io/api/fleet/snapshot", { method: "POST", headers: auth ? { authorization: auth } : {}, body: typeof body === "string" ? body : JSON.stringify(body) }), e);
  assert.equal((await post({ panels: [] })).status, 401);
  assert.equal((await post("not json", "Bearer tok")).status, 400);
  assert.equal((await post({ nope: 1 }, "Bearer tok")).status, 400);
  assert.equal((await post({ panels: new Array(1).fill({ title: "x", rows: [["a", "b", "ok"]] }), generated: "2026-11-10", commit: "abc" }, "Bearer tok")).status, 200);
  const ck = await login(e);
  const st = await (await call(e, "/api/owner/state", null, ck)).json();
  assert.equal(st.snapshot.panels[0].title, "x"); assert.equal(st.snapshot.commit, "abc");
  const r = await (await call(e, "/api/owner/run", { cmd: "snapshot" }, ck)).json(); assert.equal(r.ok, true); assert.match(r.out, /a: b/);
  const page = await (await call(e, "/owner")).text(); assert.match(page, /Funding, IP, trust and bootstrap/);
  assert.equal((await post("x".repeat(200001), "Bearer tok")).status, 413);
});
test("snapshot built from the repo has the nine panels (glossary and loops included)", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("python3", ["../scripts/dashboard_snapshot.py", "--today", "2026-11-10", "--out", "/tmp/snap-test.json"], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" });
  const snap = JSON.parse(readFileSync("/tmp/snap-test.json", "utf8"));
  assert.deepEqual(snap.panels.map(p => p.id), ["funding", "ip", "trust", "cards", "bootstrap", "glossary", "loops", "unknowns", "rules"]); assert.deepEqual(snap.problems, []); assert.ok(out.includes("panels"));
});

test("analytics: holding-page views and beacon hits show on the owner dashboard; breach is emailed", async () => {
  const e = env();
  await route(new Request("https://ultrastable.io/", { headers: { "user-agent": "Mozilla/5.0", referer: "https://news.example/x" } }), e);
  await route(new Request("https://ultrastable.io/a/e", { method: "POST", headers: { "user-agent": "Mozilla/5.0" }, body: JSON.stringify({ h: "ultrastable.io", p: "/", r: "" }) }), e);
  assert.equal((await route(new Request("https://ultrastable.io/a.js"), e)).status, 200);
  const cookie = await login(e);
  const st = await (await call(e, "/api/owner/state", null, cookie)).json();
  assert.equal(st.analytics.metrics.find(m => m.name === "pageviews_7d").value, 2);
  assert.equal(st.analytics.refs[0].ref, "news.example");
  const out = await (await call(e, "/api/owner/run", { cmd: "analytics" }, cookie)).json();
  assert.match(out.out, /pageviews_7d = 2/);
  sent.length = 0; await tick(e, "*/10 * * * *");
  assert.ok(e.db.prepare("SELECT COUNT(*) c FROM hits WHERE name='selfcheck'").get().c >= 1);
});

test("CRON-GRID-1: the daily digest rides the first */10 tick of 13:00 UTC and nothing else", () => {
  assert.equal(digestDue("*/10 * * * *", new Date("2026-11-12T13:00:30Z")), true);
  assert.equal(digestDue("*/10 * * * *", new Date("2026-11-12T13:10:00Z")), false);
  assert.equal(digestDue("*/10 * * * *", new Date("2026-11-12T12:50:00Z")), false);
});

test("a D1 without the snapshots table gets it created instead of throwing 'no such table: snapshots'", async () => {
  const db = new DatabaseSync(":memory:");
  const env = { DB: { prepare: sql => { let a = []; const o = { bind: (...x) => { a = x; return o; }, run: async () => db.prepare(sql).run(...a) }; return o; } } };
  await ensureSnapshots(env);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='snapshots'").get());
});

test("MAIL-PATHS-1: a suppressed first address falls through to the backup; both failing is reported", async () => {
  const got = [];
  const e = { ...mkdb(), OWNER_EMAIL: "a@one.example", OWNER_EMAIL_BACKUP: "b@two.example", NO_NET: 1, MAILER: async m => { if (m.to === "a@one.example") throw new Error("address suppressed"); got.push(m); } };
  const r = await call(e, "/api/owner/code", {}); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(got.length, 1); assert.equal(got[0].to, "b@two.example");
  assert.ok(!JSON.stringify(j).includes("b@two.example"), "the full address is never shown");
  assert.ok(/code is \d{6}/.test(got[0].text));
  const bad = { ...mkdb(), OWNER_EMAIL: "a@one.example", OWNER_EMAIL_BACKUP: "b@two.example", NO_NET: 1, MAILER: async () => { throw new Error("suppressed"); } };
  const rb = await call(bad, "/api/owner/code", {}); const jb = await rb.json();
  assert.equal(rb.status, 502); assert.match(jb.error, /could not send your sign-in code/); assert.doesNotMatch(jb.error, /suppressed|owner address/);
});
test("MAIL-PATHS-1: one address is a failing probe, two are a passing one", async () => {
  const one = { ...mkdb(), OWNER_EMAIL: "a@one.example", NO_NET: 1, MAILER: async () => {} };
  const two = { ...mkdb(), OWNER_EMAIL: "a@one.example", OWNER_EMAIL_BACKUP: "b@two.example", NO_NET: 1, MAILER: async () => {} };
  const pick = async env => (await runProbes(env)).find(x => x.name === "owner_email_paths");
  assert.equal((await pick(one)).ok, false); assert.equal((await pick(two)).ok, true);
});

test("OWNER-DASH-2: state carries needs, tenants and paid options with costs; free default stated", async () => {
  const e = env(); const ck = await login(e);
  const s = await (await call(e, "/api/owner/state", null, ck)).json();
  assert.ok(Array.isArray(s.needs) && s.needs.every(n => n.url.startsWith("https://")));  // NO-OPEN-ITEMS-1: an empty list is the target
  assert.ok(s.tenants.some(t => t.id === "jobs" && t.status === "pending"));
  assert.ok(s.options.length > 0 && s.options.every(o => o.cost && o.default));
  assert.doesNotMatch(s.plan_note, /free tiers|stay free/);  // LIVE-PLAN-1: never a hand-written plan claim
  assert.ok(s.generated_at && s.plan && s.plan.measured_at);
});
test("OWNER-DASH-2: at the D1 free read cap the page still answers from the bundle", async () => {
  const e = env(); const ck = await login(e);
  const real = e.DB.prepare;
  e.DB.prepare = sql => /FROM tasks|FROM checks/.test(sql) ? { bind: () => ({ all: async () => { throw new Error("D1 free tier daily row read limit exceeded (7500)"); }, first: async () => { throw new Error("7500"); }, run: async () => { throw new Error("7500"); } }) } : real(sql);
  const r = await call(e, "/api/owner/state", null, ck); assert.equal(r.status, 200);
  const s = await r.json(); assert.match(s.degraded, /free allowance/); assert.ok(Array.isArray(s.needs) && s.options.length);
});

test("US-13-R18 and OWNER-DASH-3: overview needs no database or session; a dead database gives plain words, never a 500", async () => {
  const e = env(); const real = e.DB.prepare;
  e.DB.prepare = () => { throw new Error("D1 free tier daily row read limit exceeded (7500)"); };
  const o = await call(e, "/api/owner/overview"); assert.equal(o.status, 200);
  const oj = await o.json(); assert.ok(Array.isArray(oj.needs) && oj.tenants.length && oj.options.length);
  const r = await call(e, "/api/owner/state", null, "us_owner=x"); assert.equal(r.status, 200);
  const j = await r.json(); assert.match(j.degraded, /resets at 00:00 UTC|resets by itself|allowance/); assert.ok(Array.isArray(j.needs));
  assert.ok(!/7500|Error|SQL/.test(j.degraded));
  e.DB.prepare = real;
});
test("OWNER-DASH-3: a database that is down is reported by the probe and mailed without the database", async () => {
  const e = env(); sent.length = 0; e.DB.prepare = () => { throw new Error("D1 free tier daily row read limit exceeded (7500)"); };
  const res = await runProbes(e); assert.equal(res.find(x => x.name === "database").ok, false);
});

test("provenance: owner commands are recorded, visitors' suggestions stay private, the public changelog is redacted", async () => {
  const e = env(); const cookie = await login(e);
  const raw = "add a map, write to jane@example.org or +31 6 1234 5678";
  assert.equal((await call(e, "/api/suggest", { tenant: "practical-solutions", text: raw, page: "/problems/x" })).status, 200);
  assert.equal((await call(e, "/api/suggest", { tenant: "practical-solutions", text: "x" })).status, 400);
  const fleet = { ...e, FLEET_TOKEN: "t" };
  const post = (b) => route(new Request("https://ultrastable.io/api/fleet/provenance", { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(b) }), fleet);
  assert.equal((await post({ class: "loop", actor: "insight-loop", channel: "loop-run", kind: "change", summary: "raised threshold; contact ops@example.org", affected: ["doctrine/insight.json"], public: true })).status, 200);
  assert.equal((await post({ class: "robot", actor: "x", channel: "api", kind: "change", summary: "s" })).status, 400);
  const pub = await (await call(e, "/api/changelog")).json(); const txt = JSON.stringify(pub);
  assert.equal(pub.entries.length, 1); assert.equal(pub.entries[0].origin, "loop");
  for (const leak of ["jane@", "ops@", "5678", "add a map"]) assert.ok(!txt.includes(leak), leak);
  const html = await (await call(e, "/changelog")).text(); assert.ok(html.includes("An automated loop") && !html.includes("example.org"));
  assert.equal((await call(e, "/api/owner/provenance")).status, 401);
  const tl = await (await call(e, "/api/owner/provenance", undefined, cookie)).json();
  const sug = tl.entries.find(x => x.class === "end_user"); assert.ok(sug && sug.public === 0 && !sug.summary.includes("jane@") && sug.affected[0] === "/problems/x");
});

test("MAIL-RELAY-1: a native send refused for domain ownership goes out through the relay; the relay only mails owner addresses", async () => {
  const { sendMail } = await import("../worker.js");
  const realFetch = globalThis.fetch; let seen;
  globalThis.fetch = async (u, o) => { seen = { u, o }; return new Response("{}", { status: 200 }); };
  try {
    const env = { OWNER_EMAIL: "a@one.example", MAILER: async () => { throw new Error("email from ultrastable.io not allowed because domain is not owned by the same account"); }, MAIL_RELAY_URL: "https://relay.example", MAIL_RELAY_TOKEN: "t" };
    const r = await sendMail(env, "s", "t"); assert.equal(r.via, "relay"); assert.match(seen.u, /\/api\/mail\/relay$/);
  } finally { globalThis.fetch = realFetch; }
  const e = { ...mkdb(), OWNER_EMAIL: "a@one.example", MAIL_RELAY_TOKEN: "t", MAILER: async () => {} };
  const bad = await e_call(e, { to: "x@evil.example" }); assert.equal(bad.status, 403);
  const ok = await e_call(e, { to: "a@one.example" }); assert.equal(ok.status, 200);
  const noauth = await call(e, "/api/mail/relay", { to: "a@one.example" }); assert.equal(noauth.status, 401);
});
async function e_call(e, body) { return e.__h ? null : (await import("../worker.js")).default.fetch(new Request("https://d.example/api/mail/relay", { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body) }), e); }

test("OWNER-IDENTITY-1: GitHub sign-in checks org ownership, links verified emails, audits, and denies non-owners", async () => {
  const { default: w } = await import("../worker.js");
  const mk = login => {
    const e = { ...mkdb(), GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "s", GITHUB_REPO: "ultrastable/ultrastable", NO_NET: 1 };
    e.FETCH = async u => String(u).includes("access_token") ? Response.json({ access_token: "t" }) : String(u).endsWith("/user") ? Response.json({ login }) : String(u).includes("/memberships/") ? Response.json({ role: "member", state: "active" }) : Response.json([{ email: "a@mail-one.example", verified: true }, { email: "b@mail-two.example", verified: true }, { email: "x@users.noreply.github.com", verified: true }]);
    return e;
  };
  const run = async e => {
    const st = await w.fetch(new Request("https://d.example/api/owner/github"), e); assert.equal(st.status, 302);
    const state = new URL(st.headers.get("location")).searchParams.get("state");
    return w.fetch(new Request("https://d.example/api/owner/github/callback?code=c&state=" + state), e);
  };
  const ok = mk("rwnq8"); const r = await run(ok);
  assert.equal(r.status, 302); assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await ok.DB.prepare("SELECT COUNT(*) c FROM owner_links").first()).c, 2);
  assert.ok((await ok.DB.prepare("SELECT COUNT(*) c FROM owner_audit WHERE event='github_signin'").first()).c === 1);
  const bad = mk("stranger"); const r2 = await run(bad);
  assert.equal(r2.status, 401); assert.doesNotMatch(await r2.text(), /stranger|owner/i);
  const none = { ...mkdb(), NO_NET: 1, MAIL_RELAY_TOKEN: "k" }; const r3 = await w.fetch(new Request("https://d.example/api/owner/github"), none); assert.equal(r3.status, 302); assert.match(r3.headers.get("location"), /\/owner$/);
  const pg = await w.fetch(new Request("https://d.example/connect/github-signin"), none); assert.equal(pg.status, 302); assert.match(pg.headers.get("location"), /\/owner$/);  // NO-NEW-APP-1: no manifest form
  assert.equal((await none.DB.prepare("SELECT COUNT(*) c FROM owner_oauth_app").first()).c, 0);
});

test("SELF-FIX-1: a failing check is queued as a fleet task and logged, never mailed", async () => {
  const { selfFix } = await import("../worker.js");
  const e = env(); const before = sent.length;
  assert.equal(await selfFix(e, { name: "owner_links", ok: false, detail: "dead: x" }, "2026-11-17"), true);
  assert.equal(await selfFix(e, { name: "owner_links", ok: false, detail: "dead: x" }, "2026-11-17"), false);
  assert.equal(sent.length, before);
  assert.equal((await e.DB.prepare("SELECT COUNT(*) c FROM fleet_queue WHERE task_id='fix-owner_links' AND status='queued'").first()).c, 1);
  assert.equal((await e.DB.prepare("SELECT COUNT(*) c FROM provenance WHERE kind='incident'").first()).c, 1);
});

test("US-13-R18 and GATE-SETTLE-2: the owner page drops a gate whose measured dependencies are all closed, and keeps one that is still open", async () => {
  const { openNeeds } = await import("../worker.js");
  const needs = { items: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  const deps = [{ needs_you: "a", status: "closed" }, { needs_you: "b", status: "closed" }, { needs_you: "b", status: "open" }];
  assert.deepEqual(openNeeds(needs, deps).map(i => i.id), ["b", "c"]);
  assert.ok(!openNeeds().some(i => i.id === "lane-credential" || i.id === "repo-archive"), "connected credentials are never asked for again");
});

test("GATE-SETTLE-3: the Worker settles a gate on its live page, with no Actions run; an unreadable page keeps it open", async () => {
  const { settledLive } = await import("../worker.js");
  const items = [{ id: "gh", resolved_when: ["env:X", "http:https://x.test/connect/github ~ GitHub is connected"] }, { id: "b", resolved_when: "http:https://x.test/b ~ Bluesky is connected" }, { id: "c" }];
  const pages = { "https://x.test/connect/github": "<h1>GitHub is connected</h1>" };
  const f = async u => { if (u === "https://x.test/b") throw new Error("down"); return new Response(pages[u] || "", { status: pages[u] ? 200 : 404 }); };
  assert.deepEqual([...(await settledLive({}, items, f))], ["gh"]);
});

test("NO-NEW-APP-1: no owner route can register a GitHub app", async () => {
  const { default: w } = await import("../worker.js");
  const { readFileSync, readdirSync } = await import("node:fs");
  for (const f of ["../worker.js", "../ownerid.js", "../../site/passkeys.js", "../../site/connections.js"]) { const src = readFileSync(new URL(f, import.meta.url), "utf8"); assert.doesNotMatch(src, /settings\/apps\/new|app-manifests/, f); }
  const e = { ...mkdb(), NO_NET: 1, MAIL_RELAY_TOKEN: "k" };
  for (const p of ["/owner", "/connect/github-signin", "/auth/github-signin/callback?code=c&state=s", "/api/owner/github", "/api/owner/signin-options", "/owner?next=/connect/buffer/start"]) {
    const r = await w.fetch(new Request("https://ultrastable.io" + p, { redirect: "manual" }), e); const t = await r.text();
    assert.doesNotMatch(t + (r.headers.get("location") || ""), /settings\/apps\/new|manifest/i, p);
  }
});
test("SIGNIN-NEXT-2: emailed link signs in and lands on ?next, for connect start paths with query strings", async () => {
  const { safeOwnerNext } = await import("../worker.js");
  for (const n of ["/connect/buffer/start", "/connect/mastodon/start?instance=mstdn.science", "/connections"]) assert.equal(safeOwnerNext(n), n);
  for (const n of ["//evil.example", "https://evil.example", "/\\evil", "/api/owner/state", "", null, "connect/x"]) assert.equal(safeOwnerNext(n), null, String(n));
  const e = env(); sent.length = 0;
  const nx = "/connect/mastodon/start?instance=mstdn.science";
  assert.equal((await call(e, "/api/owner/code", { next: nx })).status, 200);
  const link = /(https:\/\/ultrastable\.io\/api\/owner\/magic\?[^\s]+)/.exec(sent[0].text)[1];
  const u = new URL(link); assert.equal(u.searchParams.get("next"), nx);
  const get = await route(new Request(link), e); assert.equal(get.status, 200); assert.match(await get.text(), /<form method=post/);  // a GET (mail scanner) signs nobody in
  assert.equal((await e.DB.prepare("SELECT used FROM otp ORDER BY created_at DESC LIMIT 1").first()).used, 0);
  const post = await route(new Request(link, { method: "POST" }), e); assert.equal(post.status, 303);
  assert.equal(post.headers.get("location"), nx); assert.match(post.headers.get("set-cookie"), /us_owner=/);
  assert.equal((await route(new Request(link, { method: "POST" }), e)).status, 401);  // single use
});
test("LEGACY-TASKS-1, SELF-FIX-2, DIGEST-QUIET-1: seeded tasks retire, fixed checks close, a clean day sends no digest", async () => {
  const { LEGACY_TASK, digestBody } = await import("../worker.js");
  for (const id of ["gh-26", "own-file", "own-google"]) assert.ok(LEGACY_TASK.test(id), id);
  assert.ok(!LEGACY_TASK.test("fix-owner_links"));
  assert.equal(digestBody({ checks: [{ name: "x", ok: 1 }], analytics: { metrics: [{ name: "m", hit: 0 }] } }), "");
  assert.match(digestBody({ checks: [{ name: "owner_links", ok: 0, detail: "dead" }] }), /owner_links: dead/);
});
test("LIVE-PLAN-1: the plan is read from Cloudflare, and a paid account is not offered Workers Paid", async () => {
  const { planState, optionsFor, livePanels } = await import("../worker.js");
  const ok = j => async () => Response.json({ success: true, result: j });
  const paid = await planState({ CF_ACCOUNT_ID: "a", CF_API_TOKEN: "t" }, ok([{ rate_plan: { id: "workers_paid", public_name: "Workers Paid" }, state: "Paid" }]));
  assert.equal(paid.plan, "paid"); assert.equal(paid.source, "cloudflare-subscriptions");
  assert.equal((await planState({ CF_ACCOUNT_ID: "a", CF_API_TOKEN: "t" }, ok([{ rate_plan: { id: "free" } }]))).plan, "free");
  { const rec = await planState({}, ok([])); assert.equal(rec.plan, "paid"); assert.match(rec.source, /^recorded /); }  // PLAN-FACT-1: unreadable falls back to the recorded plan, labelled
  { const lp2 = await livePanels({ NO_NET: 1 }, ok([])); assert.match(lp2.plan_note, /recorded on/); assert.ok(!lp2.options.some(o => o.id === "cf-workers-paid")); }
  assert.ok(!optionsFor("paid").some(o => o.id === "cf-workers-paid")); assert.ok(optionsFor("free").some(o => o.id === "cf-workers-paid"));
  const lp = await livePanels({ CF_ACCOUNT_ID: "a", CF_API_TOKEN: "t", NO_NET: 1 }, ok([{ rate_plan: { id: "workers_paid" } }]));
  assert.match(lp.plan_note, /Workers Paid is active/); assert.ok(lp.generated_at);
});
