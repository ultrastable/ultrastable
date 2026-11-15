// WEBHOOKS-1: outbound CloudEvents + Standard Webhooks signing, retries, change detection, inbound verification (Standard Webhooks and GitHub), replay and bad-signature cases.
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL, fileURLToPath } from "node:url";
const W = await import(pathToFileURL(fileURLToPath(new URL("./webhooks.js", import.meta.url))).href);
const { authIntegration } = await import(pathToFileURL(fileURLToPath(new URL("./controlplane.js", import.meta.url))).href);

function d1(db) {
  return { prepare(sql) { let args = []; const st = { bind(...a) { args = a; return st; },
    all: async () => ({ results: db.prepare(sql).all(...args) }), first: async () => db.prepare(sql).get(...args) || null,
    run: async () => { const r = db.prepare(sql).run(...args); return { changes: Number(r.changes), meta: { changes: Number(r.changes) } }; } }; return st; } };
}
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'work', project TEXT, owner_role TEXT NOT NULL, trigger_on TEXT, done_check TEXT NOT NULL, closing_probe TEXT, priority INTEGER NOT NULL DEFAULT 50, status TEXT NOT NULL DEFAULT 'open', surface TEXT, disposition TEXT, blocker TEXT);");
db.exec("INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('OLD1','existing','staff','x','open');");
const ORG = d1(db);
const tokenHash = createHash("sha256").update("s3cret").digest("hex");
const ENV = { ORG, INTEGRATION_TOKENS: "companion:" + tokenHash };
const NOW = new Date("2026-11-14T12:00:00Z");
const call = async (method, path, body, { auth = "Bearer s3cret", env = ENV, headers = {}, raw } = {}) => {
  const r = await W.webhooksRoute(new Request("https://ultrastable.io" + path, { method, headers: { ...(auth ? { authorization: auth } : {}), ...headers }, body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined }), env, null, authIntegration, NOW);
  return r ? { status: r.status, body: await r.json() } : null;
};

// URL policy
for (const bad of ["http://example.com/h", "https://" + [10, 0, 0, 1].join(".") + "/h", "https://" + ["local", "host"].join("") + "/h", "https://user:pw@example.com/h", "https://intranet/h", "https://svc.internal/h", "https://example.com:8443/h", "nope"]) assert.ok(W.validCallback(bad), "rejects " + bad);
assert.equal(W.validCallback("https://hooks.example.com/ultrastable"), null);
assert.equal(await W.webhooksRoute(new Request("https://ultrastable.io/api/v1/status"), ENV, null, authIntegration), null, "other routes are not claimed");

// register: auth, validation, one-time secret
assert.equal((await call("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/u" }, { auth: null })).status, 401);
assert.equal((await call("POST", "/api/v1/webhooks", { url: "http://hooks.example.com/u" })).status, 422);
assert.equal((await call("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/u", events: ["nope"] })).status, 422);
assert.equal((await call("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/u" }, { env: { ORG } })).status, 503, "no token configured fails closed");
let r = await call("POST", "/api/v1/webhooks", { url: "https://hooks.example.com/u", events: ["item.created", "item.status_changed", "connector.expired"] });
assert.equal(r.status, 201); assert.match(r.body.secret, /^whsec_/); assert.equal(r.body.secret_shown_once, true);
const sub = r.body, secret = Buffer.from(sub.secret.slice(6), "base64");
r = await call("GET", "/api/v1/webhooks"); assert.equal(r.body.subscriptions.length, 1); assert.ok(!JSON.stringify(r.body).includes("whsec_"), "the list never shows a secret");
assert.equal((await call("GET", "/api/v1/webhooks", null, { auth: "Bearer wrong" })).status, 403);

// change detection: baseline is silent, then new and changed items announce themselves
let sent = [];
const okFetch = async (url, init) => { sent.push({ url, init }); return { status: 200 }; };
let t = await W.tickWebhooks(ENV, NOW, okFetch);
assert.equal(t.items, 0); assert.equal(sent.length, 0, "existing items are not announced on first run");
db.exec("INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('NEW1','fresh','staff','x','open');");
db.exec("UPDATE items SET status='done' WHERE id='OLD1';");
t = await W.tickWebhooks(ENV, new Date(NOW.getTime() + 1000), okFetch);
assert.equal(t.items, 2); assert.equal(t.delivered, 2); assert.equal(sent.length, 2);
const types = sent.map(s => JSON.parse(s.init.body).type).sort(); assert.deepEqual(types, ["io.ultrastable.item.created", "io.ultrastable.item.status_changed"]);
t = await W.tickWebhooks(ENV, new Date(NOW.getTime() + 2000), okFetch); assert.equal(t.items, 0, "no repeat announcements");

// the delivery is CloudEvents 1.0 and verifies two ways: our verifier and an independent HMAC
const d0 = sent[0], body0 = d0.init.body, h = new Headers(d0.init.headers), ce = JSON.parse(body0);
assert.equal(ce.specversion, "1.0"); assert.equal(ce.source, "https://ultrastable.io"); assert.equal(h.get("content-type"), "application/cloudevents+json");
const want = "v1," + createHmac("sha256", secret).update(`${h.get("webhook-id")}.${h.get("webhook-timestamp")}.${body0}`).digest("base64");
assert.equal(h.get("webhook-signature"), want, "signature matches the Standard Webhooks construction");
assert.equal(h.get("webhook-id"), ce.id);
assert.equal((await W.verifyStandard(h, body0, secret, Number(h.get("webhook-timestamp")))).ok, true);

// connector expiry is announced once
db.exec("CREATE TABLE credentials (tenant TEXT, provider TEXT, status TEXT, expires_at TEXT, last_error TEXT);");
db.exec("INSERT INTO credentials VALUES ('default','google','ok',NULL,NULL);");
sent = []; await W.tickWebhooks(ENV, new Date(NOW.getTime() + 3000), okFetch); assert.equal(sent.length, 0);
db.exec("UPDATE credentials SET status='expired', last_error='invalid_grant' WHERE provider='google';");
await W.tickWebhooks(ENV, new Date(NOW.getTime() + 4000), okFetch);
assert.equal(sent.length, 1); const cx = JSON.parse(sent[0].init.body); assert.equal(cx.type, "io.ultrastable.connector.expired"); assert.equal(cx.data.reconnect, "https://ultrastable.io/connect/google");
await W.tickWebhooks(ENV, new Date(NOW.getTime() + 5000), okFetch); assert.equal(sent.length, 1, "expiry announced once");

// retry with backoff, then failure; 410 disables
db.exec("DELETE FROM webhook_deliveries; DELETE FROM webhook_events;");
await W.emit(ENV, "item.created", "X", { id: "X" }, NOW);
const fail = async () => ({ status: 500 });
let at = NOW;
for (let i = 0; i < W.BACKOFF_S.length; i++) {
  const o = await W.deliver(ENV, at, fail); assert.equal(o.retried, 1, "attempt " + (i + 1) + " is retried");
  const row = db.prepare("SELECT attempts, next_at, status FROM webhook_deliveries").get();
  assert.equal(row.status, "pending"); assert.equal(Date.parse(row.next_at) - at.getTime(), W.BACKOFF_S[i] * 1000);
  assert.equal((await W.deliver(ENV, new Date(at.getTime() + 1000), fail)).due, 0, "not retried before it is due");
  at = new Date(row.next_at);
}
assert.equal((await W.deliver(ENV, at, fail)).failed, 1); assert.equal(db.prepare("SELECT status FROM webhook_deliveries").get().status, "failed");
r = await call("GET", `/api/v1/webhooks/${sub.id}/deliveries`); assert.equal(r.body.deliveries[0].status, "failed");
await W.emit(ENV, "item.created", "Y", { id: "Y" }, NOW);
assert.equal((await W.deliver(ENV, NOW, async () => ({ status: 410 }))).failed, 1);
assert.equal(db.prepare("SELECT active FROM webhook_subscriptions WHERE id = ?").get(sub.id).active, 0, "410 Gone disables the subscription");

// rotate re-enables with a new secret; delete stops
r = await call("POST", `/api/v1/webhooks/${sub.id}/rotate`); assert.equal(r.status, 200); assert.notEqual(r.body.secret, sub.secret);
assert.equal(db.prepare("SELECT active FROM webhook_subscriptions WHERE id = ?").get(sub.id).active, 1);
assert.equal((await call("DELETE", `/api/v1/webhooks/${sub.id}`)).body.active, false);
assert.equal((await call("GET", "/api/v1/webhooks/wh_0000000000000000/deliveries")).status, 404);

// inbound: Standard Webhooks
r = await call("POST", "/api/v1/hooks", { provider: "acme", kind: "standard" }); assert.equal(r.status, 201); assert.equal(r.body.url, "https://ultrastable.io/hooks/acme");
const isec = Buffer.from(r.body.secret.slice(6), "base64");
const signed = (id, ts, body) => ({ "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v1," + createHmac("sha256", isec).update(`${id}.${ts}.${body}`).digest("base64") });
const nowS = Math.floor(NOW.getTime() / 1000), pl = JSON.stringify({ title: "Customer asks for SSO", detail: "from acme", kind: "request" });
assert.equal((await call("POST", "/hooks/acme", null, { auth: null, raw: pl })).status, 401, "unsigned is refused");
assert.equal((await call("POST", "/hooks/acme", null, { auth: null, raw: pl, headers: { ...signed("m1", nowS, pl), "webhook-signature": "v1,AAAA" } })).status, 401, "bad signature");
assert.equal((await call("POST", "/hooks/acme", null, { auth: null, raw: pl, headers: signed("m1", nowS - 3600, pl) })).status, 401, "stale timestamp is refused");
assert.equal((await call("POST", "/hooks/acme", null, { auth: null, raw: pl + " ", headers: signed("m1", nowS, pl) })).status, 401, "tampered body");
assert.equal((await call("POST", "/hooks/nobody", null, { auth: null, raw: pl })).status, 404);
r = await call("POST", "/hooks/acme", null, { auth: null, raw: pl, headers: signed("m1", nowS, pl) }); assert.equal(r.status, 201);
const it = db.prepare("SELECT * FROM items WHERE id = ?").get(r.body.id); assert.equal(it.surface, "provider:acme agent:acme harness:webhook"); assert.equal(it.kind, "intake-request"); assert.equal(it.owner_role, "product-manager");
r = await call("POST", "/hooks/acme", null, { auth: null, raw: pl, headers: signed("m1", nowS, pl) }); assert.equal(r.body.duplicate, true, "replayed message id files nothing");
assert.equal(db.prepare("SELECT COUNT(*) n FROM items WHERE surface LIKE 'provider:acme%'").get().n, 1);
assert.equal((await call("POST", "/api/v1/hooks", { provider: "acme" })).status, 201, "same owner may re-register");

// inbound: GitHub
r = await call("POST", "/api/v1/hooks", { provider: "github", kind: "github" }); const gsec = Buffer.from(r.body.secret.slice(6), "base64");
const gh = (id, ev, obj) => { const b = JSON.stringify(obj); return { raw: b, auth: null, headers: { "x-github-event": ev, "x-github-delivery": id, "x-hub-signature-256": "sha256=" + createHmac("sha256", gsec).update(b).digest("hex") } }; };
assert.equal((await call("POST", "/hooks/github", null, gh("d0", "ping", { zen: "x" }))).body.pong, true);
r = await call("POST", "/hooks/github", null, gh("d1", "issues", { action: "opened", issue: { title: "Crash on save", html_url: "https://github.com/a/b/issues/1" }, repository: { full_name: "a/b" } }));
assert.equal(r.status, 201); assert.match(db.prepare("SELECT title FROM items WHERE id = ?").get(r.body.id).title, /a\/b: issues opened - Crash on save/);
assert.equal((await call("POST", "/hooks/github", null, gh("d1", "issues", { action: "opened", issue: { title: "Crash on save" }, repository: { full_name: "a/b" } }))).body.duplicate, true, "same delivery id is deduplicated");
assert.equal((await call("POST", "/hooks/github", null, gh("d2", "star", { action: "created" }))).status, 202, "uninteresting events are acknowledged and ignored");
const bad = gh("d3", "issues", { action: "opened" }); bad.headers["x-hub-signature-256"] = "sha256=00";
assert.equal((await call("POST", "/hooks/github", null, bad)).status, 401);
assert.equal((await call("POST", "/api/v1/hooks", { provider: "github" }, { auth: "Bearer other" })).status, 403);
console.log("webhooks ok");
