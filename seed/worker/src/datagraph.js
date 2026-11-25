// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DATAGRAPH-1 (Rowan, 2026-11-25): "All Ultrastable deployments and systems shall have a knowledge graph (graph network) to automatically build and
// maintain a graph of connections for all data." Every system built from the seed runs this tick step; no tenant sets anything up.
// The step reads every table of the system's own D1 (bounded rows per table, secret-shaped tables and columns never read), turns rows into nodes and
// references into edges with core/datagraph, and keeps the graph in D1 bi-temporally: a node or edge records when it was first seen, and one that leaves
// the data gets valid_to instead of being deleted, so the graph's history stays queryable. Writes happen only for what changed (content hash), so a
// quiet system costs reads, not writes. Each pass analyses the graph (PageRank hubs, communities, bridges, orphans), proposes links by Adamic-Adar, settles
// earlier proposals against the data (kept when the data later links the pair, dropped after keepDays), re-weights insight kinds from those outcomes, and
// files one KG-ORPHANS-<kind> item when most of a kind's records connect to nothing; the same reading closes it.
// Read side: /api/graph (summary), /api/graph/node?id= (a node and its neighbourhood, for retrieval), /api/graph/search?q=, /api/graph/insights, /graph.
import { extract, analyze, predict, insights as findInsights, settle, calibrate, neighborhood, DEFAULTS, SKIP_TABLE } from './vendor/core/datagraph.js';
import { ORIGINATE_MAX_PER_DAY } from './tick.js';
export const KG_RESERVE = 2;  // like STICKY_RESERVE: the daily originate cap is spent early by other filers; one orphan finding a pass needs a small reserve
export const KG_DEFAULTS = Object.freeze({ every_min: 360, max_rows_total: 6000, max_rows_per_table: 400, max_tables: 60, proposals_per_pass: 10 });

const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
// SCHEMA-SELF-1: the Worker carries its own DDL; kept equal to migrations/0031_datagraph.sql by test/datagraph.test.js.
export const DATAGRAPH_DDL = [
  `CREATE TABLE IF NOT EXISTS kg_nodes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT, props TEXT, hash TEXT, source TEXT, first_seen TEXT NOT NULL, changed_at TEXT NOT NULL, valid_to TEXT)`,
  `CREATE TABLE IF NOT EXISTS kg_edges (src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', confidence REAL, source TEXT, why TEXT, first_seen TEXT NOT NULL, valid_to TEXT, outcome TEXT, PRIMARY KEY (src, rel, dst))`,
  `CREATE INDEX IF NOT EXISTS kg_edges_dst ON kg_edges (dst)`,
  `CREATE INDEX IF NOT EXISTS kg_nodes_kind ON kg_nodes (kind)`,
  `CREATE TABLE IF NOT EXISTS kg_insights (id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT, text TEXT NOT NULL, score REAL, prediction TEXT, probe TEXT, state TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, item_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS kg_runs (at TEXT PRIMARY KEY, summary TEXT NOT NULL)`,
];
let ready = false;
async function ensure(db) { if (ready) return; for (const s of DATAGRAPH_DDL) await db.prepare(s).run(); ready = true; }
export const _reset = () => { ready = false; };
const qi = n => '"' + String(n).replace(/"/g, '""') + '"';

// Every user table, newest rows first, inside the row budget. A table that refuses rowid (WITHOUT ROWID) is read without it.
async function readTables(db, cfg, skip) {
  const names = (await all(db, `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)).map(r => r.name).filter(n => !skip(n)).slice(0, cfg.max_tables);
  const per = Math.max(20, Math.min(cfg.max_rows_per_table, Math.floor(cfg.max_rows_total / Math.max(1, names.length)))), out = [], errors = [];
  for (const name of names) {
    // A secret-shaped or platform table is passed on empty, never SELECTed: core drops it by name and reports it (_cf_KV refuses reads anyway).
    if (SKIP_TABLE.test(name)) { out.push({ name, rows: [] }); continue; }
    try { out.push({ name, rows: await all(db, `SELECT rowid AS _rid, * FROM ${qi(name)} ORDER BY rowid DESC LIMIT ?`, per) }); }
    catch (e) {
      try { out.push({ name, rows: await all(db, `SELECT * FROM ${qi(name)} LIMIT ?`, per) }); }
      catch (e2) { errors.push(`${name}: ${String(e2 && e2.message || e2).slice(0, 80)}`); }
    }
  }
  return { tables: out, errors, per };
}

async function batched(db, stmts, size = 50) { for (let i = 0; i < stmts.length; i += size) await db.batch(stmts.slice(i, i + size)); }

// The stored graph as of now (valid rows only), in core/datagraph's shape.
export async function loadGraph(db) {
  await ensure(db);
  const nodes = (await all(db, `SELECT id, kind, label, props, hash, first_seen FROM kg_nodes WHERE valid_to IS NULL`)).map(n => ({ ...n, props: n.props ? JSON.parse(n.props) : {} }));
  const edges = await all(db, `SELECT src, rel, dst, status, confidence, source, why, first_seen FROM kg_edges WHERE valid_to IS NULL`);
  return { nodes, edges };
}

export async function datagraphStep({ db, config = {}, ensureItem, now = Date.now(), force = false }) {
  const cfg = { ...KG_DEFAULTS, ...(config.knowledge_graph || {}) };
  if (cfg.enabled === false) return { status: 'disabled-by-config' };
  await ensure(db);
  const nowIso = new Date(now).toISOString();
  const last = await db.prepare(`SELECT at, summary FROM kg_runs ORDER BY at DESC LIMIT 1`).first();
  if (!force && last && now - Date.parse(last.at) < cfg.every_min * 60e3) return { status: 'not-due', last: last.at };
  const t0 = Date.now(), skip = n => (cfg.skip || []).includes(n);
  const { tables, errors, per } = await readTables(db, cfg, skip);
  const built = extract(tables, { at: nowIso, declared: cfg.declared || {}, maxRowsPerTable: per });

  // Diff against what is stored: write new or changed nodes, close vanished ones, same for edges. Proposed edges are left to settle().
  const stored = new Map((await all(db, `SELECT id, hash, valid_to FROM kg_nodes`)).map(r => [r.id, r]));
  const ek = e => `${e.src}|${e.rel}|${e.dst}`;
  const storedE = new Map((await all(db, `SELECT src, rel, dst, status, valid_to FROM kg_edges`)).map(r => [ek(r), r]));
  const stmts = [], seenN = new Set(), seenE = new Set(), changes = { nodes_new: 0, nodes_changed: 0, nodes_closed: 0, edges_new: 0, edges_closed: 0 };
  for (const n of built.nodes) {
    seenN.add(n.id); const o = stored.get(n.id);
    if (o && o.hash === n.hash && o.valid_to == null) continue;
    if (!o) changes.nodes_new++; else changes.nodes_changed++;
    stmts.push(db.prepare(`INSERT INTO kg_nodes (id, kind, label, props, hash, source, first_seen, changed_at, valid_to) VALUES (?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, label=excluded.label, props=excluded.props, hash=excluded.hash, source=excluded.source, changed_at=excluded.changed_at, valid_to=NULL`)
      .bind(n.id, n.kind, n.label, JSON.stringify(n.props), n.hash, n.source, nowIso, nowIso));
  }
  // A table whose read failed this pass keeps its nodes: an unreadable table is not an empty one.
  const unread = new Set(errors.map(e => e.split(':')[0]));
  const tableOf = id => id.slice(0, id.indexOf(':'));
  const readCounts = new Map(tables.map(t => [t.name, t.rows.length]));
  for (const [id, o] of stored) {
    if (o.valid_to != null || seenN.has(id) || unread.has(tableOf(id))) continue;
    if ((readCounts.get(tableOf(id)) || 0) >= per) continue;  // the table was cut at the row budget, so an unseen older row may still exist
    changes.nodes_closed++; stmts.push(db.prepare(`UPDATE kg_nodes SET valid_to=? WHERE id=?`).bind(nowIso, id));
  }
  for (const e of built.edges) {
    const k = ek(e); seenE.add(k); const o = storedE.get(k);
    if (o && o.status === 'confirmed' && o.valid_to == null) continue;
    changes.edges_new++;
    stmts.push(db.prepare(`INSERT INTO kg_edges (src, rel, dst, status, confidence, source, why, first_seen, valid_to) VALUES (?,?,?,'confirmed',?,?,NULL,?,NULL)
      ON CONFLICT(src, rel, dst) DO UPDATE SET status='confirmed', confidence=excluded.confidence, source=excluded.source, valid_to=NULL`).bind(e.src, e.rel, e.dst, e.confidence, e.source, nowIso));
  }
  for (const [k, o] of storedE) {
    if (o.status !== 'confirmed' || o.valid_to != null || seenE.has(k)) continue;
    const [src] = k.split('|');
    if (unread.has(tableOf(src)) || (!seenN.has(src) && stored.has(src) && stored.get(src).valid_to == null && (readCounts.get(tableOf(src)) || 0) >= per)) continue;
    changes.edges_closed++; stmts.push(db.prepare(`UPDATE kg_edges SET valid_to=? WHERE src=? AND rel=? AND dst=?`).bind(nowIso, ...k.split('|')));
  }
  await batched(db, stmts);

  // Analyse the current graph, settle earlier proposals, learn kind weights, propose new links.
  const graph = await loadGraph(db);
  const a = analyze(graph);
  const proposals = graph.edges.filter(e => e.status === 'proposed');
  const settled = settle(proposals, graph, { now });
  const ps = [];
  for (const s of settled) if (s.outcome !== 'open') ps.push(db.prepare(`UPDATE kg_edges SET status=?, outcome=?, valid_to=? WHERE src=? AND rel=? AND dst=? AND status='proposed'`).bind(s.outcome === 'kept' ? 'kept' : 'rejected', s.outcome, nowIso, s.src, s.rel, s.dst));
  const history = (await all(db, `SELECT outcome FROM kg_edges WHERE outcome IN ('kept','dropped')`)).map(r => ({ kind: 'link', outcome: r.outcome }));
  const cal = calibrate([...history, ...settled.filter(s => s.outcome !== 'open').map(s => ({ kind: 'link', outcome: s.outcome }))]);
  const known = (await all(db, `SELECT src, dst FROM kg_edges WHERE status IN ('proposed','rejected','kept')`));
  const cands = predict(graph, { known, candidates: DEFAULTS.candidates });
  for (const c of cands.slice(0, cfg.proposals_per_pass)) ps.push(db.prepare(`INSERT INTO kg_edges (src, rel, dst, status, confidence, source, why, first_seen) VALUES (?,?,?,'proposed',?,?,?,?) ON CONFLICT(src, rel, dst) DO NOTHING`)
    .bind(c.src, 'related', c.dst, Math.min(1, c.score / 3), 'adamic-adar', c.why, nowIso));
  await batched(db, ps);

  const previous = last ? JSON.parse(last.summary) : null;
  const found = findInsights({ analysis: a, candidates: cands, previous, weights: cal.weights });
  const is = [], live = new Set(found.map(f => f.id));
  for (const f of found) is.push(db.prepare(`INSERT INTO kg_insights (id, kind, subject, text, score, prediction, probe, state, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,'open',?,?)
    ON CONFLICT(id) DO UPDATE SET text=excluded.text, score=excluded.score, prediction=excluded.prediction, state='open', last_seen=excluded.last_seen`).bind(f.id, f.kind, f.subject, f.text, f.score, f.prediction, f.probe, nowIso, nowIso));
  for (const r of await all(db, `SELECT id FROM kg_insights WHERE state='open'`)) if (!live.has(r.id)) is.push(db.prepare(`UPDATE kg_insights SET state='cleared', last_seen=? WHERE id=?`).bind(nowIso, r.id));
  await batched(db, is);

  // One item per pass, for the strongest orphan finding; an item whose kind is no longer orphaned is closed by the same reading.
  const filed = [], closed = [];
  const orphan = found.find(f => f.kind === 'orphans');
  if (orphan && ensureItem) {
    const id = `KG-ORPHANS-${orphan.subject}`.slice(0, 80);
    const made = await ensureItem(db, { id, kind: 'improvement', owner_role: 'product-manager', priority: 0, title: `${orphan.text} Prediction: ${orphan.prediction}.`.slice(0, 400),
      done_check: `the ${orphan.subject} kind is no longer mostly unconnected in the knowledge graph`, closing_probe: orphan.probe }, { cap: ORIGINATE_MAX_PER_DAY + KG_RESERVE, now });
    if (made) { filed.push(id); await run(db, `UPDATE kg_insights SET item_id=? WHERE id=?`, id, orphan.id); }
  }
  for (const r of await all(db, `SELECT id FROM items WHERE id LIKE 'KG-ORPHANS-%' AND status NOT IN ('done','superseded','cancelled')`).catch(() => [])) {
    const kind = r.id.slice('KG-ORPHANS-'.length);
    if (live.has(`orphans:${kind}`)) continue;
    const u = await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=?`, `probe green: datagraph:orphans:${kind} no longer fires`, nowIso, r.id).catch(() => null);
    if (u && u.meta && u.meta.changes) closed.push(r.id);
  }

  const { _community, _pagerank, ...summary } = a;
  const out = { ...summary, at: nowIso, tables: tables.length, rows_per_table: per, read_errors: errors, dropped: { tables: built.dropped.tables, columns: built.dropped.columns.length, nodes: built.dropped.nodes, ambiguous: built.dropped.ambiguous },
    changes, proposals: { new: cands.slice(0, cfg.proposals_per_pass).length, kept: settled.filter(s => s.outcome === 'kept').length, dropped: settled.filter(s => s.outcome === 'dropped').length, open: settled.filter(s => s.outcome === 'open').length },
    weights: cal.weights, insights: found.length, filed, closed, ms: Date.now() - t0 };
  await run(db, `INSERT INTO kg_runs (at, summary) VALUES (?,?) ON CONFLICT(at) DO UPDATE SET summary=excluded.summary`, nowIso, JSON.stringify(out));
  await run(db, `DELETE FROM kg_runs WHERE at < ?`, new Date(now - 400 * 864e5).toISOString());
  return out;
}

// Read side. Every query is bounded and by key or index, except the label search, which is capped.
// Privacy (§7 outranks reach): the graph holds rows of every table, so what it shows depends on who asks. `open` (the owner's bearer) sees everything.
// Anyone else sees counts, the series and the orphan and fragmentation findings (which carry only kinds and numbers), and records only of the kinds a
// system declares public in config.knowledge_graph.public_kinds; every other record is shown as "a <kind> record", never its label, id or fields.
const pub = (kinds, k) => Array.isArray(kinds) && kinds.includes(k);
const veil = (kinds, x) => (pub(kinds, x.kind) ? x : { kind: x.kind, label: `a ${x.kind} record`, redacted: true, ...Object.fromEntries(Object.entries(x).filter(([k]) => !['id', 'label', 'props', 'kind', 'via', 'why'].includes(k))) });
export async function readGraph(db, { open = false, publicKinds = [] } = {}) {
  await ensure(db);
  const r = await db.prepare(`SELECT summary FROM kg_runs ORDER BY at DESC LIMIT 1`).first();
  const series = (await all(db, `SELECT at, summary FROM kg_runs ORDER BY at DESC LIMIT 60`)).map(x => { const s = JSON.parse(x.summary); return { at: x.at, nodes: s.nodes, edges: s.edges, components: s.components, orphans: s.orphans }; }).reverse();
  let last = r ? JSON.parse(r.summary) : null;
  if (last && !open) last = { ...last, hubs: (last.hubs || []).map(h => veil(publicKinds, h)), bridges: (last.bridges || []).map(b => veil(publicKinds, b)), communities: (last.communities || []).map(c => ({ size: c.size, kinds: c.kinds })) };
  return { built: Boolean(r), view: open ? 'owner' : 'public', last, series };
}
export async function readInsights(db, { limit = 50, open = false, publicKinds = [] } = {}) {
  await ensure(db);
  let insights = await all(db, `SELECT id, kind, subject, text, score, prediction, probe, state, first_seen, last_seen, item_id FROM kg_insights WHERE state='open' ORDER BY score DESC, id LIMIT ?`, Math.min(200, limit));
  let proposals = await all(db, `SELECT src, dst, why, confidence, first_seen FROM kg_edges WHERE status='proposed' AND valid_to IS NULL ORDER BY confidence DESC LIMIT 50`);
  if (!open) {
    const kindOfId = id => String(id || '').slice(0, String(id || '').indexOf(':'));
    insights = insights.filter(i => i.kind === 'orphans' || i.kind === 'fragmenting' || pub(publicKinds, kindOfId(i.subject)));
    proposals = proposals.filter(p => pub(publicKinds, kindOfId(p.src)) && pub(publicKinds, kindOfId(p.dst)));
  }
  return { view: open ? 'owner' : 'public', insights, proposals };
}
export async function readNode(db, id, { depth = 1, open = false, publicKinds = [] } = {}) {
  await ensure(db);
  const n = await db.prepare(`SELECT id, kind, label, props, first_seen, changed_at, valid_to FROM kg_nodes WHERE id = ?`).bind(id).first();
  if (!n || (!open && !pub(publicKinds, n.kind))) return null;
  // GraphRAG-style local context: the node, its edges both ways, and (depth 2) the neighbours' edges, bounded
  const ring = async ids => {
    const es = [];
    for (const x of ids.slice(0, 40)) es.push(...await all(db, `SELECT src, rel, dst, status, confidence FROM kg_edges WHERE valid_to IS NULL AND (src = ? OR dst = ?) LIMIT 60`, x, x));
    return es;
  };
  let edges = await ring([id]);
  if (depth > 1) edges = [...edges, ...await ring([...new Set(edges.map(e => (e.src === id ? e.dst : e.src)))])];
  const ids = [...new Set(edges.flatMap(e => [e.src, e.dst]))].slice(0, 120);
  const nodes = [];
  for (const x of ids) { const m = await db.prepare(`SELECT id, kind, label FROM kg_nodes WHERE id = ?`).bind(x).first(); if (m && (open || pub(publicKinds, m.kind))) nodes.push(m); }
  const keep = new Set(nodes.map(x => x.id));
  const sub = neighborhood({ nodes, edges: edges.filter(e => keep.has(e.src) && keep.has(e.dst)) }, id, { depth, limit: 120 });
  return { view: open ? 'owner' : 'public', node: { ...n, props: n.props ? JSON.parse(n.props) : {} }, neighbors: sub.nodes.filter(x => x.id !== id), edges: sub.edges };
}
export async function searchGraph(db, q, { limit = 20, open = false, publicKinds = [] } = {}) {
  await ensure(db);
  const s = String(q || '').trim().slice(0, 80);
  if (s.length < 2) return { results: [] };
  const rows = await all(db, `SELECT id, kind, label FROM kg_nodes WHERE valid_to IS NULL AND (label LIKE ? OR id LIKE ?) ORDER BY length(label) LIMIT ?`, `%${s}%`, `%${s}%`, Math.min(200, open ? limit : limit * 5));
  return { view: open ? 'owner' : 'public', results: (open ? rows : rows.filter(r => pub(publicKinds, r.kind))).slice(0, Math.min(50, limit)) };
}
