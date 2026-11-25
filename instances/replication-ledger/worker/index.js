// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The Replication Ledger Worker: reader pages and the ledger as JSON, every standing computed at request time from data/findings.json.
// Holds no secret and no database: the ledger is code, so a deploy is the whole release. The weekly discovery beat comes next
// (docs/issues/Q-RLEDGER-BEAT.json in the core repository).
import data from "./data/findings.json" with { type: "json" };
import { withStandings, FIELDS } from "./ledger.js";
import { KINDS, OUTCOMES, STANDINGS, RUBRIC } from "./standing.js";
import { home, fieldPage, findingPage, projectsPage, rubricPage, notFound } from "./site.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 1), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });
const html = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });

export function route(url, ledger = data) {
  const u = new URL(url);
  const p = u.pathname.replace(/\/+$/, "") || "/";
  const all = withStandings(ledger);
  if (p === "/health") return json({ ok: true, findings: ledger.findings.length, attempts: all.reduce((n, f) => n + f.standing.attempts, 0) });
  if (p === "/api/rubric") return json({ kinds: KINDS, outcomes: OUTCOMES, standings: STANDINGS, rubric: RUBRIC });
  if (p === "/api/findings") {
    const field = u.searchParams.get("field");
    return json({ fields: FIELDS, findings: field ? all.filter(f => f.field === field) : all, projects: ledger.projects || [] });
  }
  const m = p.match(/^\/api\/findings\/([a-z0-9-]+)$/);
  if (m) {
    const f = all.find(x => x.id === m[1]);
    return f ? json(f) : json({ error: "not_found", code: "finding_not_found" }, 404);
  }
  if (p.startsWith("/api/")) return json({ error: "not_found", code: "route_not_found" }, 404);
  if (p === "/") return html(home(all, ledger.projects || []));
  if (p === "/rubric") return html(rubricPage());
  if (p === "/projects") return html(projectsPage(ledger.projects || []));
  if (p.startsWith("/field/")) { const id = p.slice(7); return FIELDS[id] && all.some(f => f.field === id) ? html(fieldPage(id, all)) : html(notFound(), 404); }
  if (p.startsWith("/f/")) { const f = all.find(x => x.id === p.slice(3)); return f ? html(findingPage(f)) : html(notFound(), 404); }
  return html(notFound(), 404);
}

export default { fetch: req => route(req.url) };
