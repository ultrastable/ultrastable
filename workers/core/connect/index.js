// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// core/connect: the connection engine (CONNECT-1). A knowledge graph says what is already linked; a vector space says what is alike.
// A novel connection is where they disagree: two things that mean nearly the same (close in the vector space) that nobody has linked
// (far apart in the graph, or in different domains). This module finds those, ranks them, and learns from what happened to the ones it
// handed on. Tenant-agnostic: item kinds, the relation being discovered, the wording and the evidence weights are the tenant's data.
//
// Pipeline: items -> embed (routes tried in order; one space per run) -> vectors (int8, cached by text hash) -> generators over graph and
// vectors -> score = relevance x novelty x support x value x learned kind weight -> diversified shortlist -> questions and proposed edges.
//   transfer  S addresses P; Q means nearly what P means; S is not linked to Q          ("try what works for P on Q")
//   bridge    A and B are close in meaning but far in the graph or from different domains ("what does one lend the other?")
//   closure   Swanson ABC: S shares problems with S2, S2 addresses Q, S does not (Adamic-Adar weighted, then gated by meaning)
// Nothing here publishes. A candidate is a lead (a proposed kgraph edge) until a downstream check confirms it with provenance.
// Ports: embedders ({ id, embed(texts) }), fetch, ai (a Workers AI binding), token(). No platform import.
import { tokenize } from '../ask/index.js';
import { quantize } from '../tenantstore/vector.js';

export const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
export const SCHEMA = 'connect/1';

// ---------------------------------------------------------------- vectors ------------------------------------------------------------------
export function unit(v) {
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / n; return o;
}
export function dot(a, b) { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }
// FNV-1a, 32 bit: a stable, dependency-free fingerprint for cache keys and feature hashing (not a security hash).
export function fnv(s) { let h = 0x811c9dc5; const t = String(s); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 255); return btoa(s); };
const unb64 = s => { const t = atob(s), o = new Int8Array(t.length); for (let i = 0; i < t.length; i++) o[i] = (t.charCodeAt(i) << 24) >> 24; return o; };
// int8 storage: 1 byte a dimension, about 4x smaller than float32; cosine order is preserved to within quantisation noise.
export function pack(v) { const { q, scale } = quantize(v); return { d: v.length, s: Number(scale.toPrecision(6)), q: b64(new Uint8Array(q.buffer)) }; }
export function unpack(p) { const q = unb64(p.q), o = new Float32Array(q.length); for (let i = 0; i < q.length; i++) o[i] = q[i] * p.s; return unit(o); }

// ---------------------------------------------------------------- embedders ----------------------------------------------------------------
// Lexical route: TF-IDF over word unigrams and bigrams, signed feature hashing, sublinear tf. Needs no network, no model and no credential,
// so a run always completes (No single route). It sees shared words, not shared meaning; the model routes are preferred when they answer.
const stem = w => (w.length > 4 ? w.replace(/(ings?|edly|ed|es|s)$/, '') : w);
const features = t => { const w = tokenize(t).map(stem), f = [...w]; for (let i = 0; i + 1 < w.length; i++) f.push(w[i] + '_' + w[i + 1]); return f; };
export function lexicalEmbedder(corpus, { dim = 512 } = {}) {
  const df = new Map(), docs = corpus.map(features);
  for (const f of docs) for (const x of new Set(f)) df.set(x, (df.get(x) || 0) + 1);
  const N = docs.length, idf = x => Math.log((N + 1) / ((df.get(x) || 0) + 1)) + 1;
  const one = text => {
    const tf = new Map(); for (const x of features(text)) tf.set(x, (tf.get(x) || 0) + 1);
    const v = new Float32Array(dim);
    for (const [x, n] of tf) { const h = fnv(x); v[h % dim] += ((h >>> 31) ? -1 : 1) * (1 + Math.log(n)) * idf(x); }
    return unit(v);
  };
  return { id: `lexical-${dim}-${fnv(corpus.join('\u0001')).toString(36)}`, cache: false, embed: async texts => texts.map(one) };
}
// Workers AI binding (inside a Worker): bge returns { shape, data: number[][] }.
export function workersAiEmbedder(ai, { model = EMBED_MODEL, batch = 50 } = {}) {
  return { id: `wai:${model}`, async embed(texts) {
    const out = [];
    for (let i = 0; i < texts.length; i += batch) { const r = await ai.run(model, { text: texts.slice(i, i + batch) }); if (!r || !Array.isArray(r.data)) throw new Error('embedding reply had no data'); out.push(...r.data); }
    return out.map(unit);
  } };
}
// A keyless model route over HTTP (core/modelservice `embed`): the caller proves itself with a short-lived token from token().
export function httpEmbedder({ url, token, model = EMBED_MODEL, fetch: f = globalThis.fetch, batch = 50 }) {
  return { id: `wai:${model}`, async embed(texts) {
    const out = [], auth = token ? await token() : null;
    for (let i = 0; i < texts.length; i += batch) {
      const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify({ embed: texts.slice(i, i + batch), model }) });
      if (!r.ok) throw new Error(`embed route HTTP ${r.status}`);
      const j = await r.json(); if (!Array.isArray(j.vectors)) throw new Error('embed route returned no vectors'); out.push(...j.vectors);
    }
    return out.map(unit);
  } };
}
// GitHub Models (OpenAI-compatible embeddings) on a CI run's own GITHUB_TOKEN with `models: read`; no key a person mints.
export function githubModelsEmbedder({ token, model = 'openai/text-embedding-3-small', fetch: f = globalThis.fetch, batch = 64 }) {
  return { id: `ghm:${model}`, async embed(texts) {
    const out = [];
    for (let i = 0; i < texts.length; i += batch) {
      const r = await f('https://models.github.ai/inference/embeddings', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ model, input: texts.slice(i, i + batch) }) });
      if (!r.ok) throw new Error(`github-models embeddings HTTP ${r.status}`);
      const j = await r.json(); const d = (j.data || []).slice().sort((a, b) => a.index - b.index).map(x => x.embedding);
      if (d.length !== Math.min(batch, texts.length - i)) throw new Error('github-models returned the wrong number of vectors'); out.push(...d);
    }
    return out.map(unit);
  } };
}

// Embed every item with ONE route, so all vectors share a space. Routes are tried in order; a route that fails part-way is abandoned whole
// and the next one embeds everything. cache: a plain object { key: packed } the tenant persists; only changed texts cost a model call.
export async function embedAll(items, { embedders, cache = {}, log = () => {} }) {
  if (!embedders || !embedders.length) throw new Error('embedAll needs at least one embedder');
  const tried = [];
  for (const e of embedders) {
    const key = it => `${e.id}|${fnv(it.text).toString(36)}`;
    const todo = e.cache === false ? items : items.filter(it => !cache[key(it)]);
    try {
      const got = todo.length ? await e.embed(todo.map(it => it.text)) : [];
      if (got.length !== todo.length) throw new Error(`got ${got.length} vectors for ${todo.length} texts`);
      const fresh = new Map(todo.map((it, i) => [it.id, got[i]])), vectors = new Map(), next = { ...cache };
      for (const it of items) {
        const v = fresh.get(it.id) || unpack(cache[key(it)]);
        vectors.set(it.id, v instanceof Float32Array ? v : unit(v));
        if (e.cache !== false && fresh.has(it.id)) next[key(it)] = pack(vectors.get(it.id));
      }
      // keep only this route's live keys, so the cache cannot grow without bound
      const live = new Set(items.map(key)), kept = Object.fromEntries(Object.entries(next).filter(([k]) => !k.startsWith(e.id + '|') || live.has(k)));
      return { route: e.id, vectors, cache: e.cache === false ? cache : kept, embedded: todo.length, cached: items.length - todo.length, tried };
    } catch (err) { tried.push(`${e.id}: ${String(err.message || err).slice(0, 160)}`); log(`embed route ${e.id} failed: ${err.message || err}`); }
  }
  throw new Error('every embed route failed: ' + tried.join('; '));
}

// Semantic search over the same vectors: the vector-database query a natural-language question needs.
export function nearest(vectors, query, { k = 5, filter = () => true, exclude = new Set() } = {}) {
  const out = [];
  for (const [id, v] of vectors) if (!exclude.has(id) && filter(id)) out.push({ id, score: dot(query, v) });
  return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, k);
}

// ---------------------------------------------------------------- graph ---------------------------------------------------------------------
// Undirected hop distance over confirmed edges, from one node, bounded. Unreached nodes are absent (distance Infinity).
export function adjacency(edges) {
  const adj = new Map(), add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const e of edges) if ((e.status || 'confirmed') === 'confirmed') { add(e.src, e.dst); add(e.dst, e.src); }
  return adj;
}
export function hops(adj, from, maxDepth = 4) {
  const d = new Map([[from, 0]]); let frontier = [from];
  for (let k = 1; k <= maxDepth && frontier.length; k++) { const next = []; for (const n of frontier) for (const m of adj.get(n) || []) if (!d.has(m)) { d.set(m, k); next.push(m); } frontier = next; }
  return d;
}
// Novelty from graph distance: 1 hop is already linked (0); further is more novel; unreachable within the bound is fully novel (1).
export const distanceNovelty = d => (d === undefined || d === Infinity ? 1 : d <= 1 ? 0 : 1 - 1 / d);

// ---------------------------------------------------------------- discovery -----------------------------------------------------------------
export const DEFAULTS = {
  link: { from: 'solution', rel: 'addresses', to: 'problem' },   // the relation the engine tries to extend
  pair: 'solution',                                                // the kind whose members are paired by `bridge`
  // A candidate must mean more than chance. The cutoff is set from the run's own background (mean + z x sd of the similarities between
  // unrelated pairs, as an earlier fleet's graph curator did), so it holds for any embedding model; minSim is only a floor under it.
  // closure's z is negative: its signal is structural, and meaning only vetoes the clearly unrelated.
  minSim: { transfer: 0.05, bridge: 0.05, closure: 0 }, z: { transfer: 1.28, bridge: 1.64, closure: -0.5 },
  // A target that means almost exactly what a solved problem means is a restatement (another indicator of the same thing), not a new
  // connection: kept as graph hygiene, ranked far down. Threshold = mean + dupZ x sd of the problem background, within [0.25, 0.97].
  dupZ: 4,
  maxDepth: 4, perItem: 2, limit: 40,
  kindWeight: { transfer: 1, bridge: 1, closure: 1 },              // learned by calibrate(); start equal
};
const merged = s => ({ ...DEFAULTS, ...s, link: { ...DEFAULTS.link, ...(s && s.link) }, minSim: { ...DEFAULTS.minSim, ...(s && s.minSim) }, z: { ...DEFAULTS.z, ...(s && s.z) }, kindWeight: { ...DEFAULTS.kindWeight, ...(s && s.kindWeight) } });
const r3 = x => Math.round(x * 1000) / 1000;
// Background similarity of two sets, from a deterministic sample of at most `cap` pairs: { mu, sd, n }.
export function background(A, B, V, { cap = 20000 } = {}) {
  const same = A === B, n = same ? A.length * (A.length - 1) / 2 : A.length * B.length; if (!n) return { mu: 0, sd: 0, n: 0 };
  const step = Math.max(1, Math.floor(n / cap)); let k = 0, s = 0, s2 = 0, m = 0;
  for (let i = 0; i < A.length; i++) for (let j = same ? i + 1 : 0; j < B.length; j++) { if (k++ % step) continue; const x = dot(V(A[i]), V(B[j])); s += x; s2 += x * x; m++; }
  const mu = s / m; return { mu: r3(mu), sd: r3(Math.sqrt(Math.max(0, s2 / m - mu * mu))), n: m };
}
const w = it => (it && Number.isFinite(it.weight) ? Math.max(0, Math.min(1, it.weight)) : 0.5);

/** items: [{ id, kind, label, text, group?, weight? (evidence 0..1) }]; edges: kgraph edges; vectors: Map id -> unit vector.
 *  known: [{ members: [id, id], vector? }] pairs already explored (published or rejected) and therefore not novel.
 *  Returns { candidates, stats }. Deterministic for equal inputs. */
export function discover({ items, edges = [], vectors, spec = {}, known = [] }) {
  const S = merged(spec), byId = new Map(items.map(i => [i.id, i])), V = id => vectors.get(id);
  const has = id => byId.has(id) && V(id);
  const links = edges.filter(e => e.rel === S.link.rel && (e.status || 'confirmed') === 'confirmed' && has(e.src) && has(e.dst));
  const out = new Map(); // src|rel|dst -> candidate
  const linked = new Set(links.map(e => e.src + '>' + e.dst));
  const fromK = items.filter(i => i.kind === S.link.from && V(i.id)), toK = items.filter(i => i.kind === S.link.to && V(i.id));
  const linksOf = new Map(), inOf = new Map();
  for (const e of links) { (linksOf.get(e.src) || linksOf.set(e.src, []).get(e.src)).push(e.dst); (inOf.get(e.dst) || inOf.set(e.dst, []).get(e.dst)).push(e.src); }
  const adj = adjacency(edges.filter(e => byId.has(e.src) && byId.has(e.dst))), distCache = new Map();
  const dist = (a, b) => { if (!distCache.has(a)) distCache.set(a, hops(adj, a, S.maxDepth)); return distCache.get(a).get(b); };
  const exploredKey = new Set(known.map(k => [...(k.members || [])].sort().join('+')));
  const ids = xs => xs.map(x => x.id);
  const T = ids(toK); // one array, so `background` sees the pairs of unrelated items only and not each item with itself (the mean and the cutoff follow US-27-R53)
  const bg = { transfer: background(T, T, V), closure: background(ids(fromK), ids(toK), V) };
  const pairIds = ids(items.filter(i => i.kind === S.pair && V(i.id))); bg.bridge = background(pairIds, pairIds, V);
  const cut = Object.fromEntries(Object.keys(bg).map(k => [k, r3(Math.max(S.minSim[k], bg[k].mu + S.z[k] * bg[k].sd))]));
  cut.duplicate = r3(S.duplicate ?? Math.min(0.97, Math.max(0.25, bg.transfer.mu + S.dupZ * bg.transfer.sd)));
  // one entry per pair and relation; a pair that several generators reach (meaning and structure agree) is corroborated
  const pre = c => c.relevance * c.novelty;
  const add = c => {
    const key = `${c.a}|${c.rel}|${c.b}`, o = out.get(key);
    if (!o) { out.set(key, { ...c, found_by: [c.kind] }); return; }
    const best = pre(c) > pre(o) ? c : o; out.set(key, { ...best, found_by: [...new Set([...o.found_by, c.kind])].sort() });
  };

  // transfer: for each solution S, each target Q it does not reach, the best analogue P it does reach
  for (const s of fromK) {
    const mine = linksOf.get(s.id) || []; if (!mine.length) continue;
    for (const q of toK) {
      if (linked.has(s.id + '>' + q.id)) continue;
      let best = null; for (const p of mine) { const a = dot(V(p), V(q.id)); if (!best || a > best.sim) best = { p, sim: a }; }
      const fit = dot(V(s.id), V(q.id));
      const relevance = Math.sqrt(Math.max(0, best.sim) * Math.max(0, (fit + 1) / 2));
      if (best.sim < cut.transfer) continue;
      const restates = best.sim >= cut.duplicate;
      const novelty = distanceNovelty(dist(s.id, q.id)) * (restates ? 0.15 : 1), value = (inOf.get(q.id) || []).length ? 0.8 : 1;
      add({ kind: 'transfer', a: s.id, b: q.id, rel: S.link.rel, via: [best.p], relevance: r3(relevance), novelty: r3(novelty), support: r3(w(s)), value, sims: { analogue: r3(best.sim), fit: r3(fit) }, ...(restates ? { restates: best.p } : {}) });
    }
  }
  // bridge: close in meaning, far in the graph or across groups. A pair a confirmed edge of the same relation already joins is not proposed again, across groups either (US-27-R52).
  const joined = new Set(edges.filter(e => e.rel === 'shares_mechanism' && (e.status || 'confirmed') === 'confirmed').flatMap(e => [e.src + '>' + e.dst, e.dst + '>' + e.src]));
  const pairs = items.filter(i => i.kind === S.pair && V(i.id));
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const A = pairs[i], B = pairs[j]; if (joined.has(A.id + '>' + B.id)) continue;
    const sim = dot(V(A.id), V(B.id)); if (sim < cut.bridge) continue;
    const cross = A.group && B.group && A.group !== B.group, gn = distanceNovelty(dist(A.id, B.id));
    const novelty = Math.max(gn, cross ? 0.85 : 0); if (novelty <= 0) continue;
    const [a, b] = A.id < B.id ? [A, B] : [B, A];
    add({ kind: 'bridge', a: a.id, b: b.id, rel: 'shares_mechanism', via: [], relevance: r3(sim), novelty: r3(novelty), support: r3(Math.sqrt(w(A) * w(B))), value: cross ? 1 : 0.85, sims: { pair: r3(sim) } });
  }
  // closure (Swanson ABC, Adamic-Adar): S -- P -- S2 -- Q with S not linked to Q, weighted by how specific each shared P is
  for (const s of fromK) {
    const score = new Map(), why = new Map();
    for (const p of linksOf.get(s.id) || []) {
      const wp = 1 / Math.log(2 + (inOf.get(p) || []).length);
      for (const s2 of inOf.get(p) || []) if (s2 !== s.id) for (const q of linksOf.get(s2) || []) {
        if (linked.has(s.id + '>' + q)) continue;
        score.set(q, (score.get(q) || 0) + wp); if (!why.has(q)) why.set(q, [p, s2]);
      }
    }
    for (const [q, aa] of score) {
      const sim = dot(V(s.id), V(q)); if (sim < cut.closure) continue;
      const relevance = Math.sqrt(Math.min(1, aa) * Math.max(0, sim));
      add({ kind: 'closure', a: s.id, b: q, rel: S.link.rel, via: why.get(q), relevance: r3(relevance), novelty: r3(distanceNovelty(dist(s.id, q))), support: r3(w(s)), value: 0.9, sims: { fit: r3(sim), adamic_adar: r3(aa) } });
    }
  }
  // score, drop what was already explored, then a diversified shortlist (no item dominates)
  const all = [...out.values()].map(c => {
    const kw = S.kindWeight[c.kind] ?? 1, agree = 1 + 0.25 * (c.found_by.length - 1), score = Math.min(1, c.relevance * c.novelty * (0.5 + 0.5 * c.support) * c.value * kw * agree);
    const members = [c.a, c.b].sort().join('+');
    return { id: `${c.kind}:${c.a}>${c.b}`, ...c, score: r3(score), explored: exploredKey.has(members) };
  }).filter(c => c.score > 0);
  all.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
  const uses = new Map(), shortlist = [];
  for (const c of all) {
    if (c.explored || shortlist.length >= S.limit) continue;
    if ((uses.get(c.a) || 0) >= S.perItem || (uses.get(c.b) || 0) >= S.perItem) continue;
    uses.set(c.a, (uses.get(c.a) || 0) + 1); uses.set(c.b, (uses.get(c.b) || 0) + 1); shortlist.push(c);
  }
  const byKind = {}; for (const c of all) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  return { candidates: shortlist, stats: { items: items.length, vectors: [...vectors.keys()].filter(k => byId.has(k)).length, links: links.length, scored: all.length, explored: all.filter(c => c.explored).length, by_kind: byKind, background: bg, cutoff: cut } };
}

// ---------------------------------------------------------------- learning ------------------------------------------------------------------
// Learn-apply-verify: each candidate handed downstream comes back as an outcome ('accepted' | 'rejected'). A generator whose leads survive
// gets more weight next run; one whose leads die gets less. Beta(1,1) prior, bounded so one bad week cannot switch a generator off.
// The base rate is anchored half to a prior expectation (`expect`), so a generator whose leads keep failing is down-weighted even when it is the
// only one with outcomes (a purely relative base would cancel out and never move).
export function calibrate(outcomes, { floor = 0.5, ceil = 1.5, min = 3, expect = 0.25 } = {}) {
  const t = {}, a = {};
  for (const o of outcomes) { const k = String(o.id || '').split(':')[0] || o.kind; if (!k || !['accepted', 'rejected'].includes(o.outcome)) continue; t[k] = (t[k] || 0) + 1; if (o.outcome === 'accepted') a[k] = (a[k] || 0) + 1; }
  const total = Object.values(t).reduce((x, y) => x + y, 0), observed = (Object.values(a).reduce((x, y) => x + y, 0) + 1) / (total + 2), base = (observed + expect) / 2, kindWeight = {};
  for (const k of Object.keys(DEFAULTS.kindWeight)) kindWeight[k] = (t[k] || 0) < min ? 1 : r3(Math.max(floor, Math.min(ceil, ((a[k] || 0) + 1) / (t[k] + 2) / base)));
  return { kindWeight, tried: t, accepted: a, base_rate: r3(base) };
}

// ---------------------------------------------------------------- outputs -------------------------------------------------------------------
// Every candidate becomes a proposed kgraph edge (a lead, never a confirmed fact) and a question in the tenant's wording.
export const toProposals = (cands, { by = 'core/connect' } = {}) => cands.map(c => ({ src: c.a, rel: c.rel, dst: c.b, status: 'proposed', why: `${c.kind} score ${c.score} (relevance ${c.relevance}, novelty ${c.novelty})${c.via.length ? ' via ' + c.via.join(', ') : ''}; proposed by ${by}` }));
export function questions(cands, items, wording) {
  const L = id => { const i = items.find(x => x.id === id); return i ? i.label : id; };
  return cands.map(c => ({ id: c.id, kind: c.kind, score: c.score, text: (wording[c.kind] || (x => `${x.a} and ${x.b}?`))({ a: L(c.a), b: L(c.b), via: c.via.map(L), c }) }));
}
