// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// LAUNCH-PATH-1: the server side of "anyone can launch". Reads the launch queue the site keeps (site/graduate.js) and, for every idea whose page is
// built, does what a person with a code agent would otherwise do by hand:
//   1. deploys the idea's own system (managers on a clock, its own database, the account's models) through the site's OIDC route: no stored key;
//   2. gives it its own repository from the seed, with IDEA.md written from the visitor's words;
//   3. files each plain-words change the visitor typed as a work item in that repository;
//   4. invites the visitor to the repository with full control when they asked for it.
// Step 2 needs an org credential that can create a repository. Without one the launch is marked "waiting" with the reason, steps 3 and 4 wait
// with it, and step 1 still runs: the app is live and managed either way. Run by .github/workflows/tenant-repos.yml; limits in
// doctrine/tenant-repos.json `visitor_apps`.
//   node deploy/launch-apps.mjs            do the work
//   node deploy/launch-apps.mjs --probe    also send a test idea through the public front door first and fail on any step a visitor would have to do
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UA = "ultrastable-launch-path";
export const PROBE_IDEA = "[launch-path probe] A living atlas of what works in public policy: every programme graded by its trials and re-graded as evidence lands.";

const title = (brief) => { const w = String(brief).replace(/\[[^\]]*\]/g, "").replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).slice(0, 5).join(" "); return (w.charAt(0).toUpperCase() + w.slice(1)).slice(0, 60) || "New system"; };
// The manifest the seed is generated from. The visitor gave an idea, not a system test, so the four answers every system starts with are filled in
// from what the platform itself does for it; the app's product manager replaces the measure once the first readings exist.
export function manifestOf(launch, base, cfg) {
  const m = JSON.parse(JSON.stringify(base)), name = title(launch.brief), usd = (cfg && cfg.usd_per_month) || 5;
  return Object.assign(m, {
    name, slug: launch.slug, idea: String(launch.brief).replace(/\s+/g, " ").trim().slice(0, 1500),
    owner: { name: "the person who asked for it", jurisdiction: "", contact_binding: "OWNER_CONTACT", contact_binding_backup: "OWNER_CONTACT_BACKUP" },
    brand: { public_name: name, tagline: "Run on Ultrastable, the foundation for any autonomous system.", separate_from: ["Ultrastable"] },
    goals: ["Do what the idea says and keep doing it", "Check its own health every cycle and file its own repairs", "Stay inside " + usd + " USD a month"],
    positioning: name + " started as one sentence typed at ultrastable.io and is built and run by the platform.",
    repos: { org: launch.repo.split("/")[0], names: [launch.repo.split("/")[1]], canonical: launch.repo },
    budget: { usd_per_month: usd, actions_minutes_monthly: 100 },
    system_test: { loop: "its own clock measures the app, files what is wrong or missing and ships the fix, with no person in the middle", measure: "open work items past their deadline, target 0", upkeep: "new evidence, sources and requests from its owner keep arriving", run_cost: usd + " USD a month for the back end" }
  });
}
export function ideaFile(m) {
  const t = m.system_test;
  return "---\norg_name: " + m.name + "\nslug: " + m.slug + "\nowner: " + m.owner.name + "\nhosted_by: ultrastable\nowner_contact: set-in-secret-store\nowner_contact_backup: set-in-secret-store\n---\n\n# Idea\n\n" + m.idea
    + "\n\n# System test\n\n- Loop: " + t.loop + "\n- Measure: " + t.measure + "\n- Upkeep: " + t.upkeep + "\n- Run cost: " + t.run_cost
    + "\n\n# Who it is for\n\n- The person who asked for it and the people it serves\n\n# First outcomes\n\n" + m.goals.map((g) => "- " + g).join("\n")
    + "\n\n# Constraints\n\n- Budget per month: " + m.budget.usd_per_month + " USD\n";
}
export function steerItem(launch, s) {
  const id = "STEER-" + s.n;
  return { path: "docs/issues/" + id + ".json", json: { id, title: id + ": " + s.text.slice(0, 80), body: "**Owner:** product-manager\n**Trigger:** the owner asked for this at ultrastable.io/s/" + launch.id + "/change on " + s.at + "\n**Done check:** the live app does what was asked\n**Status:** open\n\nIn the owner's words:\n\n> " + s.text + "\n\nsize: S\n\n**Closing probe:** GET the live app and confirm the change; then set Status to closed in this file.\n", labels: ["p1", "agent-ready", "owner-asked"], milestone: "Now", workstream: "Owner requests" } };
}
// One pass. Everything that touches the outside is injected, so the stories in site/launchpath.test.mjs run it against fakes.
export async function run({ site, gh, deploySeed, cfg, base, log = console.log }) {
  const { launches } = await site({ op: "list" }), out = [], running = launches.filter((l) => l.system && !l.synthetic).length;
  let deploys = 0;
  for (const l of launches) {
    const r = { id: l.id, synthetic: Boolean(l.synthetic), steps: [], visitor_steps: 0 }, mark = { op: "mark", id: l.id, filed: [] };
    out.push(r);
    if (!l.built) { r.steps.push("page not built yet (" + l.site_state + ")"); continue; }
    const m = manifestOf(l, base, cfg), short = "app-" + l.id;
    try {
      // 1. its own system
      if (!l.system) {
        if (!l.synthetic && running + deploys >= cfg.max_apps) { mark.waiting_on = "all " + cfg.max_apps + " places for hosted apps are taken; the next one frees up when an app is handed over or retired"; r.steps.push("system: no place free"); }
        else if (!l.synthetic && deploys >= cfg.max_deploys_per_run) r.steps.push("system: next run (" + cfg.max_deploys_per_run + " per run)");
        else {
          const row = (await deploySeed([{ slug: short, manifest: m, ai: true }], Boolean(l.synthetic)))[0] || {};
          if (row.live_ok && !l.synthetic) { mark.system = row.url; deploys++; r.steps.push("system: live at " + row.url); }
          else if (row.live_ok) r.steps.push("system: built and bundled (" + row.modules + " modules), not deployed for a test idea");
          else throw new Error("system deploy: " + (row.error || "no row"));
        }
      }
      // 2. its own repository
      let hasRepo = l.state === "repo" || l.state === "handed-over";
      if (!hasRepo) {
        const route = await gh.route();
        if (!route) { mark.state = "waiting"; mark.waiting_on = mark.waiting_on || "no credential on the platform can create a repository yet (gate visitor-app-repos)"; r.gate = "visitor-app-repos"; r.steps.push("repository: waiting on the platform's own credential"); }
        else if (l.synthetic) r.steps.push("repository: route " + route + " is bound; not created for a test idea");
        else {
          if (!(await gh.exists(l.repo))) await gh.generate(l.repo, m.idea.slice(0, 300));
          await gh.putFile(l.repo, "IDEA.md", ideaFile(m), "The idea, in its owner's words (LAUNCH-PATH-1)");
          mark.state = "repo"; hasRepo = true; r.steps.push("repository: " + l.repo);
        }
      }
      if (hasRepo && !l.synthetic) {
        // 3. what the visitor asked for
        for (const s of (l.steer || []).filter((x) => !x.filed)) { const it = steerItem(l, s); await gh.putFile(l.repo, it.path, JSON.stringify(it.json, null, 2) + "\n", it.json.title); mark.filed.push(s.n); }
        if (mark.filed.length) r.steps.push("filed " + mark.filed.length + " request(s)");
        // 4. handing it over
        if (l.want_owner && !l.want_owner.done) { await gh.invite(l.repo, l.want_owner.login); mark.owner_done = true; mark.state = "handed-over"; r.steps.push("invited " + l.want_owner.login + " with full control"); }
      }
    } catch (e) { r.error = String(e && e.message || e).slice(0, 300); mark.waiting_on = "a step failed on our side and is retried on the next run"; log("::error::launch " + l.id + ": " + r.error); }
    await site(mark);
  }
  return out;
}

// ---- the real hands -------------------------------------------------------------------------------------------------------------------
async function oidc() {
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!u || !t) throw new Error("no OIDC request URL: the job needs permissions id-token: write");
  const j = await (await fetch(u + "&audience=ultrastable-deploy", { headers: { authorization: "bearer " + t } })).json();
  if (!j.value) throw new Error("no OIDC token"); return j.value;
}
function realGh(tokens, template) {
  let tok = null, name = null;
  const api = async (method, path, body, t) => { const r = await fetch("https://api.github.com" + path, { method, headers: { authorization: "Bearer " + (t || tok), accept: "application/vnd.github+json", "user-agent": UA, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  return {
    // A route counts when its token can read the private template: the same right repository creation from it needs. A refusal is logged per route.
    async route() { if (name) return name; for (const [n, t] of tokens) { if (!t) { console.log("route " + n + ": not bound"); continue; } const r = await api("GET", "/repos/" + template, null, t); if (r.status === 200 && r.json.permissions && r.json.permissions.admin) { tok = t; name = n; return n; } console.log("route " + n + ": HTTP " + r.status + (r.status === 200 ? " without administration rights" : "")); } return null; },
    async exists(repo) { return (await api("GET", "/repos/" + repo)).status === 200; },
    async generate(repo, description) { const [owner, nm] = repo.split("/"); const r = await api("POST", "/repos/" + template + "/generate", { owner, name: nm, private: true, description: description.slice(0, 300) }); if (r.status !== 201) throw new Error("create " + repo + ": HTTP " + r.status + " " + (r.json.message || "")); for (let i = 0; i < 10; i++) { if ((await api("GET", "/repos/" + repo + "/contents/README.md")).status === 200) return; await new Promise((z) => setTimeout(z, 3000)); } throw new Error(repo + " was created but its files did not appear"); },
    async putFile(repo, path, content, message) { const cur = await api("GET", "/repos/" + repo + "/contents/" + path); const r = await api("PUT", "/repos/" + repo + "/contents/" + path, { message, content: Buffer.from(content).toString("base64"), sha: cur.status === 200 ? cur.json.sha : undefined }); if (r.status !== 200 && r.status !== 201) throw new Error("write " + path + ": HTTP " + r.status + " " + (r.json.message || "")); },
    async invite(repo, login) { const r = await api("PUT", "/repos/" + repo + "/collaborators/" + encodeURIComponent(login), { permission: "admin" }); if (r.status !== 201 && r.status !== 204) throw new Error("invite " + login + ": HTTP " + r.status + " " + (r.json.message || "")); }
  };
}
function realDeploy(list, dry) {
  const dir = "/tmp/launch-apps"; mkdirSync(dir, { recursive: true });
  const extra = list.map((x) => { const p = dir + "/" + x.slug + ".json"; writeFileSync(p, JSON.stringify(x.manifest)); return { slug: x.slug, instance: p, ai: x.ai }; }), res = dir + "/result.json";
  writeFileSync(res, "[]");
  try { execFileSync("node", ["deploy/deploy-seed.mjs"].concat(dry ? ["--dry-run"] : []), { cwd: ROOT, stdio: "inherit", env: { ...process.env, SEED_EXTRA: JSON.stringify(extra), SEED_ONLY_EXTRA: "1", SEED_RESULT: res, SEED_DEPLOY_OUT: dir + "/out" } }); }
  catch (e) { console.log("::warning::deploy-seed exited " + e.status + "; its rows say why"); }
  return JSON.parse(readFileSync(res, "utf8"));
}
// The visitor's side, exactly as a browser with no script does it: one form post, then waiting. Anything else it would take is a failure.
export async function walk(front, fetchFn = fetch, wait = (ms) => new Promise((z) => setTimeout(z, ms))) {
  const fd = new FormData(); fd.set("idea", PROBE_IDEA); fd.set("profile", JSON.stringify({ probe: true }));
  const r = await fetchFn(front + "/api/idea", { method: "POST", body: fd, headers: { accept: "application/json", "user-agent": UA } });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.id) throw new Error("front door: HTTP " + r.status + " " + JSON.stringify(j).slice(0, 200));
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  let state = "building";
  for (let i = 0; i < 40 && state === "building"; i++) { await wait(5000); state = (await (await fetchFn(front + "/s/" + j.id + "/status", { headers: { "user-agent": UA } })).json()).state; }
  if (state !== "ready") throw new Error("the page was not built: " + state);
  const own = await fetchFn(front + "/s/" + j.id + "/own", { headers: { "user-agent": UA, cookie } }), text = await own.text();
  if (!own.ok) throw new Error("the visitor's own page: HTTP " + own.status);
  const asks = ["terminal", "command line", "api key", "token", "install ", "wrangler", "git clone", "create an account"].filter((w) => text.toLowerCase().includes(w));
  if (asks.length) throw new Error("the visitor's own page asks for: " + asks.join(", "));
  if (!cookie) throw new Error("the browser that made the app was given nothing to prove it later");
  return j.id;
}
async function main() {
  const reg = JSON.parse(readFileSync(ROOT + "doctrine/tenant-repos.json", "utf8")), cfg = reg.visitor_apps, base = JSON.parse(readFileSync(ROOT + cfg.base_manifest, "utf8"));
  const SITE = process.env.TARGET_SITE || "https://ultrastable-site.ultrastable.workers.dev", probe = process.argv.includes("--probe");
  const site = async (body) => { const r = await fetch(SITE + "/__internal/launches", { method: "POST", headers: { authorization: "Bearer " + await oidc(), "content-type": "application/json", "user-agent": UA }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error("launch queue " + body.op + ": HTTP " + r.status + " " + (j.error || "")); return j; };
  if (process.argv.includes("--routes")) { const r = await realGh([["ORG_ADMIN_TOKEN", process.env.ORG_ADMIN_TOKEN], ["LANE_PAT", process.env.LANE_PAT], ["lane-app", process.env.APP_TOKEN]], cfg.template).route(); console.log(r ? "repository route: " + r : "no route can create a visitor app's repository"); process.exit(r ? 0 : 1); }  // closing probe of gate visitor-app-repos
  let probeId = null, fail = null;
  if (probe) { try { probeId = await walk(process.env.FRONT_DOOR || SITE); console.log("test idea " + probeId + " went through the front door"); } catch (e) { fail = "front door: " + e.message; } }
  const gh = realGh([["ORG_ADMIN_TOKEN", process.env.ORG_ADMIN_TOKEN], ["LANE_PAT", process.env.LANE_PAT], ["lane-app", process.env.APP_TOKEN]], cfg.template);
  const out = await run({ site, gh, deploySeed: async (l, dry) => realDeploy(l, dry), cfg, base });
  for (const r of out) console.log((r.error ? "FAIL " : "ok   ") + r.id + (r.synthetic ? " (test)" : "") + ": " + r.steps.join("; ") + (r.error ? " | " + r.error : ""));
  if (probe && !fail) { const mine = out.find((r) => r.id === probeId); if (!mine) fail = "the test idea never reached the launch queue"; else if (mine.error) fail = mine.error; else if (mine.gate) console.log("::warning::gate " + mine.gate + ": the app is live and managed, its repository waits on the platform's credential"); }
  for (const r of out.filter((x) => x.synthetic)) await site({ op: "drop", id: r.id });
  const rec = { at: new Date().toISOString(), probe, passed: !fail && !out.some((r) => r.error), fail, launches: out.filter((r) => !r.synthetic).length, gate: out.some((r) => r.gate) ? "visitor-app-repos" : null, visitor_steps: 0 };
  if (process.env.LAUNCH_RESULT) writeFileSync(process.env.LAUNCH_RESULT, JSON.stringify(rec) + "\n");
  console.log(JSON.stringify(rec));
  if (!rec.passed) { console.log("::error::launch path: " + (fail || "a launch step failed")); process.exit(1); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
