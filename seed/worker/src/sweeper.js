// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// SERVER-OWNS-LOOPS-1: the tick Worker closes every loop a client session (code agent, chat, person) leaves open. A client only produces work; this sweeper owns closing it.
// For each open PR on a client branch: refresh a stale branch, merge when green, and once it is older than maxAgeH file one tracked item (Q-OPENLOOP-<repo>-<n>) with owner, trigger and probe.
// For each issue still labelled claimed/dispatched past maxAgeH: release the claim so the executor re-takes it. Returns open_loop_age_hours, the probe value (target 0).
import { notGreen } from './greenguard.js';
import { ghFetch, mergedAnyway } from './ghfetch.js';  // GH-RETRY-1
import { reconcile, makeGh, latency } from './mergenow.js';
import { prTier, portItemId } from './sla.js';  // SLA-1
const API = 'https://api.github.com';
// BRANCH-ROOT-CAUSE-1: `worker/` branches (the Worker executor's own PRs) were never swept, so they sat blocked; every automation prefix is swept.
const CLIENT_PREFIX = ['claude/', 'agent/', 'worker/', 'parked/', 'dependabot/'];  // PARKED-PR-1: the branch reaper parks as parked/<name> and the completion sweep opens a PR for it; without this prefix those PRs had no clock (23 overdue, fleet red every 10 min).  // DEP-LOOP-1: dependency updates merge on green like any client PR (GREEN-GUARD-1 applies)
export async function gh(f, token, method, path, body) {
  const r = await ghFetch(f, API + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-sweeper', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  // Not a throw: every caller reads ok/status and records a failure in out.errors (sweeper_runs.errors), so nothing is silent,
  // and a 410 (issues off) or 405 (merge refused) is an expected answer that must not abort the rest of the sweep.
  let json = null; try { json = t ? JSON.parse(t) : null; } catch { json = { raw: t.slice(0, 200) }; }
  return { ok: r.ok, status: r.status, json };
}
const hours = (iso, now) => Math.max(0, (now - Date.parse(iso)) / 36e5);

// GH-MIRROR-1: `laneOwned` repositories keep their work in docs/issues (the merge lane files OL-PR-<n> for a stuck PR) and mirror it onto GitHub Issues;
// the sweeper never files a second, unmirrored issue there.
// PR-LATENCY-1: a PR open longer than stallMin minutes is a stall (alarm), whatever its state.
export const PR_STALL_MIN = 15;
export const PR_LATENCY_DDL = ['ALTER TABLE sweeper_runs ADD COLUMN merge_p50_min REAL', 'ALTER TABLE sweeper_runs ADD COLUMN merge_p95_min REAL', 'ALTER TABLE sweeper_runs ADD COLUMN oldest_open_pr_min REAL', 'ALTER TABLE sweeper_runs ADD COLUMN stalled_prs INTEGER NOT NULL DEFAULT 0'];
export async function sweepOpenLoops({ token, repos = [], fetch: f = fetch, now = Date.now(), maxAgeH = 24, laneOwned = ['ultrastable/ultrastable'], stallMin = PR_STALL_MIN }) {
  const out = { status: 'ok', merged: [], refreshed: [], reconciled: [], filed: [], lane_owned: [], released: [], errors: [], open_loop_age_hours: 0, stalled: [], pr_latency: null };
  let reconciles = 0;
  if (!token) return { ...out, status: 'no-token' };
  for (const repo of repos) {
    try {
      const prs = await gh(f, token, 'GET', `/repos/${repo}/pulls?state=open&per_page=50`);
      if (!prs.ok) { out.errors.push(`${repo} pulls ${prs.status}`); continue; }
      for (const p of prs.json.filter(p => CLIENT_PREFIX.some(x => (p.head && p.head.ref || '').startsWith(x)))) {
        const tag = `${repo}#${p.number}`;
        let d = (await gh(f, token, 'GET', `/repos/${repo}/pulls/${p.number}`)).json || p;
        if (d.draft) { const r = await gh(f, token, 'POST', `/repos/${repo}/pulls/${p.number}/ready_for_review`); if (r.ok) d = (await gh(f, token, 'GET', `/repos/${repo}/pulls/${p.number}`)).json || d; }
        if (d.mergeable_state === 'behind') { const u = await gh(f, token, 'PUT', `/repos/${repo}/pulls/${p.number}/update-branch`); if (u.ok) out.refreshed.push(tag); }
        // MERGE-NOW-1: a conflict on generated files or claim values is reconciled here too (one per pass), not left for a person or the daily lane
        // STALL-ACT-1 (Rowan 2026-11-21, six-hour PRs): the one reconcile slot per pass was taken every pass by the same failing PR (#1746: code-conflict / ref 422),
        // so every other dirty PR starved for hours. Now each dirty PR gets its own try (up to 4 per pass); one that cannot be reconciled and is a bot-made
        // `agent/*` branch is closed as superseded after the stall limit (the executor refiles its item from current main) instead of only being reported.
        if (d.mergeable_state === 'dirty' && reconciles < 4) {
          reconciles++; const r = await reconcile(makeGh(f, token, 20), repo, d);
          if (r.result === 'resolved') out.reconciled.push(tag);
          else {
            out.errors.push(`${tag} ${r.result}${r.why ? ' ' + r.why : ''}`);
            if ((d.head && d.head.ref || '').startsWith('agent/') && hours(p.created_at || p.updated_at, now) * 60 > stallMin) {
              await gh(f, token, 'POST', `/repos/${repo}/issues/${p.number}/comments`, { body: 'STALL-ACT-1: conflicts with main that the server cannot reconcile after the stall limit. Superseded: the executor refiles the item from current main.' });
              const c = await gh(f, token, 'PATCH', `/repos/${repo}/pulls/${p.number}`, { state: 'closed' });
              if (c.ok) (out.superseded ||= []).push(tag);
            }
          }
        }
        if (hours(p.created_at || p.updated_at, now) * 60 > stallMin) out.stalled.push({ tag, repo, number: p.number, state: d.mergeable_state, minutes: Math.round(hours(p.created_at || p.updated_at, now) * 60) });
        // BRANCH-ROOT-CAUSE-1: a PR opened with the built-in token never fires `pull_request`, so the required `checks` never reports and the PR sits BLOCKED forever.
        // Close and reopen it once (the `reopened` trigger runs checks) when its head has no check run at all; never when a run exists, so a real failure is not looped.
        if (['blocked', 'unknown'].includes(d.mergeable_state) && d.head && d.head.sha && hours(p.updated_at || p.created_at, now) > 0.1) {
          const cr = await gh(f, token, 'GET', `/repos/${repo}/commits/${d.head.sha}/check-runs?per_page=1`);
          if (cr.ok && cr.json && cr.json.total_count === 0) {
            const c1 = await gh(f, token, 'PATCH', `/repos/${repo}/pulls/${p.number}`, { state: 'closed' });
            const c2 = c1.ok ? await gh(f, token, 'PATCH', `/repos/${repo}/pulls/${p.number}`, { state: 'open' }) : c1;
            (c2.ok ? (out.retriggered ||= []) : out.errors).push(c2.ok ? tag : `${tag} retrigger ${c2.status}`);
          }
        }
        // SLA-1: the written ladder (doctrine/sla.json). Past hard_min and idle, a PR that is not merge-ready is superseded whatever its branch prefix (STALL-ACT-1 covered agent/ only,
        // so claude/ PRs that conflicted or failed sat for hours). The branch is kept and one PORT-BRANCH item carries it onto main: nothing is lost.
        if (!(out.retriggered || []).includes(tag) && !(out.superseded || []).includes(tag) && prTier({ ageMin: hours(p.created_at || p.updated_at, now) * 60, idleMin: hours(p.updated_at || p.created_at, now) * 60, state: d.mergeable_state, branch: d.head && d.head.ref }) === 'supersede') {
          await gh(f, token, 'POST', `/repos/${repo}/issues/${p.number}/comments`, { body: 'SLA-1: open past the written limit (doctrine/sla.json) and not merge-ready. Superseded: the branch is kept and queue item ' + portItemId(d.head.ref) + ' carries it onto current main.' });
          const c = await gh(f, token, 'PATCH', `/repos/${repo}/pulls/${p.number}`, { state: 'closed' });
          if (c.ok) { (out.superseded ||= []).push(tag); (out.sla_ported ||= []).push({ repo, number: p.number, branch: d.head.ref }); continue; }
        }
        const hold = d.mergeable_state === 'clean' ? await notGreen(f, token, repo, d.head && d.head.sha, (ff, t, m, path) => gh(ff, t, m, path)) : null;  // GREEN-GUARD-1
        if (hold) out.held = [...(out.held || []), `${tag} ${hold}`];
        if (d.mergeable_state === 'clean' && !hold) {
          const m = await gh(f, token, 'PUT', `/repos/${repo}/pulls/${p.number}/merge`, { merge_method: 'squash' });
          if (!m.ok && await mergedAnyway((mm, pp) => gh(f, token, mm, pp), repo, p.number, m.status)) m.ok = true;  // GH-RETRY-1
          if (m.ok) { out.merged.push(tag); continue; }
        }
        const age = hours(p.updated_at || p.created_at, now);
        out.open_loop_age_hours = Math.max(out.open_loop_age_hours, Math.round(age * 10) / 10);
        if (age < maxAgeH) continue;
        if (laneOwned.includes(repo)) { out.lane_owned.push(tag); continue; }
        const title = `Q-OPENLOOP-${repo.replace('/', '-')}-${p.number}: close the open client loop on #${p.number}`;
        const have = await gh(f, token, 'GET', `/repos/${repo}/issues?state=open&labels=open-loop&per_page=100`);
        // Issues can be off on a repository (items are then docs/issues files): GitHub answers 410 with an object, not a list. That loop is not an
        // error and must not abort the sweep: the merge lane files its tracked item (OL-PR-<n>, `foundation loopowner --adopt`) on the same pass.
        if (have.status === 410 || have.status === 404) { out.lane_owned.push(tag); continue; }
        if ((Array.isArray(have.json) ? have.json : []).some(i => i.title.startsWith(`Q-OPENLOOP-${repo.replace('/', '-')}-${p.number}:`))) continue;
        const body = `Owner: ultrastable-tick sweeper. Trigger: every tick. State: ${d.mergeable_state}, idle ${age.toFixed(0)} h.\nDone: PR #${p.number} merged or superseded with evidence. Closing probe: open_loop_age_hours for this PR is 0.\nSERVER-OWNS-LOOPS-1: the server closes this loop, never a client session.`;
        const c = await gh(f, token, 'POST', `/repos/${repo}/issues`, { title, body, labels: ['open-loop'] });
        if (c.status === 410 || c.status === 404) { out.lane_owned.push(tag); continue; }
        (c.ok ? out.filed : out.errors).push(c.ok ? tag : `${tag} file ${c.status}`);
      }
      if (laneOwned.includes(repo) && !out.pr_latency) {  // PR-LATENCY-1: one call; the open list is already in hand
        const cl = await gh(f, token, 'GET', `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`);
        if (cl.ok && Array.isArray(cl.json)) out.pr_latency = { repo, ...latency(cl.json, prs.json, now) };
      }
      const iss = await gh(f, token, 'GET', `/repos/${repo}/issues?state=open&labels=claimed&per_page=50`);
      for (const i of iss.ok && Array.isArray(iss.json) ? iss.json : []) {
        if (i.pull_request || hours(i.updated_at, now) < maxAgeH) continue;
        const r = await gh(f, token, 'DELETE', `/repos/${repo}/issues/${i.number}/labels/claimed`);
        if (r.ok || r.status === 404) out.released.push(`${repo}#${i.number}`);
      }
    } catch (e) { out.errors.push(`${repo} ${e.message}`); }
  }
  if (out.errors.length) out.status = 'errors';
  return out;
}

// Persist one pass (D1) so the live probe can prove the sweeper ran: /live exposes the newest row.
export async function recordSweep(db, out, at = new Date().toISOString().replace('T', ' ').slice(0, 19)) {
  const L = out.pr_latency || {};
  const ins = () => db.prepare(`INSERT INTO sweeper_runs (at, status, merged, filed, released, errors, open_loop_age_hours, merge_p50_min, merge_p95_min, oldest_open_pr_min, stalled_prs) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(at, out.status, out.merged.length, out.filed.length, out.released.length, out.errors.join('; ').slice(0, 500), out.open_loop_age_hours, L.merge_p50_min ?? null, L.merge_p95_min ?? null, L.oldest_open_pr_min ?? null, (out.stalled || []).length).run();
  // SCHEMA-SELF-1: the Worker carries its own DDL (= migrations/0029_pr_latency.sql), so a deploy that did not run the migration still records
  try { await ins(); } catch (e) {
    if (!/no column|no such column/i.test(String(e && e.message))) throw e;
    for (const c of PR_LATENCY_DDL) await db.prepare(c).run().catch(x => { if (!/duplicate column/i.test(String(x && x.message))) throw x; });
    await ins();
  }
  await db.prepare(`DELETE FROM sweeper_runs WHERE id NOT IN (SELECT id FROM sweeper_runs ORDER BY id DESC LIMIT 500)`).run();
}
export async function lastSweep(db) { return (await db.prepare(`SELECT at, status, merged, filed, released, errors, open_loop_age_hours, merge_p50_min, merge_p95_min, oldest_open_pr_min, stalled_prs FROM sweeper_runs ORDER BY id DESC LIMIT 1`).first()) || null; }

// PR-LATENCY-1 stall alarm: each stalled PR is one queue item (owner sweeper, probe: the PR is merged or closed) and the merge pass is re-run now.
export async function alarmStalls(db, out, ensureItem) {
  const filed = [];
  for (const s of (out.stalled || []).slice(0, 3)) {
    const id = `Q-PR-STALL-${s.repo.replace('/', '-')}-${s.number}`;
    if (await ensureItem(db, { id, title: `PR ${s.tag} open ${s.minutes} min (${s.state}): merge, reconcile or supersede it`, kind: 'fix', owner_role: 'operations', done_check: `${s.tag} is merged or closed with a superseding PR`, closing_probe: `GET /repos/${s.repo}/pulls/${s.number} state != open`, priority: 1 })) filed.push(id);
  }
  for (const s of (out.sla_ported || []).slice(0, 5)) {  // SLA-1: the superseded PR's branch is carried by one PORT-BRANCH item
    const id = portItemId(s.branch);
    if (await ensureItem(db, { id, title: `carry ${s.branch} onto main (PR #${s.number} superseded by the SLA)`, kind: 'fix', owner_role: 'operations', done_check: `main holds the work of ${s.branch}`, closing_probe: `python3 -m foundation branchsweep --carried ${s.branch}`, priority: 1 })) filed.push(id);
  }
  return filed;
}
