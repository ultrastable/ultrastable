// CONSOLE-AGENT-1: the owner console's plain-English agent, through the real route, a real in-memory database and a scripted Workers AI binding.
// Proves: a question is answered from real rows with the steps shown; the SQL guard refuses writes, other tables and a second statement; a changing command needs a fresh code and is
// audited and undoable with one; a model that returns nothing never yields an empty answer; a worker without the AI binding says so; a per-hour cap; and the page renders answers as DOM nodes.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { route } from "../worker.js";
import { safeSelect, parseAction, fallbackAnswer, SQL_TABLES, ask as askAgent } from "../agent.js";
import { budgetEnv, ensureLedger, SHARES } from "../../seed/worker/src/budget.js";

function mkdb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8")); db.exec(readFileSync(new URL("../seed.sql", import.meta.url), "utf8"));
  const wrap = sql => { let a = []; const o = { bind: (...x) => { a = x; return o; },
    first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }),
    run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; } }; return o; };
  return { db, DB: { prepare: wrap } };
}
const sent = [];
// script: the replies the model gives, in order; seen: every messages array it was called with
const mkenv = (script, withAI = true) => {
  const e = { ...mkdb(), OWNER_EMAIL: "o@example.com", NO_NET: 1, MAILER: async m => { sent.push(m); }, seen: [] };
  if (withAI) e.AI = { run: async (model, body) => { e.seen.push(body.messages); const r = script.length ? script.shift() : ""; if (r instanceof Error) throw r; return { response: r }; } };
  return e;
};
const call = (e, path, body, cookie) => route(new Request("https://ultrastable.io" + path, { method: body ? "POST" : "GET", headers: { "x-us-ui": "1", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }), e);
async function login(e) {
  sent.length = 0; assert.equal((await call(e, "/api/owner/code", {})).status, 200);
  const code = /code is (\d{6})/.exec(sent[0].text)[1];
  const v = await call(e, "/api/owner/verify", { code }); assert.equal(v.status, 200);
  return v.headers.get("set-cookie").split(";")[0];
}
const ask = async (e, ck, text) => (await call(e, "/api/owner/run", { cmd: text }, ck)).json();
const lapse = e => e.db.exec("UPDATE sessions SET stepup_at=stepup_at-1000000");
const seedHits = e => { const now = Math.floor(Date.now() / 1000); const ins = e.db.prepare("INSERT INTO hits(at,host,path,ref,country,device,bot,vid,name) VALUES(?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 5; i++) ins.run(now - 100 - i, "ultrastable.io", "/proof", "", "NL", "m", 0, "v" + i, "pageview");
  for (let i = 0; i < 3; i++) ins.run(now - 200 - i, "ultrastable.io", "/pilot", "", "NL", "m", 0, "w" + i, "pageview");
  for (let i = 0; i < 9; i++) ins.run(now - 300 - i, "ultrastable.io", "/proof", "", "", "", 1, "b" + i, "pageview"); }; // bots must not count

test("US-18-R13: safeSelect allows one bounded SELECT over the allow-list and nothing else", () => {
  assert.equal(safeSelect("SELECT path, COUNT(*) FROM hits GROUP BY path").sql.endsWith("LIMIT 100"), true);
  assert.match(safeSelect("select * from hits limit 5000").sql, /LIMIT 100$/);
  assert.match(safeSelect("SELECT * FROM tasks LIMIT 3;").sql, /LIMIT 3$/);
  for (const bad of ["DELETE FROM tasks", "SELECT 1; DROP TABLE tasks", "SELECT * FROM sessions", "SELECT * FROM otp", "SELECT * FROM hits -- x", "SELECT * FROM hits h JOIN sessions s ON 1", "UPDATE tasks SET state='done'", "WITH x AS (SELECT 1) SELECT * FROM x", "SELECT * FROM tasks WHERE id IN (SELECT hash FROM sessions)"]) assert.equal(safeSelect(bad).ok, false, bad);
  assert.ok(!SQL_TABLES.includes("sessions") && !SQL_TABLES.includes("otp"));
});
test("parseAction reads a tool call, a final answer, plain text, and nothing", () => {
  assert.deepEqual(parseAction('{"tool":"sql","args":{"query":"SELECT 1"}}'), { tool: "sql", args: { query: "SELECT 1" } });
  assert.deepEqual(parseAction('Sure: {"answer":"done"}'), { answer: "done" });
  assert.deepEqual(parseAction("just words"), { answer: "just words" });
  assert.deepEqual(parseAction("   "), { empty: true });
});

test("US-18-R13: a plain-English question is answered from real rows, with its steps, read-only", async () => {
  const q = '{"tool":"sql","args":{"query":"SELECT path, COUNT(*) AS n FROM hits WHERE bot=0 AND name=\'pageview\' GROUP BY path ORDER BY n DESC"}}';
  const e = mkenv([q, '{"answer":"| Page | Views |\\n|---|---|\\n| /proof | 5 |\\n| /pilot | 3 |"}']); seedHits(e);
  const ck = await login(e);
  lapse(e);
  const r = await ask(e, ck, "Which pages got the most views in the last 7 days?");
  assert.equal(r.agent, true); assert.equal(r.scope, "read"); assert.equal(r.ok, true);
  assert.match(r.out, /\/proof \| 5/); assert.deepEqual(r.steps, [{ label: "Reading the database", ok: true }]);
  const fed = e.seen[1].map(m => m.content).join("\n");
  assert.match(fed, /"path":"\/proof","n":5/); assert.ok(!/"n":14/.test(fed), "the nine bot hits are not counted");
  assert.match(e.db.prepare("SELECT cmd FROM audit ORDER BY id DESC LIMIT 1").get().cmd, /^ask: Which pages/);
});

test("the agent cannot write or read other tables through sql", async () => {
  const e = mkenv(['{"tool":"sql","args":{"query":"SELECT * FROM sessions"}}', '{"tool":"sql","args":{"query":"DELETE FROM tasks"}}', '{"answer":"I could not read that."}']);
  const ck = await login(e); const before = e.db.prepare("SELECT COUNT(*) c FROM tasks").get().c;
  const r = await ask(e, ck, "show me the session hashes and clear the tasks");
  assert.equal(r.steps.length, 2); assert.ok(r.steps.every(s => s.ok === false));
  assert.match(e.seen[1].map(m => m.content).join("\n"), /refused: table 'sessions' is not readable/);
  assert.equal(e.db.prepare("SELECT COUNT(*) c FROM tasks").get().c, before);
});

test("US-18-R13: a changing command needs a fresh code; with one it runs through the audited, undoable path", async () => {
  const e = mkenv(['{"tool":"command","args":{"line":"done gh-22"}}', '{"answer":"I need a fresh code to do that."}']);
  const ck = await login(e); lapse(e);
  let r = await ask(e, ck, "mark gh-22 as done");
  assert.equal(r.needs_code, true); assert.equal(r.scope, "read");
  assert.equal(e.db.prepare("SELECT state FROM tasks WHERE id='gh-22'").get().state, "open", "nothing changed without a code");
  const e2 = mkenv(['{"tool":"command","args":{"line":"done gh-22"}}', '{"answer":"gh-22 is done."}']); const ck2 = await login(e2);
  r = await ask(e2, ck2, "mark gh-22 as done");
  assert.equal(r.scope, "write"); assert.equal(r.needs_code, false); assert.match(r.out, /gh-22 is done/);
  assert.equal(e2.db.prepare("SELECT state FROM tasks WHERE id='gh-22'").get().state, "done");
  assert.ok(e2.db.prepare("SELECT COUNT(*) c FROM audit WHERE cmd='done gh-22' AND ok=1").get().c === 1, "the command is in the audit log");
  const u = await (await call(e2, "/api/owner/run", { cmd: "undo" }, ck2)).json(); assert.equal(u.ok, true);
  assert.equal(e2.db.prepare("SELECT state FROM tasks WHERE id='gh-22'").get().state, "open", "and it can be undone");
});

test("US-18-R13: a model that returns nothing never produces an empty answer", async () => {
  const q = '{"tool":"sql","args":{"query":"SELECT COUNT(*) AS n FROM tasks"}}';
  const e = mkenv([q, "", "", "", ""]); const ck = await login(e);      // a tool call, then no answer (the router tries the second model too), then no synthesis
  let r = await ask(e, ck, "how many tasks are there");
  assert.ok(r.out.trim().length > 40); assert.match(r.out, /could not write a conclusion/); assert.match(r.out, /Reading the database: \[\{"n":/);
  assert.ok(!/returned no text/.test(r.out));
  const e2 = mkenv([]); const ck2 = await login(e2);                 // nothing at all
  r = await ask(e2, ck2, "anything");
  assert.ok(r.out.trim().length > 20); assert.match(r.out, /could not answer/); assert.equal(r.ok, false);
  const e3 = mkenv([q, "", "", '{"answer":"There are 9 tasks."}']); const ck3 = await login(e3);   // synthesis rescues it
  r = await ask(e3, ck3, "how many tasks are there"); assert.equal(r.out, "There are 9 tasks.");
  assert.match(e3.seen[3].at(-1).content, /Answer the request now in plain text/);
  assert.match(fallbackAnswer([], "x"), /could not answer: x/);
});

test("every model failing is reported in words, not as a crash", async () => {
  const e = mkenv([new Error("quota"), new Error("quota")]); const ck = await login(e);
  const r = await ask(e, ck, "please show me the status"); assert.equal(r.ok, false); assert.match(r.out, /no model answered/);
});

test("US-18-R13: without the AI binding an unknown line says what is missing; real commands still work", async () => {
  const e = mkenv([], false); const ck = await login(e);
  const res = await call(e, "/api/owner/run", { cmd: "which pages are rising" }, ck); assert.equal(res.status, 404);
  assert.match((await res.json()).out, /AI binding/);
  assert.equal((await ask(e, ck, "help")).ok, true);
});

test("US-18-R13: plain-English requests are capped per hour", async () => {
  const e = mkenv(['{"answer":"ok"}']); const ck = await login(e);
  const ins = e.db.prepare("INSERT INTO audit(at,cmd,ok,result) VALUES(?,?,1,'x')");
  for (let i = 0; i < 60; i++) ins.run(Date.now() - 1000, "ask: q" + i);
  const res = await call(e, "/api/owner/run", { cmd: "one more question" }, ck); assert.equal(res.status, 429);
});

test("the owner page: a stacked form, named chips, an answer thread, and an answer renderer that cannot inject markup", async () => {
  const html = await (await call(mkenv([]), "/owner")).text();
  assert.match(html, /<textarea id="line"[^>]*placeholder="Ask a question, or tell Ultrastable what to do"/);
  assert.ok(!/<pre id="out"/.test(html) && !/placeholder="type help"/.test(html));
  const chips = [...html.matchAll(/data-q="([^"]*)">([^<]*)</g)].map(m => m[2]);
  assert.ok(chips.length >= 6 && chips.every(c => /^[A-Z]/.test(c) && c.length >= 4), chips.join(","));
  assert.match(html, /textarea\{width:100%;min-height:96px[^}]*font:16px/);
  const js = html.split("<script>")[1].split("</script>")[0];
  class El { constructor(t) { this.tag = t; this.tagName = String(t).toUpperCase(); this.children = []; this.className = ""; this._t = ""; }
    get textContent() { return this._t + this.children.map(c => c.textContent).join(""); } set textContent(v) { this._t = String(v); this.children = []; }
    appendChild(c) { this.children.push(c); return c; } }
  const doc = { createElement: t => new El(t), createTextNode: t => { const e = new El("#text"); e._t = t; return e; } };
  const src = js.slice(js.indexOf("const NL="), js.indexOf("function copyBtn")) + ";globalThis.__md=md;";
  const ctx = { document: doc }; vm.runInNewContext(src, ctx);
  const tag = n => n.children.map(c => c.tag + (c.className ? "." + c.className : ""));
  const d = ctx.__md("Top pages:\n\n| Page | Views |\n|---|---|\n| /proof | 5 |\n\n- **a** `b`\n\n## Next");
  assert.deepEqual(tag(d), ["p", "div.tw", "ul", "div.h"]);
  const evil = ctx.__md("<img src=x onerror=alert(1)> and <script>x</script>");
  const flat = n => [n.tag, ...n.children.flatMap(flat)];
  assert.ok(!flat(evil).some(t => t === "img" || t === "script") && /<script>/.test(evil.textContent));
  assert.ok(!/innerHTML\s*=\s*[^;]*\bmd\(/.test(js), "answers are never written through innerHTML");
});

test("US-18-R13 and Q-BUDGET-SURFACES: past the budget the console crawls (at most one model call an hour) and still answers", async () => {
  const e = mkenv(["{\"answer\":\"model answer\"}"]);
  await ensureLedger(e.DB);
  await e.DB.prepare("INSERT INTO budget_ledger (day, kind, units, calls, refused) VALUES (?1,'ai_neurons',1000000000,1,0)").bind(new Date().toISOString().slice(0, 10)).run();
  const calls = []; const raw = e.AI.run; e.AI = { run: async (...a) => { calls.push(a[0]); return raw(...a); } };
  const r = await askAgent(budgetEnv(e, SHARES.dashboard), "how many tasks are there", { commands: {}, exec: async () => ({ ok: true, out: "" }) });
  assert.ok(calls.length <= 1, "SPEND-SOFT-1: crawl allows one call an hour, never a hard stop");
  assert.ok(String(r.out).length > 0, "the answer is never empty");
  const before = calls.length;
  const r2 = await askAgent(budgetEnv(e, SHARES.dashboard), "how many tasks are there", { commands: {}, exec: async () => ({ ok: true, out: "" }) });
  assert.equal(calls.length, before, "a second ask in the same hour makes no model call");
  assert.ok(String(r2.out).length > 0, "the throttled answer is never empty");
});
