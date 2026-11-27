// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// LIVE-FRESH-2: the public freshness probe repairs itself. The tick reads the site's /api/freshness every pass; when the published snapshot is older than its cadence
// it dispatches the transparency workflow (at most once per `cooldownMs`), and the returned status goes red in the beat so the self-audit and /live say so.
// A probe that only fails a workflow nobody watches let /live freeze for three days (2026-11-15..18); this one acts.
export async function watchFreshness({ token, repo, siteUrl = 'https://ultrastable.io', workflow = 'transparency.yml', cooldownMs = 3 * 3600e3, ref = 'main', fetchImpl = fetch, now = Date.now } = {}) {
  let f;
  try { const r = await fetchImpl(siteUrl + '/api/freshness', { headers: { 'cache-control': 'no-cache' } }); f = await r.json(); }
  catch (e) { return { status: 'error', error: 'freshness unreadable: ' + String(e && e.message).slice(0, 120) }; }
  if (f && f.ok) return { status: 'fresh' };
  const stale = ['snapshot', 'changes', 'pages'].filter(k => f && f[k] && f[k].stale);
  const out = { status: 'stale', stale, snapshot_age_s: f && f.snapshot ? f.snapshot.age_s : null };
  if (!stale.includes('snapshot')) return out;  // the changes cache is refreshed by this tick itself, the pages by every deploy
  // US-29-R74: with no token, or a dispatch that was refused or not sent, the answer carries `error`, which pulse.js failed() reads as a red beat.
  const unrepaired = repair => ({ ...out, repair, error: `snapshot stale and not repaired: ${repair}` });
  if (!token || !repo) return unrepaired('no-token');
  const h = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-freshness', 'x-github-api-version': '2022-11-28' };
  const base = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}`;
  try {
    const r = await fetchImpl(`${base}/runs?per_page=1`, { headers: h });
    const last = r.status === 200 ? (((await r.json()) || {}).workflow_runs || [])[0] : null;
    if (last && now() - Date.parse(last.created_at) < cooldownMs) return { ...out, repair: 'cooldown' };
    const d = await fetchImpl(`${base}/dispatches`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ ref }) });
    return d.status === 204 ? { ...out, repair: 'dispatched' } : unrepaired('error HTTP ' + d.status);
  } catch (e) { return unrepaired('error ' + String(e && e.message).slice(0, 120)); }
}
