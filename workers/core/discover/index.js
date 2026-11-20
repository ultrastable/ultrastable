// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// core/discover (DISCOVER-1): a knowledge graph plus a vector index that keeps finding connections nobody has drawn yet.
// Any system passes its own nodes ({ id, kind, domain, label, text }) and the links it already knows ({ src, rel, dst }). This module
//   1. embeds only what changed (content hash per node, a bounded batch per run, the cache is plain JSON a repository can keep),
//   2. keeps the vectors int8-quantized and searches them exactly in memory (no metered vector service below `promoteAt`),
//   3. builds the semantic neighbour graph and its communities, and proposes four kinds of connection:
//      transfer    a solution proven on one problem, for a similar problem it has never been linked to
//      combination two solutions that act on related problems from different angles and have never been combined
//      bridge      two items that read alike but sit in different communities with no known path between them
//      frontier    a problem that no known solution comes close to (the open questions)
//   4. screens each one for novelty against the known graph (duplicate, partial, none), the way the first fleet's novelty screen labelled ideas,
//   5. keeps a ledger across runs (new, standing, confirmed when the system later adds the link, dropped when it stops ranking) and
//      tunes its own threshold from the ledger, with a logged prediction per change.
// Lessons kept from the first fleet's research graph (see README): content-hashed embeddings, int8 storage, semantic plus explicit edges, communities, bridge and
// link-candidate gaps. Bottlenecks dropped: no table scans (the index is one packed value read once), no model in the ranking (models only
// word the top few, and that text is labelled), no per-query metered vector reads for small corpora.
// Pure functions over plain data. Dependencies (embed, now) are arguments. Nothing here names a tenant, a host or a model.

export const VERSION = '1.0.0';
export const DEFAULTS = Object.freeze({
  k: 8,                 // neighbours kept per node in the semantic graph
  pct: 0.9,             // a semantic link counts when its similarity is in the top (1 - pct) of all neighbour similarities this run
  minSim: 0.55,         // and never below this absolute floor
  comboLow: 0.35,       // combination: the two solutions differ (similarity below comboHigh) but are not unrelated (above comboLow)
  comboHigh: 0.82,
  crossBoost: 1.25,     // a connection across domains or communities is worth more: it is the kind nobody drew
  perType: 25,          // candidates kept per type per run
  perMember: 3,         // and no item in more than this many of one type, so one rich item cannot fill the list
  dropAfter: 3,         // runs a candidate may go unranked before it is dropped (with that reason)
  keep: 600,            // ledger entries kept; the rest are counted by status in `retired`, never silently lost
  tune: { min: 0.8, max: 0.97, step: 0.01, lowNew: 5, highNew: 40 },
  promoteAt: 20000,     // above this many vectors, use a Vectorize-style port instead of the in-memory index
});
export const ROLES = Object.freeze({ problem: 'problem', solution: 'solution', addresses: 'addresses', combines: 'combines' });

// ---------------------------------------------------------------- hashing and base64 (Web APIs only) -------------------------------------
export function hash(s) { // FNV-1a 32 bit, hex: stable ids and change detection, not security
  let h = 0x811c9dc5; const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const B64 = typeof Buffer !== 'undefined';
export function toB64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (B64) return Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64');
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s);
}
export function fromB64(s) {
  if (B64) { const b = Buffer.from(s, 'base64'); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
  const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
}

// ---------------------------------------------------------------- vectors ----------------------------------------------------------------
export function quantize(v) {
  let max = 0; for (const x of v) { const a = Math.abs(x); if (a > max) max = a; }
  const scale = max / 127 || 1, q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] / scale)));
  return { q, scale };
}
const i8 = u => new Int8Array(u.buffer, u.byteOffset, u.byteLength);
export const encodeVec = v => { const { q, scale } = quantize(v); return { s: Number(scale.toPrecision(6)), q: toB64(new Uint8Array(q.buffer)) }; };
export const decodeVec = e => i8(fromB64(e.q));

// A packed index: ids plus one int8 matrix, row norms precomputed. JSON-safe ({ dim, ids, b64 }) for a generated module or a KV value.
export function pack(rows) { // rows: [{ id, q: Int8Array }]
  const dim = rows.length ? rows[0].q.length : 0, m = new Int8Array(rows.length * dim);
  rows.forEach((r, i) => { if (r.q.length !== dim) throw new Error('mixed dimensions in pack'); m.set(r.q, i * dim); });
  return { v: 1, dim, ids: rows.map(r => r.id), b64: toB64(new Uint8Array(m.buffer)) };
}
export function unpack(p) {
  const m = i8(fromB64(p.b64)), n = p.ids.length, dim = p.dim, norm = new Float32Array(n), at = new Map();
  for (let i = 0; i < n; i++) { let s = 0; const o = i * dim; for (let j = 0; j < dim; j++) s += m[o + j] * m[o + j]; norm[i] = Math.sqrt(s) || 1; at.set(p.ids[i], i); }
  return { dim, ids: p.ids, m, norm, at };
}
const rowDot = (M, a, b) => { let s = 0; const oa = a * M.dim, ob = b * M.dim; for (let j = 0; j < M.dim; j++) s += M.m[oa + j] * M.m[ob + j]; return s / (M.norm[a] * M.norm[b]); };
export function sim(M, a, b) { const i = M.at.get(a), j = M.at.get(b); return i == null || j == null ? 0 : rowDot(M, i, j); }

// Exact nearest neighbours of a query vector (floats or int8) over the packed index. `filter(id)` limits candidates.
export function nearest(M, vec, { k = 8, filter = null, exclude = null } = {}) {
  let qn = 0; for (const x of vec) qn += x * x; qn = Math.sqrt(qn) || 1;
  const out = [];
  for (let i = 0; i < M.ids.length; i++) {
    const id = M.ids[i]; if (exclude && exclude === id) continue; if (filter && !filter(id)) continue;
    let s = 0; const o = i * M.dim; for (let j = 0; j < M.dim; j++) s += vec[j] * M.m[o + j];
    out.push({ id, score: s / (qn * M.norm[i]) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}

// A Vectorize-shaped port over the packed index, so callers do not care which store answers. `vectorizePort(binding)` is the promotion path.
export const packedPort = M => ({ kind: 'packed', size: M.ids.length, query: async (vec, { topK = 8, filter } = {}) => nearest(M, vec, { k: topK, filter }) });
export const vectorizePort = (index, { namespace } = {}) => ({
  kind: 'vectorize',
  upsert: rows => index.upsert(rows.map(r => ({ id: r.id, values: Array.from(r.values), namespace, metadata: r.meta || undefined }))),
  query: async (vec, { topK = 8 } = {}) => ((await index.query(Array.from(vec), { topK, namespace })).matches || []).map(x => ({ id: x.id, score: x.score })),
});
export const choosePort = (M, binding, { promoteAt = DEFAULTS.promoteAt } = {}) => (M && M.ids.length <= promoteAt) || !binding ? packedPort(M) : vectorizePort(binding);

// ---------------------------------------------------------------- incremental embedding --------------------------------------------------
// cache: { model, dim, rows: { id: { h, s, q } } }. Only nodes whose text hash changed are embedded, at most `max` per run, `batch` per call.
// A failed batch is recorded and the run goes on with what it has: it never stops the loop and never erases a good vector.
export async function refreshEmbeddings({ nodes, cache = {}, embed, model = '', batch = 50, max = 2000, textOf = n => `${n.label}. ${n.text || ''}`.slice(0, 2000) }) {
  const rows = { ...(cache.model === model ? cache.rows || {} : {}) }, want = [], errors = [];
  for (const n of nodes) { const t = textOf(n), h = hash(t); if (!rows[n.id] || rows[n.id].h !== h) want.push({ id: n.id, t, h }); }
  const todo = want.slice(0, max); let embedded = 0, dim = cache.model === model ? cache.dim || 0 : 0;
  for (let i = 0; i < todo.length; i += batch) {
    const part = todo.slice(i, i + batch);
    try {
      const vecs = await embed(part.map(x => x.t));
      if (!Array.isArray(vecs) || vecs.length !== part.length) throw new Error('embed returned ' + (Array.isArray(vecs) ? vecs.length : typeof vecs) + ' vectors for ' + part.length);
      vecs.forEach((v, j) => { if (dim && v.length !== dim) throw new Error('dimension changed'); dim = v.length; rows[part[j].id] = { h: part[j].h, ...encodeVec(v) }; embedded++; });
    } catch (e) { errors.push({ at: i, n: part.length, error: String(e && e.message || e).slice(0, 200) }); }
  }
  const live = new Set(nodes.map(n => n.id)), removed = Object.keys(rows).filter(id => !live.has(id));
  for (const id of removed) delete rows[id];
  return { cache: { model, dim, rows }, embedded, reused: nodes.length - want.length, pending: want.length - todo.length, removed: removed.length, errors };
}
export const packCache = (cache, ids) => pack((ids || Object.keys(cache.rows)).filter(id => cache.rows[id]).map(id => ({ id, q: decodeVec(cache.rows[id]) })));

// ---------------------------------------------------------------- graph -------------------------------------------------------------------
function quantile(xs, p) { if (!xs.length) return 1; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; }

// k nearest neighbours of every node among `targets` (all nodes by default). Cost: nodes x targets x dim, done once per run.
export function knn(M, ids, { k = DEFAULTS.k, targets = null } = {}) {
  const T = (targets || ids).map(id => M.at.get(id)).filter(i => i != null), out = new Map();
  for (const id of ids) {
    const a = M.at.get(id); if (a == null) continue;
    const best = [];
    for (const b of T) { if (b === a) continue; const s = rowDot(M, a, b); if (best.length < k || s > best[best.length - 1].s) { best.push({ id: M.ids[b], s }); best.sort((x, y) => y.s - x.s); if (best.length > k) best.pop(); } }
    out.set(id, best);
  }
  return out;
}

// Weighted label propagation, deterministic: fixed order, ties go to the smaller label. Returns Map id -> community label.
export function communities(ids, links, { rounds = 12 } = {}) {
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

const pairId = (type, ms) => type + ':' + hash(type + '|' + ms.join('|'));
const sortPair = (a, b) => (a < b ? [a, b] : [b, a]);

// The heart of it. nodes: [{ id, kind, domain, label, text?, props? }]; edges: [{ src, rel, dst }] the system already knows;
// M: unpacked index; roles: names of the kinds and relations in this system's own vocabulary. Returns candidates with their evidence.
export function discover({ nodes, edges = [], M, roles = ROLES, params = {}, known = [] }) {
  const P = { ...DEFAULTS, ...params }, R = { ...ROLES, ...roles };
  const byId = new Map(nodes.filter(n => M.at.has(n.id)).map(n => [n.id, n])), ids = [...byId.keys()];
  const problems = ids.filter(id => byId.get(id).kind === R.problem), solutions = ids.filter(id => byId.get(id).kind === R.solution);

  // known links: adjacency for path checks, solution -> problems it addresses, combinations already made (known: [[a, b, ...], ...])
  const adj = new Map(ids.map(id => [id, new Set()])), addr = new Map(solutions.map(s => [s, new Set()]));
  for (const e of edges) {
    if (!byId.has(e.src) || !byId.has(e.dst)) continue;
    adj.get(e.src).add(e.dst); adj.get(e.dst).add(e.src);
    if (e.rel === R.addresses && addr.has(e.src)) addr.get(e.src).add(e.dst);
  }
  const combined = new Set(); for (const set of known) { const s = [...new Set(set)].sort(); for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) combined.add(s[i] + '|' + s[j]); }
  const within2 = (a, b) => { if (adj.get(a).has(b)) return 1; for (const x of adj.get(a)) if (adj.get(x).has(b)) return 2; return 0; };

  // semantic graph and the self-calibrated threshold
  const nn = knn(M, ids, { k: P.k });
  const all = []; for (const l of nn.values()) for (const x of l) all.push(x.s);
  const tau = Math.max(P.minSim, quantile(all, P.pct));
  const links = []; for (const [a, l] of nn) for (const x of l) if (x.s >= tau) links.push({ a, b: x.id, w: x.s });
  for (const e of edges) if (byId.has(e.src) && byId.has(e.dst)) links.push({ a: e.src, b: e.dst, w: 1 });
  const comm = communities(ids, links);
  const cross = (a, b) => (byId.get(a).domain && byId.get(b).domain && byId.get(a).domain !== byId.get(b).domain) || comm.get(a) !== comm.get(b);
  const novelty = (members) => { // duplicate: already linked or combined; partial: two steps apart; none: no known path
    const [a, b] = [members[0], members[members.length - 1]];
    if (adj.get(a).has(b) || combined.has(sortPair(a, b).join('|'))) return 'duplicate';
    return within2(a, b) ? 'partial' : 'none';
  };
  const out = { transfer: [], combination: [], bridge: [], frontier: [] };

  // transfer: S addresses P1; P2 resembles P1 and S has never been linked to P2
  const pn = knn(M, problems, { k: P.k, targets: problems });
  for (const [s, ps] of addr) for (const p1 of ps) for (const { id: p2, s: sp } of pn.get(p1) || []) {
    if (ps.has(p2) || sp < P.minSim) continue; // ranked, not thresholded: the per-type cap keeps the best few
    const ss = sim(M, s, p2), score = (0.6 * sp + 0.4 * ss) * (cross(p1, p2) ? P.crossBoost : 1);
    out.transfer.push({ id: pairId('transfer', [s, p2]), type: 'transfer', members: [s, p2], via: p1, score, sims: { problems: sp, solution_to_target: ss }, cross: cross(p1, p2) });
  }
  // combination: two solutions, related but distinct, whose problems are alike, never combined
  for (let i = 0; i < solutions.length; i++) for (let j = i + 1; j < solutions.length; j++) {
    const [a, b] = sortPair(solutions[i], solutions[j]), sab = sim(M, a, b);
    if (sab < P.comboLow || sab > P.comboHigh) continue;
    let best = 0, pa = null, pb = null;
    for (const x of addr.get(a)) for (const y of addr.get(b)) { const s = x === y ? 1 : sim(M, x, y); if (s > best) { best = s; pa = x; pb = y; } }
    if (!pa || best < P.minSim) continue;
    const score = best * (1 - sab) * 2 * (cross(a, b) ? P.crossBoost : 1);
    out.combination.push({ id: pairId('combination', [a, b]), type: 'combination', members: [a, b], via: pa === pb ? pa : pa + ' ~ ' + pb, score, sims: { solutions: sab, problems: best }, cross: cross(a, b) });
  }
  // bridge: alike, in different communities, no known path within two steps (a link candidate)
  const seen = new Set();
  for (const [a, l] of nn) for (const { id: b, s } of l) {
    if (s < tau || comm.get(a) === comm.get(b)) continue;
    const [x, y] = sortPair(a, b), key = x + '|' + y; if (seen.has(key)) continue; seen.add(key);
    if (within2(x, y)) continue;
    out.bridge.push({ id: pairId('bridge', [x, y]), type: 'bridge', members: [x, y], score: s * (cross(x, y) ? P.crossBoost : 1), sims: { pair: s }, cross: true });
  }
  // frontier: problems no solution addresses and no solution comes near (open questions, ranked by how far the nearest solution is)
  const solved = new Set(); for (const ps of addr.values()) for (const p of ps) solved.add(p);
  for (const p of problems) {
    if (solved.has(p)) continue;
    const near = solutions.map(s => ({ s, v: sim(M, p, s) })).sort((a, b) => b.v - a.v)[0];
    const bestTransfer = Math.max(0, ...out.transfer.filter(t => t.members[1] === p).map(t => t.score));
    if (bestTransfer > 0) continue;
    const w = Number(byId.get(p).props && byId.get(p).props.weight) || 1;
    out.frontier.push({ id: pairId('frontier', [p]), type: 'frontier', members: [p], via: near ? near.s : null, score: (1 - (near ? near.v : 0)) * w, sims: { nearest_solution: near ? near.v : 0 }, cross: false });
  }

  const candidates = [];
  for (const t of Object.keys(out)) {
    const best = new Map(); for (const c of out[t]) if (!best.has(c.id) || best.get(c.id).score < c.score) best.set(c.id, c);
    const ranked = [...best.values()].map(c => ({ ...c, novelty: t === 'frontier' ? 'none' : novelty(c.members), score: Number(c.score.toFixed(4)) }))
      .filter(c => c.novelty !== 'duplicate').sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const uses = new Map(), kept = []; // diversity: no item appears in more than perMember candidates of one type
    for (const c of ranked) { if (kept.length >= P.perType) break; if (c.members.some(m => (uses.get(m) || 0) >= P.perMember)) continue; c.members.forEach(m => uses.set(m, (uses.get(m) || 0) + 1)); kept.push(c); }
    candidates.push(...kept);
  }
  const sizes = {}; for (const l of comm.values()) sizes[l] = (sizes[l] || 0) + 1;
  const bridges = ids.map(id => ({ id, reach: new Set((nn.get(id) || []).filter(x => x.s >= tau).map(x => comm.get(x.id)).concat([...adj.get(id)].map(x => comm.get(x)))).size }))
    .filter(x => x.reach >= 3).sort((a, b) => b.reach - a.reach || a.id.localeCompare(b.id)).slice(0, 15);
  return {
    tau: Number(tau.toFixed(4)), candidates,
    communities: Object.fromEntries([...comm]), community_sizes: sizes, hubs: bridges,
    stats: { nodes: ids.length, problems: problems.length, solutions: solutions.length, known_edges: edges.length, semantic_links: links.length - edges.length, communities: Object.keys(sizes).length, unembedded: nodes.length - ids.length },
  };
}

// ---------------------------------------------------------------- ledger, settling, tuning ------------------------------------------------
// ledger: { v, runs: [...], entries: { id: entry }, retired: { status: n } }. A candidate that the system later links for real (an edge
// between its members, or a combination that contains both) is `confirmed`: that is the measured hit, and the reason the loop exists.
export function mergeLedger(ledger, result, { now, edges = [], known = [], dropAfter = DEFAULTS.dropAfter, keep = DEFAULTS.keep, roles = ROLES } = {}) {
  const L = { v: 1, runs: [], entries: {}, retired: {}, ...(ledger || {}) }; L.entries = { ...L.entries }; L.retired = { ...L.retired };
  const at = new Date(now).toISOString(), R = { ...ROLES, ...roles };
  const linked = new Set(edges.map(e => sortPair(e.src, e.dst).join('|')));
  const solvedP = new Set(  // a frontier closes when any solution addresses it
    edges.filter(e => e.rel === R.addresses).map(e => e.dst));
  const comb = new Set(); for (const s of known) { const x = [...new Set(s)].sort(); for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) comb.add(x[i] + '|' + x[j]); }
  const hit = e => e.type === 'frontier' ? solvedP.has(e.members[0]) : (linked.has(sortPair(e.members[0], e.members[1]).join('|')) || comb.has(sortPair(e.members[0], e.members[1]).join('|')));
  let fresh = 0, confirmed = 0, dropped = 0; const cur = new Set();
  for (const c of result.candidates) {
    cur.add(c.id); const o = L.entries[c.id];
    if (!o) { L.entries[c.id] = { ...c, status: 'new', first_seen: at, last_seen: at, runs: 1, missed: 0, best: c.score }; fresh++; continue; }
    if (o.status === 'confirmed' || o.status === 'dropped') { if (o.status === 'dropped') { L.entries[c.id] = { ...o, ...c, status: 'standing', last_seen: at, runs: o.runs + 1, missed: 0, returned: at }; } continue; }
    L.entries[c.id] = { ...o, ...c, status: 'standing', last_seen: at, runs: o.runs + 1, missed: 0, best: Math.max(o.best || 0, c.score), why_model: o.why_model, seeded: o.seeded };
  }
  for (const [id, e] of Object.entries(L.entries)) {
    if (e.status === 'confirmed' || e.status === 'dropped') continue;
    if (hit(e)) { L.entries[id] = { ...e, status: 'confirmed', settled: at }; confirmed++; continue; }
    if (cur.has(id)) continue;
    const missed = (e.missed || 0) + 1;
    L.entries[id] = missed >= dropAfter ? { ...e, missed, status: 'dropped', settled: at, reason: `not ranked for ${missed} runs` } : { ...e, missed };
    if (missed >= dropAfter) dropped++;
  }
  // bounded: the oldest settled entries leave first, counted by status so the totals still add up (entered = open + settled + retired)
  const list = Object.values(L.entries);
  if (list.length > keep) {
    const out = list.filter(e => e.status === 'dropped' || e.status === 'confirmed').sort((a, b) => String(a.settled).localeCompare(String(b.settled))).slice(0, list.length - keep);
    for (const e of out) { delete L.entries[e.id]; L.retired[e.status] = (L.retired[e.status] || 0) + 1; }
  }
  const count = s => Object.values(L.entries).filter(e => e.status === s).length + (L.retired[s] || 0);
  const run = { at, tau: result.tau, nodes: result.stats.nodes, candidates: result.candidates.length, new: fresh, confirmed, dropped, open: Object.values(L.entries).filter(e => e.status === 'new' || e.status === 'standing').length };
  L.runs = [...L.runs, run].slice(-120);
  L.totals = { entered: Object.keys(L.entries).length + Object.values(L.retired).reduce((a, b) => a + b, 0), confirmed: count('confirmed'), dropped: count('dropped'), open: run.open };
  const settled = L.totals.confirmed + L.totals.dropped;
  L.totals.hit_rate = settled ? Number((L.totals.confirmed / settled).toFixed(4)) : null;
  return { ledger: L, run };
}

// One knob, one step, one prediction: the share of neighbour links that count (pct). Too many new candidates per run means the bar is
// too low to be read as novel; too few means the loop has gone quiet. The next run scores the prediction against what it measured.
export function tune(ledger, params = {}, { tune: T = DEFAULTS.tune } = {}) {
  const pct = params.pct ?? DEFAULTS.pct, last = (ledger.runs || []).slice(-1)[0];
  if (!last) return { params: { ...params, pct }, decision: null };
  let next = pct, why = 'in band';
  if (last.new > T.highNew) { next = Math.min(T.max, pct + T.step); why = `${last.new} new candidates is above ${T.highNew}`; }
  else if (last.new < T.lowNew && last.candidates < 4 * T.lowNew) { next = Math.max(T.min, pct - T.step); why = `${last.new} new candidates is below ${T.lowNew}`; }
  next = Number(next.toFixed(3));
  const decision = next === pct ? null : { at: last.at, knob: 'pct', from: pct, to: next, why, prediction: next > pct ? `new_candidates <= ${T.highNew} within 24 h` : `new_candidates >= ${T.lowNew} within 24 h` };
  return { params: { ...params, pct: next }, decision };
}
export function scorePrediction(decision, run) { // the prediction's own words decide it: "<metric> <op> <n> within ..."
  const m = decision && /^new_candidates (<=|>=) (\d+)/.exec(decision.prediction || ''); if (!m || !run) return null;
  const ok = m[1] === '<=' ? run.new <= Number(m[2]) : run.new >= Number(m[2]);
  return { ...decision, scored_at: run.at, measured: run.new, kept: ok };
}

// ---------------------------------------------------------------- retrieval fusion -------------------------------------------------------
// Reciprocal rank fusion of ranked id lists (keyword and vector): robust, parameter-light, no score calibration needed.
export function rrf(lists, { k = 60, limit = 10 } = {}) {
  const s = new Map();
  for (const l of lists) l.forEach((id, r) => s.set(id, (s.get(id) || 0) + 1 / (k + r + 1)));
  return [...s].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit).map(([id, score]) => ({ id, score }));
}

// Plain sentences for a candidate, from the system's own labels: the page never depends on a model being up.
export function explain(c, label = id => id) {
  const [a, b] = c.members, pct = x => Math.round(100 * x) + '%';
  if (c.type === 'transfer') return `"${label(a)}" has evidence against "${label(c.via)}". "${label(b)}" reads ${pct(c.sims.problems)} alike, and nothing links the two yet: worth testing there.`;
  if (c.type === 'combination') return `"${label(a)}" and "${label(b)}" work on related problems (${pct(c.sims.problems)} alike) from different angles (${pct(c.sims.solutions)} alike) and have not been combined.`;
  if (c.type === 'bridge') return `"${label(a)}" and "${label(b)}" read ${pct(c.sims.pair)} alike but sit in different clusters with no known link between them.`;
  return `No known solution comes close to "${label(a)}" (the nearest, "${label(c.via)}", is ${pct(c.sims.nearest_solution)} alike): an open question.`;
}
