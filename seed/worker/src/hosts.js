// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// HOSTS-1: one adapter interface for every system that runs or hosts an Ultrastable system, and the two-way wiring between the repository and them.
let prunedDay = null;  // RETENTION-1: host_events keeps 30 days; pruned once a day per isolate (integer time column, so retention.js cannot prune it)
//   repo -> host: a signed push/workflow event deploys the workers it touched through the first healthy host (failover down the list), no polling.
//   host -> repo: every deploy, failure, health change and inbound host webhook becomes a commit status (and a check run when the credential allows) on the commit.
// A host is { id, kind, health(), deploy({worker, sha, repo}), version?(worker) }. Cloudflare, GitHub Actions (the credential-free route) and Google Cloud plug in below;
// a new host is one object that passes assertHost. Pure and injectable (fetch, db, now); never throws into the tick.
const API = 'https://api.github.com';
export const STALL_MS = 30 * 60e3;       // a push with no deploy event after this long is a stalled lane
export const MAX_DEPLOYS_PER_PUSH = 3;   // Free plan: 50 subrequests per invocation; the rest ride the handoff lane

export function assertHost(h) {
  for (const k of ['id', 'kind']) if (!h || typeof h[k] !== 'string' || !h[k]) throw new Error('host needs a string ' + k);
  for (const k of ['health', 'deploy']) if (typeof h[k] !== 'function') throw new Error('host ' + h.id + ' needs ' + k + '()');
  return h;
}

const gh = (f, token, method, path, body) => f(API + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-hosts', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

// ---- adapters ----
export function cloudflareHost({ site, key, deployer, versionOf }) {  // the site worker holds the Cloudflare credential; the tick never does
  return { id: 'cloudflare', kind: 'runtime',
    async health() { if (!site || !key) return { ok: false, detail: 'site binding or INTERNAL_DEPLOY_KEY missing' }; const v = versionOf ? await versionOf('ultrastable-site') : { ok: true }; return { ok: !!v.ok, detail: v.ok ? 'site worker answers' : (v.detail || 'no answer') }; },
    deploy: (a) => deployer ? deployer(a.worker, a.sha, a.repo) : Promise.resolve({ ok: false, detail: 'no deployer bound' }),
    version: (w) => versionOf ? versionOf(w) : Promise.resolve({ ok: false, version: null }) };
}
export function githubActionsHost({ token, repo, workflow = 'deploy-workers.yml', ref = 'main', fetch: f = fetch }) {  // credential-free route: GitHub's own run token does the deploy
  return { id: 'github-actions', kind: 'ci',
    async health() { if (!token || !repo) return { ok: false, detail: 'no GitHub credential' }; const r = await gh(f, token, 'GET', `/repos/${repo}/actions/workflows/${workflow}`); return { ok: r.status === 200, detail: 'HTTP ' + r.status }; },
    async deploy({ sha }) { const r = await gh(f, token, 'POST', `/repos/${repo}/actions/workflows/${workflow}/dispatches`, { ref }); return r.status === 204 ? { ok: true, async: true, detail: 'dispatched ' + workflow + (sha ? ' for ' + String(sha).slice(0, 7) : '') } : { ok: false, detail: 'dispatch HTTP ' + r.status }; } };
}
export function gcpHost({ url, token, fetch: f = fetch }) {  // Cloud Run adapter (platform/adapters/gcp): /health, and /hook/github to be woken by repo events
  return { id: 'gcp', kind: 'runtime',
    async health() { if (!url) return { ok: false, detail: 'GCP_ADAPTER_URL not set' }; const r = await f(url.replace(/\/$/, '') + '/health'); return { ok: r.status === 200, detail: 'HTTP ' + r.status }; },
    async deploy({ worker, sha }) { if (!url || !token) return { ok: false, detail: 'GCP deploy hook not configured' }; const r = await f(url.replace(/\/$/, '') + '/tick', { method: 'POST', headers: { 'x-tick-token': token } }); return r.status === 200 ? { ok: true, detail: 'tick run on gcp for ' + worker + '@' + String(sha || '').slice(0, 7) } : { ok: false, detail: 'gcp HTTP ' + r.status }; } };
}

// ---- registry with failover ----
export function createHosts(list, { db = null, now = Date.now } = {}) {
  const hosts = list.map(assertHost);
  return {
    hosts, get: (id) => hosts.find(h => h.id === id) || null,
    async deploy(a, { prefer } = {}) {  // first healthy host wins; a failed host is recorded and the next one is tried
      const order = [...hosts].sort((x, y) => (x.id === prefer ? -1 : 0) - (y.id === prefer ? -1 : 0)), tried = [];
      for (const h of order) {
        let r; try { r = await h.deploy(a); } catch (e) { r = { ok: false, detail: String(e && e.message || e) }; }
        await record(db, now, { host: h.id, kind: r.ok ? 'deploy' : 'deploy_failed', worker: a.worker, repo: a.repo, sha: a.sha, ok: r.ok, detail: r.detail });
        tried.push(`${h.id}: ${r.ok ? 'ok' : r.detail}`);
        if (r.ok) return { ...r, host: h.id, tried };
      }
      return { ok: false, detail: tried.join('; ') || 'no host registered', tried };
    },
    async probe() { const out = []; for (const h of hosts) { let r; try { r = await h.health(); } catch (e) { r = { ok: false, detail: String(e && e.message || e) }; }
      // HOSTS-SUBREQ-1: a probe that failed on this invocation's own subrequest limit says nothing about the host. It is recorded as unmeasured ('health-skip'), never as a host down.
      if (!r.ok && /Too many subrequests/i.test(String(r.detail))) r = { ok: false, unmeasured: true, detail: 'not probed: this invocation had no subrequests left' };
      out.push({ host: h.id, ...r }); await record(db, now, { host: h.id, kind: r.unmeasured ? 'health-skip' : 'health', ok: r.ok, detail: r.detail }); } return out; },
  };
}
async function record(db, now, e) {
  if (!db) return;
  try { await db.prepare('INSERT INTO host_events (at, host, kind, worker, repo, sha, ok, detail) VALUES (?,?,?,?,?,?,?,?)').bind(now(), e.host, e.kind, e.worker || null, e.repo || null, e.sha || null, e.ok === false ? 0 : 1, String(e.detail || '').slice(0, 300)).run(); if (prunedDay !== (prunedDay = Math.floor(now() / 864e5))) await db.prepare('DELETE FROM host_events WHERE at < ?').bind(now() - 30 * 864e5).run(); return { recorded: true }; } catch (err) { console.error('host_events', err && err.message); return { recorded: false, error: String(err && err.message).slice(0, 120) }; }  // allow-silent: the event ledger cannot record its own write failure; the caller gets it back and the Worker log keeps it
}
export const recordHostEvent = record;

// ---- host -> repo: commit status first-class, check run when the credential allows it ----
export async function reportStatus({ fetch: f = fetch, token, repo, sha, context, state, description, url = null }) {
  if (!token || !repo || !sha) return { ok: false, detail: 'no credential, repo or sha' };
  const st = { success: 'success', failure: 'failure', pending: 'pending', error: 'error' }[state] || 'error', desc = String(description || '').slice(0, 140);
  const cr = await gh(f, token, 'POST', `/repos/${repo}/check-runs`, { name: context, head_sha: sha, status: st === 'pending' ? 'in_progress' : 'completed', ...(st === 'pending' ? {} : { conclusion: st === 'success' ? 'success' : 'failure' }), output: { title: context, summary: desc }, ...(url ? { details_url: url } : {}) }).catch(() => null);
  if (cr && cr.status === 201) return { ok: true, via: 'check-run' };
  const s = await gh(f, token, 'POST', `/repos/${repo}/statuses/${sha}`, { state: st, context, description: desc, ...(url ? { target_url: url } : {}) }).catch(() => null);
  return s && s.status === 201 ? { ok: true, via: 'status' } : { ok: false, detail: 'status HTTP ' + (s && s.status) };
}
// wraps a deployer so every deploy it makes is reported on the commit (used by the handoff lane and by push deploys)
export function reporting(deployer, { fetch: f = fetch, token, host = 'cloudflare' }) {
  return async (worker, sha, repo) => {
    const ctx = `ultrastable/deploy/${worker}`;
    await reportStatus({ fetch: f, token, repo, sha, context: ctx, state: 'pending', description: 'deploying to ' + host });
    const r = await deployer(worker, sha, repo);
    await reportStatus({ fetch: f, token, repo, sha, context: ctx, state: r.ok ? 'success' : 'failure', description: r.ok ? `deployed ${r.version || ''} on ${host}`.trim() : String(r.detail || 'deploy failed') });
    return r;
  };
}

// ---- repo -> host ----
export function workersTouched(topo, files) {
  const dirs = (topo.workers || []).filter(w => w.state === 'live').map(w => ({ id: w.id, dir: String(w.main).split('/').slice(0, -1).join('/') + '/' }));
  const hit = new Set();
  for (const f of files) for (const d of dirs) if (f.startsWith(d.dir) || f === 'doctrine/topology.json') hit.add(d.id);
  return [...hit];
}
export function pushFiles(payload) { const s = new Set(); for (const c of (payload.commits || [])) for (const k of ['added', 'modified', 'removed']) for (const f of (c[k] || [])) s.add(f); return [...s]; }

// a signed push to the default branch: deploy the touched workers through the host chain and report each on the commit
export async function onPush({ db, registry, token, fetch: f = fetch, payload, now = Date.now }) {
  const repo = payload.repository && payload.repository.full_name, sha = payload.after, branch = payload.repository && payload.repository.default_branch;
  if (!repo || !sha || payload.ref !== 'refs/heads/' + (branch || 'main') || /^0+$/.test(sha)) return { status: 'ignored' };
  if (!token) return { status: 'no-token' };
  const tr = await f(`${API}/repos/${repo}/contents/doctrine/topology.json?ref=${sha}`, { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github.raw', 'user-agent': 'ultrastable-hosts' } });
  if (tr.status !== 200) return { status: 'no-topology', http: tr.status };
  let topo; try { topo = JSON.parse(await tr.text()); } catch { return { status: 'bad-topology' }; }
  const all = workersTouched(topo, pushFiles(payload)), targets = all.slice(0, MAX_DEPLOYS_PER_PUSH), out = { status: 'ok', sha: sha.slice(0, 7), targets, deferred: all.slice(MAX_DEPLOYS_PER_PUSH), results: [] };
  for (const w of targets) {
    const done = db && await db.prepare("SELECT 1 AS x FROM host_events WHERE worker = ? AND sha = ? AND kind = 'deploy' AND ok = 1").bind(w, sha).first().catch(() => null);
    if (done) { out.results.push({ w, skipped: 'already deployed at this sha' }); continue; }
    const ctx = `ultrastable/deploy/${w}`;
    await reportStatus({ fetch: f, token, repo, sha, context: ctx, state: 'pending', description: 'push webhook: deploying' });
    const r = await registry.deploy({ worker: w, sha, repo });
    await reportStatus({ fetch: f, token, repo, sha, context: ctx, state: r.ok ? 'success' : 'failure', description: r.ok ? `deployed on ${r.host}${r.async ? ' (dispatched)' : ''}` : r.detail });
    out.results.push({ w, ok: r.ok, host: r.host, detail: r.detail });
  }
  return out;
}
// a failed workflow run is reported on its commit as a failing status the repo can see and the lane can act on
export async function onWorkflowRun({ token, fetch: f = fetch, payload }) {
  const run = payload.workflow_run; if (!run || run.conclusion !== 'failure') return { status: 'ignored' };
  return reportStatus({ fetch: f, token, repo: payload.repository.full_name, sha: run.head_sha, context: 'ultrastable/workflow/' + String(run.name).slice(0, 60), state: 'failure', description: 'workflow failed; the operations role owns it', url: run.html_url });
}

// host -> repo, inbound: any host posts { host, worker, sha, repo, state, detail, url } signed with HOST_WEBHOOK_SECRET (Workers Builds, Cloud Build, a custom runner)
export async function onHostEvent({ db, token, fetch: f = fetch, event, now = Date.now }) {
  const e = event || {}; if (!e.host || !e.sha || !e.repo) return { status: 'bad-event' };
  const state = ['success', 'failure', 'pending'].includes(e.state) ? e.state : 'error';
  await record(db, now, { host: String(e.host).slice(0, 40), kind: 'inbound', worker: e.worker, repo: e.repo, sha: e.sha, ok: state !== 'failure' && state !== 'error', detail: e.detail });
  if (state === 'success') await record(db, now, { host: String(e.host).slice(0, 40), kind: 'deploy', worker: e.worker, repo: e.repo, sha: e.sha, ok: true, detail: 'reported by host' });
  const r = await reportStatus({ fetch: f, token, repo: e.repo, sha: e.sha, context: `ultrastable/host/${String(e.host).slice(0, 40)}${e.worker ? '/' + String(e.worker).slice(0, 40) : ''}`, state, description: e.detail || state, url: e.url || null });
  return { status: 'recorded', reported: r };
}

// ---- health and stall detection: runs inside the tick as loop 'hosts' ----
export async function watchHosts({ db, registry, token, repo, fetch: f = fetch, now = Date.now, stallMs = STALL_MS }) {
  const health = await registry.probe(), out = { status: 'ok', health, stalled: [] };
  if (!db) return out;
  const down = health.filter(h => !h.ok && !h.unmeasured).map(h => h.host);
  if (health.some(h => h.unmeasured)) out.unmeasured = health.filter(h => h.unmeasured).map(h => h.host);
  // stall: the newest push to the default branch has no successful deploy event after stallMs although a host is healthy
  const push = await db.prepare("SELECT at, sha FROM host_events WHERE kind = 'inbound' AND worker IS NULL AND host = 'github' ORDER BY at DESC LIMIT 1").first().catch(() => null);
  if (push) {
    const dep = await db.prepare("SELECT 1 AS x FROM host_events WHERE kind = 'deploy' AND ok = 1 AND at >= ?").bind(push.at).first().catch(() => null);
    if (!dep && now() - push.at > stallMs && health.some(h => h.ok)) {
      const r = await registry.deploy({ worker: '*', sha: push.sha, repo }, { prefer: 'github-actions' });  // re-wake through the credential-free host
      await record(db, now, { host: r.host || 'none', kind: 'stall', repo, sha: push.sha, ok: r.ok, detail: 'no deploy ' + Math.round((now() - push.at) / 60e3) + ' min after push; ' + (r.ok ? 'redispatched' : r.detail) });
      out.stalled.push({ sha: String(push.sha).slice(0, 7), redispatched: r.ok });
    }
  }
  // repo/host state mismatch: a handoff stuck in deploy_failed whose target worker has a successful deploy event since is returned to 'merged', so the lane re-runs the live probe and closes it on the evidence
  out.reconciled = [];
  const stuck = (await db.prepare("SELECT id, deploy, updated_at FROM handoffs WHERE state = 'deploy_failed' LIMIT 10").all().catch(() => ({ results: [] }))).results || [];
  for (const h of stuck) {
    const ws = String(h.deploy || '').split(',').map(x => x.trim()).filter(Boolean); if (!ws.length) continue;
    const since = Date.parse(String(h.updated_at).replace(' ', 'T') + (String(h.updated_at).includes('Z') ? '' : 'Z')) || 0;
    let all = true; for (const w of ws) { const e = await db.prepare("SELECT 1 AS x FROM host_events WHERE worker = ? AND kind = 'deploy' AND ok = 1 AND at > ?").bind(w, since).first().catch(() => null); if (!e) all = false; }
    if (all) { await db.prepare("UPDATE handoffs SET state = 'merged' WHERE id = ?").bind(h.id).run(); await db.prepare("INSERT INTO handoff_events (handoff_id, state, detail) VALUES (?,?,?)").bind(h.id, 'merged', 'HOSTS-1: a host reported a successful deploy of every target; re-running the live probe').run().catch(() => null); out.reconciled.push(h.id); }
  }
  if (down.length) { out.status = 'host-down'; out.down = down; }
  if (token && repo && down.length) await reportStatus({ fetch: f, token, repo, sha: (push && push.sha) || undefined, context: 'ultrastable/hosts/health', state: 'failure', description: 'host(s) down: ' + down.join(', ') }).catch(() => null);
  return out;
}

// ---- integrations set up and kept by the server itself (no client agent, no pasted secret) ----
// The webhook secrets are derived inside the Worker: HMAC(CREDENTIAL_KEY, purpose). Nothing is stored or printed; the Worker signs and verifies with the same derivation,
// and the reconciler writes the derived value to GitHub when it creates or repairs the hook. A bound GITHUB_WEBHOOK_SECRET / HOST_WEBHOOK_SECRET still wins (legacy hooks).
export async function hookSecret(env, purpose) {
  const bound = purpose === 'github' ? env.GITHUB_WEBHOOK_SECRET : env.HOST_WEBHOOK_SECRET; if (bound) return bound;
  if (!env.CREDENTIAL_KEY) return '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.CREDENTIAL_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('ultrastable-hook:' + purpose))), b => b.toString(16).padStart(2, '0')).join('');
}
// Every secret a delivery to /hook/github may be signed with: a bound one, the GitHub App's own webhook secret (registered by the manifest flow and
// sealed in the credential store; the App's webhook is the hook that delivers today), and the derived one the reconciler writes on repo hooks.
export async function githubHookSecrets(env, appMaterial = null) {
  const out = [];
  if (env.GITHUB_WEBHOOK_SECRET) out.push(env.GITHUB_WEBHOOK_SECRET);
  try { const m = appMaterial ? await appMaterial() : null; if (m && m.secret && m.secret.webhook_secret) out.push(m.secret.webhook_secret); } catch (e) { /* allow-silent: an unreadable App secret leaves the bound and derived secrets; verification still runs and a bad signature still answers 401 */ console.error('app webhook secret', e && e.message); }
  const d = await hookSecret({ CREDENTIAL_KEY: env.CREDENTIAL_KEY }, 'github'); if (d) out.push(d);
  return [...new Set(out)];
}
export async function verifyAny(verify, secrets, body, header) { for (const s of secrets) if (await verify(s, body, header)) return true; return false; }
// FREE-TIER-1: workflow_run is not subscribed. Every workflow run sends three deliveries, each one a request on the site Worker and one on the tick Worker;
// with the repository's own workflows starting each other that was about 130 deliveries a minute (9,000 requests an hour against 100,000 a day, 00:31 UTC 2026-11-18).
// A failed run still reaches operations through ciwatch and the tick's lane; onWorkflowRun stays for hosts that post it themselves.
export const HOOK_EVENTS = ['push', 'pull_request', 'issues', 'issue_comment', 'release'];
const HOOKS_TAG = 'ev:' + HOOK_EVENTS.join(',') + ' ';  // a change of the event list is reconciled on the next tick, not after the hourly freshness window
// create the repository webhook when missing, repair it when GitHub says its last delivery failed or its url/events drifted; a token without hook rights is recorded plainly
export async function reconcileHooks({ db = null, token, repos, origin = 'https://ultrastable.io', secret, fetch: f = fetch, now = Date.now, everyMs = 3600e3 }) {
  const out = { status: 'ok', repos: {} };
  if (!token || !secret) return { status: 'no-credential', why: !token ? 'no GitHub credential' : 'no derivable secret (CREDENTIAL_KEY unbound)' };
  if (db) { const last = await db.prepare("SELECT at FROM host_events WHERE kind = 'hooks' AND detail LIKE ? ORDER BY at DESC LIMIT 1").bind(HOOKS_TAG + '%').first().catch(() => null); if (last && now() - last.at < everyMs) return { status: 'fresh' }; }
  const url = origin.replace(/\/$/, '') + '/hook/github', body = { active: true, events: HOOK_EVENTS, config: { url, content_type: 'json', secret, insecure_ssl: '0' } };
  for (const repo of repos) {
    try {
      const l = await gh(f, token, 'GET', `/repos/${repo}/hooks`);
      if (l.status === 403 || l.status === 404) { out.repos[repo] = `no hook rights (HTTP ${l.status}); polling path stays in force`; out.status = 'no-rights'; continue; }
      const mine = ((await l.json()) || []).find(h => h.config && h.config.url === url);
      if (!mine) { const c = await gh(f, token, 'POST', `/repos/${repo}/hooks`, { name: 'web', ...body }); out.repos[repo] = c.status === 201 ? 'created' : 'create HTTP ' + c.status; if (c.status !== 201) out.status = 'error'; continue; }
      const bad = mine.last_response && mine.last_response.code && (mine.last_response.code < 200 || mine.last_response.code >= 300), drift = !mine.active || HOOK_EVENTS.some(e => !(mine.events || []).includes(e)) || (mine.events || []).some(e => !HOOK_EVENTS.includes(e));
      if (bad || drift) { const c = await gh(f, token, 'PATCH', `/repos/${repo}/hooks/${mine.id}`, body); out.repos[repo] = (c.status === 200 ? 'repaired' : 'repair HTTP ' + c.status) + (bad ? ' (last delivery ' + mine.last_response.code + ')' : ' (drift)'); if (c.status !== 200) out.status = 'error'; }
      else out.repos[repo] = 'present';
    } catch (e) { out.repos[repo] = 'error: ' + String(e && e.message).slice(0, 100); out.status = 'error'; }
  }
  await record(db, now, { host: 'github', kind: 'hooks', ok: out.status !== 'error', detail: HOOKS_TAG + JSON.stringify(out.repos).slice(0, 220) });
  return out;
}
