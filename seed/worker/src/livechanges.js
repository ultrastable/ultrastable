// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// LIVE-FRESH-1: the public changelog is read from merged pull requests refreshed by the tick (one GitHub call per pass), not from a daily snapshot.
import { classifyPrFiles } from './vendor/core/substance.js';  // SUBSTANCE-1
const API = 'https://api.github.com';
const origin = p => /^Executor run \d{4}-\d{2}-\d{2}T/m.test(String(p.body || '')) ? 'unattended executor' : /^(dependabot|ultrastable-)/.test(p.head && p.head.ref || '') ? 'bot' : /^(agent|claude)\//.test(p.head && p.head.ref || '') ? 'agent session' : 'other';

export async function refreshLiveChanges({ db, token, repo, fetch: f = fetch, now = Date.now() }) {
  if (!token || !repo) return { status: 'no-token' };
  const r = await f(`${API}/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`, { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-livechanges' } });
  if (!r.ok) return { status: 'error', http: r.status };
  const prs = (JSON.parse(await r.text()) || []).filter(p => p.merged_at);
  // SUBSTANCE-1: an upsert, not INSERT OR REPLACE, so the substance verdict a later pass wrote is kept when the PR is seen again
  const stmts = prs.map(p => db.prepare('INSERT INTO live_changes (n, repo, title, by_origin, merged_at, url) VALUES (?,?,?,?,?,?) ON CONFLICT(repo, n) DO UPDATE SET title=excluded.title, by_origin=excluded.by_origin, merged_at=excluded.merged_at, url=excluded.url').bind(p.number, repo, String(p.title).slice(0, 300), origin(p), p.merged_at, p.html_url));
  stmts.push(db.prepare('INSERT OR REPLACE INTO live_changes_meta (repo, refreshed_at) VALUES (?,?)').bind(repo, new Date(now).toISOString()));
  stmts.push(db.prepare('DELETE FROM live_changes WHERE repo = ? AND merged_at < (SELECT merged_at FROM live_changes WHERE repo = ? ORDER BY merged_at DESC LIMIT 1 OFFSET 399)').bind(repo, repo));  // READ-BUDGET-9: one walk of the (repo, merged_at) index to the 400th row, then a range; rows that share the 400th row's instant are kept  // PROGRESS-1: the cap is per repository, so one busy repository never evicts another's history
  await db.batch(stmts);
  await writeSig(db, repo, prs, new Date(now).toISOString());
  return { status: 'ok', merged_seen: prs.length };
}

// PROGRESS-1: the other repositories of the fleet are read at most once per `everyMs` (default 55 min), one GitHub call each, so the every-tick
// budget stays one call. A repository whose read fails keeps its older rows and its older refreshed_at, which the cadence step reports.
export async function refreshFleetChanges({ db, token, repos = [], everyMs = 55 * 60e3, fetch: f = fetch, now = Date.now() }) {
  const out = {};
  for (const repo of repos) {
    const m = await db.prepare('SELECT refreshed_at FROM live_changes_meta WHERE repo = ?').bind(repo).first();
    if (m && m.refreshed_at && now - Date.parse(m.refreshed_at) < everyMs) { out[repo] = 'fresh'; continue; }
    try { const r = await refreshLiveChanges({ db, token, repo, fetch: f, now }); out[repo] = r.status === 'ok' ? r.merged_seen : r.status + (r.http ? ' ' + r.http : ''); }
    catch (e) { out[repo] = 'error ' + String(e && e.message).slice(0, 80); }
  }
  return out;
}

// SUBSTANCE-1 (Rowan, 2026-11-21): "the illusion of productivity ... must be stopped." Each merged PR is classified from its diff (one GitHub call
// per PR, at most `max` per pass, newest first) as substantive (executable behaviour changed), trivial (numbers, hashes, comments, imports) or record
// (ledgers, generated data, docs). /progress, the cadence monitor and its stall alarm count only substantive changes; an unclassified PR falls back
// to the title rule until a pass reaches it.
const substanceReady = new WeakSet();  // per database binding, so a fresh database (a test, a new tenant) gets its columns
export async function ensureSubstance(db) {
  if (substanceReady.has(db)) return;
  for (const c of ['substance TEXT', 'substance_files INTEGER']) {
    try { await db.prepare(`ALTER TABLE live_changes ADD COLUMN ${c}`).run(); }
    catch (e) { const m = String(e && e.message); if (/no such table/i.test(m)) return; if (!/duplicate column/i.test(m)) throw e; }  // no table yet: the next pass, after the migration, adds the columns
  }
  substanceReady.add(db);
}

export async function classifyPending({ db, token, max = 2, fetch: f = fetch }) {
  if (!token) return { status: 'no-token' };
  await ensureSubstance(db);
  const rows = (await db.prepare('SELECT n, repo FROM live_changes WHERE substance IS NULL ORDER BY merged_at DESC LIMIT ?').bind(max).all()).results || [];
  const out = {};
  for (const r of rows) {
    const res = await f(`${API}/repos/${r.repo}/pulls/${r.n}/files?per_page=100`, { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-substance' } });
    if (!res.ok) { out[`${r.repo}#${r.n}`] = 'HTTP ' + res.status; if (res.status === 404) await db.prepare('UPDATE live_changes SET substance = ? WHERE repo = ? AND n = ?').bind('unknown', r.repo, r.n).run(); continue; }
    const files = JSON.parse(await res.text()) || [];
    const c = classifyPrFiles(files);
    const v = files.length >= 100 && c.verdict !== 'substantive' ? 'unknown' : c.verdict;  // a truncated file list is never called trivial
    await db.prepare('UPDATE live_changes SET substance = ?, substance_files = ? WHERE repo = ? AND n = ?').bind(v, files.length, r.repo, r.n).run();
    out[`${r.repo}#${r.n}`] = v;
  }
  return { status: 'ok', classified: out };
}

// repo: the one repository /live shows. Without it, every cached repository is returned (the first deploys cached only one).
// READ-BUDGET-9: the site asks for this on every /live and /api/freshness request through its service binding (about 115 calls an hour, 705 rows
// each, measured), while the rows change only when a pass refreshes them or classifies a pending one. The answer is kept per isolate and served
// again while two cheap readings are unchanged: the refresh time (one row) and the count of rows still waiting for a verdict (the partial index
// live_changes_pending, so only pending rows are read). Either one moving reads the table again.
const liveCache = new WeakMap();  // db binding -> Map(repo -> { stamp, out })
// READ-BUDGET-11 (2026-11-27): the main repository is refreshed every tick, so the refresh time moved every 10 minutes and each move cost every
// isolate the 400 rows again (measured: 621 calls and 167,988 rows in 6 h, the second largest reader of a database over its rows-read budget),
// although the merged pull requests themselves change far less often. A refresh now also writes a signature of what GitHub returned, tied to
// its own refresh time; while the signature and the pending count are unchanged the answer is served from one org row, in any isolate. A
// signature that is missing, unreadable or from another refresh than the newest is not used, and the reading falls back to the refresh time.
const SIG = repo => `live_sig:${repo}`, OUT = repo => `live_out:${repo}`;
async function sigOf(prs) {
  const text = prs.map(p => [p.number, String(p.title).slice(0, 300), origin(p), p.merged_at, p.html_url].join('\u0001')).sort().join('\u0002');
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
const putOrg = (db, key, value) => db.prepare(`INSERT INTO org (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(key, value).run();
const getOrg = async (db, key) => { try { const r = await db.prepare(`SELECT value FROM org WHERE key = ?`).bind(key).first(); return r ? JSON.parse(r.value) : null; } catch { return null; } };
async function writeSig(db, repo, prs, at) {
  try { await putOrg(db, SIG(repo), JSON.stringify({ at, sig: await sigOf(prs) })); }
  catch (e) { /* allow-silent: without a signature the reading uses the refresh time, as it did before */ console.error('livechanges: signature not written:', e && e.message); }
}
export async function readLiveChanges(db, repo = null) {
  const meta = repo ? await db.prepare('SELECT MAX(refreshed_at) AS at FROM live_changes_meta WHERE repo = ?').bind(repo).first() : await db.prepare('SELECT MAX(refreshed_at) AS at FROM live_changes_meta').first();
  await ensureSubstance(db);
  const pending = await db.prepare('SELECT COUNT(*) AS n FROM live_changes WHERE substance IS NULL').first();
  const sig = repo && meta && meta.at ? await getOrg(db, SIG(repo)) : null, signed = Boolean(sig && sig.sig && sig.at === meta.at);
  const stamp = `${signed ? 's:' + sig.sig : (meta && meta.at) || ''}|${pending ? pending.n : ''}`, key = repo || '*';
  let byRepo = liveCache.get(db); if (!byRepo) { byRepo = new Map(); liveCache.set(db, byRepo); }
  const fresh = o => (o.refreshed_at === meta.at ? o : { ...o, refreshed_at: meta.at });
  const hit = byRepo.get(key);
  if (hit && hit.stamp === stamp && meta && meta.at) { const o = fresh(hit.out); byRepo.set(key, { stamp, out: o }); return o; }
  if (signed) { const kept = await getOrg(db, OUT(repo)); if (kept && kept.stamp === stamp && kept.out && Array.isArray(kept.out.changes)) { const o = fresh(kept.out); byRepo.set(key, { stamp, out: o }); return o; } }
  const q = repo ? db.prepare('SELECT n, title, by_origin, merged_at, url, substance FROM live_changes WHERE repo = ? ORDER BY merged_at DESC LIMIT 400').bind(repo) : db.prepare('SELECT n, title, by_origin, merged_at, url, substance FROM live_changes ORDER BY merged_at DESC LIMIT 400');
  const rows = (await q.all()).results || [];
  const out = { refreshed_at: (meta && meta.at) || null, changes: rows.map(x => ({ n: x.n, title: x.title, by: x.by_origin, merged_at: x.merged_at, url: x.url, substance: x.substance || null })) };
  byRepo.set(key, { stamp, out });
  if (signed) { try { await putOrg(db, OUT(repo), JSON.stringify({ stamp, out })); } catch (e) { /* allow-silent: the next reading reads the rows again */ console.error('livechanges: answer not kept:', e && e.message); } }
  return out;
}
