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

const IDEA = "A living atlas of what works in public policy: every programme graded by its trials and re-graded as evidence lands.";
const PAGE = "<!doctype html><html lang=\"en\"><head><title>Atlas</title></head><body><h1>Policy atlas</h1><p>Graded programmes.</p></body></html>";
const cfg = JSON.parse(readFileSync(new URL("../doctrine/tenant-repos.json", import.meta.url), "utf8")).visitor_apps;
const base = JSON.parse(readFileSync(new URL("../" + cfg.base_manifest, import.meta.url), "utf8"));
function world() {
  const m = new Map();
  const ASSETS = { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, String(v)); }, delete: async (k) => { m.delete(k); }, list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }) };
  const AI = { run: async () => ({ response: PAGE }) };
  const env = { ASSETS, AI, INTERNAL_DEPLOY_KEY: "k".repeat(32) };
  const call = (path, init) => site.fetch(new Request("https://ultrastable.io" + path, init), env, { waitUntil() {} });
  const internal = async (body) => (await internalDeploy(new Request("https://ultrastable.io/__internal/launches", { method: "POST", headers: { "x-internal-key": env.INTERNAL_DEPLOY_KEY }, body: JSON.stringify(body) }), env)).json();
  const repos = new Map(), invited = [], deployed = [];
  const gh = (route) => ({ route: async () => route, exists: async (r) => repos.has(r), generate: async (r) => { repos.set(r, new Map([["README.md", "seed"]])); }, putFile: async (r, p, c) => { repos.get(r).set(p, c); }, invite: async (r, l) => { invited.push([r, l]); } });
  const deploySeed = async (list, dry) => list.map((x) => { deployed.push({ slug: x.slug, dry, ai: x.ai }); return { live_ok: true, modules: 40, url: "https://ultrastable-seed-" + x.slug + ".ultrastable.workers.dev" }; });
  const pass = (route) => L.run({ site: internal, gh: gh(route), deploySeed, cfg, base, log() {} });
  return { m, env, call, internal, repos, invited, deployed, pass };
}
const form = (o) => { const f = new FormData(); for (const k in o) f.set(k, o[k]); return f; };
async function submit(w, idea) {
  const r = await w.call("/api/idea", { method: "POST", body: form({ idea, profile: "{}" }), headers: { accept: "application/json" } });
  assert.equal(r.status, 200); const { id } = await r.json(), cookie = r.headers.get("set-cookie").split(";")[0];
  for (let i = 0; i < 5; i++) if ((await (await w.call("/s/" + id + "/status")).json()).state === "ready") break;
  assert.equal((await (await w.call("/s/" + id + "/status")).json()).state, "ready", "the page builds from one form post and waiting");
  return { id, cookie };
}

test("story: a person types the atlas idea and gets a live, managed app with its own repository, doing nothing else", async () => {
  const w = world(), { id } = await submit(w, IDEA);
  assert.equal((await w.call("/s/" + id)).status, 200, "the app is live straight away");
  let l = await (await w.call("/s/" + id + "/launch")).json();
  assert.equal(l.state, "queued"); assert.equal(l.manual_steps, 0); assert.ok(!("brief" in l) && !("key" in l), "the public record carries no idea text and no key");
  const out = await w.pass("lane-app");
  assert.deepEqual(w.deployed, [{ slug: "app-" + id, dry: false, ai: true }], "its own system is deployed with the account's models, no key from anyone");
  l = await (await w.call("/s/" + id + "/launch")).json();
  assert.equal(l.state, "repo"); assert.match(l.repo, /^ultrastable\/app-living-atlas-works-[a-f0-9]{10}$/); assert.match(l.system, /^https:\/\/ultrastable-seed-app-/);
  const idea = w.repos.get(l.repo).get("IDEA.md");
  assert.ok(idea.includes(IDEA) && /- Loop: .+\n- Measure: .+\n- Upkeep: .+\n- Run cost: 5 USD/.test(idea), "IDEA.md carries the words and a complete system test, so the seed's own bootstrap admits it");
  assert.equal(out[0].visitor_steps, 0);
  await w.pass("lane-app"); assert.equal(w.deployed.length, 1, "a second pass deploys nothing twice");
});

test("story: they steer it in plain words; the page changes now and the request lands in the repository", async () => {
  const w = world(), { id } = await submit(w, IDEA); await w.pass("lane-app");
  const r = await w.call("/api/change", { method: "POST", body: form({ id, change: "Add a filter by country" }), headers: { accept: "application/json" } });
  assert.equal(r.status, 200);
  await w.pass("lane-app");
  const l = await (await w.call("/s/" + id + "/launch")).json(); assert.equal(l.changes, 1); assert.equal(l.changes_filed, 1);
  const item = JSON.parse(w.repos.get(l.repo).get("docs/issues/STEER-1.json"));
  assert.ok(item.body.includes("Add a filter by country") && item.labels.includes("agent-ready"));
  assert.ok((await (await w.call("/s/" + id + "/own")).text()).includes("Add a filter by country"), "they see what they asked for when they come back");
});

test("story: they come back later and take it over; only the browser that made it can", async () => {
  const w = world(), { id, cookie } = await submit(w, IDEA);
  const page = await (await w.call("/s/" + id + "/own", { headers: { cookie } })).text();
  assert.ok(page.includes("Invite me") && !/terminal|api key|token|install |command line/i.test(page), "the page asks for a GitHub name at most, and only if they want the repository");
  assert.equal((await w.call("/s/" + id + "/own", { method: "POST", body: form({ github: "mallory" }) })).status, 403, "a stranger with the link cannot claim it");
  assert.equal((await w.call("/s/" + id + "/own", { method: "POST", body: form({ github: "not a name!" }), headers: { cookie } })).status, 400);
  assert.equal((await w.call("/s/" + id + "/own", { method: "POST", body: form({ github: "ada-l" }), headers: { cookie } })).status, 303);
  await w.pass("lane-app");
  const l = await (await w.call("/s/" + id + "/launch")).json();
  assert.equal(l.state, "handed-over"); assert.deepEqual(w.invited, [[l.repo, "ada-l"]]);
});

test("story: the platform cannot create a repository; the app is still live and managed, and it says so plainly", async () => {
  const w = world(), { id, cookie } = await submit(w, IDEA);
  await w.call("/s/" + id + "/own", { method: "POST", body: form({ github: "ada-l" }), headers: { cookie } });
  const out = await w.pass(null);
  assert.equal(out[0].gate, "visitor-app-repos"); assert.equal(w.deployed.length, 1, "its system is deployed without the repository");
  const l = await (await w.call("/s/" + id + "/launch")).json();
  assert.equal(l.state, "waiting"); assert.equal(l.repo, null); assert.ok(l.system); assert.equal(w.invited.length, 0);
  const page = await (await w.call("/s/" + id + "/own", { headers: { cookie } })).text();
  assert.ok(page.includes("you do not need to do anything") && !page.includes("credential"), "backend words stay out of the visitor's page");
  await w.pass("LANE_PAT");
  assert.equal((await (await w.call("/s/" + id + "/launch")).json()).state, "handed-over", "the day a route is bound, the same pass creates, files and hands over");
});

test("story: more ideas arrive than there are places; nobody is dropped and nothing is deployed past the limit", async () => {
  const w = world(), ids = [];
  for (let i = 0; i < 3; i++) ids.push((await submit(w, IDEA + " Region " + i)).id);
  await w.pass("lane-app"); assert.equal(w.deployed.length, cfg.max_deploys_per_run);
  await w.pass("lane-app"); assert.equal(w.deployed.length, 3, "the rest follow on the next pass");
  for (const id of ids) assert.equal((await (await w.call("/s/" + id + "/launch")).json()).state, "repo");
});

test("story: the scheduled test idea walks the same front door, is never deployed or given a repository, and is cleaned up", async () => {
  const w = world();
  const id = await L.walk("https://ultrastable.io", (u, init) => w.call(u.replace("https://ultrastable.io", ""), init), async () => {});
  const out = await w.pass("lane-app"), mine = out.find((r) => r.id === id);
  assert.ok(mine.synthetic && !mine.error && !mine.gate); assert.deepEqual(w.deployed, [{ slug: "app-" + id, dry: true, ai: true }]); assert.equal(w.repos.size, 0);
  assert.equal((await w.internal({ op: "drop", id })).ok, true); assert.equal((await w.call("/s/" + id)).status, 404);
  const real = (await submit(w, IDEA)).id; assert.equal((await w.internal({ op: "drop", id: real })).ok, false, "a real person's app can never be dropped by the probe");
});

test("story: a one-off is told so before anything is queued; the queue is closed to the public", async () => {
  const w = world();
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
