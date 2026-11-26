// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// Worker-side lane: each tick merges green PRs and hands open issues to the agent workflow, with no person in the loop.
// Needs a GITHUB_TOKEN secret binding; without one it reports "no-token" and the other hosts (deploy/routes.json) carry the lane.
const API = 'https://api.github.com';

// GITHUB-BUDGET-1 (Q-LESSON-GITHUB-BUDGET): the fleet this org was split from lost 25 failure modes to external quotas (the shared GitHub quota spent,
// null mergeable states retried without limit). One budget is shared by every GitHub caller of a tick (lane, handoffs): it counts calls, stops at
// `cap` (default 150 per tick), and on a 403 or 429 that carries Retry-After or x-ratelimit-remaining: 0 / x-ratelimit-reset it stops for the rest of
// the tick and records why. A stopped budget answers every later call with { ok: false, status: 0, stopped: true } without touching the network.
export const GITHUB_CALLS_PER_TICK = 40;  // SUBREQUEST-ROTATION-1: the Workers Free plan allows 50 subrequests per invocation (was 150)
export function githubBudget(cap = GITHUB_CALLS_PER_TICK, now = () => Date.now()) {
  const b = { cap: Number(cap) > 0 ? Number(cap) : GITHUB_CALLS_PER_TICK, calls: 0, stopped: false, why: null, retry_after_s: null,
    // true when a call may go out; counts it
    take() { if (b.stopped) return false; if (b.calls >= b.cap) { b.stop(`cap ${b.cap} GitHub calls per tick reached`); return false; } b.calls++; return true; },
    stop(why, retryAfterS = null) { if (!b.stopped) { b.stopped = true; b.why = why; b.retry_after_s = retryAfterS; } },
    // reads a response; stops on a rate-limit answer (403/429 with Retry-After or an exhausted x-ratelimit window)
    observe(r, path) {
      if (r.status !== 403 && r.status !== 429) return;
      const h = (n) => (r.headers && typeof r.headers.get === 'function' ? r.headers.get(n) : null);
      const ra = h('Retry-After') || h('retry-after'), reset = h('x-ratelimit-reset'), remaining = h('x-ratelimit-remaining');
      if (r.status === 403 && ra == null && remaining !== '0') return;  // a plain permission refusal, not a quota
      const wait = ra != null && !Number.isNaN(Number(ra)) ? Number(ra) : reset ? Math.max(0, Math.round(Number(reset) - now() / 1000)) : null;
      b.stop(`GitHub ${r.status} on ${path}: rate limited${wait != null ? `, Retry-After ${wait}s` : ''}; stopped for this tick`, wait);
    },
    report() { return { calls: b.calls, cap: b.cap, stopped: b.stopped, why: b.why, retry_after_s: b.retry_after_s }; },
  };
  return b;
}
const STOPPED = { ok: false, status: 0, json: null, stopped: true };

export async function gh(f, token, method, path, body, budget = null, ua = 'ultrastable-lane') {
  if (budget && !budget.take()) return STOPPED;
  const r = await ghFetch(f, API + path, {
    method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': ua, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (budget) budget.observe(r, method + ' ' + path);
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { ok: r.ok, status: r.status, json };
}

export const EVIDENCE_PATH = 'ops/worker-merge-evidence.jsonl';

// Appends one JSON line to the evidence file on main through the contents API (done check of ZERO-MINUTES-1).
async function appendEvidence(f, token, repo, row, budget = null) {
  const cur = await gh(f, token, 'GET', `/repos/${repo}/contents/${EVIDENCE_PATH}?ref=main`, undefined, budget);
  if (!cur.ok && cur.status !== 404) throw new Error(`read ${cur.status}`);
  const old = cur.ok ? atob(String(cur.json.content || '').replace(/\n/g, '')) : '';
  const content = btoa(old + JSON.stringify(row) + '\n');
  const put = await gh(f, token, 'PUT', `/repos/${repo}/contents/${EVIDENCE_PATH}`, { message: `ZERO-MINUTES-1: worker merged #${row.pr}`, content, branch: 'main', ...(cur.ok ? { sha: cur.json.sha } : {}) }, budget);
  if (!put.ok) throw new Error(`write ${put.status}`);
}

// LANE-RED-1: with ZERO_ACTIONS the lane used to merge any 'unstable' PR that passed the diff gate, including PRs whose checks ran and failed
// (#433 merged 20 s after `checks` failed on an orphan document). A failed Actions job with a failed step really ran: it holds the PR. A failed job
// with no steps never started (minutes exhausted), and only then does the Worker's diff gate decide. An unreadable answer holds: unknown is not green.
import { notGreen } from './greenguard.js';  // GREEN-GUARD-1
import { ghFetch, mergedAnyway } from './ghfetch.js';  // GH-RETRY-1
export async function realRed(f, token, repo, sha, budget = null) {
  const runs = await gh(f, token, 'GET', `/repos/${repo}/actions/runs?head_sha=${sha}&per_page=30`, undefined, budget);
  if (!runs.ok) return `runs ${runs.status}`;
  // MERGE-RUNNING-1: #2222 was merged on the worker gate while its `checks` run was still running, and that run then failed: main went red.
  // Runs that are really running (started within the hour, not stuck in a queue Actions minutes will never serve) are waited for.
  const now = Date.now();
  const live = (runs.json.workflow_runs || []).find(r => r.status !== 'completed' && r.name !== 'lane' && now - Date.parse(r.run_started_at || r.created_at || 0) < 3600e3);
  if (live) return `${live.name || 'run'} still running`;
  for (const run of (runs.json.workflow_runs || []).filter(r => r.conclusion === 'failure')) {
    const jobs = await gh(f, token, 'GET', `/repos/${repo}/actions/runs/${run.id}/jobs?per_page=30`, undefined, budget);
    if (!jobs.ok) return `jobs ${jobs.status}`;
    const bad = (jobs.json.jobs || []).find(j => j.conclusion === 'failure' && (j.steps || []).some(s => s.conclusion === 'failure'));
    if (bad) return `${run.name || 'run'}/${bad.name} failed`;
  }
  return null;
}

export async function runLane({ token, repos = [], fetch: f = fetch, issueWorkflow = 'issues.yml', maxIssues = 3, maxMerges = 5, zeroActions = false, evidenceRepo = null, budget = githubBudget() }) {
  if (!token) return { status: 'no-token', merged: [], dispatched: [], errors: [] };
  const out = { status: 'ok', merged: [], dispatched: [], held: [], errors: [] };
  for (const repo of repos) {
    if (budget.stopped) break;  // GITHUB-BUDGET-1: a stopped budget ends the lane for this tick
    try {
      const prs = await gh(f, token, 'GET', `/repos/${repo}/pulls?state=open&per_page=30`, undefined, budget);
      if (!prs.ok) { out.errors.push(`${repo} pulls ${prs.status}`); continue; }
      for (const pr of prs.json) {
        if (out.merged.length >= maxMerges || budget.stopped) break;
        let d = (await gh(f, token, 'GET', `/repos/${repo}/pulls/${pr.number}`, undefined, budget)).json;
        if (d && d.draft) { // a draft with finished work is marked ready by the lane
          if (pr.labels && pr.labels.some(l => l.name === 'handoff')) continue;
          const m = await gh(f, token, 'POST', `/repos/${repo}/pulls/${pr.number}/ready_for_review`, undefined, budget);
          if (!m.ok) { out.held.push(`${repo}#${pr.number} draft`); continue; }
          d = (await gh(f, token, 'GET', `/repos/${repo}/pulls/${pr.number}`, undefined, budget)).json;
        }
        // HOLD-LABEL-1 (US-33-R13): the label `hold` holds here as on every other merge route; it is read from what is in hand, so it costs no call
        if ([...(pr.labels || []), ...((d && d.labels) || [])].some(l => l && l.name === 'hold')) { out.held.push(`${repo}#${pr.number} hold`); continue; }
        const comments = (await gh(f, token, 'GET', `/repos/${repo}/issues/${pr.number}/comments?per_page=30`, undefined, budget)).json || [];
        if (comments.some(c => /^HOLD:/.test(c.body || ''))) { out.held.push(`${repo}#${pr.number} HOLD`); continue; }
        let ready = d && d.mergeable_state === 'clean';
        if (!ready && d && zeroActions && ['unstable', 'blocked'].includes(d.mergeable_state)) { // ZERO-MINUTES-1: Actions minutes are exhausted, so the Worker's own diff gate decides
          const st = await gh(f, token, 'GET', `/repos/${repo}/commits/${d.head.sha}/status`, undefined, budget);
          ready = Boolean(st.ok && (st.json.statuses || []).some(s => s.context === 'worker-gate' && s.state === 'success'));          if (ready) { const red = await realRed(f, token, repo, d.head.sha, budget); if (red) { out.held.push(`${repo}#${pr.number} red: ${red}`); continue; } }
        }
        if (ready && d.mergeable_state === 'clean') { const hold = await notGreen(f, token, repo, d.head.sha, (ff, t, m, path) => gh(ff, t, m, path, undefined, budget)); if (hold) { out.held.push(`${repo}#${pr.number} ${hold}`); continue; } }  // GREEN-GUARD-1
        if (!ready) { out.held.push(`${repo}#${pr.number} ${d && d.mergeable_state}`); continue; }
        const m = await gh(f, token, 'PUT', `/repos/${repo}/pulls/${pr.number}/merge`, { merge_method: 'squash' }, budget);
        if (!m.ok && !m.stopped && await mergedAnyway((mm, pp) => gh(f, token, mm, pp, undefined, budget), repo, pr.number, m.status)) m.ok = true;  // GH-RETRY-1
        (m.ok ? out.merged : out.errors).push(m.ok ? `${repo}#${pr.number}` : `${repo}#${pr.number} merge ${m.status}`);
        if (m.ok && evidenceRepo === repo) { // ZERO-MINUTES-1 probe: the Worker merged this with no lane run on Actions
          try { await appendEvidence(f, token, repo, { at: new Date().toISOString(), pr: pr.number, sha: (m.json && m.json.sha) || null, host: 'cloudflare-worker', via: zeroActions ? 'worker-gate' : 'clean' }); }
          catch (e) { out.errors.push(`${repo}#${pr.number} evidence ${e.message}`); }
        }
      }
      if (!issueWorkflow) continue; // issue work is dispatched by executor.js; the lane only merges
      const iss = await gh(f, token, 'GET', `/repos/${repo}/issues?state=open&per_page=30`, undefined, budget);
      let n = 0;
      for (const i of iss.ok ? iss.json : []) {
        if (budget.stopped) break;
        if (i.pull_request || n >= maxIssues) continue;
        if ((i.labels || []).some(l => ['claimed', 'dispatched', 'blocked'].includes(l.name)) || (i.assignees || []).length) continue;
        const dsp = await gh(f, token, 'POST', `/repos/${repo}/actions/workflows/${issueWorkflow}/dispatches`, { ref: 'main', inputs: { issue: String(i.number) } }, budget);
        if (!dsp.ok) { out.errors.push(`${repo}#${i.number} dispatch ${dsp.status}`); continue; }
        await gh(f, token, 'POST', `/repos/${repo}/issues/${i.number}/labels`, { labels: ['dispatched'] }, budget);
        out.dispatched.push(`${repo}#${i.number}`); n++;
      }
    } catch (e) { out.errors.push(`${repo} ${e.message}`); }
  }
  out.github = budget.report();
  if (out.errors.length) out.status = 'errors';
  else if (budget.stopped) out.status = 'stopped';  // why is in out.github.why; the beat row records it
  return out;
}
