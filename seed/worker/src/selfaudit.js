// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// SELFAUDIT-1: the tick audits its own failure modes. Every mode in autonomy/failure-modes.json has a read-only SELECT probe (1 = healthy).
// Red: item FM-<id> is filed (owner role, closing probe selfaudit:<id>) or reopened. Green: the item closes WITH evidence. An item whose
// closing probe is selfaudit:<id> can never stay done while that probe is red: resolving is gated by the probe, not by a message.
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];

export async function probeMode(db, m) {
  if (!/^\s*select\b/i.test(m.probe) || m.probe.includes(';')) return { healthy: null, error: 'probe must be one SELECT' };
  try { const r = await first(db, m.probe); const v = r ? Number(Object.values(r)[0]) : NaN; return Number.isFinite(v) ? { healthy: v >= 1 ? 1 : 0, error: null } : { healthy: null, error: 'probe returned no number' }; }
  catch (e) { return { healthy: null, error: String(e.message).slice(0, 200) }; }
}

export async function selfAuditStep(db, ctx, register, ensureItem) {
  const red = [], green = [], reopened = [], closed = [];
  for (const m of (register && register.modes) || []) {
    const { healthy, error } = await probeMode(db, m);
    await run(db, `INSERT INTO failure_probe_runs (at, mode_id, healthy, error) VALUES (?,?,?,?)`, ctx.nowIso, m.id, healthy, error);
    const id = `FM-${m.id}`;
    if (healthy === 1) {
      green.push(m.id);
      const r = await run(db, `UPDATE items SET status='done', disposition='probe green: selfaudit:${m.id}', updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, ctx.nowIso, id);
      if (r.meta && r.meta.changes) {
        await run(db, `DELETE FROM claims WHERE item_id=?`, id);
        await run(db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'selfaudit', 'probe', 'verified', ?)`, id, `selfaudit:${m.id} green at ${ctx.nowIso}`);
        closed.push(id);
      }
      continue;
    }
    // red or unprobeable: an unprobeable mode is itself a finding
    red.push(m.id);
    const made = await ensureItem(db, {
      id, kind: 'fix', owner_role: m.owner_role, priority: -1,
      title: `Failure mode ${m.id} is ${healthy === 0 ? 'red' : 'unprobeable'}: ${m.failure} Root cause: ${m.root_cause} Remedy: ${m.remedy}`.slice(0, 400),
      done_check: `probe selfaudit:${m.id} returns green`, closing_probe: `selfaudit:${m.id}`,
    });
    if (!made) { // the gate: a closed item whose probe is red is reopened with a recorded outcome
      const r = await run(db, `UPDATE items SET status='ready', disposition=NULL, updated_at=? WHERE id=? AND status IN ('done','superseded','cancelled')`, ctx.nowIso, id);
      if (r.meta && r.meta.changes) {
        await run(db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'selfaudit', 'probe', 'failed', ?)`, id, `reopened: selfaudit:${m.id} still red at ${ctx.nowIso}`);
        reopened.push(id);
      }
    }
  }
  // Any other item that names a selfaudit probe may not stay closed while that probe is red.
  for (const it of await all(db, `SELECT id, closing_probe FROM items WHERE closing_probe LIKE 'selfaudit:%' AND status='done' AND id NOT LIKE 'FM-%'`)) {
    const mid = it.closing_probe.slice('selfaudit:'.length);
    if (red.includes(mid)) {
      await run(db, `UPDATE items SET status='ready', disposition=NULL, updated_at=? WHERE id=?`, ctx.nowIso, it.id);
      await run(db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'selfaudit', 'probe', 'failed', ?)`, it.id, `reopened: probe ${mid} red`);
      reopened.push(it.id);
    }
  }
  ctx.notes.push(`selfaudit: ${green.length} green, ${red.length} red${red.length ? ` (${red.join(',')})` : ''}${closed.length ? `, closed ${closed.length}` : ''}${reopened.length ? `, reopened ${reopened.length}` : ''}`);
  return { green, red, closed, reopened };
}

// Loop-breaker for dispatch: an item dispatched max times with no outcome is blocked and a LOOPBREAK item (a different approach) takes its place.
export async function loopBreak(db, ctx, max, ensureItem) {
  const rows = await all(db, `SELECT d.item_id AS id, COUNT(*) AS n FROM dispatches d JOIN items i ON i.id=d.item_id
      WHERE i.status IN ('ready','claimed','open') AND d.item_id NOT IN (SELECT item_id FROM outcomes WHERE item_id IS NOT NULL) GROUP BY d.item_id HAVING COUNT(*) >= ?`, max);
  for (const r of rows) {
    await run(db, `UPDATE items SET status='blocked', blocker=?, updated_at=? WHERE id=?`, `loop-breaker: dispatched ${r.n} times with no outcome`, ctx.nowIso, r.id);
    await run(db, `DELETE FROM claims WHERE item_id=?`, r.id);
    await run(db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'work_tracker', 'dispatch', 'failed', ?)`, r.id, `loop-breaker: ${r.n} dispatches, no outcome`);
    await ensureItem(db, { id: `LOOPBREAK-${r.id}`.slice(0, 80), kind: 'fix', owner_role: 'operations', priority: 0,
      title: `Dispatch of ${r.id} failed ${r.n} times with no outcome: change the approach (different doer, smaller item or missing capability), then unblock it.`,
      done_check: `item ${r.id} has an outcome`, closing_probe: `item_outcome:${r.id}` });
  }
  if (rows.length) ctx.notes.push(`loop-breaker blocked ${rows.length} item(s)`);
  return rows.map(r => r.id);
}

// Independent deploy evidence: rows of ops/deploys.jsonl are written by the post-deploy verifier (live code equals the commit), not by the loop that deployed.
export async function ingestDeploys(db, { token, repo, fetch: f = fetch }) {
  if (!token || !repo) return { status: 'no-token', ingested: 0 };
  const r = await f(`https://api.github.com/repos/${repo}/contents/ops/deploys.jsonl`, { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github.raw', 'user-agent': 'ultrastable-selfaudit' } });
  if (!r.ok) return { status: `http-${r.status}`, ingested: 0 };
  let n = 0;
  for (const line of (await r.text()).split('\n')) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (!d || !d.at || !d.worker || !d.sha) continue;
    const id = `deploy:${d.worker}:${d.sha.slice(0, 12)}`;
    if (await first(db, `SELECT 1 AS x FROM outcomes WHERE item_id=?`, id)) continue;
    const ok = d.uploaded && d.live_matches_commit;
    await run(db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence, at) VALUES (?, 'deploy', 'deploy', ?, ?, ?)`,
      id, ok ? 'verified' : 'failed', `probe:live_matches_commit=${Boolean(d.live_matches_commit)} sha=${d.sha.slice(0, 12)}`, String(d.at).replace('T', ' ').slice(0, 19));
    n++;
  }
  return { status: 'ok', ingested: n };
}
