// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// LAUNCH-PATH-1: the visitor stories, run against the real site handler and the real launcher with only the outside world faked.
// The visitor here has a browser and nothing else: no agent, no terminal, no GitHub account, no key.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import site from "./worker.js";
import { internalDeploy } from "./deployer.js";
import * as L from "../deploy/launch-apps.mjs";
import { hostKey as siteHostKey } from "./deployer.js";
import { makeDb } from "../seed/worker/test/d1shim.js";
import { newKey } from "../seed/worker/src/auth/seal.js";
import * as store from "../seed/worker/src/auth/store.js";
import { getToken } from "../seed/worker/src/auth/index.js";
import { handleAppHost, hostKey } from "../seed/worker/src/apprepos.js";

const IDEA = "A living atlas of what works in public policy: every programme graded by its trials and re-graded as evidence lands.";
const PAGE = "<!doctype html><html lang=\"en\"><head><title>Atlas</title></head><body><h1>Policy atlas</h1><p>Graded programmes.</p></body></html>";
const cfg = JSON.parse(readFileSync(new URL("../doctrine/tenant-repos.json", import.meta.url), "utf8")).visitor_apps;
const base = JSON.parse(readFileSync(new URL("../" + cfg.base_manifest, import.meta.url), "utf8"));
const toPem = (der) => "-----BEGIN " + "PRIVATE KEY-----\n" + Buffer.from(der).toString("base64").match(/.{1,64}/g).join("\n") + "\n-----END " + "PRIVATE KEY-----";
const PEM = toPem(new Uint8Array(await crypto.subtle.exportKey("pkcs8", (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])).privateKey)));
// The site worker, the tick Worker's repository routes and the launcher are the real code. Only GitHub, the model and the Cloudflare deploy are faked.
async function world({ admin = true, covers = true } = {}) {
  const m = new Map(), KEY = "k".repeat(40), far = Date.now() + 3600e3;
  const ASSETS = { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); }, list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }) };
  const repos = new Map(), invited = [], deployed = [], github = { admin, covers };
  const ghFetch = async (url, init = {}) => {
    const u = new URL(url), tok = (init.headers.authorization || "").slice(7), body = init.body ? JSON.parse(init.body) : null, method = init.method || "GET", R = (status, json) => new Response(JSON.stringify(json || {}), { status });
    let x;
    if (/access_tokens$/.test(u.pathname)) return R(201, { token: "scoped:" + body.repositories.join(","), expires_at: new Date(far).toISOString() });
    if ((x = /^\/repos\/[^/]+\/[^/]+\/generate$/.exec(u.pathname))) { if (tok !== "admin-token") return R(403); repos.set(body.owner + "/" + body.name, new Map([["README.md", "seed"]])); return R(201); }
    if ((x = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(u.pathname))) { const r = repos.get(x[1]); if (!r || tok !== "code-token" || !github.covers) return R(404); if (method === "GET") return r.has(x[2]) ? R(200, { sha: "s", content: Buffer.from(r.get(x[2])).toString("base64") }) : R(404); r.set(x[2], Buffer.from(body.content, "base64").toString()); return R(201); }
    if ((x = /^\/repos\/([^/]+\/[^/]+)\/collaborators\/(.+)$/.exec(u.pathname))) { invited.push([x[1], x[2]]); return R(201); }
    if ((x = /^\/repos\/([^/]+\/[^/]+)$/.exec(u.pathname))) return repos.has(x[1]) ? R(200) : R(404);
    return R(500, { message: "unexpected " + u.pathname });
  };
  const tickEnv = { CREDENTIAL_KEY: newKey(), INTERNAL_DEPLOY_KEY: KEY, DB: makeDb() };
  await store.ensureSchema(tickEnv.DB);
  await store.put(tickEnv.DB, tickEnv, "t", "github-app", { secret: { pem: PEM }, meta: { app_id: 1, installation_id: 11 }, access: "code-token", expiresAt: far });
  if (admin) await store.put(tickEnv.DB, tickEnv, "t", "github-admin", { secret: { pem: PEM }, meta: { app_id: 2, installation_id: 22 }, access: "admin-token", expiresAt: far });
  const TICK = { fetch: (req) => handleAppHost(req, tickEnv, { tenant: "t", fetch: ghFetch }) };
  const env = { ASSETS, AI: { run: async () => ({ response: PAGE }) }, INTERNAL_DEPLOY_KEY: KEY, TICK };
  const call = (path, init) => site.fetch(new Request("https://ultrastable.io" + path, init), env, { waitUntil() {} });
  const internal = async (body) => (await internalDeploy(new Request("https://ultrastable.io/__internal/launches", { method: "POST", headers: { "x-internal-key": KEY }, body: JSON.stringify(body) }), env)).json();
  const deploySeed = async (list, dry) => list.map((x) => { deployed.push({ slug: x.slug, dry, ai: x.ai, host_repo: x.host_repo }); return { live_ok: true, modules: 40, url: "https://ultrastable-seed-" + x.slug + ".ultrastable.workers.dev" }; });
  const pass = () => L.run({ site: internal, deploySeed, cfg, base, log() {} });
  return { m, env, tickEnv, ghFetch, github, call, internal, repos, invited, deployed, pass, KEY };
}
const form = (o) => { const f = new FormData(); for (const k in o) f.set(k, o[k]); return f; };
async function submit(w, idea) {
  const r = await w.call("/api/idea", { method: "POST", body: form({ idea, profile: "{}" }), headers: { accept: "application/json" } });
  assert.equal(r.status, 200); const { id } = await r.json(), cookie = r.headers.get("set-cookie").split(";")[0];
  for (let i = 0; i < 5; i++) if ((await (await w.call("/s/" + id + "/status")).json()).state === "ready") break;
  assert.equal((await (await w.call("/s/" + id + "/status")).json()).state, "ready", "the page builds from one form post and waiting");
  return { id, cookie };
}

// BREADTH-1: the owner's own widened wording of a second suggestion, typed as he typed it (slashes and all), and both probe ideas.
test("story: a second, wider idea in the owner's raw words launches the same way", async () => {
  const raw = "An encyclopedic replication ledger for many/multiple domains/fields: which landmark findings held up and which failed, updated as replications publish.";
  const w = await world(), { id } = await submit(w, raw); await w.pass();
  const l = await (await w.call("/s/" + id + "/launch")).json();
  assert.equal(l.state, "repo"); assert.match(l.repo, /^ultrastable\/app-[a-z0-9-]+-[a-f0-9]{10}$/); assert.ok(l.repo.length <= 60, "a long idea still gets a short repository name");
  assert.ok(w.repos.get(l.repo).get("IDEA.md").includes(raw), "IDEA.md keeps the words exactly");
  assert.equal(L.PROBE_IDEAS.length, 2); assert.notEqual(L.probeIdea(0), L.probeIdea(864e5), "the daily walk takes the ideas in turn");
  for (const p of L.PROBE_IDEAS) assert.ok(p.startsWith("[launch-path probe] "));
});
// FULLSTACK-1: every launched app ends as a public front end, a live back end and a repository; the run goes red when one is still missing after two days.
test("story: a launched app has all three parts, and one stuck without a repository is flagged once it is overdue", async () => {
  const w = await world(), { id } = await submit(w, IDEA), out = await w.pass(), r = out.find((x) => x.id === id);
  assert.deepEqual(r.stack, { frontend: true, backend: true, repo: true }); assert.deepEqual(r.missing, []); assert.equal(r.overdue, false);
  const cfg = { full_stack_hours: 48 }, stuck = { at: "2026-11-01T00:00:00Z", built: true, system: "https://x", state: "waiting" };
  assert.deepEqual(L.stackOf(stuck, cfg, Date.parse("2026-11-01T12:00:00Z")).overdue, false, "inside two days it is still being worked on");
  const late = L.stackOf(stuck, cfg, Date.parse("2026-11-04T00:00:00Z"));
  assert.deepEqual(late.missing, ["repo"]); assert.equal(late.overdue, true);
  assert.equal(L.stackOf({ ...stuck, synthetic: true }, cfg, Date.parse("2026-11-04T00:00:00Z")).overdue, false, "a test idea is never deployed, so it is never overdue");
});
test("story: a person types the atlas idea and gets a live, managed app with its own repository, doing nothing else", async () => {
  const w = await world(), { id } = await submit(w, IDEA);
  assert.equal((await w.call("/s/" + id)).status, 200, "the app is live straight away");
  let l = await (await w.call("/s/" + id + "/launch")).json();
  assert.equal(l.state, "queued"); assert.equal(l.manual_steps, 0); assert.ok(!("brief" in l) && !("key" in l), "the public record carries no idea text and no key");
  const out = await w.pass();
  assert.equal(w.deployed.length, 1); assert.deepEqual({ slug: w.deployed[0].slug, dry: w.deployed[0].dry, ai: w.deployed[0].ai }, { slug: "app-" + id, dry: false, ai: true }, "its own system is deployed with the account's models, no key from anyone");
  l = await (await w.call("/s/" + id + "/launch")).json();
  assert.equal(l.state, "repo"); assert.match(l.repo, /^ultrastable\/app-living-atlas-works-[a-f0-9]{10}$/); assert.match(l.system, /^https:\/\/ultrastable-seed-app-/);
  const idea = w.repos.get(l.repo).get("IDEA.md");
  assert.ok(idea.includes(IDEA) && /- Loop: .+\n- Measure: .+\n- Upkeep: .+\n- Run cost: 5 USD/.test(idea), "IDEA.md carries the words and a complete system test, so the seed's own bootstrap admits it");
  assert.equal(out[0].visitor_steps, 0);
  await w.pass(); assert.equal(w.deployed.length, 1, "a second pass deploys nothing twice");
});

test("story: they steer it in plain words; the page changes now and the request lands in the repository", async () => {
  const w = await world(), { id } = await submit(w, IDEA); await w.pass();
  const r = await w.call("/api/change", { method: "POST", body: form({ id, change: "Add a filter by country" }), headers: { accept: "application/json" } });
  assert.equal(r.status, 200);
  await w.pass();
  const l = await (await w.call("/s/" + id + "/launch")).json(); assert.equal(l.changes, 1); assert.equal(l.changes_filed, 1);
  const item = JSON.parse(w.repos.get(l.repo).get("docs/issues/STEER-1.json"));
  assert.ok(item.body.includes("Add a filter by country") && item.labels.includes("agent-ready"));
  assert.ok((await (await w.call("/s/" + id + "/own")).text()).includes("Add a filter by country"), "they see what they asked for when they come back");
});

test("story: they come back later and take it over; only the browser that made it can", async () => {
  const w = await world(), { id, cookie } = await submit(w, IDEA);
  const page = await (await w.call("/s/" + id + "/own", { headers: { cookie } })).text();
  assert.ok(page.includes("Invite me") && !/terminal|api key|token|install |command line/i.test(page), "the page asks for a GitHub name at most, and only if they want the repository");
  assert.equal((await w.call("/s/" + id + "/own", { method: "POST", body: form({ github: "mallory" }) })).status, 403, "a stranger with the link cannot claim it");
  assert.equal((await w.call("/s/" + id + "/own", { method: "POST", body: form({ github: "not a name!" }), headers: { cookie } })).status, 400);
  assert.equal((await w.call("/s/" + id + "/own", { method: "POST", body: form({ github: "ada-l" }), headers: { cookie } })).status, 303);
  await w.pass();
  const l = await (await w.call("/s/" + id + "/launch")).json();
  assert.equal(l.state, "handed-over"); assert.deepEqual(w.invited, [[l.repo, "ada-l"]]);
});

test("story: the platform cannot finish the repository; the app is still live and managed, and it says so plainly", async () => {
  const w = await world({ admin: false }), { id, cookie } = await submit(w, IDEA);
  await w.call("/s/" + id + "/own", { method: "POST", body: form({ github: "ada-l" }), headers: { cookie } });
  const out = await w.pass();
  assert.equal(out[0].gate, "visitor-app-repos"); assert.equal(out[0].waiting_on, "admin-app"); assert.equal(w.deployed.length, 1, "its system is deployed without the repository");
  let l = await (await w.call("/s/" + id + "/launch")).json();
  assert.equal(l.state, "waiting"); assert.equal(l.repo, null); assert.ok(l.system); assert.equal(w.invited.length, 0); assert.equal(l.served_from, "platform");
  const page = await (await w.call("/s/" + id + "/own", { headers: { cookie } })).text();
  assert.ok(page.includes("you do not need to do anything") && !/credential|admin-app|gate /.test(page), "backend words stay out of the visitor's page");
  await store.put(w.tickEnv.DB, w.tickEnv, "t", "github-admin", { secret: { pem: PEM }, meta: { app_id: 2, installation_id: 22 }, access: "admin-token", expiresAt: Date.now() + 3600e3 });
  await w.pass();
  l = await (await w.call("/s/" + id + "/launch")).json();
  assert.equal(l.state, "handed-over", "the pass after the credential is connected creates, files and hands over"); assert.equal(l.waiting_on, null);
});

test("story: the code app does not cover the new repository; it is created once, named as the thing waited on, and finished later", async () => {
  const w = await world({ covers: false }), { id } = await submit(w, IDEA);
  const out = await w.pass(); assert.equal(out[0].waiting_on, "code-app-scope"); assert.equal(w.repos.size, 1);
  w.github.covers = true; await w.pass();
  const l = await (await w.call("/s/" + id + "/launch")).json(); assert.equal(l.state, "repo"); assert.equal(w.repos.size, 1, "not created twice");
});

test("story: the page they see and the repository stay the same thing, in both directions", async () => {
  const w = await world(), { id } = await submit(w, IDEA); await w.pass();
  const l = await (await w.call("/s/" + id + "/launch")).json(), repo = w.repos.get(l.repo);
  assert.equal(l.served_from, "repository"); assert.equal(repo.get("app/index.html"), w.m.get("site:" + id), "the built page is committed");
  repo.set("app/index.html", PAGE.replace("Graded programmes.", "Graded programmes, with sources."));  // the app's own system, or its owner, merged a change
  await w.pass();
  assert.ok(w.m.get("site:" + id).includes("with sources"), "a change merged in the repository reaches the page the visitor sees");
  w.m.set("site:" + id, PAGE.replace("Policy atlas", "The atlas")); await w.pass();  // the visitor asked for a change on the site
  assert.ok(repo.get("app/index.html").includes("The atlas"), "a change made on the site reaches the repository");
});

test("story: the app's own system ships to its own repository with a token only it can get", async () => {
  const w = await world(), { id } = await submit(w, IDEA); await w.pass();
  const l = await (await w.call("/s/" + id + "/launch")).json();
  assert.equal(w.deployed[0].host_repo, l.repo, "the deploy names the one repository the app may write to");
  assert.equal(await siteHostKey(w.KEY, l.repo), await hostKey(w.KEY, l.repo), "the key the site binds at deploy is the key the tick Worker checks");
  const appEnv = { HOST_TOKEN_URL: "https://tick.internal/host/app-token", HOST_REPO: l.repo, HOST_APP_KEY: await siteHostKey(w.KEY, l.repo) };
  const t = await getToken(makeDb(), appEnv, "app", "github-app", { fetch: (url, init) => w.env.TICK.fetch(new Request(url, init)) });
  assert.equal(t.ok, true); assert.equal(t.token, "scoped:" + l.repo.split("/")[1], "one hour, one repository");
  const r = await w.ghFetch("https://api.github.com/repos/" + l.repo + "/contents/app/notes.md", { method: "PUT", headers: { authorization: "Bearer code-token" }, body: JSON.stringify({ content: Buffer.from("x").toString("base64") }) });
  assert.equal(r.status, 201);
});

test("story: more ideas arrive than there are places; nobody is dropped and nothing is deployed past the limit", async () => {
  const w = await world(), ids = [];
  for (let i = 0; i < 3; i++) ids.push((await submit(w, IDEA + " Region " + i)).id);
  await w.pass(); assert.equal(w.deployed.length, cfg.max_deploys_per_run);
  await w.pass(); assert.equal(w.deployed.length, 3, "the rest follow on the next pass");
  for (const id of ids) assert.equal((await (await w.call("/s/" + id + "/launch")).json()).state, "repo");
});

test("story: the scheduled test idea walks the same front door, is never deployed or given a repository, and is cleaned up", async () => {
  const w = await world();
  const id = await L.walk("https://ultrastable.io", (u, init) => w.call(u.replace("https://ultrastable.io", ""), init), async () => {});
  const out = await w.pass(), mine = out.find((r) => r.id === id);
  assert.ok(mine.synthetic && !mine.error && !mine.gate, JSON.stringify(mine)); assert.equal(w.deployed.length, 1); assert.equal(w.deployed[0].dry, true); assert.equal(w.repos.size, 0);
  assert.equal((await w.internal({ op: "drop", id })).ok, true); assert.equal((await w.call("/s/" + id)).status, 404);
  const real = (await submit(w, IDEA)).id; assert.equal((await w.internal({ op: "drop", id: real })).ok, false, "a real person's app can never be dropped by the probe");
});

test("story: a one-off is told so before anything is queued; the queue is closed to the public", async () => {
  const w = await world();
  const r = await w.call("/api/idea", { method: "POST", body: form({ idea: "a birthday invitation" }), headers: { accept: "application/json" } });
  assert.equal(r.status, 422); assert.equal((await w.internal({ op: "list" })).launches.length, 0);
  const open = await internalDeploy(new Request("https://ultrastable.io/__internal/launches", { method: "POST", body: "{\"op\":\"list\"}" }), w.env);
  assert.equal(open.status, 404);
});

test("the generated manifest is one the seed admits", () => {
  const m = L.manifestOf({ id: "ab12cd34ef", slug: "app-living-atlas-works-ab12cd34ef", repo: "ultrastable/app-living-atlas-works-ab12cd34ef", brief: IDEA }, base, cfg);
  for (const k of ["loop", "measure", "upkeep", "run_cost"]) assert.ok(m.system_test[k]);
  assert.equal(m.owner.jurisdiction, ""); assert.equal(m.repos.canonical, "ultrastable/app-living-atlas-works-ab12cd34ef"); assert.equal(m.name, "A living atlas of what");
});
