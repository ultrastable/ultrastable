// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// LAUNCH-PATH-1 (Rowan, 2026-11-25: "how will someone without access to a code agent be able to launch the app and achieve criticality?"):
// an idea a visitor submits becomes a launch record here. The server side (deploy/launch-apps.mjs, run by tenant-repos.yml) reads the queue,
// gives the app its own repository from the seed, files each plain-words change as a work item there, and hands the repository to the person
// when they ask. The visitor needs no agent, terminal, GitHub skill or key at any step; the page stays live at /s/<id> the whole time.
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const ORG = "ultrastable", SYNTHETIC = "[launch-path probe]";
const STOP = new Set("a an the of in on for to and or that what which every by its as is are with it this each from into".split(" "));
// A short readable name from the idea's own words plus the id, so two ideas never collide: "app-living-atlas-works-ab12cd34ef".
export function slugOf(brief, id) {
  const words = String(brief || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 3);
  return ("app-" + words.concat(id).join("-")).slice(0, 60);
}
const key = (id) => "grad:" + id;
export async function getLaunch(env, id) { const t = await env.ASSETS.get(key(id)); try { return t ? JSON.parse(t) : null; } catch (e) { console.error("launch record unreadable", id, String(e)); return null; } }
const save = (env, rec) => env.ASSETS.put(key(rec.id), JSON.stringify(rec));
function newKey() { const b = new Uint8Array(16); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); }
function same(a, b) { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
export const cookieName = (id) => "us_app_" + id;
export function cookieOf(request, id) { const m = new RegExp("(?:^|; )" + cookieName(id) + "=([a-f0-9]{32})").exec((request && request.headers.get("cookie")) || ""); return m ? m[1] : ""; }
export const setCookie = (rec) => cookieName(rec.id) + "=" + rec.key + "; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax";

// Called once when a new idea starts building. Idempotent: a second call keeps the first record.
export async function enqueue(env, id, brief, now) {
  const had = await getLaunch(env, id); if (had) return had;
  const rec = { id, slug: slugOf(brief, id), repo: null, brief: String(brief || "").slice(0, 4000), at: (now || new Date()).toISOString(), state: "queued", steer: [], key: newKey(), synthetic: String(brief || "").includes(SYNTHETIC) };
  rec.repo = ORG + "/" + rec.slug;
  await save(env, rec); return rec;
}
// A change typed at /s/<id>/change also becomes a work item for the app's repository (the page itself is rebuilt at once, as before).
export async function steer(env, id, text, now) {
  const rec = await getLaunch(env, id); if (!rec) return null;
  rec.steer.push({ n: rec.steer.length + 1, text: String(text).slice(0, 1000), at: (now || new Date()).toISOString(), filed: false });
  await save(env, rec); return rec;
}
// What anyone may see about a launch: no idea text, no key.
export function publicView(rec) {
  if (!rec) return null;
  return { id: rec.id, state: rec.state, repo: rec.state === "repo" || rec.state === "handed-over" ? rec.repo : null, changes: rec.steer.length, changes_filed: rec.steer.filter((s) => s.filed).length, system: rec.system || null, owner_requested: Boolean(rec.want_owner), waiting_on: rec.waiting_on || null, served_from: rec.page_sha ? "repository" : "platform", manual_steps: 0 };
}
const GH_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
export async function requestOwnership(request, env, id) {
  const rec = await getLaunch(env, id); if (!rec) return { ok: false, status: 404, say: "That app was not found." };
  if (!same(cookieOf(request, id), rec.key)) return { ok: false, status: 403, say: "Open this page in the browser you made the app in. That is how we know it is yours." };
  const f = await request.formData().catch(() => null), login = f && String(f.get("github") || "").trim().replace(/^@/, "");
  if (!login || !GH_LOGIN.test(login)) return { ok: false, status: 400, say: "That does not look like a GitHub name. It is the short name in your profile address." };
  rec.want_owner = { login, at: new Date().toISOString(), done: false }; await save(env, rec);
  return { ok: true, status: 200, say: "Done. You will get an invitation from GitHub at " + login + " once the project has its own home." };
}
const STATE_WORDS = {
  queued: ["Your app is live", "It runs at the address below. We are setting up its own project home next, where it keeps being built and improved."],
  waiting: ["Your app is live", "It runs at the address below and keeps being checked and improved every week. Its own project home is not set up yet. We keep trying; you do not need to do anything."],
  repo: ["Your app is live and has its own home", "It keeps being built and improved there. Anything you ask for below goes onto its to-do list."],
  "handed-over": ["It is yours", "You have full control of the project. We keep improving it unless you tell us to stop."]
};
export function ownBody(rec, canon, mine) {
  const w = STATE_WORDS[rec.state] || STATE_WORDS.queued, live = "https://" + canon + "/s/" + rec.id;
  const home = rec.state === "repo" || rec.state === "handed-over" ? "<p><a href=\"https://github.com/" + esc(rec.repo) + "\">See the project</a></p>" : "";
  const engine = rec.system ? "<p class=\"meta\">It has its own managers running on a clock: they measure it, decide what to improve and do the work. <a href=\"" + esc(rec.system) + "/health\">Their pulse</a></p>" : "";
  const asks = rec.steer.length ? "<div class=\"card\"><h3 class=\"card-title\">What you asked for</h3><ul>" + rec.steer.slice(-8).map((s) => "<li>" + esc(s.text) + " <span class=\"meta\">(" + (s.filed ? "on the to-do list" : "applied to the page; queued for the project") + ")</span></li>").join("") + "</ul></div>" : "";
  const own = rec.want_owner ? "<p class=\"meta\">Ownership asked for by " + esc(rec.want_owner.login) + (rec.want_owner.done ? ". The invitation has been sent." : ". The invitation goes out when the project home is ready.") + "</p>"
    : mine ? "<form method=\"post\" action=\"/s/" + rec.id + "/own\"><p>Want to own the project yourself later? Type your GitHub name and we invite you with full control. This is optional.</p><div class=\"us-ask\"><input name=\"github\" type=\"text\" maxlength=\"39\" autocomplete=\"off\" aria-label=\"Your GitHub name\" placeholder=\"your-name\"><button type=\"submit\" class=\"btn\">Invite me</button></div></form>"
      : "<p class=\"meta\">To take the project over, open this page in the browser you made the app in.</p>";
  return "<div class=\"head\"><h1>" + esc(w[0]) + "</h1><p>" + esc(w[1]) + "</p></div>"
    + "<div class=\"card\"><p><a href=\"" + live + "\">" + esc(live.replace("https://", "")) + "</a></p>" + home + engine + "</div>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/s/" + rec.id + "/change\">Change something</a> <a class=\"btn\" href=\"/s/" + rec.id + "/history\">History</a></div>"
    + asks + "<div class=\"card\"><h3 class=\"card-title\">Taking it over</h3>" + own + "</div>"
    + "<p class=\"meta\">There is no code for you to write and no password to keep. We build it, publish it and look after it.</p>";
}

// APP-REPO-1: the repository work goes to the tick Worker, which already holds the two App credentials (seed/worker/src/apprepos.js). The repository
// name comes from the launch record, never from the caller. The page a visitor sees is kept the same in both places: a change made on the site is
// committed to app/index.html, and a change merged in the repository is published to the site. When both moved, the visitor's own words win and
// the repository keeps the other version in its history.
const PAGE_PATH = "app/index.html";
async function sha(text) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)))), (x) => x.toString(16).padStart(2, "0")).join(""); }
async function tickRepo(env, spec) {
  if (!env.TICK || !env.INTERNAL_DEPLOY_KEY) return { ok: false, waiting_on: "host-binding", error: "the site has no route to the tick Worker" };
  const r = await env.TICK.fetch(new Request("https://tick.internal/host/app-repo", { method: "POST", headers: { "content-type": "application/json", "x-internal-key": env.INTERNAL_DEPLOY_KEY }, body: JSON.stringify(spec) }));
  const j = await r.json().catch(() => null);
  return j || { ok: false, error: "tick Worker answered HTTP " + r.status };
}
async function repoOp(b, env) {
  if (b.check) { const r = await tickRepo(env, { repo: ORG + "/app-route-check", dry: true }); return J({ ok: Boolean(r.ok), waiting_on: r.waiting_on || null, error: r.error || null }); }
  const rec = await getLaunch(env, String(b.id || "")); if (!rec) return J({ ok: false, error: "no such launch" }, 404);
  if (rec.synthetic) return J({ ok: false, error: "a probe launch gets no repository" }, 400);
  const files = (Array.isArray(b.files) ? b.files : []).filter((f) => f && typeof f.path === "string" && typeof f.content === "string" && f.path !== PAGE_PATH).slice(0, 12);
  const first = await tickRepo(env, { repo: rec.repo, template: b.template, description: rec.brief.slice(0, 300), files, read: [PAGE_PATH], invite: b.invite || undefined });
  if (!first.ok) return J({ ok: false, waiting_on: first.waiting_on || null, error: first.error || "repository step failed", steps: first.steps || [], created: Boolean(first.created) });
  const out = { ok: true, created: Boolean(first.created), from_template: first.from_template, steps: first.steps || [], invited: first.invited || null, page: "same" };
  const live = await env.ASSETS.get("site:" + rec.id), inRepo = first.read ? first.read[PAGE_PATH] : undefined;
  if (live) {
    const hLive = await sha(live), hRepo = inRepo === undefined ? null : await sha(inRepo);
    if (hRepo && hRepo !== hLive && rec.page_sha === hLive) { await env.ASSETS.put("site:" + rec.id, inRepo); rec.page_sha = hRepo; out.page = "published from the repository"; }
    else if (hRepo !== hLive) {
      const w = await tickRepo(env, { repo: rec.repo, files: [{ path: PAGE_PATH, content: live, message: "The page as its owner sees it" }] });
      if (!w.ok) return J({ ok: false, waiting_on: w.waiting_on || null, error: w.error || "page commit failed", steps: out.steps, created: out.created });
      rec.page_sha = hLive; out.page = "committed to the repository";
    } else rec.page_sha = hLive;
    await save(env, rec);
  }
  return J(out);
}

// The server side's hands (deploy/launch-apps.mjs). Reached only through internalDeploy's key or GitHub OIDC check.
const MARKS = new Set(["queued", "waiting", "repo", "handed-over"]);
export async function launchesInternal(request, env) {
  let b; try { b = await request.json(); } catch (e) { return J({ ok: false, error: "bad json" }, 400); }
  if (b.op === "list") {
    const out = []; let cursor;
    for (let i = 0; i < 10; i++) { const r = await env.ASSETS.list({ prefix: "grad:", cursor }); for (const k of r.keys) { const rec = await getLaunch(env, k.name.slice(5)); if (rec) { const { key: _k, ...pub } = rec; pub.site_state = await env.ASSETS.get("state:" + rec.id); pub.built = Boolean(await env.ASSETS.get("site:" + rec.id));  /* a page that was built once stays live while a change rebuilds it */ const b = await env.ASSETS.get("brief:" + rec.id); if (b) { try { pub.brief = JSON.parse(b).brief || pub.brief; } catch (e) { console.error("brief unreadable", rec.id, String(e)); } } out.push(pub); } } if (r.list_complete) break; cursor = r.cursor; }
    return J({ ok: true, launches: out });
  }
  if (b.op === "drop") {  // only the scheduled probe's own test launches are ever removed
    const rec = await getLaunch(env, String(b.id || "")); if (!rec || !rec.synthetic) return J({ ok: false, error: "not a probe launch" }, 400);
    for (const k of ["grad:", "state:", "site:", "brief:", "job:", "tries:", "since:", "audit:", "profile:"]) await env.ASSETS.delete(k + rec.id);
    return J({ ok: true, dropped: rec.id });
  }
  if (b.op === "repo") return repoOp(b, env);
  if (b.op === "tenant-repo") {  // TENANT-REPO-2: tenant-repos.yml's credential-free route; the tick decides, the name rule is checked there too
    if (!env.TICK || !env.INTERNAL_DEPLOY_KEY) return J({ ok: false, waiting_on: "host-binding", error: "the site has no route to the tick Worker" }, 409);
    const r = await env.TICK.fetch(new Request("https://tick.internal/host/tenant-repo", { method: "POST", headers: { "content-type": "application/json", "x-internal-key": env.INTERNAL_DEPLOY_KEY }, body: JSON.stringify({ repo: String(b.repo || ""), visibility: b.visibility === "private" ? "private" : "public", description: String(b.description || "").slice(0, 300) }) }));
    return J((await r.json().catch(() => null)) || { ok: false, error: "tick Worker answered HTTP " + r.status }, r.status);
  }
  if (b.op === "repo-settings") {  // REPO-SETTINGS-1: branch cleanup's credential-free route to delete_branch_on_merge and allow_auto_merge
    if (!env.TICK || !env.INTERNAL_DEPLOY_KEY) return J({ ok: false, waiting_on: "host-binding", error: "the site has no route to the tick Worker" }, 409);
    const r = await env.TICK.fetch(new Request("https://tick.internal/host/repo-settings", { method: "POST", headers: { "content-type": "application/json", "x-internal-key": env.INTERNAL_DEPLOY_KEY }, body: JSON.stringify({ repo: String(b.repo || ""), public: b.public === true, dry: b.dry === true }) }));
    return J((await r.json().catch(() => null)) || { ok: false, error: "tick Worker answered HTTP " + r.status }, r.status);
  }
  if (b.op === "mark") {
    const rec = await getLaunch(env, String(b.id || "")); if (!rec) return J({ ok: false, error: "no such launch" }, 404);
    if (b.state) { if (!MARKS.has(b.state)) return J({ ok: false, error: "unknown state " + b.state }, 400); rec.state = b.state; }
    if (b.system && /^https:\/\/ultrastable-seed-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(String(b.system))) rec.system = String(b.system);
    rec.waiting_on = b.waiting_on ? String(b.waiting_on).slice(0, 300) : null;
    for (const n of Array.isArray(b.filed) ? b.filed : []) { const s = rec.steer.find((x) => x.n === n); if (s) s.filed = true; }
    if (b.owner_done && rec.want_owner) rec.want_owner.done = true;
    rec.checked_at = new Date().toISOString(); await save(env, rec);
    return J({ ok: true, state: rec.state });
  }
  return J({ ok: false, error: "unknown op" }, 400);
}
