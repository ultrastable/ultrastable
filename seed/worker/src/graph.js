// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KGRAPH-1 (Rowan, 2026-11-25): "All Ultrastable deployments and systems shall have a knowledge graph (graph network) to automatically build and maintain a
// graph of connections for all data." Every seeded system carries this tick step, so a tenant gets its graph with no setup.
// Ingest: each source (work items, predictions, decisions, metrics) is read past its own rowid cursor, at most `batch` rows a pass, so a pass reads only
// what changed (a graph that rescans its tables on every pass reads billions of rows a month; this never rescans). Extract: deterministic, no model: the row itself is a
// node, ids and rule tags it mentions (FOO-12, Q-BAR-x) and file paths become nodes with `mentions` edges, a prediction links to its metric. Each node
// keeps its top terms; when Workers AI is bound and the `embed` knob is on, up to `embed_max` nodes a pass also get a small embedding.
// Insight: every new node is compared with a bounded pool of recent nodes. A pair that reads alike but has no edge and no shared neighbour is a lead
// (a `proposed` edge, never a fact). At most `max_filed_per_day` leads become KG-<hash> items the managers take. A lead is `kept` when a later row
// links the pair for real, which is the insight-yield measure. Probes: freshness (the cursor keeps up with its source), growth (daily series) and yield.
// Public by default: /api/graph, /api/graph/export and /graph serve it. Nothing here posts or calls outside except the optional embedding.
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = (db, sql, ...a) => db.prepare(sql).bind(...a).first();

// SCHEMA-SELF-1: kept equal to migrations/0031_graph.sql by test/graph.test.js.
export const GRAPH_DDL = [
  `CREATE TABLE IF NOT EXISTS kg_nodes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, terms TEXT, vec TEXT, source TEXT, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS kg_nodes_updated ON kg_nodes (updated_at)`,
  `CREATE TABLE IF NOT EXISTS kg_edges (src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', why TEXT, at INTEGER NOT NULL, PRIMARY KEY (src, rel, dst))`,
  `CREATE INDEX IF NOT EXISTS kg_edges_dst ON kg_edges (dst)`,
  `CREATE TABLE IF NOT EXISTS kg_cursor (source TEXT PRIMARY KEY, last INTEGER NOT NULL DEFAULT 0, lag INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kg_leads (id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, score REAL NOT NULL, why TEXT, status TEXT NOT NULL DEFAULT 'open', item_id TEXT, at INTEGER NOT NULL, settled_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS kg_series (day TEXT PRIMARY KEY, nodes INTEGER NOT NULL, edges INTEGER NOT NULL, leads INTEGER NOT NULL, filed INTEGER NOT NULL, kept INTEGER NOT NULL, lag INTEGER NOT NULL)`,
];
export const DEFAULTS = { batch: 60, pool: 300, threshold: 0.45, max_leads_per_pass: 3, max_filed_per_day: 2, embed: false, embed_max: 8, lag_alarm: 500, embed_model: '@cf/baai/bge-small-en-v1.5' };
// Each source: a table, the columns that make its node, and how a row links out. Missing tables are skipped, so a young system runs with what it has.
export const SOURCES = [
  { name: 'items', sql: `SELECT rowid r, id, title t, kind k, owner_role o, closing_probe p FROM items WHERE rowid > ? ORDER BY rowid LIMIT ?`, node: x => ({ id: 'tag:' + x.id, kind: 'item', label: x.title || x.t, text: [x.t, x.p].join(' '), links: [['owned_by', 'role:' + x.o]] }) },
  { name: 'predictions', sql: `SELECT rowid r, id, item_id i, metric m, op, target FROM predictions WHERE rowid > ? ORDER BY rowid LIMIT ?`, node: x => ({ id: 'pred:' + x.id, kind: 'prediction', label: `${x.m} ${x.op} ${x.target}`, text: x.m, links: [['predicts', 'metric:' + x.m], ...(x.i ? [['for', 'tag:' + x.i]] : [])] }) },
  { name: 'decisions', sql: `SELECT id r, id, point, chosen, metric m FROM decision_log WHERE id > ? ORDER BY id LIMIT ?`, node: x => ({ id: 'dec:' + x.id, kind: 'decision', label: `${x.point}: ${x.chosen}`.slice(0, 120), text: `${x.point} ${x.chosen} ${x.m}`, links: [['optimizes', 'metric:' + x.m], ['at', 'point:' + x.point]] }) },
  { name: 'metrics', sql: `SELECT rowid r, id, name n, kind k, owner_role o, remedy FROM metrics WHERE rowid > ? ORDER BY rowid LIMIT ?`, node: x => ({ id: 'metric:' + x.id, kind: 'metric', label: x.n, text: `${x.n} ${x.remedy || ''}`, links: [['owned_by', 'role:' + x.o]] }) },
];

const STOP = new Set('the a an and or of to in on for with by from is are be was it this that as at not no into its their when then than each per every one two after before over under has have had will must can may only also any all new old item items'.split(' '));
export function terms(text, n = 24) {
  const c = new Map();
  for (const w of String(text || '').toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []) if (!STOP.has(w)) c.set(w, (c.get(w) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(x => x[0]);
}
// Mentions: work-item ids and rule tags (KGRAPH-1, Q-AUDIT-x), file paths. A tag that is also an item id lands on the same node, so mentions join items.
export function mentions(text) {
  const s = String(text || ''), out = new Set();
  for (const m of s.match(/(?<![\w-])[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+\b/g) || []) out.add('tag:' + m);
  for (const m of s.match(/\b[\w-]+(?:\/[\w.-]+)+\.(?:js|mjs|py|json|md|sql|yml)\b/g) || []) out.add('file:' + m);
  return [...out];
}
const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? d / Math.sqrt(x * y) : 0; };
export function similarity(a, b) {
  if (a.vec && b.vec) return cos(a.vec, b.vec);
  const A = new Set(a.terms || []), B = b.terms || [];
  if (!A.size || !B.length) return 0;
  const shared = B.filter(t => A.has(t)).length;
  return shared / Math.sqrt(A.size * B.length);  // cosine over term sets
}
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };

let ready = false;
async function ensure(db) { if (ready) return; for (const s of GRAPH_DDL) await db.prepare(s).run(); ready = true; }
export const _reset = () => { ready = false; };

async function upsertNode(db, n, now) {
  await run(db, `INSERT INTO kg_nodes (id, kind, label, terms, vec, source, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    kind = CASE WHEN kg_nodes.kind IN ('tag','file','role','metric','point') AND excluded.kind NOT IN ('tag','file','role','point') THEN excluded.kind ELSE kg_nodes.kind END,
    label = CASE WHEN excluded.label <> excluded.id THEN excluded.label ELSE kg_nodes.label END, terms = COALESCE(excluded.terms, kg_nodes.terms),
    vec = COALESCE(excluded.vec, kg_nodes.vec), source = COALESCE(excluded.source, kg_nodes.source), updated_at = excluded.updated_at`,
    n.id, n.kind, String(n.label || n.id).slice(0, 160), n.terms ? JSON.stringify(n.terms) : null, n.vec ? JSON.stringify(n.vec) : null, n.source || null, now);
}
async function addEdge(db, src, rel, dst, now, why = null, status = 'confirmed') {
  if (src === dst) return;
  await run(db, `INSERT INTO kg_edges (src, rel, dst, status, why, at) VALUES (?,?,?,?,?,?) ON CONFLICT(src, rel, dst) DO UPDATE SET status = CASE WHEN kg_edges.status = 'confirmed' THEN 'confirmed' ELSE excluded.status END`, src, rel, dst, status, why, now);
}
const kindOf = id => id.split(':')[0];
// Records filed by one template share their first two id segments (STICKY-a, STICKY-b). Siblings are known, never a lead.
export const family = id => id.slice(id.indexOf(':') + 1).split('-').slice(0, 2).join('-');

// One pass. ai: a Workers AI binding or null. ensureItem: tick.js's filer (respects the originate cap). Returns what it did, for the beat ledger.
export async function graphStep({ db, config = {}, ai = null, ensureItem = null, now = Date.now() }) {
  const k = { ...DEFAULTS, ...(config.graph || {}) };
  await ensure(db);
  const out = { ingested: {}, nodes: 0, edges: 0, leads: [], filed: [], kept: [], lag: 0, skipped: [] }, fresh = [];
  for (const s of SOURCES) {
    const cur = (await first(db, `SELECT last FROM kg_cursor WHERE source = ?`, s.name)) || { last: 0 };
    let rows;
    try { rows = await all(db, s.sql, cur.last, k.batch); } catch (e) { out.skipped.push(s.name); continue; }  // allow-silent: the table does not exist in this system yet
    let last = cur.last;
    for (const x of rows) {
      const n = s.node(x), text = n.text || n.label;
      n.terms = terms(`${n.label} ${text}`); n.source = s.name;
      await upsertNode(db, n, now); out.nodes++; fresh.push(n);
      for (const [rel, dst] of n.links || []) { if (!dst || /:(undefined|null)?$/.test(dst)) continue; await upsertNode(db, { id: dst, kind: kindOf(dst), label: dst.slice(dst.indexOf(':') + 1) }, now); await addEdge(db, n.id, rel, dst, now); out.edges++; }
      for (const m of mentions(`${n.label} ${text}`)) { if (m === n.id) continue; await upsertNode(db, { id: m, kind: kindOf(m), label: m.slice(m.indexOf(':') + 1) }, now); await addEdge(db, n.id, 'mentions', m, now); out.edges++; }
      last = Math.max(last, Number(x.r) || 0);
    }
    let lag = 0;
    try { const top = await first(db, s.sql.replace(/SELECT .* FROM (\w+) WHERE (\w+) > \? ORDER BY \w+ LIMIT \?/, 'SELECT MAX($2) m FROM $1')); lag = Math.max(0, (Number(top && top.m) || 0) - last); } catch (e) { lag = 0; }  // allow-silent: lag stays 0 when the table vanished mid-pass
    await run(db, `INSERT INTO kg_cursor (source, last, lag, at) VALUES (?,?,?,?) ON CONFLICT(source) DO UPDATE SET last = excluded.last, lag = excluded.lag, at = excluded.at`, s.name, last, lag, now);
    out.ingested[s.name] = rows.length; out.lag += lag;
  }
  // Optional embedding: a knob, bounded per pass. A failure keeps the term route; it never stops the pass.
  if (k.embed && ai && fresh.length) {
    const take = fresh.slice(0, k.embed_max);
    try {
      const r = await ai.run(k.embed_model, { text: take.map(n => `${n.label}`.slice(0, 300)) });
      (r && r.data || []).forEach((v, i) => { take[i].vec = v.map(x => Math.round(x * 1000) / 1000); });
      for (const n of take) if (n.vec) await run(db, `UPDATE kg_nodes SET vec = ? WHERE id = ?`, JSON.stringify(n.vec), n.id);
    } catch (e) { out.embed_error = String(e && e.message || e).slice(0, 120); }
  }
  // Settle: an open lead whose pair is now linked for real is kept.
  for (const l of await all(db, `SELECT id, a, b, item_id FROM kg_leads WHERE status = 'open' LIMIT 50`)) {
    const linked = await first(db, `SELECT 1 x FROM kg_edges WHERE status = 'confirmed' AND ((src = ? AND dst = ?) OR (src = ? AND dst = ?)) LIMIT 1`, l.a, l.b, l.b, l.a);
    if (linked) { await run(db, `UPDATE kg_leads SET status = 'kept', settled_at = ? WHERE id = ?`, now, l.id); await run(db, `UPDATE kg_edges SET status = 'confirmed' WHERE status = 'proposed' AND ((src = ? AND dst = ?) OR (src = ? AND dst = ?))`, l.a, l.b, l.b, l.a); out.kept.push(l.id); }
  }
  // Insight: new content nodes against a bounded pool of recent ones (one read). Similar, unlinked and with no shared neighbour is a lead.
  const content = fresh.filter(n => n.terms.length >= 3);
  if (content.length) {
    const pool = (await all(db, `SELECT id, kind, label, terms, vec FROM kg_nodes WHERE kind IN ('item','decision','metric','prediction','doc','content') ORDER BY updated_at DESC LIMIT ?`, k.pool))
      .map(p => ({ ...p, terms: JSON.parse(p.terms || '[]'), vec: p.vec ? JSON.parse(p.vec) : null }));
    const cands = [];
    for (const n of content) for (const p of pool) {
      if (p.id === n.id || p.kind === 'prediction' && n.kind === 'prediction' || family(p.id) === family(n.id)) continue;
      const s = similarity(n, p);
      if (s >= k.threshold) cands.push({ a: n.id < p.id ? n.id : p.id, b: n.id < p.id ? p.id : n.id, score: Math.round(s * 1000) / 1000, la: n.label, lb: p.label, shared: (n.terms || []).filter(t => p.terms.includes(t)).slice(0, 5) });
    }
    const seen = new Set();
    for (const c of cands.sort((x, y) => y.score - x.score)) {
      if (out.leads.length >= k.max_leads_per_pass) break;
      const id = 'KG-' + hash(c.a + '|' + c.b); if (seen.has(id)) continue; seen.add(id);
      if (await first(db, `SELECT 1 x FROM kg_leads WHERE id = ?`, id)) continue;
      const direct = await first(db, `SELECT 1 x FROM kg_edges WHERE (src = ? AND dst = ?) OR (src = ? AND dst = ?) LIMIT 1`, c.a, c.b, c.b, c.a);
      const near = await first(db, `SELECT 1 x FROM kg_edges e1 JOIN kg_edges e2 ON e1.dst = e2.dst WHERE e1.src = ? AND e2.src = ? AND e1.status = 'confirmed' AND e2.status = 'confirmed' AND e1.dst NOT LIKE 'role:%' LIMIT 1`, c.a, c.b);
      if (direct || near) continue;
      const why = `read alike (${c.shared.join(', ')}) but nothing links them`;
      await run(db, `INSERT INTO kg_leads (id, a, b, score, why, at) VALUES (?,?,?,?,?,?)`, id, c.a, c.b, c.score, why, now);
      await addEdge(db, c.a, 'related', c.b, now, why, 'proposed');
      out.leads.push({ id, a: c.a, b: c.b, score: c.score, la: c.la, lb: c.lb, why });
    }
  }
  // File the strongest leads as work, at most max_filed_per_day. The id is fixed, so a refile is a no-op.
  if (ensureItem && out.leads.length) {
    const day = new Date(now).toISOString().slice(0, 10), dayStart = Date.parse(day + 'T00:00:00Z');
    let filedToday = ((await first(db, `SELECT COUNT(*) n FROM kg_leads WHERE item_id IS NOT NULL AND at >= ?`, dayStart)) || {}).n || 0;
    for (const l of out.leads) {
      if (filedToday >= k.max_filed_per_day) break;
      const made = await ensureItem(db, { id: l.id, kind: 'plus', owner_role: 'product-manager', priority: 30,
        title: `${l.id}: connect "${String(l.la).slice(0, 50)}" and "${String(l.lb).slice(0, 50)}"; they ${l.why}. Prediction: kg_leads_kept >= 1 within 168 h`,
        done_check: `the pair ${l.a} and ${l.b} is linked by a real reference, or the lead is declined with a reason`, closing_probe: `GET /api/graph/lead/${l.id} expect "kept"` });
      if (made) { await run(db, `UPDATE kg_leads SET item_id = ? WHERE id = ?`, l.id, l.id); out.filed.push(l.id); filedToday++; }
    }
  }
  // Freshness probe: a source that keeps falling behind files one alarm item, closed by the same reading.
  if (ensureItem && out.lag > k.lag_alarm) await ensureItem(db, { id: 'KG-LAG', kind: 'fix', owner_role: 'operations', priority: 20, title: `KG-LAG: the knowledge graph is ${out.lag} rows behind its sources; raise graph.batch or the pass cadence`, done_check: 'graph lag at or below lag_alarm', closing_probe: 'GET /api/graph expect "fresh":true' });
  else if (out.lag <= k.lag_alarm) await run(db, `UPDATE items SET status = 'done', disposition = 'graph caught up with its sources' WHERE id = 'KG-LAG' AND status NOT IN ('done','superseded','cancelled')`).catch(() => null);
  await series(db, now);
  return out;
}

async function counts(db) {
  const q = async sql => ((await first(db, sql)) || {}).n || 0;
  return { nodes: await q(`SELECT COUNT(*) n FROM kg_nodes`), edges: await q(`SELECT COUNT(*) n FROM kg_edges WHERE status = 'confirmed'`), leads: await q(`SELECT COUNT(*) n FROM kg_leads`),
    filed: await q(`SELECT COUNT(*) n FROM kg_leads WHERE item_id IS NOT NULL`), kept: await q(`SELECT COUNT(*) n FROM kg_leads WHERE status = 'kept'`), lag: await q(`SELECT COALESCE(SUM(lag),0) n FROM kg_cursor`) };
}
async function series(db, now) {
  const c = await counts(db), day = new Date(now).toISOString().slice(0, 10);
  await run(db, `INSERT INTO kg_series (day, nodes, edges, leads, filed, kept, lag) VALUES (?,?,?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET nodes=excluded.nodes, edges=excluded.edges, leads=excluded.leads, filed=excluded.filed, kept=excluded.kept, lag=excluded.lag`, day, c.nodes, c.edges, c.leads, c.filed, c.kept, c.lag);
  await run(db, `DELETE FROM kg_series WHERE day < ?`, new Date(now - 400 * 864e5).toISOString().slice(0, 10));
}

// Public read: stats, the probes and the newest leads. fresh = every cursor ran inside 2 h and the total lag is under the alarm.
export async function readGraph(db, { now = Date.now(), config = {} } = {}) {
  await ensure(db);
  const k = { ...DEFAULTS, ...(config.graph || {}) }, c = await counts(db);
  const cursors = await all(db, `SELECT source, last, lag, at FROM kg_cursor ORDER BY source`);
  const lastAt = Math.max(0, ...cursors.map(x => x.at));
  const s = await all(db, `SELECT * FROM kg_series ORDER BY day DESC LIMIT 30`);
  const kinds = await all(db, `SELECT kind, COUNT(*) n FROM kg_nodes GROUP BY kind ORDER BY n DESC`);
  const leads = await all(db, `SELECT id, a, b, score, why, status, item_id, at FROM kg_leads ORDER BY at DESC LIMIT 20`);
  const week = s.find(x => x.day <= new Date(now - 7 * 864e5).toISOString().slice(0, 10));
  return { ...c, kinds, cursors, leads, series: s.reverse(), fresh: !!lastAt && now - lastAt < 2 * 3600e3 && c.lag <= k.lag_alarm, age_min: lastAt ? Math.round((now - lastAt) / 60e3) : null,
    growth_7d: week ? c.nodes - week.nodes : null, yield: c.filed ? Math.round((c.kept / c.filed) * 1000) / 1000 : null };
}
export async function readLead(db, id) { await ensure(db); return (await first(db, `SELECT * FROM kg_leads WHERE id = ?`, id)) || null; }
// Bounded export for the public view: the most recently touched nodes and the confirmed or proposed edges among them.
export async function exportGraph(db, { limit = 300 } = {}) {
  await ensure(db);
  const nodes = await all(db, `SELECT id, kind, label FROM kg_nodes ORDER BY updated_at DESC LIMIT ?`, Math.min(Number(limit) || 300, 1000));
  const ids = new Set(nodes.map(n => n.id));
  const edges = (await all(db, `SELECT src, rel, dst, status FROM kg_edges ORDER BY at DESC LIMIT ?`, 4 * nodes.length)).filter(e => ids.has(e.src) && ids.has(e.dst));
  return { nodes, edges, truncated: nodes.length >= limit ? `newest ${limit} nodes only` : null };
}

export const GRAPH_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Knowledge graph</title>
<style>:root{--bg:#fff;--fg:#1a1a1a;--mute:#666;--line:#ccc;--acc:#2563eb;--lead:#d97706}@media(prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--mute:#aaa;--line:#444;--acc:#60a5fa;--lead:#fbbf24}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main{max-width:960px;margin:0 auto;padding:16px}svg{width:100%;height:auto;border:1px solid var(--line);border-radius:8px}
.m{color:var(--mute);font-size:14px}ul{padding-left:18px}</style></head><body><main><h1>Knowledge graph</h1>
<p class="m">Built from this system's own records as they change. Amber lines are leads: things that read alike but nothing links yet.</p>
<p id="s" class="m">Loading.</p><svg id="g" viewBox="0 0 800 800" role="img" aria-label="Graph of recent nodes"></svg><h2>Newest leads</h2><ul id="l"></ul></main>
<script>(async()=>{const [st,ex]=await Promise.all([fetch('/api/graph').then(r=>r.json()),fetch('/api/graph/export?limit=200').then(r=>r.json())]);
document.getElementById('s').textContent=st.nodes+' nodes, '+st.edges+' links, '+st.leads+' leads ('+st.kept+' kept). '+(st.fresh?'Up to date.':'Catching up.');
const n=ex.nodes,p={},R=360,ns='http://www.w3.org/2000/svg',g=document.getElementById('g');n.forEach((x,i)=>{const a=2*Math.PI*i/n.length;p[x.id]=[400+R*Math.cos(a),400+R*Math.sin(a)]});
ex.edges.forEach(e=>{const l=document.createElementNS(ns,'line'),[a,b]=[p[e.src],p[e.dst]];l.setAttribute('x1',a[0]);l.setAttribute('y1',a[1]);l.setAttribute('x2',b[0]);l.setAttribute('y2',b[1]);l.setAttribute('stroke',e.status==='proposed'?'var(--lead)':'var(--line)');g.appendChild(l)});
n.forEach(x=>{const c=document.createElementNS(ns,'circle'),[a,b]=p[x.id];c.setAttribute('cx',a);c.setAttribute('cy',b);c.setAttribute('r',4);c.setAttribute('fill','var(--acc)');const t=document.createElementNS(ns,'title');t.textContent=x.kind+': '+x.label;c.appendChild(t);g.appendChild(c)});
const ul=document.getElementById('l');st.leads.forEach(x=>{const li=document.createElement('li');li.textContent=x.a+' and '+x.b+': '+x.why+' ('+x.status+')';ul.appendChild(li)})})().catch(e=>{document.getElementById('s').textContent='The graph could not be read right now.'})</script></body></html>`;
