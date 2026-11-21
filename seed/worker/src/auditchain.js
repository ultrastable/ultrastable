// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// AUDIT-CHAIN-1 (Rowan, 2026-11-17): everything is traceable, and D1 stays small. Lesson from an earlier fleet: its audit database kept every
// row and read billions of them in 30 days from scans. Here D1 holds only the last hot_days of events, read by primary key or index.
// Older events are sealed, in order, into append-only gzip NDJSON segments written to every available sink (R2 bucket, git repository),
// each with a manifest: row-hash chain, Merkle root, bytes hash and a hash chain over segments. A change to any past row breaks
// every later hash; verify() finds it. Deletion from D1 happens only after the segment is read back from a sink and matches.
export const HOT_DAYS = 7, SEAL_MAX_ROWS = 5000, GENESIS = '0'.repeat(64);

// One hash and Merkle implementation for every audit log (Q-AUDIT-CONVERGE-1): the core module owns it.
import { sha256 as coreSha256, merkleLevels } from './vendor/core/audit.js';
export const sha256 = coreSha256;
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];

// Secrets and contact details never rest in the trail (the same classes provenance.js removes).
const RED = [[/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[removed]'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,})/g, '[removed]'],
  [/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, '$1']];
export const redact = (t) => RED.reduce((o, [rx, to]) => o.replace(rx, to), String(t == null ? '' : t));

// The canonical form hashed for a row: a fixed-order array, so every runtime produces the same bytes.
export const canon = (r) => JSON.stringify([r.seq, r.at, r.rec, r.kind, r.actor, r.ref, r.summary, r.data]);
export const rowHash = (prev, r) => sha256(prev + '\n' + canon(r));

async function tip(db) {
  const t = await first(db, 'SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1');
  if (t) return t;
  const s = await first(db, 'SELECT seq_to AS seq, last_hash AS hash FROM audit_segments ORDER BY seq_from DESC LIMIT 1');
  return s || { seq: 0, hash: GENESIS };
}

/** Append events (one read, one insert each). Returns the rows. Concurrent writers collide on the primary key and retry. */
export async function record(db, events, { now = Date.now() } = {}) {
  const list = (Array.isArray(events) ? events : [events]).filter(Boolean);
  if (!list.length) return [];
  for (let attempt = 0; attempt < 4; attempt++) {
    let t = await tip(db); const out = [];
    try {
      for (const e of list) {
        const r = { seq: t.seq + 1, at: Number(e.at) || now, rec: now, kind: redact(e.kind).slice(0, 60) || 'event', actor: redact(e.actor || 'system').slice(0, 60),
          ref: redact(e.ref).slice(0, 120), summary: redact(e.summary).slice(0, 500), data: redact(JSON.stringify(e.data || {})).slice(0, 2000) };
        r.prev = t.hash; r.hash = await rowHash(t.hash, r);
        await db.prepare('INSERT INTO audit_log (seq, at, rec, kind, actor, ref, summary, data, prev, hash) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)')
          .bind(r.seq, r.at, r.rec, r.kind, r.actor, r.ref, r.summary, r.data, r.prev, r.hash).run();
        t = { seq: r.seq, hash: r.hash }; out.push(r);
      }
      return out;
    } catch (err) { if (!/constraint|unique|primary/i.test(String(err && err.message))) throw err; }
  }
  throw new Error('audit chain busy: could not append after 4 attempts');
}

export async function merkleRoot(hashes) { const lv = await merkleLevels(hashes); return lv[lv.length - 1][0]; }

// A small Bloom filter over refs lets a lookup open only the segments that may mention a ref. False positives cost one fetch, never a miss.
const bitsFor = (n) => { let m = 1024; while (m < n * 16 && m < 65536) m *= 2; return m; };
function positions(key, m) { let h1 = 2166136261, h2 = 5381; for (const ch of key) { const c = ch.charCodeAt(0); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + c) >>> 0; } return [0, 1, 2, 3].map(i => ((h1 + i * h2) >>> 0) % m); }
export function bloomBuild(keys) { const m = bitsFor(keys.size), bytes = new Uint8Array(m / 8); for (const k of keys) for (const p of positions(k, m)) bytes[p >> 3] |= 1 << (p & 7); return m + ':' + Buffer.from(bytes).toString('base64'); }
export function bloomHas(bloom, key) { const [ms, b64] = String(bloom).split(':'), m = Number(ms), bytes = Buffer.from(b64 || '', 'base64'); return positions(key, m).every(p => bytes[p >> 3] & (1 << (p & 7))); }

async function gzip(text) { const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')); return new Uint8Array(await new Response(s).arrayBuffer()); }
async function gunzip(bytes) { const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')); return await new Response(s).text(); }
const pad = (n) => String(n).padStart(12, '0');
export const segKey = (seqFrom) => `audit/seg/${pad(seqFrom)}.ndjson.gz`;
export const manKey = (seqFrom) => `audit/man/${pad(seqFrom)}.json`;

// ---- sinks: { name, put(key, bytes), get(key) -> bytes|null }. Append-only: a put onto an existing key must carry identical bytes.
export function r2Sink(bucket) {
  return { name: 'r2', async put(key, bytes) { const ex = await bucket.head(key); if (ex) { const g = await bucket.get(key); if (await sha256(new Uint8Array(await g.arrayBuffer())) !== await sha256(bytes)) throw new Error('audit sink conflict: ' + key); return; } await bucket.put(key, bytes); },
    async get(key) { const g = await bucket.get(key); return g ? new Uint8Array(await g.arrayBuffer()) : null; } };
}
// The repository is a second, independent store: git history is itself a hash chain, and it costs nothing.
export function githubSink({ token, repo, prefix = '', fetchFn = fetch, branch = 'main' }) {
  const url = (key) => `https://api.github.com/repos/${repo}/contents/${prefix}${key}`;
  const h = { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-audit' };
  return { name: 'github', async get(key) { const r = await fetchFn(url(key) + '?ref=' + branch, { headers: h }); if (r.status === 404) return null; if (!r.ok) throw new Error('github get ' + r.status); const j = await r.json(); return Uint8Array.from(Buffer.from(j.content || '', 'base64')); },
    async put(key, bytes) { const ex = await this.get(key); if (ex) { if (await sha256(ex) !== await sha256(bytes)) throw new Error('audit sink conflict: ' + key); return; }
      const r = await fetchFn(url(key), { method: 'PUT', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'audit: ' + key, content: Buffer.from(bytes).toString('base64'), branch }) });
      if (!r.ok) throw new Error('github put ' + r.status); } };
}

/** Seal events older than hot_days into one segment (at most max_rows). Safe to call every day; does nothing when there is nothing due. */
export async function seal(db, sinks, { now = Date.now(), hotDays = HOT_DAYS, maxRows = SEAL_MAX_ROWS } = {}) {
  if (!sinks || !sinks.length) return { sealed: 0, skipped: 'no archive sink bound; hot rows are kept, nothing is deleted' };
  const cutoff = now - hotDays * 864e5;
  const rows = await all(db, 'SELECT * FROM audit_log WHERE seq > ?1 AND rec < ?2 ORDER BY seq LIMIT ?3', (await first(db, 'SELECT COALESCE(MAX(seq_to),0) AS s FROM audit_segments')).s, cutoff, maxRows);
  if (!rows.length) return { sealed: 0, skipped: 'nothing older than ' + hotDays + ' days' };
  const prevSeg = await first(db, 'SELECT last_hash, chain, seq_to FROM audit_segments ORDER BY seq_from DESC LIMIT 1');
  const startPrev = prevSeg ? prevSeg.last_hash : GENESIS;
  let p = startPrev; const refs = new Set(), kinds = {};
  for (const r of rows) { if (r.prev !== p || await rowHash(p, r) !== r.hash) throw new Error('audit chain broken at seq ' + r.seq + ' before sealing'); p = r.hash; if (r.ref) refs.add(r.ref); kinds[r.kind] = (kinds[r.kind] || 0) + 1; }
  const body = rows.map(r => JSON.stringify(r)).join('\n') + '\n', bytes = await gzip(body), bytesHash = await sha256(bytes);
  const m = { v: 1, seq_from: rows[0].seq, seq_to: rows[rows.length - 1].seq, count: rows.length, at_min: Math.min(...rows.map(r => r.at)), at_max: Math.max(...rows.map(r => r.at)),
    prev_hash: startPrev, last_hash: p, merkle_root: await merkleRoot(rows.map(r => r.hash)), sha256: bytesHash, bytes: bytes.length, kinds };
  m.chain = await sha256([prevSeg ? prevSeg.chain : GENESIS, m.sha256, m.merkle_root, m.seq_from, m.seq_to].join('|'));
  const manBytes = new TextEncoder().encode(JSON.stringify(m)), used = [], failed = [];
  for (const s of sinks) {
    try {
      await s.put(segKey(m.seq_from), bytes); await s.put(manKey(m.seq_from), manBytes);
      const back = await s.get(segKey(m.seq_from));  // read back before anything is deleted
      if (!back || await sha256(back) !== bytesHash) throw new Error('read-back mismatch');
      used.push(s.name);
    } catch (e) { failed.push(s.name + ': ' + String(e && e.message).slice(0, 120)); }
  }
  if (!used.length) throw new Error('audit seal failed on every sink, nothing deleted: ' + failed.join('; '));
  await db.prepare('INSERT OR IGNORE INTO audit_segments (seq_from, seq_to, count, at_min, at_max, prev_hash, last_hash, merkle_root, sha256, chain, bloom, kinds, sinks, sealed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)')
    .bind(m.seq_from, m.seq_to, m.count, m.at_min, m.at_max, m.prev_hash, m.last_hash, m.merkle_root, m.sha256, m.chain, bloomBuild(refs), JSON.stringify(kinds), JSON.stringify(used), now).run();
  await db.prepare('DELETE FROM audit_log WHERE seq >= ?1 AND seq <= ?2').bind(m.seq_from, m.seq_to).run();
  return { sealed: m.count, seq_from: m.seq_from, seq_to: m.seq_to, sinks: used, failed_sinks: failed, merkle_root: m.merkle_root, chain: m.chain, more: rows.length === maxRows };
}

/** Public: the chain head, which anyone can write down elsewhere to anchor the trail. */
export async function head(db) {
  const t = await tip(db), s = await first(db, 'SELECT COUNT(*) AS n, MAX(seq_to) AS sealed_seq, (SELECT chain FROM audit_segments ORDER BY seq_from DESC LIMIT 1) AS chain FROM audit_segments');
  return { seq: t.seq, hash: t.hash, segments: s.n, sealed_seq: s.sealed_seq || 0, segment_chain: s.chain || GENESIS };
}

/** Recompute everything it can reach. deep=true also opens each segment (bounded by maxSegments per call, resumable with fromSeq). */
export async function verify(db, sinks, { deep = false, maxSegments = 31, fromSeq = 0, hotCap = 20000 } = {}) {
  const bad = [], segs = await all(db, 'SELECT * FROM audit_segments WHERE seq_from >= ?1 ORDER BY seq_from LIMIT ?2', fromSeq, maxSegments + 1);
  const page = segs.slice(0, maxSegments); let prevChain = GENESIS, prevHash = GENESIS, expectFrom = 1;
  if (fromSeq > 0) { const b = await first(db, 'SELECT last_hash, chain, seq_to FROM audit_segments WHERE seq_to < ?1 ORDER BY seq_from DESC LIMIT 1', fromSeq); if (b) { prevChain = b.chain; prevHash = b.last_hash; expectFrom = b.seq_to + 1; } }
  let deepChecked = 0;
  for (const s of page) {
    if (s.seq_from !== expectFrom) bad.push({ seg: s.seq_from, why: `gap or overlap: expected seq ${expectFrom}` });
    if (s.prev_hash !== prevHash) bad.push({ seg: s.seq_from, why: 'prev_hash does not continue the chain' });
    if (await sha256([prevChain, s.sha256, s.merkle_root, s.seq_from, s.seq_to].join('|')) !== s.chain) bad.push({ seg: s.seq_from, why: 'segment chain hash mismatch' });
    if (deep) {
      let checked = false;
      for (const sk of sinks || []) {
        const man = await sk.get(manKey(s.seq_from)), seg = await sk.get(segKey(s.seq_from));
        if (!man || !seg) { bad.push({ seg: s.seq_from, why: `missing in ${sk.name}` }); continue; }
        checked = true;
        const m = JSON.parse(new TextDecoder().decode(man));
        if (m.chain !== s.chain || m.merkle_root !== s.merkle_root || m.sha256 !== s.sha256) bad.push({ seg: s.seq_from, why: `${sk.name} manifest differs from the D1 index` });
        if (await sha256(seg) !== s.sha256) { bad.push({ seg: s.seq_from, why: `${sk.name} segment bytes changed` }); continue; }
        const rows = (await gunzip(seg)).trim().split('\n').map(l => JSON.parse(l)); let p = s.prev_hash;
        for (const r of rows) { if (r.prev !== p || await rowHash(p, r) !== r.hash) { bad.push({ seg: s.seq_from, why: `${sk.name} row ${r.seq} hash mismatch` }); break; } p = r.hash; }
        if (await merkleRoot(rows.map(r => r.hash)) !== s.merkle_root) bad.push({ seg: s.seq_from, why: `${sk.name} merkle root mismatch` });
      }
      if (!checked) bad.push({ seg: s.seq_from, why: 'no sink could be read' }); else deepChecked++;
    }
    prevChain = s.chain; prevHash = s.last_hash; expectFrom = s.seq_to + 1;
  }
  const more = segs.length > maxSegments;
  let hot = { rows: 0, ok: true };
  if (!more) {  // the hot tail must continue from the last sealed hash
    const rows = await all(db, 'SELECT * FROM audit_log ORDER BY seq LIMIT ?1', hotCap); let p = prevHash, exp = expectFrom;
    for (const r of rows) { if (r.seq !== exp || r.prev !== p || await rowHash(p, r) !== r.hash) { hot.ok = false; bad.push({ seg: 'hot', why: 'row ' + r.seq + ' does not continue the chain' }); break; } p = r.hash; exp++; }
    hot.rows = rows.length;
  }
  return { ok: bad.length === 0, segments_checked: page.length, deep, deep_segments_read: deepChecked, hot, next_from_seq: more ? segs[maxSegments].seq_from : null, bad, head: await head(db) };
}

/** Trace one thing back through hot rows and archived segments. Indexed reads only; archive segments are opened only when their filter matches. */
export async function trace(db, sinks, { ref, kind, from = 0, to = Date.now() + 864e5, limit = 100, maxSegments = 12 } = {}) {
  if (!ref && !kind) return { error: 'give ref or kind' };
  const lim = Math.min(Number(limit) || 100, 500), out = [];
  const hotRows = ref ? await all(db, 'SELECT * FROM audit_log WHERE ref = ?1 AND at >= ?2 AND at <= ?3 ORDER BY seq LIMIT ?4', ref, from, to, lim)
    : await all(db, 'SELECT * FROM audit_log WHERE kind = ?1 AND at >= ?2 AND at <= ?3 ORDER BY at LIMIT ?4', kind, from, to, lim);
  const segs = await all(db, 'SELECT seq_from, bloom, kinds, at_min, at_max FROM audit_segments WHERE at_max >= ?1 AND at_min <= ?2 ORDER BY seq_from DESC', from, to);
  const hits = segs.filter(s => ref ? bloomHas(s.bloom, ref) : kind in JSON.parse(s.kinds));
  let opened = 0;
  for (const s of hits) {
    if (opened >= maxSegments || out.length + hotRows.length >= lim) break;
    let bytes = null; for (const sk of sinks || []) { bytes = await sk.get(segKey(s.seq_from)).catch(() => null); if (bytes) break; }
    opened++; if (!bytes) { out.push({ missing_segment: s.seq_from }); continue; }
    for (const l of (await gunzip(bytes)).trim().split('\n')) { const r = JSON.parse(l); if ((ref ? r.ref === ref : r.kind === kind) && r.at >= from && r.at <= to) out.push(r); }
  }
  const rows = [...out.filter(r => !r.missing_segment), ...hotRows].sort((a, b) => a.seq - b.seq).slice(0, lim);
  return { rows, segments_opened: opened, segments_skipped_by_filter: segs.length - hits.length, incomplete: out.some(r => r.missing_segment) || hits.length > opened };
}

/** Retention hook: copy rows into the chain before they are deleted from their own table. */
export const archiveRows = (db, table) => async (rows) => { await record(db, rows.map(r => ({ at: Date.parse(String(r.at || r.started_at || r.due_at || r.created_at || '').replace(' ', 'T') + (String(r.at || '').includes('Z') ? '' : 'Z')) || undefined, kind: 'archive:' + table, actor: 'retention', ref: String(r.item_id || r.id || r.handoff_id || ''), summary: table + ' row aged out of D1', data: r }))); };
