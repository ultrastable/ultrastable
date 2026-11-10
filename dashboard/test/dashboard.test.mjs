import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { sha256, route, tick } from "../worker.js";

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
test("login, one-tap done, undo, delegate, step-up expiry", async () => {
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
