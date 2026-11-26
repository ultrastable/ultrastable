// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// LAUNCH-PATH-1: the server side of "anyone can launch". Reads the launch queue the site keeps (site/graduate.js) and, for every idea whose page is
// built, does what a person with a code agent would otherwise do by hand:
//   1. deploys the idea's own system (managers on a clock, its own database, the account's models) through the site's OIDC route: no stored key;
//   2. gives it its own repository from the seed, with IDEA.md written from the visitor's words;
//   3. files each plain-words change the visitor typed as a work item in that repository;
//   4. invites the visitor to the repository with full control when they asked for it.
// Steps 2 to 4 are done by the tick Worker with the two GitHub App credentials it already holds (seed/worker/src/apprepos.js), reached through
// the site worker; this script holds no GitHub credential. When the tick Worker cannot finish, the launch is marked "waiting" with what GitHub
// answered and step 1 still runs: the app is live and managed either way. The app's own Worker gets a key for a one-hour token to its one
// repository, so its executor can open pull requests there. Run by .github/workflows/tenant-repos.yml; limits in
// doctrine/tenant-repos.json `visitor_apps`.
//   node deploy/launch-apps.mjs            do the work
//   node deploy/launch-apps.mjs --probe    also send a test idea through the public front door first and fail on any step a visitor would have to do
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UA = "ultrastable-launch-path";
// Two real front-door suggestions, taken in turn by day, so the walk is not tuned to one idea. The second is the owner's own widened wording (BREADTH-1).
export const PROBE_IDEAS = ["[launch-path probe] A living atlas of what works in public policy: every programme graded by its trials and re-graded as evidence lands.",
  "[launch-path probe] An encyclopedic replication ledger across many fields: which landmark findings held up and which failed, updated as replications publish."];
export const probeIdea = (now = Date.now()) => PROBE_IDEAS[Math.floor(now / 864e5) % PROBE_IDEAS.length];
export const PROBE_IDEA = PROBE_IDEAS[0];

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
export async function run({ site, deploySeed, cfg, base, log = console.log, now = () => Date.now(), poke = null }) {
  const { launches } = await site({ op: "list" }), out = [], running = launches.filter((l) => l.system && !l.synthetic).length;
  let deploys = 0;
  for (const l of launches) {
    const r = { id: l.id, synthetic: Boolean(l.synthetic), steps: [], visitor_steps: 0 }, mark = { op: "mark", id: l.id, filed: [] };
    out.push(r);
    // a first page that is still the no-model draft is built again from the kept idea; the draft stays the page until that works
    if (l.built && l.draft && !l.synthetic) { const q = await site({ op: "rebuild", id: l.id }); if (q.requeued && poke) await poke(l.id); r.steps.push("page: still the first draft; " + (q.requeued ? "queued again" : "nothing to rebuild from")); }
    if (!l.built) {
      // A build that failed while nobody was looking (the model was unavailable) is queued again here; the next status read builds it.
      if ((l.site_state === "failed" || l.draft) && !l.synthetic) { const q = await site({ op: "rebuild", id: l.id }); if (q.requeued && poke) await poke(l.id); r.steps.push("page: " + (l.draft ? "still the first draft; " : "build failed earlier; ") + (q.requeued ? "queued again" : "nothing to rebuild from")); }
      else r.steps.push("page not built yet (" + l.site_state + ")");
      Object.assign(r, stackOf(l, cfg, now())); continue;
    }
    const m = manifestOf(l, base, cfg), short = "app-" + l.id;
    try {
      // 1. its own system
      if (!l.system) {
        if (!l.synthetic && running + deploys >= cfg.max_apps) { mark.waiting_on = "all " + cfg.max_apps + " places for hosted apps are taken; the next one frees up when an app is handed over or retired"; r.steps.push("system: no place free"); }
        else if (!l.synthetic && deploys >= cfg.max_deploys_per_run) r.steps.push("system: next run (" + cfg.max_deploys_per_run + " per run)");
        else {
          const row = (await deploySeed([{ slug: short, manifest: m, ai: true, host_repo: l.repo }], Boolean(l.synthetic)))[0] || {};
          if (row.live_ok && !l.synthetic) { mark.system = row.url; deploys++; r.steps.push("system: live at " + row.url); }
          else if (row.live_ok) r.steps.push("system: built and bundled (" + row.modules + " modules), not deployed for a test idea");
          else throw new Error("system deploy: " + (row.error || "no row"));
        }
      }
      // 2 to 4. its own repository, what the visitor asked for, and handing it over: one call, done by the tick Worker with the App
      // credentials it already holds (seed/worker/src/apprepos.js). The page the visitor sees is kept the same in the repository and on the site.
      if (l.synthetic) {
        const c = await site({ op: "repo", check: true });
        if (c.ok) r.steps.push("repository: the platform can create one; not created for a test idea");
        else { r.gate = "visitor-app-repos"; r.steps.push("repository: " + (c.waiting_on || c.error)); }
      } else {
        const todo = (l.steer || []).filter((x) => !x.filed), invite = l.want_owner && !l.want_owner.done ? l.want_owner.login : null;
        const files = [{ path: "IDEA.md", content: ideaFile(m), message: "The idea, in its owner's words (LAUNCH-PATH-1)" }].concat(todo.map((x) => { const it = steerItem(l, x); return { path: it.path, content: JSON.stringify(it.json, null, 2) + "\n", message: it.json.title }; }));
        const g = await site({ op: "repo", id: l.id, template: cfg.template, files, invite });
        if (g.ok) {
          mark.state = invite || l.state === "handed-over" ? "handed-over" : "repo"; mark.filed = todo.map((x) => x.n); if (invite) mark.owner_done = true;
          r.steps.push("repository: " + l.repo + (g.created ? (g.from_template ? " created from the seed" : " created (the seed could not be copied: " + g.steps.join("; ") + ")") : "") + "; page " + g.page + (todo.length ? "; filed " + todo.length + " request(s)" : "") + (invite ? "; invited " + invite : ""));
        } else if (g.waiting_on) { if (l.state === "queued") mark.state = "waiting"; mark.waiting_on = mark.waiting_on || "the platform cannot finish the repository yet: " + g.waiting_on + " (gate visitor-app-repos)"; r.gate = "visitor-app-repos"; r.waiting_on = g.waiting_on; r.steps.push("repository: waiting on " + g.waiting_on + " | " + g.error); }
        else throw new Error("repository: " + g.error);
      }
    } catch (e) { r.error = String(e && e.message || e).slice(0, 300); mark.waiting_on = "a step failed on our side and is retried on the next run"; log("::error::launch " + l.id + ": " + r.error); }
    await site(mark);
    Object.assign(r, stackOf({ ...l, system: mark.system || l.system, state: mark.state || l.state }, cfg, now()));
  }
  return out;
}
// FULLSTACK-1: every app is three things, a public front end, a live back end and a repository. What a launch still lacks, and whether it is overdue.
export function stackOf(l, cfg, now = Date.now()) {
  const stack = { frontend: Boolean(l.built), backend: Boolean(l.system), repo: l.state === "repo" || l.state === "handed-over" };
  const missing = Object.keys(stack).filter((k) => !stack[k]), age = (now - Date.parse(l.at || 0)) / 36e5;
  return { stack, missing, overdue: !l.synthetic && missing.length > 0 && age > (cfg.full_stack_hours || 48) };
}

// ---- the real hands -------------------------------------------------------------------------------------------------------------------
async function oidc() {
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!u || !t) throw new Error("no OIDC request URL: the job needs permissions id-token: write");
  const j = await (await fetch(u + "&audience=ultrastable-deploy", { headers: { authorization: "bearer " + t } })).json();
  if (!j.value) throw new Error("no OIDC token"); return j.value;
}
function realDeploy(list, dry) {
  const dir = "/tmp/launch-apps"; mkdirSync(dir, { recursive: true });
  const extra = list.map((x) => { const p = dir + "/" + x.slug + ".json"; writeFileSync(p, JSON.stringify(x.manifest)); return { slug: x.slug, instance: p, ai: x.ai, host_repo: x.host_repo }; }), res = dir + "/result.json";
  writeFileSync(res, "[]");
  try { execFileSync("node", ["deploy/deploy-seed.mjs"].concat(dry ? ["--dry-run"] : []), { cwd: ROOT, stdio: "inherit", env: { ...process.env, SEED_EXTRA: JSON.stringify(extra), SEED_ONLY_EXTRA: "1", SEED_RESULT: res, SEED_DEPLOY_OUT: dir + "/out" } }); }
  catch (e) { console.log("::warning::deploy-seed exited " + e.status + "; its rows say why"); }
  return JSON.parse(readFileSync(res, "utf8"));
}
// The visitor's side, exactly as a browser with no script does it: one form post, then waiting. Anything else it would take is a failure.
export async function walk(front, fetchFn = fetch, wait = (ms) => new Promise((z) => setTimeout(z, ms)), idea = probeIdea()) {
  const fd = new FormData(); fd.set("idea", idea); fd.set("profile", JSON.stringify({ probe: true }));
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
  const site = async (body) => { const r = await fetch(SITE + "/__internal/launches", { method: "POST", headers: { authorization: "Bearer " + await oidc(), "content-type": "application/json", "user-agent": UA }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (body.op === "repo") return j.ok === undefined ? { ok: false, error: "HTTP " + r.status } : j; if (!r.ok || !j.ok) throw new Error("launch queue " + body.op + ": HTTP " + r.status + " " + (j.error || "")); return j; };
  if (process.argv.includes("--routes")) { const c = await site({ op: "repo", check: true }); console.log(c.ok ? "the platform can create a visitor app's repository" : "it cannot yet: " + (c.waiting_on || c.error)); process.exit(c.ok ? 0 : 1); }  // closing probe of gate visitor-app-repos
  let probeId = null, fail = null;
  if (probe) { try { probeId = await walk(process.env.FRONT_DOOR || SITE); console.log("test idea " + probeId + " went through the front door"); } catch (e) { fail = "front door: " + e.message; } }
  const front = process.env.FRONT_DOOR || SITE, poke = async (id) => { for (let i = 0; i < 4; i++) { const s = await (await fetch(front + "/s/" + id + "/status", { headers: { "user-agent": UA } })).json().catch(() => ({})); if (s.state !== "building") return; } };
  const out = await run({ site, deploySeed: async (l, dry) => realDeploy(l, dry), cfg, base, poke });
  for (const r of out) console.log((r.error ? "FAIL " : "ok   ") + r.id + (r.synthetic ? " (test)" : "") + ": " + r.steps.join("; ") + (r.error ? " | " + r.error : ""));
  if (probe && !fail) { const mine = out.find((r) => r.id === probeId); if (!mine) fail = "the test idea never reached the launch queue"; else if (mine.error) fail = mine.error; else if (mine.gate) console.log("::warning::gate " + mine.gate + ": apps are live and managed; their repositories wait on " + mine.steps.join("; ")); }
  for (const r of out.filter((x) => x.synthetic)) await site({ op: "drop", id: r.id });
  const rec = { at: new Date().toISOString(), probe, passed: !fail && !out.some((r) => r.error), fail, launches: out.filter((r) => !r.synthetic).length, gate: out.some((r) => r.gate) ? "visitor-app-repos" : null, visitor_steps: 0 };
    const late = out.filter((r) => r.overdue);
  for (const r of late) console.log("::error::FULLSTACK-1: app " + r.id + " still has no " + r.missing.join(", no ") + " after " + (cfg.full_stack_hours || 48) + " hours");
  if (late.length) { rec.passed = false; fail = fail || late.length + " app(s) are missing part of their stack"; }
  rec.fail = fail; rec.full_stack = { apps: out.filter((r) => !r.synthetic).length, complete: out.filter((r) => !r.synthetic && !r.missing.length).length, overdue: late.length };
  if (process.env.LAUNCH_RESULT) writeFileSync(process.env.LAUNCH_RESULT, JSON.stringify(rec) + "\n");
  console.log(JSON.stringify(rec));
  if (!rec.passed) { console.log("::error::launch path: " + (fail || "a launch step failed")); process.exit(1); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
