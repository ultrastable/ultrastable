// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KGRAPH-1 (Rowan, 2026-11-25): "All UltraStable deployments and systems shall have a knowledge graph (graph network) to automatically build and maintain
// a graph of connections for all data." Each system builds its own graph from its own data and serves it at the URL its row in config.progress.systems
// declares (`knowledge_graph: { url, expect_hours?, min_nodes? }`, kg/1 contract in core/kgraph/insight.js). This tick step is the platform's half of the
// loop: it reads every declared graph (at most once per `every_hours`), checks it with the shared analytics (shape, provenance, size, upkeep age), keeps a
// daily series, and files KG-<system> while a system has no graph, an unreadable one, an invalid or empty one, or one whose upkeep stopped; the same reading
// closes the item. A system with no declaration is `undeclared` and gets the item too, so a new system is given a graph by the executor, not by a person.
import { analyze, validate, VERSION } from './vendor/core/kgraph.js';
import { ORIGINATE_MAX_PER_DAY } from './tick.js';

export const KG_RESERVE = 5;  // one fixed id per system, so the reserve cannot flood; same reasoning as STICKY_RESERVE
export const KG = { every_hours: 6, expect_hours: 3, min_nodes: 10, max_bytes: 4e6 };
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
// SCHEMA-SELF-1: kept equal to migrations/0031_kgraph.sql by test/kgraph.test.js.
export const KGRAPH_DDL = [
  `CREATE TABLE IF NOT EXISTS kgraph_state (system TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, url TEXT, nodes INTEGER, edges INTEGER, communities INTEGER, insights INTEGER, problems INTEGER, last_run TEXT, summary TEXT, error TEXT, checked_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kgraph_series (system TEXT NOT NULL, day TEXT NOT NULL, row TEXT NOT NULL, PRIMARY KEY (system, day))`,
];
let ready = false;
async function ensure(db) { if (ready) return; for (const s of KGRAPH_DDL) await db.prepare(s).run(); ready = true; }
export const _reset = () => { ready = false; };

// Pure judgement of one reading, so the rules are testable without a database.
export function judge(snap, { now = Date.now(), expect_hours = KG.expect_hours, min_nodes = KG.min_nodes } = {}) {
  if (!snap || snap.version !== VERSION) return { state: 'invalid', why: `not a ${VERSION} graph` };
  const problems = validate(snap);
  if (problems.length) return { state: 'invalid', why: `${problems.length} problems, first: ${problems[0].kind} ${problems[0].id || ''}`.trim(), problems: problems.length };
  if (snap.nodes.length < min_nodes) return { state: 'empty', why: `${snap.nodes.length} nodes, fewer than ${min_nodes}` };
  const last = snap.upkeep && snap.upkeep.last_run ? Date.parse(snap.upkeep.last_run) : null;
  if (last === null) return { state: 'stale', why: 'no upkeep run recorded (upkeep.last_run)' };
  const age = (now - last) / 3600e3;
  if (age > expect_hours) return { state: 'stale', why: `last rebuilt ${age.toFixed(1)} h ago, expected every ${expect_hours} h` };
  return { state: 'healthy', why: `rebuilt ${age.toFixed(1)} h ago` };
}

export async function kgraphStep({ db, config, ensureItem, fetchImpl = fetch, now = Date.now() }) {
  // config.kgraph (doctrine/knowledge-graph.json) lists every system with its graph url; a progress row may carry its own knowledge_graph block too.
  const kgc = config && config.kgraph, defaults = (kgc && kgc.defaults) || {};
  const systems = kgc && Array.isArray(kgc.systems) ? kgc.systems.map(s => ({ id: s.id, name: s.name, knowledge_graph: s.url ? { ...defaults, url: s.url, ...(s.expect_hours ? { expect_hours: s.expect_hours } : {}), ...(s.min_nodes ? { min_nodes: s.min_nodes } : {}) } : null }))
    : config && config.progress && config.progress.systems;
  if (!Array.isArray(systems) || !systems.length) return { status: 'no-config' };
  await ensure(db);
  const nowIso = new Date(now).toISOString(), out = { systems: {}, filed: [], closed: [], skipped: [] };
  const prev = Object.fromEntries((await all(db, `SELECT system, state, checked_at FROM kgraph_state`)).map(r => [r.system, r]));
  for (const sys of systems) {
    const kg = sys.knowledge_graph, id = `KG-${sys.id}`.slice(0, 80), p = prev[sys.id];
    // A healthy graph is re-read every every_hours; anything else every pass, so a fix is noticed quickly.
    if (p && p.state === 'healthy' && now - Date.parse(p.checked_at) < KG.every_hours * 3600e3) { out.skipped.push(sys.id); out.systems[sys.id] = 'healthy'; continue; }
    let j, a = null, error = null;
    if (!kg || !kg.url) j = { state: 'undeclared', why: 'no knowledge_graph.url in its progress row' };
    else {
      try {
        const r = await fetchImpl(kg.url, { headers: { accept: 'application/json', 'user-agent': 'ultrastable-tick (kgraph)' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const text = await r.text(); if (text.length > KG.max_bytes) throw new Error(`graph larger than ${KG.max_bytes} bytes`);
        const snap = JSON.parse(text);
        j = judge(snap, { now, expect_hours: kg.expect_hours || KG.expect_hours, min_nodes: kg.min_nodes || KG.min_nodes });
        if (j.state !== 'invalid') a = snap.analysis && snap.analysis.stats ? snap.analysis : analyze(snap, {}, { now });
        if (a) a.last_run = snap.upkeep && snap.upkeep.last_run;
      } catch (e) { error = String(e && e.message || e).slice(0, 160); j = { state: 'unreadable', why: error }; }
    }
    const st = a && a.stats || {};
    const summary = a ? { central: (a.central || []).slice(0, 5), top: (a.insights || []).slice(0, 5).map(i => ({ id: i.id, type: i.type, title: i.title })), why: j.why } : { why: j.why };
    await run(db, `INSERT INTO kgraph_state (system, name, state, url, nodes, edges, communities, insights, problems, last_run, summary, error, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(system) DO UPDATE SET name=excluded.name, state=excluded.state, url=excluded.url, nodes=COALESCE(excluded.nodes, kgraph_state.nodes), edges=COALESCE(excluded.edges, kgraph_state.edges),
      communities=COALESCE(excluded.communities, kgraph_state.communities), insights=COALESCE(excluded.insights, kgraph_state.insights), problems=excluded.problems, last_run=COALESCE(excluded.last_run, kgraph_state.last_run),
      summary=excluded.summary, error=excluded.error, checked_at=excluded.checked_at`,
      sys.id, sys.name || sys.id, j.state, (kg && kg.url) || null, st.nodes ?? null, st.edges ?? null, st.communities ?? null, a ? (a.insights || []).length : null, j.problems ?? 0, (a && a.last_run) || null, JSON.stringify(summary), error, nowIso);
    if (a) {
      const day = nowIso.slice(0, 10);
      await run(db, `INSERT INTO kgraph_series (system, day, row) VALUES (?,?,?) ON CONFLICT(system, day) DO UPDATE SET row=excluded.row`, sys.id, day, JSON.stringify({ day, state: j.state, nodes: st.nodes, edges: st.edges, communities: st.communities, insights: (a.insights || []).length }));
      await run(db, `DELETE FROM kgraph_series WHERE system = ? AND day < ?`, sys.id, new Date(now - 400 * 864e5).toISOString().slice(0, 10));
    }
    out.systems[sys.id] = j.state;
    if (j.state !== 'healthy' && ensureItem) {
      const what = j.state === 'undeclared' ? `${sys.name || sys.id} has no knowledge graph: build one from all its data, serve it as kg/1 (vendor core/kgraph/insight.js) and set its url in doctrine/knowledge-graph.json`
        : `${sys.name || sys.id} knowledge graph is ${j.state}: ${j.why}`;
      const made = await ensureItem(db, { id, kind: 'fix', owner_role: 'knowledge', priority: j.state === 'undeclared' ? 0 : -1,
        title: `${what}. Prediction: kgraph_state.state of ${sys.id} is healthy within 72 h.`.slice(0, 400), done_check: `kgraph_state.state of ${sys.id} is healthy`, closing_probe: `kgraph:${sys.id}` },
        { cap: ORIGINATE_MAX_PER_DAY + KG_RESERVE, now });
      if (made) out.filed.push(id);
      else { const r = await run(db, `UPDATE items SET status='ready', disposition=NULL, updated_at=? WHERE id=? AND status IN ('done','superseded','cancelled')`, nowIso, id).catch(() => null); if (r && r.meta && r.meta.changes) out.filed.push(id); }
    } else if (j.state === 'healthy') {
      const r = await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, `probe green: kgraph:${sys.id} healthy, ${st.nodes} nodes, ${j.why}`, nowIso, id).catch(() => null);
      if (r && r.meta && r.meta.changes) out.closed.push(id);
    }
  }
  return out;
}

export async function readKgraph(db) {
  await ensure(db);
  const systems = [];
  for (const r of await all(db, `SELECT * FROM kgraph_state ORDER BY system`)) {
    const series = (await all(db, `SELECT row FROM kgraph_series WHERE system = ? ORDER BY day`, r.system)).map(x => JSON.parse(x.row));
    systems.push({ ...r, summary: r.summary ? JSON.parse(r.summary) : null, series });
  }
  return { rule: 'KGRAPH-1', version: VERSION, systems };
}
