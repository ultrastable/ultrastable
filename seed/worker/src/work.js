// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// ROLE-WORK-1: the roles consume what the tick dispatches to them. Before this step, `dispatch` wrote rows with status 'queued' and nothing ever
// read them (286 queued, 0 consumed on 2026-11-14): the roles existed on paper only. Each run, every queued or waiting dispatch is worked by its
// role against the item's closing probe, and every non-terminal item whose probe can be evaluated here is closed when it passes (stale TICKFAIL
// and BREACH items included). Every transition writes an outcome row, so the trust ledger and the dashboard see real work, not declarations.
//
// Probe kinds evaluated here:  file:<path> (repo contents, through fileExists), metric:<id>, item_done:<id>, successor:<id>, and TICKFAIL-<step>-*
// items (closed when the newest finished tick completed that step). Anything else is 'waiting' for the executor, recorded once, re-checked each run.

const TERMINAL = new Set(['done', 'superseded', 'cancelled']);
export const MAX_PER_RUN = 60;

const iso = d => d.toISOString().replace('T', ' ').slice(0, 19);
const all = async (db, sql, ...a) => ((await db.prepare(sql).bind(...a).all()).results) || [];
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();

// Returns {state: 'pass'|'fail'|'unknown', evidence}. Pure over the db plus the injected fileExists(path) -> true|false|null.
export async function evaluate(db, item, { fileExists = async () => null, prState = async () => null, lastTick = null } = {}) {
  const tf = /^TICKFAIL-([a-z_]+)-/.exec(item.id || '');
  if (tf) {
    if (!lastTick) return { state: 'unknown', evidence: 'no finished tick yet' };
    const errs = String(lastTick.errors || '');
    const ok = lastTick.steps_completed === lastTick.steps_total || !errs.includes(tf[1] + ':');
    return ok ? { state: 'pass', evidence: `tick ${lastTick.id} completed step ${tf[1]}` } : { state: 'fail', evidence: `tick ${lastTick.id} still fails ${tf[1]}` };
  }
  const probe = String(item.closing_probe || '');
  const i = probe.indexOf(':');
  const kind = i > 0 ? probe.slice(0, i) : '', arg = i > 0 ? probe.slice(i + 1).trim() : '';
  if (kind === 'metric') {
    const m = await first(db, `SELECT breached, last_value, last_at FROM metrics WHERE id=?`, arg);
    if (!m || m.last_at == null) return { state: 'unknown', evidence: `metric ${arg} not read yet` };
    return m.breached ? { state: 'fail', evidence: `metric ${arg} = ${m.last_value} (breached)` } : { state: 'pass', evidence: `metric ${arg} = ${m.last_value} healthy at ${m.last_at}` };
  }
  if (kind === 'item_done') {
    const d = await first(db, `SELECT status FROM items WHERE id=?`, arg);
    return d && d.status === 'done' ? { state: 'pass', evidence: `item ${arg} done` } : { state: 'fail', evidence: `item ${arg} ${d ? d.status : 'missing'}` };
  }
  if (kind === 'file') {
    const r = await fileExists(arg);
    if (r === true) return { state: 'pass', evidence: `file ${arg} present on main` };
    if (r === false) return { state: 'fail', evidence: `file ${arg} absent on main` };
    return { state: 'unknown', evidence: `file ${arg}: repository not readable from the worker` };
  }
  if (kind === 'pr_merged') {  // CODE-AGENT-SOP-1: a handed-off pull request closes when the server sees it merged
    const m = /^([^#]+)#(\d+)$/.exec(arg);
    const st = m ? await prState(m[1], Number(m[2])) : null;
    if (st === 'merged') return { state: 'pass', evidence: `pull request ${arg} merged` };
    if (st === 'closed' || st === 'missing') return { state: 'cancel', evidence: `pull request ${arg} ${st} without merge` };
    return { state: 'unknown', evidence: st ? `pull request ${arg} ${st}; the server lane owns it` : `pull request ${arg} not readable from the worker` };
  }
  if (kind === 'successor') return { state: 'successor', evidence: arg };
  return { state: 'unknown', evidence: probe ? `probe ${probe} needs the executor` : 'no closing probe' };
}

async function closeItem(db, item, evidence, nowIso, agent) {
  await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`,
    ('fixed: ' + evidence).slice(0, 400), nowIso, item.id);
  await run(db, `DELETE FROM claims WHERE item_id=?`, item.id);
  await run(db, `INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES (?, ?, 'work_tracker', 'probe_close', 'verified', ?, ?)`,
    item.id, agent || 'role-work', evidence.slice(0, 400), nowIso);
}

// A successor item asks its role to name and file the next improvement. The role files it (owner = same role, kind plus, no successor probe so the
// chain cannot run away) and the original closes with the new item's id as evidence.
async function fileSuccessor(db, item, role, nowIso, namer) {
  const base = item.closing_probe.slice('successor:'.length).trim();
  const id = `PLUS-${base}`.slice(0, 120);
  if (!(await first(db, `SELECT id FROM items WHERE id=?`, id))) {
    const src = await first(db, `SELECT title, done_check FROM items WHERE id=?`, base);
    let title = `Plus after ${base}: measure what ${base} changed and ship the next improvement it unlocks`;
    if (namer) { try { const t = await namer(src ? src.title : base); if (t && t.length > 12) title = `PLUS-${base}: ${t}`.slice(0, 300); } catch (e) { console.error('successor namer', e && e.message); } }
    await run(db, `INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, created_at, updated_at) VALUES (?, ?, 'plus', ?, ?, NULL, 40, 'ready', ?, ?)`,
      id, title, role || item.owner_role, `the improvement named in ${id} is merged and its effect is measured`, nowIso, nowIso);
  }
  return `filed successor ${id}`;
}

async function cancelItem(db, id, evidence, nowIso, agent) {
  await run(db, `UPDATE items SET status='cancelled', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, ('superseded: ' + evidence).slice(0, 400), nowIso, id);
  await run(db, `DELETE FROM claims WHERE item_id=?`, id);
  await run(db, `INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES (?, ?, 'work_tracker', 'probe_close', 'cancelled', ?, ?)`, id, agent || 'role-work', evidence.slice(0, 400), nowIso);
}

// GitHub pull request state for pr_merged:<repo>#<n>: 'merged' | 'open' | 'closed' | 'missing', or null when unreadable (never guessed).
export function githubPrState({ token, fetchImpl = fetch }) {
  return async (repo, n) => {
    if (!token) return null;
    try {
      const r = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${n}`, { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-role-work' } });
      if (r.status === 404) return 'missing';
      if (!r.ok) return null;
      const j = await r.json();
      return j.merged_at ? 'merged' : j.state === 'open' ? 'open' : 'closed';
    } catch (e) { console.error('prState', repo, n, e && e.message); return null; }
  };
}

export async function runRoleWork(db, { now = Date.now(), fileExists, prState = async () => null, namer } = {}) {
  const nowIso = iso(new Date(now));
  const lastTick = await first(db, `SELECT id, steps_completed, steps_total, errors FROM tick_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1`);
  const out = { worked: 0, done: 0, waiting: 0, superseded: 0, released: 0, closed_unclaimed: 0, successors: 0 };

  // 1. Dispatches: each one is worked by the role it was handed to.
  const ds = await all(db, `SELECT d.id, d.role_id, d.item_id, d.status, i.id AS iid, i.status AS istatus, i.closing_probe, i.owner_role, i.title, c.agent
      FROM dispatches d LEFT JOIN items i ON i.id = d.item_id LEFT JOIN claims c ON c.item_id = d.item_id
      WHERE d.status IN ('queued','waiting') ORDER BY d.id LIMIT ?`, MAX_PER_RUN);
  for (const d of ds) {
    out.worked++;
    if (!d.iid || TERMINAL.has(d.istatus)) { await run(db, `UPDATE dispatches SET status='superseded' WHERE id=?`, d.id); out.superseded++; continue; }
    if (d.agent !== d.role_id) { await run(db, `UPDATE dispatches SET status='released' WHERE id=?`, d.id); out.released++; continue; }
    const role = (await first(db, `SELECT role FROM roles WHERE id=?`, d.role_id) || {}).role;
    const ev = await evaluate(db, { id: d.iid, closing_probe: d.closing_probe }, { fileExists, prState, lastTick });
    if (ev.state === 'cancel') {
      await cancelItem(db, d.iid, ev.evidence, nowIso, d.role_id);
      await run(db, `UPDATE dispatches SET status='superseded' WHERE id=?`, d.id); out.superseded++; continue;
    }
    if (ev.state === 'pass' || ev.state === 'successor') {
      const evidence = ev.state === 'pass' ? ev.evidence : await fileSuccessor(db, { id: d.iid, closing_probe: d.closing_probe, owner_role: d.owner_role }, role, nowIso, namer);
      if (ev.state === 'successor') out.successors++;
      await closeItem(db, { id: d.iid }, evidence, nowIso, d.role_id);
      await run(db, `UPDATE dispatches SET status='done' WHERE id=?`, d.id); out.done++;
    } else {
      if (d.status === 'queued') {
        await run(db, `INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES (?, ?, 'work_tracker', 'probe_close', 'needs_executor', ?, ?)`,
          d.iid, d.role_id, ev.evidence.slice(0, 400), nowIso);
        await run(db, `UPDATE dispatches SET status='waiting' WHERE id=?`, d.id);
      }
      await run(db, `UPDATE claims SET heartbeat_at=? WHERE item_id=? AND agent=?`, nowIso, d.iid, d.role_id);  // the role is working it: keep the claim alive
      out.waiting++;
    }
  }

  // 2. Unclaimed items whose probe passes close without waiting for a dispatch (stale TICKFAIL rows, items already satisfied).
  const open = await all(db, `SELECT id, closing_probe FROM items WHERE status IN ('open','ready','blocked')
      AND (id LIKE 'TICKFAIL-%' OR closing_probe LIKE 'metric:%' OR closing_probe LIKE 'item_done:%' OR closing_probe LIKE 'file:%' OR closing_probe LIKE 'pr_merged:%')
      AND id NOT IN (SELECT item_id FROM claims) ORDER BY priority LIMIT ?`, MAX_PER_RUN);
  for (const it of open) {
    const ev = await evaluate(db, it, { fileExists, prState, lastTick });
    if (ev.state === 'pass') { await closeItem(db, it, ev.evidence, nowIso, 'role-work'); out.closed_unclaimed++; }
    else if (ev.state === 'cancel') { await cancelItem(db, it.id, ev.evidence, nowIso, 'role-work'); out.closed_unclaimed++; }
  }
  return out;
}

// GitHub contents probe for file:<path>. null when there is no token or the API refuses, so 'unknown' is never reported as a pass or a fail.
export function githubFileExists({ token, repo, fetchImpl = fetch }) {
  const cache = new Map();
  return async path => {
    if (!token || !repo) return null;
    if (cache.has(path)) return cache.get(path);
    let v = null;
    try {
      const r = await fetchImpl(`https://api.github.com/repos/${repo}/contents/${String(path).split('/').map(encodeURIComponent).join('/')}?ref=main`,
        { method: 'GET', headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-role-work' } });
      v = r.status === 200 ? true : r.status === 404 ? false : null;
    } catch (e) { console.error('fileExists', path, e && e.message); }
    cache.set(path, v);
    return v;
  };
}

// Names a successor with the cheapest Workers AI adapter; the deterministic title is used when the binding is missing or the answer is unusable.
export function aiNamer(env, model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast') {
  if (!env || !env.AI) return null;
  return async title => {
    const r = await env.AI.run(model, { messages: [{ role: 'user', content: `A software platform just closed this work item: "${title}". In one sentence under 20 words, name the single most valuable next improvement it unlocks. Reply with the sentence only.` }], max_tokens: 60 });
    return String((r && (r.response || '')) || '').replace(/\s+/g, ' ').trim().replace(/^"|"$/g, '');
  };
}
