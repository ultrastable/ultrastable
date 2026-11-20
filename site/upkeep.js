// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SITE-UPKEEP-1: a built site keeps improving after it is built, and every change can be undone.
// The product promise is "kept running and kept improving"; before this a built site was changed only when its person asked
// (and two audit rounds). Now, on the site Worker's existing tick (no new cron), each ready site gets, at most once a week:
//   1. a free, deterministic pass (page description, social preview, language, theme colour) with no model call;
//   2. when that finds nothing, one model pass on a rotating theme (accessibility, empty states, speed, clarity), capped per tick
//      so spend cannot spiral (the caller's budget-wrapped env pays for it; a caller's `visited(id)` returning false skips the model pass; the Worker passes real first-party views).
// Every change keeps the previous page as a numbered version (last 10) and /s/<id>/history lists them and restores one.
// The module has no imports; the Worker passes the model function and the clock. Tests: site/upkeep.test.mjs.

export const KEEP_VERSIONS = 10;
export const WEEK_MS = 7 * 24 * 3600e3;
export const THEMES = [
  ["accessibility", "Improve accessibility only: visible keyboard focus, labels on every input, sufficient contrast in light and dark, alt text."],
  ["empty-states", "Make every empty or error state say in plain words what is happening and what to do next. Change nothing else."],
  ["speed", "Make it lighter and faster: remove unused CSS and scripts, no blocking resources. Keep the look and every feature."],
  ["clarity", "Tighten the copy so the first screen says what this is and the one main action. Change nothing else."],
];
export const themeFor = (n) => THEMES[Math.abs(Number(n) || 0) % THEMES.length];

const strip = (h) => String(h).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
const text = (h) => strip(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").slice(0, 300);

// Free pass: add what a page should carry and lacks. Returns { html, fixed[] }; html is unchanged when nothing was missing.
export function tidy(html) {
  let h = String(html), fixed = [];
  const title = ((/<title>([^<]*)<\/title>/i.exec(h) || [])[1] || "").trim();
  const adds = [];
  if (!/<meta[^>]+name=["']description["']/i.test(h)) {
    const d = text((/<body[^>]*>([\s\S]*)/i.exec(h) || [, h])[1]).slice(0, 155);
    if (d) { adds.push('<meta name="description" content="' + attr(d) + '">'); fixed.push("page description"); }
  }
  if (title && !/<meta[^>]+property=["']og:title["']/i.test(h)) { adds.push('<meta property="og:title" content="' + attr(title) + '"><meta property="og:type" content="website">'); fixed.push("social preview"); }
  if (!/<meta[^>]+name=["']theme-color["']/i.test(h)) { adds.push('<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#111111" media="(prefers-color-scheme: dark)">'); fixed.push("theme colour"); }
  if (adds.length && /<\/head>/i.test(h)) h = h.replace(/<\/head>/i, adds.join("") + "</head>"); else fixed = [];
  if (!/<html[^>]+\blang=/i.test(h) && /<html/i.test(h)) { h = h.replace(/<html/i, '<html lang="en"'); fixed.push("page language"); }
  return { html: h, fixed };
}

// Versions: ver:<id>:<n> holds a page, vers:<id> the index [{n, at, why}] newest last. Kept to KEEP_VERSIONS.
const jget = async (env, k) => { const v = await env.ASSETS.get(k); try { return v ? JSON.parse(v) : null; } catch (e) { console.error("upkeep: unreadable record", k, String(e).slice(0, 80)); return null; } };
export async function versions(env, id) { return (await jget(env, "vers:" + id)) || { next: 1, list: [] }; }
export async function recordVersion(env, id, html, why, now) {
  if (!html) return null;
  const idx = await versions(env, id), n = idx.next;
  await env.ASSETS.put("ver:" + id + ":" + n, String(html));
  idx.list.push({ n, at: (now || new Date()).toISOString(), why: String(why || "change").slice(0, 160), bytes: String(html).length }); idx.next = n + 1;
  while (idx.list.length > KEEP_VERSIONS) { const old = idx.list.shift(); await env.ASSETS.delete("ver:" + id + ":" + old.n); }
  await env.ASSETS.put("vers:" + id, JSON.stringify(idx)); return n;
}
// Restore keeps the current page as a version first, so a restore is itself undoable.
export async function restore(env, id, n, now) {
  const idx = await versions(env, id), hit = idx.list.find((v) => v.n === Number(n)); if (!hit) return { ok: false, error: "no such version" };
  const old = await env.ASSETS.get("ver:" + id + ":" + hit.n); if (!old) return { ok: false, error: "that version is no longer stored" };
  await recordVersion(env, id, await env.ASSETS.get("site:" + id), "before restoring version " + hit.n, now);
  await env.ASSETS.put("site:" + id, old); return { ok: true, restored: hit.n };
}

// One upkeep round for one site. deps: { improve(brief, html, instruction) -> html, lint(html) -> string[], now }.
export async function upkeepSite(env, id, deps) {
  const now = deps.now || new Date(), st = (await jget(env, "upkeep:" + id)) || { runs: 0 };
  if (st.at && now - new Date(st.at) < WEEK_MS) return { id, skipped: "done this week" };
  const html = await env.ASSETS.get("site:" + id); if (!html || (await env.ASSETS.get("state:" + id)) !== "ready") return { id, skipped: "not ready" };
  const rec = { at: now.toISOString(), runs: st.runs + 1, kind: "none", what: [] };
  const t = tidy(html);
  if (t.fixed.length) { await recordVersion(env, id, html, "upkeep: added " + t.fixed.join(", "), now); await env.ASSETS.put("site:" + id, t.html); rec.kind = "free"; rec.what = t.fixed; }
  else if (deps.improve && (!deps.visited || await deps.visited(id))) {
    const b = await jget(env, "brief:" + id), [name, ins] = themeFor(st.runs), bad = deps.lint ? deps.lint(html) : [];
    try {
      const better = await deps.improve((b && b.brief) || "", html, bad.length ? "Fix these problems and change nothing else: " + bad.join("; ") : ins);
      if (better && better !== html && deps.lint(better).length <= bad.length) { await recordVersion(env, id, html, "upkeep: " + (bad.length ? "fixed " + bad.length + " defects" : name), now); await env.ASSETS.put("site:" + id, better); rec.kind = "model"; rec.what = [bad.length ? "defects" : name]; }
    } catch (e) { console.error("upkeep: model pass failed", id, String(e).slice(0, 120)); rec.kind = "failed"; rec.error = String(e).slice(0, 120); }
  }
  await env.ASSETS.put("upkeep:" + id, JSON.stringify(rec)); return Object.assign({ id }, rec);
}

// The tick step: oldest-served first, at most `limit` model passes per tick, free passes are not counted.
export async function upkeepRound(env, list, deps, limit) {
  const out = []; let models = 0;
  for (const k of list) {
    const id = k.slice(6); if (!/^[a-f0-9]{10}$/.test(id)) continue;
    const d = models >= (limit || 2) ? Object.assign({}, deps, { improve: null }) : deps;
    const r = await upkeepSite(env, id, d); if (r.kind === "model" || r.kind === "failed") models++; if (!r.skipped) out.push(r);
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function historyBody(id, idx, last) {
  const rows = idx.list.slice().reverse().map((v) => "<tr><td>" + v.n + "</td><td>" + esc(v.at.slice(0, 16).replace("T", " ")) + "</td><td>" + esc(v.why) + '</td><td><form method="post" action="/s/' + id + '/history"><input type="hidden" name="v" value="' + v.n + '"><button class="btn" type="submit">Go back to this</button></form></td></tr>').join("");
  const next = last && last.at ? "<p class=\"meta\">Last upkeep " + esc(last.at.slice(0, 10)) + (last.what && last.what.length ? ": " + esc(last.what.join(", ")) : ": nothing needed") + ". The next one runs within a week.</p>" : "<p class=\"meta\">The first upkeep runs within a week.</p>";
  return '<div class="head"><h1>How your site has changed</h1><p>The system looks after your site by itself and keeps what each page looked like before. Pick one to go back to it.</p></div>' + next + '<p class="meta"><a href="/s/' + id + '/feed.xml">Subscribe to these changes</a></p>'
    + (rows ? '<div class="card"><div class="us-wrap"><table class="us-table"><thead><tr><th>#</th><th>When</th><th>What changed after it</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div></div>" : '<div class="card"><p>Nothing has changed yet. Earlier versions appear here the first time the site is improved.</p></div>');
}

// Insights: first-party, cookieless hits (seed/analytics) recorded when a built site is served, path /s/<id>. Bots excluded.
export async function insights(db, id, now) {
  const t = (now || new Date()).getTime(), p = "/s/" + id, q = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const [tot] = await q("SELECT SUM(at>=?3) AS v7, COUNT(*) AS v30, COUNT(DISTINCT CASE WHEN at>=?3 THEN vid END) AS u7 FROM hits WHERE path=?1 AND bot=0 AND at>=?2", p, t - 30 * 86400e3, t - 7 * 86400e3);
  const by = (col) => q("SELECT " + col + " AS k, COUNT(*) AS n FROM hits WHERE path=?1 AND bot=0 AND at>=?2 AND " + col + "!='' GROUP BY " + col + " ORDER BY n DESC LIMIT 5", p, t - 30 * 86400e3);
  return { views7: Number((tot || {}).v7 || 0), views30: Number((tot || {}).v30 || 0), visitors7: Number((tot || {}).u7 || 0), refs: await by("ref"), countries: await by("country"), devices: await by("device") };
}
export const viewedRecently = async (db, id, now) => (await insights(db, id, now)).views30 > 0;
export function insightsBody(id, d) {
  const list = (t, xs) => '<div class="card"><h3 class="card-title">' + t + "</h3>" + (xs.length ? "<ul>" + xs.map((x) => "<li>" + esc(x.k) + ": " + x.n + "</li>").join("") + "</ul>" : '<p class="meta">Nothing yet.</p>') + "</div>";
  return '<div class="head"><h1>Who visits your site</h1><p>Counted without cookies or names. Browsers that ask not to be tracked are not counted.</p></div><div class="card"><h3 class="card-title">Visits</h3><p>' + d.views7 + " in the last 7 days from " + d.visitors7 + " visitors; " + d.views30 + " in the last 30 days.</p><p class=\"meta\">The system spends its improvement effort on sites that are visited.</p></div>" + list("Where they came from", d.refs) + list("Countries", d.countries) + list("Devices", d.devices);
}

// SITE-FEED-1: every built site has an Atom feed of what the system changed (/s/<id>/feed.xml) and an embeddable badge (/s/<id>/badge.svg),
// built from the version index above, so an owner or visitor can subscribe and see the site being looked after.
const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function siteFeed(id, idx, origin, title) {
  const base = origin + "/s/" + id, list = idx.list.slice().reverse();
  const entries = list.map((v) => "<entry><id>" + x(base + "#v" + v.n) + "</id><title>" + x("After version " + v.n + ": " + v.why) + "</title><updated>" + x(v.at) + '</updated><link href="' + x(base + "/history") + '"/></entry>').join("");
  return '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>' + x(base + "/feed.xml") + "</id><title>" + x((title || "Your site") + ": changes made by the system") + "</title><updated>" + x(list.length ? list[0].at : "1970-01-01T00:00:00Z") + '</updated><link rel="self" href="' + x(base + "/feed.xml") + '"/><link href="' + x(base) + '"/>' + entries + "</feed>";
}
export function siteBadge(idx, last) {
  const n = idx.list.length, right = n ? "kept up: " + n + " change" + (n === 1 ? "" : "s") : "newly built", w = 70 + right.length * 6.2;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(w) + '" height="20" role="img" aria-label="Ultrastable: ' + x(right) + '"><rect width="64" height="20" fill="#14120f"/><rect x="64" width="' + Math.round(w - 64) + '" height="20" fill="#0a7a3d"/><g fill="#fff" font-family="Verdana,sans-serif" font-size="11"><text x="6" y="14">Ultrastable</text><text x="70" y="14">' + x(right) + "</text></g></svg>";
}
