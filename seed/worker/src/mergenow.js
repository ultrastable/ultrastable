// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// MERGE-NOW-1 (Rowan, 2026-11-21): "PR should not be sitting in GitHub for more than a second. If there are merge conflicts, then fix them immediately."
// The tick Worker acts on a pull request the moment GitHub tells it something changed (webhook: pull_request, check_suite, push to main), not on the
// next 10-minute tick or after an Actions lane run. With the org's GitHub App token (which may write workflow files) it:
//   draft -> ready; behind -> update-branch; a pending `pull_request` run waiting for approval -> approved;
//   dirty (conflict) -> reconciled through the git data API: every generated file the PR carries is set to main's copy and every
//     `<!-- claim:ID -->` block takes main's value (both are regenerated on main after the merge, REGEN-GENERATED-1), then main is merged into the
//     branch with POST /merges. A conflict left in hand-written code is reported as `code-conflict`; the Actions lane and the queue take it.
//   clean and green (GREEN-GUARD-1) -> squash-merged on the exact head commit.
// Every call is counted against the invocation's subrequest budget (Workers Free: 50 per invocation).
import { notGreen } from './greenguard.js';
import { GENERATED } from './generated.js';
import { ghFetch, mergedAnyway } from './ghfetch.js';  // GH-RETRY-1

const API = 'https://api.github.com';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function makeGh(f, token, cap = 40) {
  let calls = 0;
  const gh = async (method, path, body) => {
    if (calls >= cap) return { ok: false, status: 0, json: null, stopped: true };
    calls++;
    const r = await ghFetch(f, API + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-mergenow', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let json = null; try { json = t ? JSON.parse(t) : null; } catch { json = t; }
    return { ok: r.ok, status: r.status, json };
  };
  gh.calls = () => calls;
  return gh;
}

const CLAIM = /<!-- claim:([\w.-]+) -->([\s\S]*?)<!-- \/claim -->/g;
// The PR's text with every claim block's value taken from main: a claim value is computed from code (claims --fix), never written by hand.
export function adoptClaims(prText, mainText) {
  const vals = new Map(); for (const m of String(mainText).matchAll(CLAIM)) vals.set(m[1], m[2]);
  return String(prText).replace(CLAIM, (all, id, v) => (vals.has(id) ? `<!-- claim:${id} -->${vals.get(id)}<!-- /claim -->` : all));
}

const b64dec = (s) => { const bin = atob(String(s || '').replace(/\n/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); };
const b64enc = (t) => { const u = new TextEncoder().encode(t); let s = ''; for (const c of u) s += String.fromCharCode(c); return btoa(s); };
async function content(gh, repo, path, ref) {
  const r = await gh('GET', `/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`);
  if (r.status === 404) return { missing: true };
  if (!r.ok || !r.json || r.json.encoding !== 'base64') return { error: `read ${path}@${ref} ${r.status}` };
  return { text: b64dec(r.json.content), sha: r.json.sha };
}

// Removes the generated-file and claim-block side of a conflict on the PR branch, then merges main into it. Returns the result word.
export async function reconcile(gh, repo, pr, { generated = GENERATED } = {}) {
  const files = await gh('GET', `/repos/${repo}/pulls/${pr.number}/files?per_page=100`);
  if (!files.ok || !Array.isArray(files.json)) return { result: 'error', why: `files ${files.status}` };
  const tree = [];
  for (const f of files.json) {
    const p = f.filename;
    if (generated.includes(p)) {
      const m = await content(gh, repo, p, 'main');
      if (m.error) return { result: 'error', why: m.error };
      tree.push(m.missing ? { path: p, mode: '100644', type: 'blob', sha: null } : { path: p, mode: '100644', type: 'blob', sha: m.sha });
    } else if (/\.(md|html)$/.test(p) && f.status !== 'removed' && /<!-- claim:/.test(f.patch || '')) {
      const [a, m] = [await content(gh, repo, p, pr.head.sha), await content(gh, repo, p, 'main')];
      if (a.error || m.error) return { result: 'error', why: a.error || m.error };
      if (a.missing || m.missing) continue;
      const t = adoptClaims(a.text, m.text);
      if (t !== a.text) tree.push({ path: p, mode: '100644', type: 'blob', content: t });
    }
  }
  let head = null, nt = null;
  if (tree.length) {
    head = await gh('GET', `/repos/${repo}/git/commits/${pr.head.sha}`);
    if (!head.ok) return { result: 'error', why: `head ${head.status}` };
    nt = await gh('POST', `/repos/${repo}/git/trees`, { base_tree: head.json.tree.sha, tree });
    if (!nt.ok) return { result: 'error', why: `tree ${nt.status}` };
  }
  // MERGENOW-NOOP-1: a tree equal to the head's tree changes nothing. Committing it anyway pushed an empty commit, which raised a synchronize
  // event, which ran this again: 34 empty commits in four minutes on one PR, each starting a full CI run. Nothing changed, so nothing is committed.
  if (tree.length && nt.json.sha !== head.json.tree.sha) {
    const c = await gh('POST', `/repos/${repo}/git/commits`, { message: 'MERGE-NOW-1: generated files and claim values follow main (regenerated after merge)', tree: nt.json.sha, parents: [pr.head.sha] });
    if (!c.ok) return { result: 'error', why: `commit ${c.status}` };
    const u = await gh('PATCH', `/repos/${repo}/git/refs/heads/${encodeURIComponent(pr.head.ref)}`, { sha: c.json.sha, force: false });
    if (!u.ok) return { result: 'error', why: `ref ${u.status}` };
  }
  const mg = await gh('POST', `/repos/${repo}/merges`, { base: pr.head.ref, head: 'main', commit_message: `MERGE-NOW-1: merge main into ${pr.head.ref}` });
  const stripped = tree.length && nt && nt.json.sha !== head.json.tree.sha ? tree.length : 0;
  if (mg.ok || mg.status === 204) return { result: 'resolved', stripped };
  if (mg.status === 409) return { result: 'code-conflict', stripped };
  return { result: 'error', why: `merges ${mg.status}` };
}

// One pass over the given PRs (or every open PR into main when none are named). Returns what it did per PR.
export async function mergeNow({ token, repo, numbers = null, fetch: f = fetch, cap = 40, wait = sleep, maxReconcile = 1 }) {
  const out = { repo, merged: [], reconciled: [], refreshed: [], approved: [], readied: [], held: [], conflicts: [], errors: [] };
  if (!token) return { ...out, status: 'no-token' };
  const gh = makeGh(f, token, cap);
  let list = numbers;
  if (!list) {
    const r = await gh('GET', `/repos/${repo}/pulls?state=open&base=main&per_page=30`);
    if (!r.ok) return { ...out, status: 'error', errors: [`pulls ${r.status}`] };
    list = (r.json || []).map(p => p.number);
  }
  let reconciles = 0;
  for (const n of list) {
    const tag = `${repo}#${n}`;
    let d = (await gh('GET', `/repos/${repo}/pulls/${n}`)).json;
    if (!d || d.state !== 'open' || d.base?.ref !== 'main') continue;
    if ((d.labels || []).some(l => l.name === 'hold')) { out.held.push(`${tag} hold`); continue; }
    if (d.draft) {
      const r = await gh('POST', `/repos/${repo}/pulls/${n}/ready_for_review`);
      if (r.ok) out.readied.push(tag);
      d = (await gh('GET', `/repos/${repo}/pulls/${n}`)).json || d;
    }
    if (d.mergeable === null) { await wait(3000); d = (await gh('GET', `/repos/${repo}/pulls/${n}`)).json || d; }  // GitHub computes mergeability lazily
    const st = d.mergeable_state;
    if (st === 'dirty') {
      if (reconciles >= maxReconcile) { out.held.push(`${tag} dirty (next event)`); continue; }
      reconciles++;
      const r = await reconcile(gh, repo, d);
      (r.result === 'resolved' ? out.reconciled : r.result === 'code-conflict' ? out.conflicts : out.errors).push(`${tag}${r.why ? ' ' + r.why : ''}`);
      continue;  // the new head raises its checks; the check_suite event merges it
    }
    if (st === 'behind') { const u = await gh('PUT', `/repos/${repo}/pulls/${n}/update-branch`, { expected_head_sha: d.head.sha }); (u.ok ? out.refreshed : out.errors).push(u.ok ? tag : `${tag} update ${u.status}`); continue; }
    // LANE-APPROVE-1: a pull_request run waiting in action_required is the required `checks`; approve it so it reports
    const waiting = await gh('GET', `/repos/${repo}/actions/runs?head_sha=${d.head.sha}&event=pull_request&status=action_required`);
    let ap = 0;
    for (const run of (waiting.ok && waiting.json && waiting.json.workflow_runs) || []) { const a = await gh('POST', `/repos/${repo}/actions/runs/${run.id}/approve`); if (a.ok || a.status === 201) ap++; }
    if (ap) { out.approved.push(tag); continue; }
    if (st !== 'clean' && st !== 'unstable' && st !== 'blocked') { out.held.push(`${tag} ${st}`); continue; }
    const hold = await notGreen(f, token, repo, d.head.sha, (ff, t, m, path) => gh(m, path));  // GREEN-GUARD-1
    if (hold) { out.held.push(`${tag} ${hold}`); continue; }
    const m = await gh('PUT', `/repos/${repo}/pulls/${n}/merge`, { merge_method: 'squash', sha: d.head.sha });
    if (!m.ok && !m.stopped && await mergedAnyway(gh, repo, n, m.status)) m.ok = true;  // GH-RETRY-1
    (m.ok ? out.merged : out.errors).push(m.ok ? tag : `${tag} merge ${m.status} ${(m.json && m.json.message || '').slice(0, 80)}`);
  }
  out.calls = gh.calls();
  out.status = out.errors.length ? 'errors' : 'ok';
  return out;
}

// Which PRs a webhook names. null: the event is not about merging.
export function prsForEvent(ev, p) {
  const repo = p && p.repository && p.repository.full_name;
  if (!repo) return null;
  if (ev === 'pull_request' && ['opened', 'reopened', 'synchronize', 'ready_for_review', 'labeled', 'unlabeled'].includes(p.action) && p.pull_request && p.pull_request.base?.ref === 'main') return { repo, numbers: [p.pull_request.number] };
  if ((ev === 'check_suite' || ev === 'check_run') && p.action === 'completed') {
    const prs = ((p.check_suite || (p.check_run && p.check_run.check_suite) || {}).pull_requests || []).map(x => x.number);
    return prs.length ? { repo, numbers: prs } : null;
  }
  if (ev === 'workflow_run' && p.action === 'completed' && p.workflow_run) {
    const prs = (p.workflow_run.pull_requests || []).map(x => x.number);
    return prs.length ? { repo, numbers: prs } : null;
  }
  if (ev === 'push' && p.ref === 'refs/heads/main') return { repo, numbers: null };  // main moved: every open PR may now conflict or be behind
  return null;
}

// PR-LATENCY-1: minutes from open to merge over the most recently closed PRs, and the age of the oldest open PR (one GitHub call each).
export function latency(closed, open, now = Date.now()) {
  const mins = closed.filter(p => p.merged_at).map(p => (Date.parse(p.merged_at) - Date.parse(p.created_at)) / 6e4).sort((a, b) => a - b);
  const q = (x) => (mins.length ? Math.round(mins[Math.min(mins.length - 1, Math.floor(x * mins.length))] * 10) / 10 : null);
  const oldest = open.reduce((m, p) => Math.max(m, (now - Date.parse(p.created_at)) / 6e4), 0);
  return { merge_p50_min: q(0.5), merge_p95_min: q(0.95), merged_sample: mins.length, oldest_open_pr_min: Math.round(oldest * 10) / 10, open_prs: open.length };
}
