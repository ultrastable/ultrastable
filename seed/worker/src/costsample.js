// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// COSTGUARD-1: server-side sampler. Reads rows read in the last hour for each budgeted D1 database and records one cost_samples row per target.
// A missing token or a failed query is recorded as a sample with an error, so the failure-mode probe goes red and the loop files the fix.
const API = 'https://api.cloudflare.com/client/v4/graphql';

export async function sampleCosts(db, { token, budgets, fetch: f = fetch, now = new Date() }) {
  const out = [];
  const at = now.toISOString().replace('T', ' ').slice(0, 19);
  const from = new Date(now.getTime() - 3600e3).toISOString();
  for (const b of budgets || []) {
    let rows = null, error = null;
    if (!token) error = 'no Cloudflare analytics token bound (CF_ANALYTICS_TOKEN)';
    else try {
      const q = `{viewer{accounts(filter:{accountTag:"${b.account_id}"}){d1AnalyticsAdaptiveGroups(limit:100,filter:{datetime_geq:"${from}",datetime_leq:"${now.toISOString()}",databaseId:"${b.database_id}"}){sum{rowsRead}}}}}`;
      const r = await f(API, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) });
      const j = await r.json();
      if (!r.ok || (j.errors && j.errors.length)) error = `graphql ${r.status} ${JSON.stringify(j.errors || []).slice(0, 150)}`;
      else rows = ((j.data.viewer.accounts[0] || {}).d1AnalyticsAdaptiveGroups || []).reduce((s, g) => s + Number(g.sum.rowsRead || 0), 0);
    } catch (e) { error = String(e.message).slice(0, 150); }
    if (token) error = error && error.split(token).join('***');
    await db.prepare(`INSERT INTO cost_samples (at, target, rows_read_1h, error) VALUES (?,?,?,?)`).bind(at, b.id, rows, error).run();
    out.push({ target: b.id, rows_read_1h: rows, error });
  }
  return out;
}
