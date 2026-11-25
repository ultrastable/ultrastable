// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KGRAPH-1 for the Replication Ledger: the ledger's knowledge graph, rebuilt by the hourly beat with the shared engine (vendor/ultrastable/knowledge.js,
// kept equal to the core's seed/worker/src/knowledge.js by doctrine/tenant-repos.json). Every finding is a record: its field and topic, the
// original study and its authors, every replication attempt (seed or machine-read) with its outcome and authors, and every lead the loop filed.
// The engine finds what nobody wrote down: findings that rest on the same researchers' work, researchers whose work spans fields, findings
// with no replication attempt yet. Each finding is checked later and kinds that come true are trusted more (calibration in the engine).
// Data: /api/graph, /api/graph/insights, /api/graph/node, /api/graph/method, /api/graph/health.
import { runKg, kgHealth, handleKg, lastRun, insights, practices, methodHtml } from "../vendor/ultrastable/knowledge.js";

export const TENANT = "replication-ledger";

// "Baumeister RF, Bratslavsky E, et al." -> ["Baumeister RF", "Bratslavsky E"]; a consortium stays whole.
export function authorsOf(s) {
  const t = String(s || "").replace(/,?\s*\bet al\.?/g, "").trim();
  if (!t) return [];
  if (/collaboration|consortium|project|group|team|network|many labs/i.test(t)) return [t];
  return t.split(/,\s*|\s+and\s+|\s*&\s*/).map(x => x.trim()).filter(Boolean).slice(0, 12);
}

function study(cite, { node, edge }, extra = {}) {
  const st = node("study", cite.title, { year: cite.year || null, doi: cite.doi || null, ...extra });
  for (const a of authorsOf(cite.authors)) edge(st, "by", node("author", a));
  if (cite.venue) edge(st, "in_venue", node("venue", cite.venue));
  return st;
}

export const MAPPERS = {
  finding: (f, g) => {
    const { node, edge } = g;
    const me = node("finding", f.name, { field: f.field, topic: f.topic || null, slug: f.id }, "finding:" + f.id);
    if (f.field) edge(me, "in_field", node("field", f.field, {}, "field:" + f.field));
    if (f.topic) edge(me, "in_topic", node("topic", f.topic));
    if (f.original?.title) {
      const o = study(f.original, g, { role: "original" }); edge(me, "claimed_in", o);
      for (const a of authorsOf(f.original.authors)) edge(me, "draws_on", node("author", a), { weight: 0.5 });
    }
    for (const r of f.replications || []) {
      if (!r.cite?.title) continue;
      const st = study(r.cite, g, { kind: r.kind || null, outcome: r.outcome || null, machine: !!r.machine });
      edge(me, "tested_by", st, { why: r.outcome || null });
      if (r.outcome === "failed" || r.outcome === "reversed") edge(me, "failed_in", st);
      for (const a of authorsOf(r.cite.authors)) edge(me, "draws_on", node("author", a), { weight: 0.5 });
    }
  },
  lead: (l, { node, edge }) => {
    if (!l.cite?.title || !l.finding_id) return;
    const st = node("study", l.cite.title, { year: l.cite.year || null, doi: l.cite.doi || null, found_by: "discovery loop" });
    edge(st, "may_test", node("finding", l.finding_name || l.finding_id, { slug: l.finding_id }, "finding:" + l.finding_id));
  },
};

export const SPEC = {
  predict: [{ from: "finding", to: "finding" }],
  via_kinds: ["author", "venue"],
  max_hub: 10,
  bridge_kinds: ["author"],
  gaps: [
    { id: "untested", kind: "finding", need: { rel: "tested_by", dir: "out" }, weight: 0.7, text: n => `"${n.label}" has no replication attempt on the ledger yet.` },
  ],
  link_text: (a, b, via) => `"${a}" and "${b}" share researchers or journals (${via.slice(0, 3).join("; ")}): when one fails to replicate, look at the other.`,
  bridge_text: (n, k) => `${n} appears across ${k} separate clusters of findings.`,
  max_new_per_run: 5,
};

export async function records(db, ledger) {
  const names = Object.fromEntries(ledger.findings.map(f => [f.id, f.name]));
  let leads = [];
  try { leads = (await db.prepare("SELECT finding_id, doi, body FROM leads ORDER BY found_at DESC LIMIT 1000").all()).results || []; }
  catch (e) { if (!/no such table/.test(String(e?.message))) throw e; }
  return [...ledger.findings.map(f => ({ type: "finding", source: "finding/" + f.id, data: f })),
    ...leads.map(r => { let b = {}; try { b = JSON.parse(r.body); } catch { b = {}; } return { type: "lead", source: `lead/${r.finding_id}/${r.doi}`, data: { ...b, finding_id: r.finding_id, finding_name: names[r.finding_id] } }; })];
}

// Runs after each beat, at most once per 55 minutes.
export async function graphTick(db, ledger, now = Date.now()) {
  const last = await lastRun(db, TENANT);
  if (last && !last.error && now - last.at < 55 * 6e4) return { skipped: "recent" };
  return runKg(db, { tenant: TENANT, records: await records(db, ledger), mappers: MAPPERS, spec: SPEC, now });
}
export const graphHealth = (db, now = Date.now()) => kgHealth(db, TENANT, now);
export const graphApi = (req, db, now = Date.now()) => handleKg(req, db, { tenant: TENANT, now });

// What the /graph page shows, read live from D1 on every request: the engine's own measurements and the open insights.
export async function graphView(db, now = Date.now()) {
  const [p, open] = await Promise.all([practices(db, TENANT, now), insights(db, TENANT, { status: "open", limit: 25 })]);
  return { health: p.health, insights: open, method: methodHtml(p) };
}
