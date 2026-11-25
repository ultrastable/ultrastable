// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The Replication Ledger Worker. Pages and JSON are rendered on every request from the seed (data/findings.json) merged with what the
// discovery loop has found (store.js, D1). The loop runs on the hourly cron, and any request that finds the last beat older than
// BEAT.SPARK_MIN starts one in the background, so the ledger keeps itself current even if the cron stops.
import seed from "./data/findings.json" with { type: "json" };
import { withStandings, FIELDS } from "./ledger.js";
import { KINDS, OUTCOMES, STANDINGS, RUBRIC } from "./standing.js";
import { BEAT } from "./discover.js";
import { load, beat, freshness, minutesSince } from "./store.js";
import { graphTick, graphApi, graphView } from "./graph.js";
import { home, fieldPage, findingPage, projectsPage, rubricPage, changesPage, graphPage, notFound, SITE } from "./site.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 1), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });
const html = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=120" } });

export function route(url, ledger = seed, live = { checks: {}, beats: [], changes: [], cites: {} }) {
  const u = new URL(url);
  const p = u.pathname.replace(/\/+$/, "") || "/";
  const all = withStandings(ledger);
  if (p === "/health") {
    const fr = freshness(ledger, live);
    return json({ ok: true, findings: ledger.findings.length, attempts: all.reduce((n, f) => n + f.standing.attempts, 0),
      discovered: { findings: ledger.findings.filter(f => f.discovered).length, attempts: all.reduce((n, f) => n + f.replications.filter(r => r.machine).length, 0), leads: live.leads || 0 },
      loop: { beats: live.beats.length, last_beat_minutes: fr.last_beat_minutes, fresh: fr.ok } });
  }
  if (p === "/api/freshness") { const fr = freshness(ledger, live); return json(fr, fr.ok ? 200 : 503); }
  if (p === "/api/beats") return json({ beats: live.beats.map(b => ({ ...b, errors: JSON.parse(b.errors || "[]") })) });
  if (p === "/api/citations") return json({ checked: Object.keys(live.cites).length, failed: Object.values(live.cites).filter(c => !c.ok).map(c => ({ doi: c.doi, issues: JSON.parse(c.issues) })) });
  if (p === "/api/rubric") return json({ kinds: KINDS, outcomes: OUTCOMES, standings: STANDINGS, rubric: RUBRIC });
  if (p === "/api/findings") {
    const field = u.searchParams.get("field");
    return json({ fields: FIELDS, findings: field ? all.filter(f => f.field === field) : all, projects: ledger.projects || [] });
  }
  if (p === "/feed.json" || p === "/api/changes") {
    const names = Object.fromEntries(ledger.findings.map(f => [f.id, f.name]));
    return json({ version: "https://jsonfeed.org/version/1.1", title: "Replication Ledger: what changed", home_page_url: SITE, feed_url: SITE + "/feed.json",
      items: live.changes.map(c => ({ id: `${c.finding_id}@${c.at}`, url: `${SITE}/f/${c.finding_id}`, date_published: c.at,
        title: `${names[c.finding_id] || c.finding_id}: ${c.from_st ? STANDINGS[c.from_st]?.name : "added"} to ${STANDINGS[c.to_st]?.name}`,
        content_text: c.doi ? `A replication (doi:${c.doi}) reported: ${OUTCOMES[c.outcome]?.name || c.outcome}.` : "The ledger added this finding after finding a replication paper." })) });
  }
  const m = p.match(/^\/api\/findings\/([a-z0-9-]+)$/);
  if (m) {
    const f = all.find(x => x.id === m[1]);
    return f ? json({ ...f, live: live.checks[f.id] || null }) : json({ error: "not_found", code: "finding_not_found" }, 404);
  }
  if (p.startsWith("/api/")) return json({ error: "not_found", code: "route_not_found" }, 404);
  if (p === "/") return html(home(all, ledger.projects || [], live));
  if (p === "/rubric") return html(rubricPage());
  if (p === "/projects") return html(projectsPage(ledger.projects || []));
  if (p === "/changes") return html(changesPage(live.changes, live.beats, ledger));
  if (p === "/graph") return html(graphPage(live.graph || null));
  if (p.startsWith("/field/")) { const id = p.slice(7); return FIELDS[id] && all.some(f => f.field === id) ? html(fieldPage(id, all)) : html(notFound(), 404); }
  if (p.startsWith("/f/")) { const f = all.find(x => x.id === p.slice(3)); return f ? html(findingPage(f, live)) : html(notFound(), 404); }
  return html(notFound(), 404);
}

// After each beat the knowledge graph is rebuilt from the ledger as it now stands (KGRAPH-1, graph.js).
const runBeat = (env, trigger) => beat(env, { trigger }).catch(e => console.error("beat failed", e?.message || e))
  .then(async r => { try { const { ledger } = await load(env); await graphTick(env.DB, ledger); } catch (e) { console.error("graph failed", e?.message || e); } return r; });

export default {
  async fetch(req, env, ctx) {
    const { ledger, live } = await load(env).catch(e => (console.error("load failed", e?.message || e), load(null)));
    const age = minutesSince(live.beat?.ended_at);
    if (new URL(req.url).pathname === "/pulse/watch" && req.method === "POST") {
      // The restart route the platform watchdog calls (doctrine/resilience.json): runs a beat only when the last one is old.
      if (!env?.DB) return new Response(JSON.stringify({ ok: false, error: "no database bound" }), { status: 503, headers: { "content-type": "application/json" } });
      const r = age != null && age <= BEAT.SPARK_MIN ? { skipped: "the last beat is recent", last_beat_minutes: age } : await beat(env, { trigger: "watch" }).catch(e => ({ error: String(e?.message || e) }));
      return new Response(JSON.stringify({ ok: !r.error, ...r }), { status: r.error ? 500 : 200, headers: { "content-type": "application/json" } });
    }
    if (env?.DB && new URL(req.url).pathname.startsWith("/api/graph")) return graphApi(req, env.DB);
    if (env?.DB && new URL(req.url).pathname.replace(/\/+$/, "") === "/graph") live.graph = await graphView(env.DB).catch(e => (console.error("graph view failed", e?.message || e), null));
    if (env?.DB && (age == null || age > BEAT.SPARK_MIN)) ctx?.waitUntil?.(runBeat(env, "spark"));
    return route(req.url, ledger, live);
  },
  async scheduled(_ev, env, ctx) { ctx.waitUntil(runBeat(env, "cron")); }
};
