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

// Q-LESSON-COST-SAMPLE-ACT: a sample is only worth taking if a breach acts. over_budget reads the latest sample per budget taken in the last
// hour and reports each one whose rows_read_1h exceeds max_rows_read_per_hour; the tick skips its non-essential steps while it is breached
// (tick.js COST_ESSENTIAL_STEPS) and the criticality step treats it as a breached spend cap. The sampler runs hourly, so one breached sample
// holds the tick lean for the following hour and a sample back under the cap releases it. A failed sample (rows NULL) is not a breach.
export async function over_budget(db, budgets, now = Date.now()) {
  const since = new Date(now - 3600e3).toISOString().replace('T', ' ').slice(0, 19);
  const breaches = [];
  for (const b of budgets || []) {
    const max = Number(b.max_rows_read_per_hour);
    if (!b.id || !Number.isFinite(max) || max <= 0) continue;
    const s = await db.prepare(`SELECT at, rows_read_1h FROM cost_samples WHERE target = ? AND at >= ? AND rows_read_1h IS NOT NULL ORDER BY at DESC, id DESC LIMIT 1`)
      .bind(b.id, since).first();
    if (s && Number(s.rows_read_1h) > max) breaches.push({ target: b.id, rows_read_1h: Number(s.rows_read_1h), max_rows_read_per_hour: max, at: s.at, gates_tick: b.gates_tick !== false });
  }
  // OPS-QUEUE-1: only a breach of a database the tick itself reads may hold the tick lean. A budget with gates_tick:false (the analytics DB
  // ultrastable-ops, which no tick step reads) is advisory: it stays in `breaches` and `advisory`, but dispatch and execute keep running.
  // Before this, a 5% overage on the analytics DB froze the work queue for the hour, claims were released unworked and issues sat open.
  const gating = breaches.filter(x => x.gates_tick);
  return { over: gating.length > 0, breaches: gating, advisory: breaches.filter(x => !x.gates_tick) };
}
