// VENDORED from ultrastable/workers core/audit/index.js so a seed checkout is self-contained (SEED-SELFCONTAINED-1); tests/foundation/test_failmine.py keeps it identical.
// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// core/audit (AUDIT-1): one append-only, hash-chained log of every autonomous action, small enough for a free tier, for any tenant.
// Each event stores a redacted summary and the sha-256 of its raw payload (the payload itself is never kept). Recent events live in D1; each
// finished UTC day is rolled into one gzip batch (R2 if a bucket is given, else one D1 row) with a Merkle root, and its event rows are deleted.
// A day anchor chains to the day before, so the whole history is checked from anchors alone and any one event is proved by a Merkle path.
// Ports: db (D1-style), bucket (optional R2-style {put,get,delete}), now, config. Web APIs only (crypto.subtle, CompressionStream).
const ZERO = '0'.repeat(64);
const DAY = 86400e3;
export const DEFAULTS = { tenant: 'tenant', hotDays: 2, archiveDays: 400, maxSummary: 280, deepDays: 3, listMax: 200 };
const KIND = /^[a-z][a-z0-9_.-]{1,40}$/;
const RED = [[/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[removed]'], [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,})\b/g, '[removed]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[removed]'], [/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, '$1']];
export const redact = t => { let o = String(t == null ? '' : t); for (const [rx, to] of RED) o = o.replace(rx, to); return o.replace(/\s+/g, ' ').trim(); };

export async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', typeof s === 'string' ? new TextEncoder().encode(s) : s); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
export const eventHash = (prev, e) => sha256(prev + '\n' + JSON.stringify([e.seq, e.at, e.actor, e.kind, e.subject, e.summary, e.ref, e.pay]));
const pair = (a, b) => sha256(a + b);
// Merkle tree over event hashes; an odd node is paired with itself. levels[0] are the leaves, the last level holds the root.
export async function merkleLevels(leaves) {
  if (!leaves.length) return [[ZERO]];
  const levels = [leaves.slice()];
  while (levels[levels.length - 1].length > 1) { const l = levels[levels.length - 1], n = []; for (let i = 0; i < l.length; i += 2) n.push(await pair(l[i], l[i + 1] ?? l[i])); levels.push(n); }
  return levels;
}
export function merklePath(levels, i) { const path = []; for (let L = 0; L < levels.length - 1; L++, i = i >> 1) { const l = levels[L], s = i ^ 1; path.push({ side: i % 2 ? 'left' : 'right', hash: l[s] ?? l[i] }); } return path; }
export async function applyPath(leaf, path) { let h = leaf; for (const p of path) h = p.side === 'left' ? await pair(p.hash, h) : await pair(h, p.hash); return h; }
const dayHash = (prevDay, d) => sha256([prevDay, d.day, d.n, d.root, d.last_hash].join('\n'));

const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function gz(text) { const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')); return new Uint8Array(await new Response(s).arrayBuffer()); }
async function gunzip(u8) { const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip')); return new Response(s).text(); }
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);

export function createAudit({ db, bucket = null, now = () => Date.now(), config = {} } = {}) {
  if (!db) throw new Error('audit needs a db');
  const cfg = { ...DEFAULTS, ...config };
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const one = async (sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  const metaGet = async k => { const r = await one(`SELECT v FROM audit_meta WHERE k=?`, k); try { return r ? JSON.parse(r.v) : null; } catch { return null; } };
  const metaSet = (k, v) => run(`INSERT INTO audit_meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, k, JSON.stringify(v));
  // The head is the newest hot event, or the last rolled day's final event when no event row remains.
  async function head() {
    const e = await one(`SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1`);
    if (e) return { seq: e.seq, hash: e.hash };
    const d = await one(`SELECT last_seq AS seq, last_hash AS hash FROM audit_days ORDER BY day DESC LIMIT 1`);
    return d || { seq: 0, hash: ZERO };
  }
  const clean = o => {
    if (!KIND.test(String(o.kind || ''))) throw new Error('kind must match ' + KIND);
    const actor = redact(o.actor).slice(0, 60), summary = redact(o.summary).slice(0, cfg.maxSummary);
    if (!actor || !summary) throw new Error('actor and summary are required');
    return { actor, kind: o.kind, subject: redact(o.subject).slice(0, 80), summary, ref: String(o.ref || '').replace(/[^\w:/.#@-]/g, '').slice(0, 80) };
  };
  // payload (any value) is hashed, never stored: the hash proves what was acted on if the original is produced later.
  async function append(o) {
    const c = clean(o), pay = o.payload === undefined ? '' : await sha256(typeof o.payload === 'string' ? o.payload : JSON.stringify(o.payload));
    for (let attempt = 0; attempt < 4; attempt++) {
      const h = await head(), at = new Date(o.at || now()).toISOString(), e = { seq: h.seq + 1, at, ...c, pay };
      e.hash = await eventHash(h.hash, e);
      try {
        await run(`INSERT INTO audit_events (seq,day,at,actor,kind,subject,summary,ref,pay,prev,hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, e.seq, at.slice(0, 10), at, e.actor, e.kind, e.subject, e.summary, e.ref, e.pay, h.hash, e.hash);
        return { seq: e.seq, hash: e.hash, at };
      } catch (err) { if (!/UNIQUE|constraint|PRIMARY/i.test(String(err && err.message))) throw err; }
    }
    throw new Error('audit append lost the race four times');
  }
  async function appendMany(list) { const out = []; for (const o of list) out.push(await append(o)); return out; }

  async function batchOf(rows) { const lines = rows.map(r => ({ seq: r.seq, at: r.at, actor: r.actor, kind: r.kind, subject: r.subject, summary: r.summary, ref: r.ref, pay: r.pay, prev: r.prev, hash: r.hash })); return JSON.stringify({ v: 1, tenant: cfg.tenant, events: lines }); }
  // Roll every finished day older than hotDays: anchor row first, archive second, event rows last, so a crash leaves at worst duplicates a re-run removes.
  async function roll() {
    const cutoff = dayOf(now() - cfg.hotDays * DAY), rolled = [];
    const days = await all(`SELECT DISTINCT day FROM audit_events WHERE day < ? ORDER BY day`, cutoff);
    for (const { day } of days) {
      const rows = await all(`SELECT * FROM audit_events WHERE day=? ORDER BY seq`, day);
      if (!rows.length) continue;
      const prevD = await one(`SELECT day, last_seq, day_hash FROM audit_days WHERE day < ? ORDER BY day DESC LIMIT 1`, day);
      const existing = await one(`SELECT day, last_seq FROM audit_days WHERE day=?`, day);
      if (existing) { await run(`DELETE FROM audit_events WHERE day=? AND seq<=?`, day, existing.last_seq); continue; }
      const levels = await merkleLevels(rows.map(r => r.hash)), root = levels[levels.length - 1][0];
      const kinds = {}; for (const r of rows) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
      const d = { day, n: rows.length, root, last_hash: rows[rows.length - 1].hash }, prevDay = prevD ? prevD.day_hash : ZERO;
      const bytes = await gz(await batchOf(rows)), key = `audit/${cfg.tenant}/${day}.json.gz`;
      if (bucket) await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/gzip' } });
      await run(`INSERT INTO audit_days (day,first_seq,last_seq,n,first_prev,last_hash,root,prev_day,day_hash,kinds,bytes,blob_sha,archive_key,blob,rolled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        day, rows[0].seq, rows[rows.length - 1].seq, rows.length, rows[0].prev, d.last_hash, root, prevDay, await dayHash(prevDay, d), JSON.stringify(kinds), bytes.length, await sha256(bytes), bucket ? key : '', bucket ? null : b64(bytes), new Date(now()).toISOString());
      await run(`DELETE FROM audit_events WHERE day=? AND seq<=?`, day, rows[rows.length - 1].seq);
      rolled.push({ day, n: rows.length, bytes: bytes.length });
    }
    // Retention: after archiveDays the batch is dropped but the anchor stays, so the chain still verifies; event-level proof ends there.
    const old = dayOf(now() - cfg.archiveDays * DAY), pruned = [];
    for (const d of await all(`SELECT day, archive_key FROM audit_days WHERE day < ? AND pruned=0`, old)) { if (bucket && d.archive_key) await bucket.delete(d.archive_key); await run(`UPDATE audit_days SET pruned=1, blob=NULL WHERE day=?`, d.day); pruned.push(d.day); }
    return { rolled, pruned };
  }
  async function loadBatch(d) {
    const u8 = d.blob ? unb64(d.blob) : bucket && d.archive_key ? new Uint8Array(await (await bucket.get(d.archive_key))?.arrayBuffer?.() ?? []) : null;
    if (!u8 || !u8.length) return { error: 'archive missing' };
    if (await sha256(u8) !== d.blob_sha) return { error: 'archive bytes differ from the recorded sha-256' };
    return JSON.parse(await gunzip(u8));
  }
  // Re-derives everything: anchor chain from the first day, then the hot events; deep also re-checks the newest unpruned batches (a rotating cursor covers the rest over time).
  async function verify({ deep = true, deepDays = cfg.deepDays } = {}) {
    const problems = [], days = await all(`SELECT * FROM audit_days ORDER BY day`);
    let prevDay = ZERO, prevSeq = 0, prevHash = ZERO;
    for (const d of days) {
      if (d.prev_day !== prevDay) problems.push(`day ${d.day}: does not chain to the day before`);
      if (d.day_hash !== await dayHash(d.prev_day, d)) problems.push(`day ${d.day}: anchor hash does not match its fields`);
      if (d.first_seq !== prevSeq + 1) problems.push(`day ${d.day}: sequence gap (${prevSeq} -> ${d.first_seq})`);
      if (d.first_prev !== prevHash) problems.push(`day ${d.day}: first event does not follow the previous day's last hash`);
      prevDay = d.day_hash; prevSeq = d.last_seq; prevHash = d.last_hash;
    }
    const hot = await all(`SELECT * FROM audit_events ORDER BY seq`);
    for (const e of hot) {
      if (e.seq !== prevSeq + 1) problems.push(`event ${e.seq}: sequence gap after ${prevSeq}`);
      if (e.prev !== prevHash) problems.push(`event ${e.seq}: prev does not match the previous hash`);
      if (e.hash !== await eventHash(e.prev, e)) problems.push(`event ${e.seq}: hash does not match its content`);
      prevSeq = e.seq; prevHash = e.hash;
    }
    let checked = 0;
    if (deep) {
      const live = days.filter(d => !d.pruned), cur = (await metaGet('deep_cursor')) || 0;
      const pick = new Set([...live.slice(-deepDays), ...live.slice(cur, cur + deepDays)]);
      for (const d of live.filter(x => pick.has(x))) {
        checked++;
        const b = await loadBatch(d);
        if (b.error) { problems.push(`day ${d.day}: ${b.error}`); continue; }
        let p = d.first_prev, bad = false;
        for (const e of b.events) { if (e.prev !== p || e.hash !== await eventHash(p, e)) { bad = true; break; } p = e.hash; }
        if (bad || p !== d.last_hash || b.events.length !== d.n) problems.push(`day ${d.day}: archived events do not rebuild the anchor`);
        else { const lv = await merkleLevels(b.events.map(e => e.hash)); if (lv[lv.length - 1][0] !== d.root) problems.push(`day ${d.day}: archived Merkle root differs`); }
      }
      await metaSet('deep_cursor', live.length ? (cur + deepDays) % live.length : 0);
    }
    const res = { ok: problems.length === 0, head: { seq: prevSeq, hash: prevHash }, days: days.length, hot_events: hot.length, deep_days_checked: checked, problems: problems.slice(0, 20), problem_count: problems.length, at: new Date(now()).toISOString() };
    await metaSet('verified', { at: res.at, ok: res.ok, head_seq: prevSeq, problems: problems.length });
    return res;
  }
  // Public: counts and the chain head only. No summaries, no actors beyond kind counts.
  async function summary() {
    const days = await all(`SELECT day, n, kinds, root, day_hash, pruned, bytes FROM audit_days ORDER BY day`), hot = await all(`SELECT kind, COUNT(*) AS n FROM audit_events GROUP BY kind`);
    const first = await one(`SELECT at FROM audit_events ORDER BY seq LIMIT 1`), h = await head(), v = await metaGet('verified');
    const byKind = {}; for (const d of days.slice(-30)) for (const [k, n] of Object.entries(JSON.parse(d.kinds))) byKind[k] = (byKind[k] || 0) + n; for (const r of hot) byKind[r.kind] = (byKind[r.kind] || 0) + r.n;
    return { tenant: cfg.tenant, head: h, events_total: h.seq, hot_events: hot.reduce((a, r) => a + r.n, 0), days_rolled: days.length, days_pruned: days.filter(d => d.pruned).length, archive_bytes: days.reduce((a, d) => a + d.bytes, 0),
      last_day_root: days.length ? { day: days[days.length - 1].day, root: days[days.length - 1].root, day_hash: days[days.length - 1].day_hash } : null, oldest_hot_at: first ? first.at : null,
      kinds_last_30_days: byKind, last_verified: v, retention: { hot_days: cfg.hotDays, archive_days: cfg.archiveDays, stores: bucket ? 'D1 hot, R2 batches' : 'D1 hot, D1 compressed batches' } };
  }
  // A Merkle path from one event to its day root and the day's anchor. Carries hashes only; the holder of the event text re-derives its hash.
  async function proof(seq) {
    const hot = await one(`SELECT * FROM audit_events WHERE seq=?`, seq);
    if (hot) return { seq, state: 'hot', hash: hot.hash, prev: hot.prev, note: 'not yet rolled into a day; the live chain covers it' };
    const d = await one(`SELECT * FROM audit_days WHERE first_seq<=? AND last_seq>=?`, seq, seq);
    if (!d) return { seq, state: 'unknown' };
    if (d.pruned) return { seq, state: 'pruned', day: d.day, root: d.root, note: 'batch retired after the retention window; the day anchor remains' };
    const b = await loadBatch(d); if (b.error) return { seq, state: 'unavailable', day: d.day, error: b.error };
    const i = b.events.findIndex(e => e.seq === seq), lv = await merkleLevels(b.events.map(e => e.hash));
    return { seq, state: 'rolled', day: d.day, hash: b.events[i].hash, index: i, path: merklePath(lv, i), root: d.root, prev_day: d.prev_day, last_hash: d.last_hash, n: d.n, day_hash: d.day_hash };
  }
  async function events({ since = 0, limit = 50 } = {}) { return all(`SELECT * FROM audit_events WHERE seq > ? ORDER BY seq LIMIT ?`, Number(since) || 0, Math.min(Number(limit) || 50, cfg.listMax)); }
  async function day(d) { const r = await one(`SELECT * FROM audit_days WHERE day=?`, d); return r ? loadBatch(r) : null; }

  // Reuses loop_beats rather than copying it: each finished hour of each loop becomes one digest event that points at the beat ids.
  async function digestLoopBeats() {
    let wm = (await metaGet('loop_beats_wm')) || 0, rows;
    try { rows = await all(`SELECT id, loop, started_at, ok FROM loop_beats WHERE id > ? ORDER BY id LIMIT 5000`, wm); } catch { return { digested: 0, note: 'no loop_beats table' }; }
    const thisHour = new Date(now()).toISOString().slice(0, 13), g = new Map(); let top = wm;
    for (const r of rows) { const hr = String(r.started_at).replace(' ', 'T').slice(0, 13); if (hr >= thisHour) break; const k = r.loop + '|' + hr, x = g.get(k) || { loop: r.loop, hr, runs: 0, ok: 0, bad: 0, lo: r.id, hi: r.id }; x.runs++; if (r.ok === 1) x.ok++; else if (r.ok === 0) x.bad++; x.hi = r.id; g.set(k, x); top = r.id; }
    let n = 0; for (const x of g.values()) { await append({ actor: 'audit', kind: 'loop_digest', subject: x.loop, summary: `${x.hr}h: ${x.runs} runs, ${x.ok} ok, ${x.bad} failed, ${x.runs - x.ok - x.bad} unfinished`, ref: `loop_beats:${x.lo}-${x.hi}`, payload: x }); n++; }
    if (top > wm) await metaSet('loop_beats_wm', top);
    return { digested: n };
  }
  // The tick step: digest finished loop hours, roll finished days, verify, and report. Never throws into the tick.
  const step = () => ({ name: 'audit', run: async (_db, ctx) => { try { const d = await digestLoopBeats(), r = await roll(), v = await verify({ deep: true }); ctx?.notes?.push(`audit: ${d.digested} digests, ${r.rolled.length} days rolled, chain ${v.ok ? 'intact' : 'BROKEN (' + v.problem_count + ')'}`);
    if (!v.ok) await append({ actor: 'audit', kind: 'incident', subject: 'chain', summary: 'verification found ' + v.problem_count + ' problem(s): ' + v.problems[0], payload: v.problems }); } catch (e) { ctx?.notes?.push('audit: ' + String(e && e.message || e).slice(0, 120)); } } });

  // Routes. Public: summary, verify, proof. authorize(request) -> boolean guards events, day batches and writes.
  async function handle(request, { authorize = () => false, prefix = '/audit' } = {}) {
    const u = new URL(request.url), p = u.pathname;
    if (!p.startsWith(prefix + '/') && p !== prefix) return null;
    const rest = p.slice(prefix.length), json = (o, s = 200) => Response.json(o, { status: s, headers: { 'cache-control': 'public, max-age=60' } });
    if (request.method === 'GET' && (rest === '' || rest === '/summary.json')) return json(await summary());
    if (request.method === 'GET' && rest === '/verify') return json(await verify({ deep: true }));
    if (request.method === 'GET' && rest === '/proof') return json(await proof(Number(u.searchParams.get('seq'))));
    if (!(await authorize(request))) return Response.json({ error: 'forbidden' }, { status: 403 });
    if (request.method === 'GET' && rest === '/events') return Response.json({ events: await events({ since: u.searchParams.get('since'), limit: u.searchParams.get('limit') }) });
    if (request.method === 'GET' && rest.startsWith('/day/')) { const b = await day(rest.slice(5)); return b ? Response.json(b) : Response.json({ error: 'no such day' }, { status: 404 }); }
    if (request.method === 'POST' && rest === '/event') { const b = await request.json().catch(() => null); if (!b) return Response.json({ error: 'bad_request' }, { status: 400 }); try { return Response.json(await append(b)); } catch (e) { return Response.json({ error: String(e.message) }, { status: 400 }); } }
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  return { append, appendMany, roll, verify, summary, proof, events, day, digestLoopBeats, step, handle, head, config: cfg };
}
