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
  stmts.push(db.prepare('DELETE FROM live_changes WHERE rowid NOT IN (SELECT rowid FROM live_changes ORDER BY merged_at DESC LIMIT 400)'));
  await db.batch(stmts);
  return { status: 'ok', merged_seen: prs.length };
}

export async function readLiveChanges(db) {
  const meta = await db.prepare('SELECT MAX(refreshed_at) AS at FROM live_changes_meta').first();
  const rows = (await db.prepare('SELECT n, title, by_origin, merged_at, url FROM live_changes ORDER BY merged_at DESC LIMIT 400').all()).results || [];
  return { refreshed_at: (meta && meta.at) || null, changes: rows.map(x => ({ n: x.n, title: x.title, by: x.by_origin, merged_at: x.merged_at, url: x.url })) };
}
