// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// LIVE-FRESH-1: the public changelog is read from merged pull requests refreshed by the tick (one GitHub call per pass), not from a daily snapshot.
const API = 'https://api.github.com';
const origin = p => String((p.body || '')).includes('Executor run') ? 'unattended executor' : /^(dependabot|ultrastable-)/.test(p.head && p.head.ref || '') ? 'bot' : /^(agent|claude)\//.test(p.head && p.head.ref || '') ? 'agent session' : 'other';

export async function refreshLiveChanges({ db, token, repo, fetch: f = fetch, now = Date.now() }) {
  if (!token || !repo) return { status: 'no-token' };
  const r = await f(`${API}/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`, { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-livechanges' } });
  if (!r.ok) return { status: 'error', http: r.status };
  const prs = (JSON.parse(await r.text()) || []).filter(p => p.merged_at);
  const stmts = prs.map(p => db.prepare('INSERT OR REPLACE INTO live_changes (n, repo, title, by_origin, merged_at, url) VALUES (?,?,?,?,?,?)').bind(p.number, repo, String(p.title).slice(0, 300), origin(p), p.merged_at, p.html_url));
  stmts.push(db.prepare('INSERT OR REPLACE INTO live_changes_meta (repo, refreshed_at) VALUES (?,?)').bind(repo, new Date(now).toISOString()));
  stmts.push(db.prepare('DELETE FROM live_changes WHERE repo = ? AND rowid NOT IN (SELECT rowid FROM live_changes WHERE repo = ? ORDER BY merged_at DESC LIMIT 400)').bind(repo, repo));  // PROGRESS-1: the cap is per repository, so one busy repository never evicts another's history
  await db.batch(stmts);
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

// repo: the one repository /live shows. Without it, every cached repository is returned (the first deploys cached only one).
export async function readLiveChanges(db, repo = null) {
  const meta = repo ? await db.prepare('SELECT MAX(refreshed_at) AS at FROM live_changes_meta WHERE repo = ?').bind(repo).first() : await db.prepare('SELECT MAX(refreshed_at) AS at FROM live_changes_meta').first();
  const q = repo ? db.prepare('SELECT n, title, by_origin, merged_at, url FROM live_changes WHERE repo = ? ORDER BY merged_at DESC LIMIT 400').bind(repo) : db.prepare('SELECT n, title, by_origin, merged_at, url FROM live_changes ORDER BY merged_at DESC LIMIT 400');
  const rows = (await q.all()).results || [];
  return { refreshed_at: (meta && meta.at) || null, changes: rows.map(x => ({ n: x.n, title: x.title, by: x.by_origin, merged_at: x.merged_at, url: x.url })) };
}
