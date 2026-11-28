// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// TENANT-DEPLOY-1: a merge to a tenant repository ships within the hour, server-side. The daily tenant-repos run was the only route from a tenant's
// main to its live Worker, so a fix merged in ultrastable/what-works waited up to a day. Each pass (at most every `everyMin`) this step reads the
// tenant registry from the core repository, compares each moved tenant's latest main commit with the last successful deploy-ultrastable run, and
// dispatches deploy-ultrastable for the workers that moved. Bounded: one dispatch per `cooldownMs`, none while a deploy is queued or running.
export async function watchTenantDeploys({ token, repo, workflow = 'deploy-ultrastable.yml', registry = 'doctrine/tenant-repos.json', cooldownMs = 3600e3, fetchImpl = fetch, now = Date.now } = {}) {
  if (!token || !repo) return { status: 'no-token' };
  const h = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-tenant-deploy', 'x-github-api-version': '2022-11-28' };
  const gj = async (url) => { const r = await fetchImpl(url, { headers: h }); if (r.status !== 200) throw new Error(`HTTP ${r.status} ${url.replace('https://api.github.com/', '')}`); return r.json(); };
  try {
    const regFile = await gj(`https://api.github.com/repos/${repo}/contents/${registry}?ref=main`);
    const reg = JSON.parse(atob(String(regFile.content || '').replace(/\s/g, '')));
    const tenants = Object.entries(reg.tenants || {}).filter(([, t]) => (t.state === 'moved' || t.state === 'own-repo') && t.worker && t.repo).map(([slug, t]) => ({ slug, repo: t.repo, worker: t.worker }));
    if (!tenants.length) return { status: 'none' };
    const runs = ((await gj(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?per_page=20`)).workflow_runs) || [];
    if (runs.some(r => r.status === 'queued' || r.status === 'in_progress')) return { status: 'deploy-running' };
    const lastOk = runs.find(r => r.conclusion === 'success');
    const lastOkAt = lastOk ? Date.parse(lastOk.created_at) : 0;
    const behind = [];
    for (const t of tenants) {
      const c = await gj(`https://api.github.com/repos/${t.repo}/commits/main`);
      const at = Date.parse((c.commit && c.commit.committer && c.commit.committer.date) || 0);
      if (at > lastOkAt) behind.push(t.worker);
    }
    if (!behind.length) return { status: 'current', tenants: tenants.length };
    if (runs[0] && now() - Date.parse(runs[0].created_at) < cooldownMs) return { status: 'behind', behind, repair: 'cooldown' };
    const d = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { workers: behind.join(',') } }) });
    return { status: 'behind', behind, repair: d.status === 204 ? 'dispatched' : 'error HTTP ' + d.status };
  } catch (e) { return { status: 'error ' + String(e && e.message).slice(0, 160) }; }
}
