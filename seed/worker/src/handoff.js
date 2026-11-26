// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// HANDOFF-1 (owner 2026-11-14): "This is a server-side platform, not a local platform. Code agents do not own this. This is owned by Ultrastable completely."
// A code agent (any vendor) ends its work at an open PR that carries the label `handoff` or a `## Handoff` block. From then on this module, run by the
// tick Worker every 10 minutes, owns the loop: it records the handoff, notices the merge (the lane and sweeper gate, refresh and merge), deploys the
// named workers from the merge commit, runs the PR's live probe, and then closes the backlog item or rolls the deploy back and reopens it.
// Every state change is a row in D1 `handoff_events` and one comment on the PR, so the record lives server-side, not in a chat.
const API = 'https://api.github.com';
const MAX_ATTEMPTS = 3;
const CAPACITY = /Too many subrequests|subrequest budget/i;  // HANDOFF-SUBREQ-3: the platform's limit and the worker's own meter (subreq.js) are both this tick's capacity, never the change
const VERIFY_TRIES = 3;  // VERIFY-RETRY-1: a fresh deploy takes a moment to reach the edge; one early 404 must not roll production back

// One GitHub wrapper for the tick (lane.js), counted against the tick's shared budget (GITHUB-BUDGET-1). `ghb` is bound per run with that budget.
import { gh as laneGh, githubBudget } from './lane.js';
let ghb = null;
const gh = (f, token, method, path, body) => laneGh(f, token, method, path, body, ghb, 'ultrastable-handoff');

// DEPLOY-VERSION-1 (Q-LESSON-DEPLOY-VERSION): the fleet this org was split from had 36 failure modes from deploy drift (merges never deployed,
// exact-string version probes). A deploy is verified by the version the worker reports after it, with min_version semantics, never string equality:
// a dotted version (1.4.0) passes when reported >= min_version; an opaque id (a Cloudflare deployment id) passes when it differs from the one live
// before the deploy, which proves the code really changed. No reported version fails: an unprovable deploy is not a deploy.
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.+-]/).map(Number), pb = String(b).replace(/^v/, '').split(/[.+-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y ? 1 : -1; }
  return 0;
}
const DOTTED = /^v?\d+(\.\d+)+$/;
export function meetsVersion({ reported, before = null, min_version = null }) {
  if (!reported) return { ok: false, detail: 'the worker reports no version after the deploy' };
  if (min_version && DOTTED.test(String(min_version)) && DOTTED.test(String(reported)))
    return compareVersions(reported, min_version) >= 0 ? { ok: true, detail: `version ${reported} >= min_version ${min_version}` } : { ok: false, detail: `version ${reported} < min_version ${min_version}` };
  if (before && String(reported) === String(before)) return { ok: false, detail: `deployment still ${reported}: the code did not change` };
  return { ok: true, detail: `deployment ${String(before || 'none').slice(0, 12)} -> ${String(reported).slice(0, 12)}` };
}

// "## Handoff" block: `key: value` lines until the next heading. Keys: item, agent, verify, deploy.
export function parseHandoff(body) {
  const m = /^##\s*Handoff\s*$([\s\S]*?)(?=^##\s)/im.exec(String(body || '') + '\n## ');
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^\s*[-*]?\s*`?(item|agent|verify|deploy)`?\s*:\s*(.+?)\s*$/i.exec(line.replace(/^```.*$/, ''));
    if (kv) out[kv[1].toLowerCase()] = kv[2].replace(/^`|`$/g, '');
  }
  return out;
}

// verify syntax: "GET <url>" [expect "<text>"] | [status <code>]. Default: HTTP 200.
export function parseVerify(spec) {
  const m = /^\s*(GET|HEAD)\s+(https:\/\/\S+)(.*)$/i.exec(String(spec || ''));
  if (!m) return null;
  const rest = m[3] || '', ex = /expect\s+"([^"]+)"|expect\s+(\S+)/i.exec(rest), st = /status\s+(\d{3})/i.exec(rest);
  return { method: m[1].toUpperCase(), url: m[2], expect: ex ? (ex[1] || ex[2]) : null, status: st ? Number(st[1]) : 200 };
}

export async function runProbe(spec, f = fetch) {
  const v = parseVerify(spec);
  if (!v) return { ok: false, detail: 'no runnable verify line (expected: GET https://... [expect "text"] [status 200])' };
  try {
    const sep = v.url.includes('?') ? '&' : '?';
    const r = await f(v.url + sep + 'handoff_probe=' + Date.now(), { method: v.method, headers: { 'cache-control': 'no-cache', 'user-agent': 'ultrastable-handoff-probe' } });
    const body = v.method === 'HEAD' ? '' : await r.text();
    if (r.status !== v.status) return { ok: false, detail: `${v.method} ${v.url} -> ${r.status}, want ${v.status}` };
    if (v.expect && !body.includes(v.expect)) return { ok: false, detail: `${v.method} ${v.url} -> ${r.status}, body lacks "${v.expect}"` };
    return { ok: true, detail: `${v.method} ${v.url} -> ${r.status}${v.expect ? `, contains "${v.expect}"` : ''}` };
  } catch (e) { return { ok: false, detail: `${v.method} ${v.url} failed: ${e && e.message}` }; }
}

import { record } from './auditchain.js';
import { envelope } from './cloudevents.js';
export const handoffEvent = (id, state, detail, tenant = handoffTenant) => envelope({ area: 'handoff', event: state, source: '/tenants/' + (tenant || 'ultrastable') + '/loops/handoff', subject: String(id), data: { state, detail: detail ? String(detail).slice(0, 300) : null } });
import { tenantOf } from './tenant.js';  // Q-TENANT-row-isolation: a handoff block can name any item id; only this runtime's own items (tenant_id NULL or its slug) are advanced or closed
let handoffTenant = '';
async function event(db, id, state, detail) {
  await db.prepare("UPDATE handoffs SET state = ?, detail = ?, updated_at = datetime('now') WHERE id = ?").bind(state, detail || null, id).run();
  await db.prepare('INSERT INTO handoff_events (handoff_id, state, detail) VALUES (?, ?, ?)').bind(id, state, detail || null).run();
  // AUDIT-CHAIN-1: every merge, deploy, probe and rollback also lands in the tamper-evident trail (a failure here is logged, never hidden)
  // STANDARDS-FIRST-1: the event between loops is a CloudEvents 1.0 envelope (io.ultrastable.handoff.<state>); rows written before it hold { state } and stay readable (unwrap)
  await record(db, { kind: 'handoff:' + state, actor: 'handoff', ref: String(id), summary: String(detail || state).slice(0, 300), data: handoffEvent(id, state, detail) }).catch(e => console.error('audit record', e && e.message));
}
async function say(f, token, repo, pr, text) { await gh(f, token, 'POST', `/repos/${repo}/issues/${pr}/comments`, { body: 'Ultrastable (server side, HANDOFF-1): ' + text }); }
async function setItem(db, item, status, blocker) {
  if (!item) return;
  const r = await db.prepare("UPDATE items SET status = ?, blocker = ?, updated_at = datetime('now') WHERE id = ? AND (tenant_id IS NULL OR tenant_id = ?)").bind(status, blocker || null, item, handoffTenant).run();
  if (status === 'done' && r && r.meta && r.meta.changes) await db.prepare('DELETE FROM claims WHERE item_id = ?').bind(item).run();  // only when the item was this runtime's own
}

// Upsert a handoff (also used by POST /api/v1/handoff on the site worker through the shared D1).
export async function registerHandoff(db, h) {
  const id = `${h.repo}#${h.pr}`;
  await db.prepare(`INSERT INTO handoffs (id, repo, pr, title, item, agent, verify, deploy, head_sha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, item = coalesce(excluded.item, handoffs.item), agent = coalesce(excluded.agent, handoffs.agent),
      verify = coalesce(excluded.verify, handoffs.verify), deploy = coalesce(excluded.deploy, handoffs.deploy), head_sha = excluded.head_sha, updated_at = datetime('now')`)
    .bind(id, h.repo, h.pr, h.title || null, h.item || null, h.agent || null, h.verify || null, h.deploy || null, h.head_sha || null).run();
  return id;
}

// deployer(workerId, sha, repo) -> { ok, version?, detail }; rollback(workerId) -> { ok, detail }. Injected so the tick can route it through the site worker.
// versionOf(workerId) -> { ok, version } reads the live version (DEPLOY-VERSION-1); without it the version check is recorded as skipped.
// budget: the tick's shared GitHub budget (GITHUB-BUDGET-1); the run stops advancing once it is spent or rate limited.
export async function runHandoffs({ db, token, repos = [], fetch: f = fetch, deployer = null, rollback = null, versionOf = null, probe = runProbe, maxPerTick = 5, now = Date.now(), budget = githubBudget(), tenant = '' }) {
  const out = { status: 'ok', registered: [], merged: [], deployed: [], verified: [], failed: [], rolled_back: [], retried: [], recovered: [], deferred: [], errors: [] };
  if (!token) return { ...out, status: 'no-token' };
  if (!db) return { ...out, status: 'no-db' };
  ghb = budget; handoffTenant = tenantOf(tenant); let worked = 0; const seen = new Set();  // a handoff is advanced once per run
  try { return await advance(); } finally { ghb = null; out.github = budget.report(); if (budget.stopped && out.status === 'ok') out.status = 'stopped'; }
  async function advance() {
  // the existing rollback path: roll every target back, record it, return the item to ready
  const rollBack = async (h, why, what = 'live probe') => {
    await event(db, h.id, 'verify_failed', what === 'live probe' ? why : what + ': ' + why); out.failed.push(h.id);
    const targets = String(h.deploy || '').split(',').map(s => s.trim()).filter(Boolean), rb = [];
    if (rollback) for (const w of targets) rb.push(`${w}: ${(await rollback(w)).detail}`);
    await event(db, h.id, 'rolled_back', rb.join('; ') || 'nothing deployed to roll back'); out.rolled_back.push(h.id);
    await setItem(db, h.item, 'ready', null);
    await say(f, token, h.repo, h.pr, 'the ' + what + ' failed (' + why + '). ' + (rb.length ? 'Rolled back: ' + rb.join('; ') + '. ' : '') + (h.item ? 'Item `' + h.item + '` is back to ready for the executor.' : ''));
  };
  // 0. HANDOFF-SUBREQ-2: merged work waiting for its deploy goes before discovery, which costs two GitHub calls a repository and left a deploy with no subrequests (01:01 UTC 2026-11-18).
  // A handoff blocked only by that limit is returned to the deploy queue, or closed on its live probe when a later handoff already deployed every worker it names.
  await unblockCapacity();
  const heads = {};
  await advanceRows("'merged','deployed','deploy_failed'");
  if (out.deferred.length) return out;
  // 1. discover: open PRs that declare a handoff, and ones merged in the last day before a tick saw them open (a fast merge must not escape the loop)
  for (const repo of repos) {
    if (budget.stopped) break;
    const prs = await gh(f, token, 'GET', `/repos/${repo}/pulls?state=open&per_page=50`);
    if (!prs.ok) { out.errors.push(`${repo} pulls ${prs.status}`); continue; }
    const closed = await gh(f, token, 'GET', `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`);
    const recent = (closed.ok && Array.isArray(closed.json) ? closed.json : []).filter(p => p.merged_at && now - Date.parse(p.merged_at) < 864e5);
    for (const p of [...prs.json, ...recent]) {
      const block = parseHandoff(p.body), labelled = (p.labels || []).some(l => l.name === 'handoff');
      if (!block && !labelled) continue;
      const id = `${repo}#${p.number}`, known = await db.prepare('SELECT state FROM handoffs WHERE id = ?').bind(id).first();
      if (known && p.merged_at) continue;
      await registerHandoff(db, { repo, pr: p.number, title: p.title, head_sha: p.head && p.head.sha, ...(block || {}) });
      if (!known) { await event(db, id, 'open', 'registered from PR'); out.registered.push(id); await say(f, token, repo, p.number, 'handoff received. From here the server gates, merges, deploys' + (block && block.deploy ? ' `' + block.deploy + '`' : '') + ', probes' + (block && block.verify ? ' `' + block.verify + '`' : '') + ' and closes' + (block && block.item ? ' `' + block.item + '`' : '') + '. The agent that opened this PR is done.'); }
    }
  }
  // 2. advance every handoff the server owns
  await advanceRows("'open','conflict','merged','deployed','deploy_failed'");
  async function advanceRows(states) {
  const rows = (await db.prepare(`SELECT * FROM handoffs WHERE state IN (${states}) ORDER BY updated_at LIMIT ?`).bind(maxPerTick * 4).all()).results || [];
  for (const h of rows) {
    if (worked >= maxPerTick || budget.stopped) break;
    if (seen.has(h.id)) continue; seen.add(h.id);
    try {
      if (h.state === 'open' || h.state === 'conflict') {
        const d = await gh(f, token, 'GET', `/repos/${h.repo}/pulls/${h.pr}`);
        if (!d.ok) { out.errors.push(`${h.id} ${d.status}`); continue; }
        if (d.json.merged) { await db.prepare('UPDATE handoffs SET merge_sha = ? WHERE id = ?').bind(d.json.merge_commit_sha, h.id).run(); await event(db, h.id, 'merged', 'merged as ' + String(d.json.merge_commit_sha).slice(0, 7)); out.merged.push(h.id); h.state = 'merged'; h.merge_sha = d.json.merge_commit_sha; }
        else if (d.json.state === 'closed') { await event(db, h.id, 'closed_unmerged', 'PR closed without merge'); continue; }
        else if (d.json.mergeable_state === 'dirty' && h.state !== 'conflict') { await event(db, h.id, 'conflict', 'conflicts with the base branch; the sweeper files the open-loop item and the executor re-does the change'); await say(f, token, h.repo, h.pr, 'this PR conflicts with the base branch. The server owns it: the sweeper files the open-loop item and the executor rebuilds the change; no agent needs to come back.'); continue; }
        else continue;
      }
      if (h.state === 'merged' || h.state === 'deploy_failed') {
        worked++;
        const targets = String(h.deploy || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!targets.length) { await event(db, h.id, 'deployed', 'nothing to deploy'); h.state = 'deployed'; }
        else if (!deployer) { await event(db, h.id, 'deploy_failed', 'no deployer bound on this tick (site service binding or INTERNAL_DEPLOY_KEY missing)'); out.failed.push(h.id); continue; }
        else {
          // Deploy the base branch head, not the merge commit: an older merge must never roll production back past a newer one. The change is in it.
          if (!heads[h.repo]) { const r = await gh(f, token, 'GET', `/repos/${h.repo}`), b = r.ok ? r.json.default_branch : 'main', c = await gh(f, token, 'GET', `/repos/${h.repo}/commits/${b}`); heads[h.repo] = c.ok && c.json.sha ? c.json.sha : h.merge_sha; }
          if (budget.stopped) break;  // GITHUB-BUDGET-1: never deploy from a fallback sha because the head lookup was refused
          const at = heads[h.repo], res = [], before = {};
          for (const w of targets) { if (versionOf) before[w] = ((await versionOf(w)) || {}).version || null; res.push({ w, ...(await deployer(w, at, h.repo)) }); }
          const bad = res.filter(r => !r.ok);
          if (bad.some(b => CAPACITY.test(String(b.detail)))) {  // HANDOFF-SUBREQ-2: the invocation ran out of subrequests. That is this tick's limit, not a bad change: no attempt is counted and the deploy goes first next run
            await event(db, h.id, 'deploy_failed', 'deferred, not an attempt: ' + bad.map(b => `${b.w}: ${b.detail}`).join('; ').slice(0, 300)); out.deferred.push(h.id); break;
          }
          if (bad.length) {
            const n = h.attempts + 1; await db.prepare('UPDATE handoffs SET attempts = ? WHERE id = ?').bind(n, h.id).run();
            const msg = bad.map(b => `${b.w}: ${b.detail}`).join('; ');
            if (n >= MAX_ATTEMPTS) { await event(db, h.id, 'blocked', 'deploy failed ' + n + ' times: ' + msg); await setItem(db, h.item, 'blocked', 'HANDOFF-1 deploy failed: ' + msg.slice(0, 300)); await say(f, token, h.repo, h.pr, 'deploy failed ' + n + ' times (' + msg + '). The item is blocked with that reason; the operations role owns it.'); }
            else await event(db, h.id, 'deploy_failed', 'attempt ' + n + ': ' + msg);
            out.failed.push(h.id); continue;
          }
          await event(db, h.id, 'deployed', res.map(r => `${r.w} ${r.version || ''}`.trim()).join(', ') + ' from ' + String(at).slice(0, 7)); out.deployed.push(h.id); h.state = 'deployed';
          if (versionOf) {  // DEPLOY-VERSION-1: the worker must report a version that proves the new code is live, else roll back
            const checks = [];
            for (const r of res) {
              const live = (await versionOf(r.w)) || {};
              // a reader that cannot answer (site not yet serving /__internal/version) is recorded, not taken as proof of a bad deploy
              if (live.ok === false && !live.version) { checks.push({ w: r.w, ok: true, detail: 'version unreadable (' + (live.detail || 'no answer') + '), not checked' }); continue; }
              checks.push({ w: r.w, ...meetsVersion({ reported: live.version, before: before[r.w], min_version: r.min_version || null }) });
            }
            const off = checks.filter(c => !c.ok);
            if (off.length) { await rollBack(h, off.map(c => `${c.w}: ${c.detail}`).join('; '), 'version check'); continue; }
            await event(db, h.id, 'deployed', 'version check: ' + checks.map(c => `${c.w}: ${c.detail}`).join('; '));
          }
        }
      }
      if (h.state === 'deployed') {
        worked++;
        const pr = h.verify ? await probe(h.verify, f) : { ok: true, detail: 'no verify line; deploy is the last step' };
        if (pr.ok) {
          await event(db, h.id, 'verified', pr.detail); await setItem(db, h.item, 'done'); out.verified.push(h.id);
          await say(f, token, h.repo, h.pr, 'verified live: ' + pr.detail + (h.item ? '. Item `' + h.item + '` closed.' : '.'));
        } else if ((((await db.prepare("SELECT COUNT(*) AS n FROM handoff_events WHERE handoff_id = ? AND detail LIKE 'verify retry %'").bind(h.id).first()) || {}).n || 0) + 1 < VERIFY_TRIES) {
          const n = (((await db.prepare("SELECT COUNT(*) AS n FROM handoff_events WHERE handoff_id = ? AND detail LIKE 'verify retry %'").bind(h.id).first()) || {}).n || 0) + 1;
          await event(db, h.id, 'deployed', `verify retry ${n}/${VERIFY_TRIES}: ${pr.detail}`); out.retried.push(h.id);  // state stays deployed: the next tick probes again
        } else await rollBack(h, pr.detail);
      }
    } catch (e) { out.errors.push(`${h.id} ${e && e.message}`); }
  }
  }
  async function unblockCapacity() {
    const stuck = (await db.prepare("SELECT * FROM handoffs WHERE state = 'blocked' AND (detail LIKE '%Too many subrequests%' OR detail LIKE '%subrequest budget%') ORDER BY updated_at DESC LIMIT 3").all()).results || [];
    for (const h of stuck) {
      try {
        const targets = String(h.deploy || '').split(',').map(s => s.trim()).filter(Boolean); let carried = targets.length > 0, by = null;
        for (const w of targets) { const l = await db.prepare("SELECT id FROM handoffs WHERE state = 'verified' AND updated_at > ? AND (',' || replace(deploy, ' ', '') || ',') LIKE ? ORDER BY updated_at DESC LIMIT 1").bind(h.updated_at, '%,' + w + ',%').first(); if (l) by = l.id; else carried = false; }
        if (carried) {
          const pr = h.verify ? await probe(h.verify, f) : { ok: true, detail: 'no verify line' };
          if (pr.ok) { await event(db, h.id, 'verified', 'recovered: ' + pr.detail + ' (the deploy of ' + by + ' carried this change; the earlier block was the subrequest limit)'); await setItem(db, h.item, 'done'); out.verified.push(h.id); out.recovered.push(h.id); continue; }
        }
        await db.prepare('UPDATE handoffs SET attempts = 0 WHERE id = ?').bind(h.id).run();
        await event(db, h.id, 'deploy_failed', 'requeued: the block was the subrequest limit of the tick, not the change'); await setItem(db, h.item, 'ready', null); out.retried.push(h.id);
      } catch (e) { out.errors.push(`${h.id} ${e && e.message}`); }
    }
  }
  // 3. VERIFY-RETRY-1 self-heal: a handoff recorded as rolled_back whose probe passes now was a propagation race, not a bad change. Record the truth and close the item.
  // A rollback for a failed version check is not a propagation race (the old code is what the probe would see), so it never self-heals here.
  const rb = (await db.prepare("SELECT * FROM handoffs h WHERE state = 'rolled_back' AND merge_sha IS NOT NULL AND verify IS NOT NULL AND NOT EXISTS (SELECT 1 FROM handoff_events e WHERE e.handoff_id = h.id AND e.state = 'verify_failed' AND e.detail LIKE 'version check:%') ORDER BY updated_at DESC LIMIT 2").all()).results || [];
  for (const h of rb) {
    try { const pr = await probe(h.verify, f); if (!pr.ok) continue;
      await event(db, h.id, 'verified', 'recovered: ' + pr.detail + ' (the earlier probe ran before the deploy reached the edge)'); await setItem(db, h.item, 'done'); out.verified.push(h.id); out.recovered.push(h.id);
    } catch (e) { out.errors.push(`${h.id} ${e && e.message}`); }
  }
  if (out.errors.length) out.status = 'errors';
  return out;
  }
}

// ---- deploy from the merge commit, through the site worker's deploy endpoint ----
// Reads doctrine/topology.json and the worker's modules at `sha` from GitHub, flattens relative imports (same method as deploy/deploy-site.mjs),
// and asks the site worker (service binding SITE, header x-internal-key) to upload them with its CF_DEPLOY_TOKEN. No Cloudflare credential lives in the tick.
async function raw(f, token, repo, sha, path) {
  const r = await f(`${API}/repos/${repo}/contents/${path}?ref=${sha}`, { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github.raw', 'user-agent': 'ultrastable-handoff' } });
  if (!r.ok) throw new Error(`read ${path}@${String(sha).slice(0, 7)}: ${r.status}`);
  return r.text();
}
// The commit a branch of another repository points to now (a tenant repository's main), so a deploy reads one consistent tree and records it.
async function headSha(f, token, repo, ref) {
  const r = await f(`${API}/repos/${repo}/commits/${encodeURIComponent(ref)}`, { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github.sha', 'user-agent': 'ultrastable-handoff' } });
  if (!r.ok) throw new Error(`read ${repo}@${ref}: ${r.status}`);
  const t = (await r.text()).trim(); if (!/^[0-9a-f]{40}$/.test(t)) throw new Error(`read ${repo}@${ref}: no commit sha`);
  return t;
}
const norm = (p) => { const out = []; for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); } return out.join('/'); };
// HANDOFF-SUBREQ-1: a deploy read every module of the tick Worker one request at a time (about 60 files), which alone passes the Free plan's 50
// subrequests per invocation ("Too many subrequests", ultrastable-tick and ultrastable-tenants handoffs blocked from 20:21 UTC on 2026-11-17).
// GitHub GraphQL returns many files in one request, so a deploy reads each import level in one call. A file GraphQL cannot return whole (binary, truncated)
// is still read singly, and the reason a batch fell back is kept in `fallbacks`, never dropped.
export const RAW_CHUNK = 12;  // HANDOFF-SUBREQ-2: one GraphQL answer carrying 30 files (about 500 KB for the site Worker) can be refused; a refused batch fell back to 30 single reads
export async function rawMany(f, token, repo, sha, all) {
  if (all.length > RAW_CHUNK) { const out = new Map(), errs = []; for (let i = 0; i < all.length; i += RAW_CHUNK) { try { for (const [k, v] of await rawMany(f, token, repo, sha, all.slice(i, i + RAW_CHUNK))) out.set(k, v); } catch (e) { errs.push(String(e && e.message || e)); } } if (errs.length && !out.size) throw new Error(errs[0]); return out; }
  const paths = all, [owner, name] = String(repo).split('/');
  const fields = paths.map((p, i) => `f${i}: object(expression: ${JSON.stringify(sha + ':' + p)}) { ... on Blob { text isTruncated } }`).join(' ');
  const r = await f(`${API}/graphql`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'user-agent': 'ultrastable-handoff' }, body: JSON.stringify({ query: `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} } }` }) });
  if (!r.ok) throw new Error('graphql ' + r.status);
  const j = await r.json(), data = j && j.data && j.data.repository;
  if (!data) throw new Error('graphql returned no repository: ' + JSON.stringify(j && j.errors || '').slice(0, 120));
  const out = new Map();
  paths.forEach((p, i) => { const o = data['f' + i]; if (o && typeof o.text === 'string' && !o.isTruncated) out.set(p, o.text); });
  return out;
}
export function batchedReader(read, many) {
  const cache = new Map(), fallbacks = [];
  return { fallbacks,
    prefetch: async (paths) => { const need = paths.filter(p => !cache.has(p)); if (!need.length) return; try { for (const [k, v] of await many(need)) cache.set(k, v); } catch (e) { fallbacks.push(String(e && e.message || e).slice(0, 120)); } },
    read: async (p) => (cache.has(p) ? cache.get(p) : read(p)) };
}
export async function collectModules(read, main, prefetch = null) {  // prefetch(paths): optional, reads a whole import level in one request (Free plan: 50 subrequests per invocation)
  const mods = new Map(), names = new Map(), queue = [main];
  // JSON imports become JS modules (`export default <json>`; the upload API has no JSON module type, error 10162), named <file>.json.js, and the
  // `with { type: 'json' }` attribute is dropped from the importing statement, as a bundler would do.
  const flat = (path) => { if (!names.has(path)) { const base = path.split('/').pop() + (/\.json$/.test(path) ? '.js' : ''); let n = base, i = 1; while ([...names.values()].includes(n)) n = base.replace(/(\.\w+)$/, `-${i++}$1`); names.set(path, n); } return names.get(path); };
  flat(main);
  while (queue.length) {
    const level = [...new Set(queue.splice(0))].filter(x => !mods.has(x));
    if (prefetch && level.length) await prefetch(level);
    for (const path of level) {
    if (mods.has(path)) continue;
    let src = await read(path); const dir = path.replace(/[^/]+$/, '');
    if (/\.json$/.test(path)) { mods.set(path, 'export default ' + JSON.stringify(JSON.parse(src)) + ';\n'); continue; }
    src = src.replace(/(\bfrom\s+["']|\bimport\s*\(\s*["']|\bimport\s+["'])(\.{1,2}\/[^"']+)(["'])(\s*(?:with|assert)\s*\{\s*type\s*:\s*["']json["']\s*\})?/g, (_, a, spec, c) => { const target = norm(dir + spec); if (!mods.has(target)) queue.push(target); return a + './' + flat(target) + c; });
    mods.set(path, src);
    }
  }
  return [...mods.entries()].map(([path, src]) => ({ name: names.get(path), path, src, type: 'application/javascript+module' }));
}
export function topologyBindings(topo, id) {
  const w = (topo.workers || []).find(x => x.id === id); if (!w) return null;
  const b = w.bindings || {}, st = (kind, n) => ((topo.stores || {})[kind] || []).find(s => s.name === n), live = (kind, n) => (st(kind, n) || {}).state === 'live', out = [];
  for (const [bn, t] of Object.entries(b.d1 || {})) if (live('d1', t)) out.push({ type: 'd1', name: bn, id: st('d1', t).id });
  for (const [bn, t] of Object.entries(b.kv || {})) if (live('kv', t) && st('kv', t).id) out.push({ type: 'kv_namespace', name: bn, namespace_id: st('kv', t).id });
  for (const [bn, t] of Object.entries(b.r2 || {})) if (live('r2', t)) out.push({ type: 'r2_bucket', name: bn, bucket_name: t });  // AUDIT on the tick: without it the audit chain's R2 sink and the daily D1 copy have no bucket
  for (const bn of b.ai || []) out.push({ type: 'ai', name: bn });
  for (const [bn, t] of Object.entries(b.services || {})) if (((topo.workers || []).find(x => x.id === t) || {}).state === 'live') out.push({ type: 'service', name: bn, service: t });
  for (const bn of b.send_email || []) out.push({ type: 'send_email', name: bn });  // the dashboard's sign-in mail; dropping it on deploy broke sign-in
  for (const [bn, cls] of Object.entries(b.durable_objects || {})) out.push({ type: 'durable_object_namespace', name: bn, class_name: cls });  // an upload without it drops the namespace (ultrastable-tenants lost TENANT on its first handoff deploy)
  for (const [bn, v] of Object.entries(b.vars || {})) out.push({ type: 'plain_text', name: bn, text: String(v) });
  return { worker: w, bindings: out };
}
// OWNER-EMAIL-1 (Rowan 2026-11-17): the owner's sign-in address is never typed in. It is read from the repository the code lives in: the
// human committer with admin permission (most commits first) and the address on their commits, never a noreply or bot address. Plain
// variables are replaced on every deploy, so the deployer resolves it each time. A miss returns '' and the deploy goes on (the dashboard
// probe `owner_email` then reports it); nothing is guessed.
export async function resolveOwnerEmail(f, token, repo) {
  const h = { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-handoff' };
  const r = await f(`${API}/repos/${repo}/commits?per_page=100`, { headers: h }); if (!r.ok) return '';
  const by = new Map();
  for (const c of await r.json()) {
    const login = c.author && c.author.login, email = String((c.commit && c.commit.author && c.commit.author.email) || '').toLowerCase();
    if (!login || (c.author.type && c.author.type !== 'User') || !email || /noreply|\[bot\]/.test(email)) continue;
    const e = by.get(login) || { n: 0, emails: new Map() }; e.n++; e.emails.set(email, (e.emails.get(email) || 0) + 1); by.set(login, e);
  }
  const ranked = [...by.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [login, e] of ranked) {
    const p = await f(`${API}/repos/${repo}/collaborators/${login}/permission`, { headers: h }).then(x => x.ok ? x.json() : null).catch(() => null);
    if (p && p.permission === 'admin') return [...e.emails.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return '';
}
// The tick's config.js is generated, not in git. Same generator as deploy/deploy-workers.mjs, read from the repo at the deploy commit, so a policy change ships with its merge.
export async function tickConfigSource(read) {
  const j = async (p) => JSON.parse(await read(p));
  const pol = await j('seed/autonomy/policy.json'), fm = await j('seed/autonomy/failure-modes.json'), ifm = await j('instances/ultrastable/failure-modes.json');
  fm.modes = [...fm.modes, ...ifm.modes];
  const cfg = { org_slug: 'ultrastable', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy: { trust: pol.trust, ladder: pol.ladder, surfaces: pol.surfaces }, criticality: await j('seed/autonomy/criticality.json'), failure_modes: fm, migrations: await Promise.all((await j('seed/worker/migrations/index.json')).map(async f => ({ file: f, sql: await read('seed/worker/migrations/' + f) }))), unknowns: await j('doctrine/unknowns.json').catch(() => null), cost_budgets: (await j('instances/ultrastable/cost-budgets.json')).budgets, budget: await j('instances/ultrastable/instance.json').then(m => m.budget || {}, () => ({})), retention: await j('seed/autonomy/retention.json').catch(() => null), halt: await j('ops/halt.json').catch(() => null), pace: await j('seed/autonomy/pace.json').catch(() => null), goals: await j('seed/autonomy/goals.json').catch(() => null), seed_metrics: await j('instances/ultrastable/objectives.json').then(o => o.metrics || [], () => []), progress: await j('instances/ultrastable/progress.json').catch(() => null), managers: await j('seed/autonomy/managers.json').catch(() => null) };  // MANAGERS-1  // HALT-1  // RETENTION-1  // SPEND-GOVERNOR-1: no manifest means budget 0, the free-tier default
  return '// Generated on the server path (HANDOFF-1) from seed/autonomy at the deploy commit. Do not edit.\nexport default ' + JSON.stringify(cfg) + ';\n';
}
// generated: optional overrides for build-time paths not in git, mapped to their source text.
export function makeDeployer({ token, fetch: f = fetch, site, key, oidc, generated = {} }) {  // oidc: a GitHub Actions OIDC token instead of the shared key (DEPLOY-OIDC-1)
  return async (id, sha, repo) => {
    try {
      const topo = JSON.parse(await raw(f, token, repo, sha, 'doctrine/topology.json'));
      const tb = topologyBindings(topo, id); if (!tb) return { ok: false, detail: `${id} is not in doctrine/topology.json` };
      if (tb.worker.state !== 'live') return { ok: false, detail: `${id} is ${tb.worker.state}, not live` };
      // TENANT-REPO-1: a tenant worker is built from its own repository (topology `source`), at the commit its main branch points to now
      const src = tb.worker.source && tb.worker.source.repo ? tb.worker.source : null;
      const fromRepo = src ? src.repo : repo, fromSha = src ? await headSha(f, token, src.repo, src.ref || 'main') : sha;
      const br = batchedReader(p => raw(f, token, fromRepo, fromSha, p), ps => rawMany(f, token, fromRepo, fromSha, ps)), read = br.read;
      if (String(tb.worker.main).startsWith('seed/worker/')) {  // the tick Worker: its generated config.js reads these files (and every migration), so they come in two requests, not about thirty
        await br.prefetch([tb.worker.main, 'seed/autonomy/policy.json', 'seed/autonomy/failure-modes.json', 'instances/ultrastable/failure-modes.json', 'seed/autonomy/criticality.json', 'doctrine/unknowns.json', 'instances/ultrastable/cost-budgets.json', 'instances/ultrastable/instance.json', 'instances/ultrastable/objectives.json', 'ops/halt.json', 'seed/autonomy/retention.json', 'seed/worker/migrations/index.json']);
        const idx = await read('seed/worker/migrations/index.json').then(JSON.parse, () => []);
        await br.prefetch(idx.map(x => 'seed/worker/migrations/' + x));
      }
      if (((tb.worker.bindings || {}).var_names || []).includes('OWNER_EMAIL') && !tb.bindings.some(x => x.name === 'OWNER_EMAIL')) {
        const em = await resolveOwnerEmail(f, token, repo).catch(() => ''); if (em) tb.bindings.push({ type: 'plain_text', name: 'OWNER_EMAIL', text: em });
      }
      const gen = { 'seed/worker/src/config.js': () => tickConfigSource(read), ...Object.fromEntries(Object.entries(generated).map(([k, v]) => [k, () => v])) };
      const modules = await collectModules(p => (p in gen ? Promise.resolve(gen[p]()) : read(p)), tb.worker.main, ps => br.prefetch(ps.filter(p => !(p in gen))));
      const r = await site.fetch('https://internal/__internal/deploy', { method: 'POST', headers: { ...(oidc ? { authorization: 'Bearer ' + oidc } : { 'x-internal-key': key }), 'content-type': 'application/json' },
        body: JSON.stringify({ name: id, modules: modules.map(({ name, src, type }) => ({ name, src, type })), main: modules[0].name, compatibility_date: tb.worker.compatibility_date || topo.compatibility_date, bindings: tb.bindings, crons: tb.worker.crons || null, workers_dev: !tb.worker.public, domains: (src || String(tb.worker.main).startsWith('instances/')) ? (tb.worker.routes || []) : [], tag: String(sha).slice(0, 12) }) });
      const j = await r.json().catch(() => ({}));
      const extra = src ? { source_repo: fromRepo, source_sha: fromSha } : {};
      return r.ok && j.ok ? { ok: true, version: j.version || '', detail: j.warnings && j.warnings.length ? 'uploaded; ' + j.warnings.join('; ') : 'uploaded', ...extra } : { ok: false, detail: j.error || ('site deploy ' + r.status), ...extra };
    } catch (e) { return { ok: false, detail: String(e && e.message || e) }; }
  };
}
// DEPLOY-VERSION-1: the live deployment id of a worker, read through the site worker (it holds the Cloudflare credential).
export function makeVersionReader({ site, key }) {
  return async (id) => {
    try { const r = await site.fetch('https://internal/__internal/version', { method: 'POST', headers: { 'x-internal-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ name: id }) }); const j = await r.json().catch(() => ({})); return { ok: !!j.ok, version: j.ok ? (j.version || null) : null, detail: j.detail || j.error || String(r.status) }; }
    catch (e) { return { ok: false, version: null, detail: String(e && e.message || e) }; }
  };
}
export function makeRollback({ site, key }) {
  return async (id) => {
    try { const r = await site.fetch('https://internal/__internal/rollback', { method: 'POST', headers: { 'x-internal-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ name: id }) }); const j = await r.json().catch(() => ({})); return { ok: !!j.ok, detail: j.detail || j.error || String(r.status) }; }
    catch (e) { return { ok: false, detail: String(e && e.message || e) }; }
  };
}
