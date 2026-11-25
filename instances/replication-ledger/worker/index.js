// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The Replication Ledger Worker, first slice: the ledger as JSON with every standing computed at request time, and a health route.
// Pages, the guess-first reveal and the weekly discovery beat come next (docs/issues/Q-RLEDGER-BEAT.json in the core repository).
import data from "./data/findings.json" with { type: "json" };
import { withStandings, FIELDS } from "./ledger.js";
import { KINDS, OUTCOMES, STANDINGS, RUBRIC } from "./standing.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 1), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });

export function route(url, ledger = data) {
  const p = new URL(url).pathname.replace(/\/+$/, "") || "/";
  if (p === "/health") return json({ ok: true, findings: ledger.findings.length });
  if (p === "/api/rubric") return json({ kinds: KINDS, outcomes: OUTCOMES, standings: STANDINGS, rubric: RUBRIC });
  if (p === "/api/findings" || p === "/") {
    const all = withStandings(ledger);
    const field = new URL(url).searchParams.get("field");
    return json({ fields: FIELDS, findings: field ? all.filter(f => f.field === field) : all, projects: ledger.projects || [] });
  }
  const m = p.match(/^\/api\/findings\/([a-z0-9-]+)$/);
  if (m) {
    const f = withStandings(ledger).find(x => x.id === m[1]);
    return f ? json(f) : json({ error: "not_found", code: "finding_not_found" }, 404);
  }
  return json({ error: "not_found", code: "route_not_found" }, 404);
}

export default { fetch: req => route(req.url) };
