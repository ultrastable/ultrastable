// VENDORED from ultrastable/workers core/knowledge/index.js so a seed checkout is self-contained (SEED-SELFCONTAINED-1); tests/foundation/test_failmine.py keeps it identical.
// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// core/knowledge (KNOWLEDGE-GRAPH-1): every Ultrastable system builds and maintains a graph of its own data and generates insights from it.
// Tenant-agnostic. A tenant supplies records (see README for the interface); this module is a pure function over them, so a CI job, a Worker
// tick or a test calls it the same way. No model is in the loop: structure is computed, text is templated from facts, every edge carries
// provenance. Semantic links (core/discover) may be passed in as extra edges and are labelled as leads, never facts.

// Label propagation, the same rule as core/discover's communities(); inlined so this file has no imports and a seed can vendor it unchanged.
function communities(ids, links, { rounds = 12 } = {}) {
  const adj = new Map(ids.map(id => [id, []]));
  for (const { a, b, w } of links) { if (adj.has(a) && adj.has(b) && a !== b) { adj.get(a).push([b, w]); adj.get(b).push([a, w]); } }
  const lab = new Map(ids.map(id => [id, id])), order = [...ids].sort();
  for (let r = 0; r < rounds; r++) {
    let moved = 0;
    for (const id of order) {
      const score = new Map(); for (const [n, w] of adj.get(id)) score.set(lab.get(n), (score.get(lab.get(n)) || 0) + w);
      if (!score.size) continue;
      let best = lab.get(id), bs = score.get(best) || 0;
      for (const [l, s] of score) if (s > bs + 1e-9 || (Math.abs(s - bs) <= 1e-9 && l < best)) { best = l; bs = s; }
      if (best !== lab.get(id)) { lab.set(id, best); moved++; }
    }
    if (!moved) break;
  }
  return lab;
}

export const VERSION = '1.0.0';
export const DEFAULTS = Object.freeze({ nearDup: 0.85, topLeads: 10, topHubs: 5, damping: 0.85, iters: 30, maxInsights: 12, minCommunity: 3 });

export function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }
const STOP = new Set('the a an of and or for to in on at by with from is are was were be as this that it its'.split(' '));
export const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = s => norm(s).split(' ').filter(t => t && !STOP.has(t));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const t of a) if (b.has(t)) i++; return i / (a.size + b.size - i); };
const rhash = r => hash(JSON.stringify([r.kind, r.title, r.text || '', [...(r.refs || [])].sort(), [...(r.entities || [])].sort()]));

// ---- entity resolution: records of one kind that name the same thing become one node, aliases kept -------------------------------------
export function resolve(records, { nearDup = DEFAULTS.nearDup } = {}) {
  const parent = new Map(records.map(r => [r.id, r.id])), find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra); };
  const byKind = new Map();
  for (const r of records) (byKind.get(r.kind) || byKind.set(r.kind, []).get(r.kind)).push({ r, key: tokens(r.title).sort().join(' '), set: new Set(tokens(r.title)) });
  for (const list of byKind.values()) {
    const exact = new Map();
    for (const x of list) { if (!x.key) continue; if (exact.has(x.key)) union(x.r.id, exact.get(x.key)); else exact.set(x.key, x.r.id); }
    if (list.length <= 2000) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (find(list[i].r.id) !== find(list[j].r.id) && list[i].set.size > 1 && jaccard(list[i].set, list[j].set) >= nearDup) union(list[i].r.id, list[j].r.id);
  }
  const canon = new Map(); for (const r of records) canon.set(r.id, find(r.id));
  return canon;
}

// ---- build: records -> nodes, edges, metrics ------------------------------------------------------------------------------------------
// records: [{ id, kind, title, text?, refs?: [ids], entities?: [names], source, url?, at }]; extra: [{ a, b, w, rel, source }] semantic leads
export function build({ records, extra = [], now = new Date().toISOString(), params = {} }) {
  const P = { ...DEFAULTS, ...params }, canon = resolve(records, P), nodes = new Map(), edges = new Map(), aliases = {};
  const addEdge = (a, b, rel, source, at, w = 1, conf = 'fact') => { if (a === b || !a || !b) return; const [x, y] = a < b ? [a, b] : [b, a], k = `${x}|${rel}|${y}`; const e = edges.get(k); if (e) e.w = Math.max(e.w, w); else edges.set(k, { a: x, b: y, rel, w, conf, source, at }); };
  for (const r of records) {
    const id = canon.get(r.id);
    if (!nodes.has(id)) nodes.set(id, { id, kind: r.kind, title: r.title, h: '', source: r.source, url: r.url, at: r.at, tid: r.id });
    const n0 = nodes.get(id); if (r.id < n0.tid) Object.assign(n0, { title: r.title, source: r.source, url: r.url, at: r.at, tid: r.id });
    if (r.id !== id) (aliases[id] || (aliases[id] = [])).push(r.id);
    const n = nodes.get(id); (n.hs || (n.hs = [])).push(rhash(r)); n.h = hash([...n.hs].sort().join());
  }
  for (const r of records) {
    const id = canon.get(r.id);
    for (const ref of r.refs || []) if (canon.has(ref)) addEdge(id, canon.get(ref), 'ref', r.source, r.at);
    for (const name of r.entities || []) { const key = norm(name); if (!key) continue; const eid = 'e:' + key.replace(/ /g, '-'); if (!nodes.has(eid)) nodes.set(eid, { id: eid, kind: 'entity', title: key, h: hash(key), source: 'derived', at: now }); addEdge(id, eid, 'mentions', r.source, r.at); }
  }
  for (const x of extra) if (nodes.has(x.a) && nodes.has(x.b)) addEdge(x.a, x.b, x.rel || 'similar', x.source || 'discover', now, x.w ?? 0.5, 'lead');
  const ids = [...nodes.keys()].sort(), E = [...edges.values()];
  const adj = new Map(ids.map(i => [i, new Set()])); for (const e of E) if (e.conf === 'fact') { adj.get(e.a).add(e.b); adj.get(e.b).add(e.a); }
  // PageRank over fact edges
  let pr = new Map(ids.map(i => [i, 1 / ids.length]));
  for (let it = 0; it < P.iters; it++) {
    const nx = new Map(ids.map(i => [i, (1 - P.damping) / ids.length])); let dead = 0;
    for (const i of ids) { const d = adj.get(i).size; if (!d) dead += pr.get(i); else for (const j of adj.get(i)) nx.set(j, nx.get(j) + P.damping * pr.get(i) / d); }
    for (const i of ids) nx.set(i, nx.get(i) + P.damping * dead / ids.length); pr = nx;
  }
  const comm = communities(ids, E.filter(e => e.conf === 'fact').map(e => ({ a: e.a, b: e.b, w: e.w })));
  for (const i of ids) Object.assign(nodes.get(i), { deg: adj.get(i).size, pr: Number(pr.get(i).toFixed(6)), c: comm.get(i) });
  return { nodes, edges: E, adj, aliases, comm, stats: { nodes: ids.length, edges: E.length, entities: ids.filter(i => nodes.get(i).kind === 'entity').length, merged: Object.values(aliases).reduce((s, a) => s + a.length, 0) }, at: now };
}

// ---- link prediction: Adamic-Adar over shared neighbours for pairs with no edge; a lead, never a fact -----------------------------------
export function predict(g, { top = DEFAULTS.topLeads } = {}) {
  const seen = new Set(), out = [], skip = n => n.kind === 'entity';
  for (const [m, nb] of g.adj) { const ns = [...nb]; if (ns.length > 60) continue; const w = 1 / Math.log(2 + ns.length);
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) { const [a, b] = ns[i] < ns[j] ? [ns[i], ns[j]] : [ns[j], ns[i]], k = a + '|' + b; if (g.adj.get(a).has(b)) continue; const o = seen.has(k) ? out.find(x => x.k === k) : (seen.add(k), out[out.push({ k, a, b, score: 0, via: [] }) - 1]); o.score += w; o.via.push(m); } }
  return out.filter(x => !skip(g.nodes.get(x.a)) && !skip(g.nodes.get(x.b))).sort((x, y) => y.score - x.score || (x.k < y.k ? -1 : 1)).slice(0, top).map(({ k, ...x }) => ({ ...x, score: Number(x.score.toFixed(3)), via: x.via.slice(0, 3), conf: 'lead' }));
}

// ---- snapshot: compact, content-hashed, small enough for KV/R2 or a committed file ---------------------------------------------------------
export function snapshot(g) { return { v: 1, at: g.at, stats: g.stats, nodes: [...g.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map(n => ({ id: n.id, k: n.kind, t: n.title, h: n.h, d: n.deg, pr: n.pr, c: n.c })), edges: g.edges.filter(e => e.conf === 'fact').map(e => [e.a, e.b, e.rel]).sort((x, y) => (x.join() < y.join() ? -1 : 1)) }; }

// ---- insights: templated from facts, each with evidence ids and its source; the diff against the previous snapshot is what is new ---------
export function insights(g, prev = null, { params = {}, now = g.at } = {}) {
  const P = { ...DEFAULTS, ...params }, out = [], label = id => (g.nodes.get(id) || {}).title || id;
  const real = [...g.nodes.values()].filter(n => n.kind !== 'entity');
  const push = (kind, text, evidence) => out.push({ at: now, kind: 'graph_' + kind, id: text, evidence: evidence.slice(0, 6), conf: 'computed' });
  const prevIds = prev ? new Set(prev.nodes.map(n => n.id)) : null, prevH = prev ? new Map(prev.nodes.map(n => [n.id, n.h])) : null;
  if (prev) {
    const added = real.filter(n => !prevIds.has(n.id)), changed = real.filter(n => prevIds.has(n.id) && prevH.get(n.id) !== n.h), gone = prev.nodes.filter(n => n.k !== 'entity' && !g.nodes.has(n.id));
    if (added.length) push('growth', `${added.length} new item(s) joined the graph: ${added.slice(0, 3).map(n => n.title).join('; ')}${added.length > 3 ? '...' : ''}`, added.map(n => n.id));
    if (changed.length) push('revised', `${changed.length} item(s) changed content and were re-linked`, changed.map(n => n.id));
    if (gone.length) push('removed', `${gone.length} item(s) left the graph`, gone.map(n => n.id));
    const pe = new Set(prev.edges.map(e => e.join('|'))), ne = g.edges.filter(e => e.conf === 'fact' && !pe.has([e.a, e.b, e.rel].join('|')));
    if (ne.length) push('new_links', `${ne.length} new link(s) with provenance, e.g. ${label(ne[0].a)} to ${label(ne[0].b)} (${ne[0].rel})`, ne.flatMap(e => [e.a, e.b]));
    const ppr = new Map(prev.nodes.map(n => [n.id, n.pr])), risers = real.filter(n => ppr.has(n.id) && n.pr > ppr.get(n.id) * 1.25 && n.deg >= 3).sort((a, b) => b.pr / ppr.get(b.id) - a.pr / ppr.get(a.id)).slice(0, 3);
    for (const n of risers) push('rising', `${n.title} became more central (rank x${(n.pr / ppr.get(n.id)).toFixed(2)})`, [n.id]);
  }
  const hubs = [...real].sort((a, b) => b.pr - a.pr).slice(0, P.topHubs); if (hubs.length) push('hubs', `Most connected: ${hubs.map(n => `${n.title} (${n.deg})`).join('; ')}`, hubs.map(n => n.id));
  const orphans = real.filter(n => n.deg === 0); if (orphans.length) push('orphans', `${orphans.length} item(s) have no links to anything: ${orphans.slice(0, 3).map(n => n.title).join('; ')}`, orphans.map(n => n.id));
  const bridges = real.filter(n => { const cs = new Set([...g.adj.get(n.id)].map(m => g.nodes.get(m).c)); return cs.size >= 3; }).sort((a, b) => b.deg - a.deg).slice(0, 3);
  for (const n of bridges) push('bridge', `${n.title} connects ${new Set([...g.adj.get(n.id)].map(m => g.nodes.get(m).c)).size} otherwise separate groups`, [n.id, ...g.adj.get(n.id)]);
  const sizes = new Map(); for (const n of real) sizes.set(n.c, (sizes.get(n.c) || 0) + 1);
  const groups = [...sizes].filter(([, s]) => s >= P.minCommunity).length; if (groups) push('communities', `${groups} group(s) of related items found; largest has ${Math.max(...sizes.values())}`, []);
  const leads = predict(g, { top: P.topLeads }).slice(0, 3); for (const l of leads) push('lead', `Lead, not a finding: ${label(l.a)} and ${label(l.b)} share ${l.via.length}+ neighbours but are not linked`, [l.a, l.b, ...l.via]);
  return out.slice(0, P.maxInsights);
}

// One call: build, diff, snapshot. `store` is a port { get(key), put(key, value) } (KV, R2 wrapper, or a file).
export async function run({ records, extra, store, key = 'knowledge/snapshot', now, params } = {}) {
  const prev = store ? await store.get(key) : null, g = build({ records, extra, now, params }), ins = insights(g, prev, { params, now: g.at }), snap = snapshot(g);
  if (store) await store.put(key, snap);
  return { stats: g.stats, insights: ins, snapshot: snap, leads: predict(g, params), first: !prev };
}
