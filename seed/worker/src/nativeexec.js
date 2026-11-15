// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// ZERO-MINUTES-1 step 2: the Worker-native executor. One tick = take the top item of ops/priority-queue.json that has no worker branch yet, ask the Workers AI
// code agent for a change, apply it under a path guard through the GitHub contents API and open a PR whose provenance host is cloudflare-worker.
// No Actions minutes and no person's machine. The lane/sweeper merge the PR on green. Needs the same installation token the lane uses; without one it
// reports not-configured and the Actions executor stays the fallback.
import { runCodeAgent } from './codeagent.js';

const API = 'https://api.github.com';
export const PROTECTED = ['.github/', 'autonomy/', 'doctrine/server-side.json'];
export const MAX_FILES = 3, MAX_BYTES = 60000, CANDIDATES = 6;

export function guard(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('no files in the change');
  if (files.length > MAX_FILES) throw new Error(`too many files (${files.length} > ${MAX_FILES})`);
  for (const f of files) {
    const p = String(f.path || '');
    if (!p || p.startsWith('/') || p.includes('..') || p.includes('\\') || /^[a-z]:/i.test(p)) throw new Error('unsafe path: ' + p);
    if (PROTECTED.some(x => p === x || p.startsWith(x))) throw new Error('protected path: ' + p);
    if (typeof f.content !== 'string' || f.content.length > MAX_BYTES) throw new Error('bad or oversized content: ' + p);
  }
  // NATIVE-CODE-ONLY-1: the executor's job is code a loop runs. A change set that is only prose (specs/, docs/, *.md, *.txt) is an orphan document by
  // doc-consumed rules; PR #433 merged one for an item that needed Worker code (see the removed ledger in doctrine/doc-consumers.json). Refused, so the item is retried.
  if (files.every(f => /^(specs|docs)\//.test(String(f.path)) || /\.(md|txt)$/i.test(String(f.path)))) throw new Error('documentation-only change: the executor produces code, data or tests that a loop consumes');
  return files;
}

// NATIVE-SHRINK-GUARD-1: the model answers with whole files, and a small model drops what it did not see (#352 removed codeagent.js exports,
// #348/#379/#389 cut doctrine/market.json to four keys). A change that removes most of an existing file, a JSON top-level key or a JS export is refused.
const exportsOf = t => new Set([...t.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
export function shrinkGuard(path, before, after) {
  if (before == null) return;
  if (after.length < before.length * 0.5) throw new Error(`shrink: ${path} would lose ${before.length - after.length} of ${before.length} bytes`);
  if (/\.json$/.test(path)) {
    let a, b;
    try { a = JSON.parse(before); b = JSON.parse(after); } catch { throw new Error(`shrink: ${path} is not valid JSON after the change`); }
    if (a && b && typeof a === 'object' && !Array.isArray(a)) {
      const lost = Object.keys(a).filter(k => !(k in b));
      if (lost.length) throw new Error(`shrink: ${path} drops keys ${lost.slice(0, 5).join(', ')}`);
    }
  }
  if (/\.(m?js)$/.test(path)) {
    const now = exportsOf(after), lost = [...exportsOf(before)].filter(n => !now.has(n));
    if (lost.length) throw new Error(`shrink: ${path} drops exports ${lost.slice(0, 5).join(', ')}`);
  }
}

// A file: done check that already passes on main means the item is finished; re-working it only churns (Q-GROW-second-tenant-deploying ran 4 times).
export function doneOnMain(body, exists) {
  const m = /\*\*Done check:\*\*\s*file:(\S+)/.exec(body || '');
  return Boolean(m && exists(m[1].replace(/[;,.]$/, '')));
}

const b64 = s => btoa(unescape(encodeURIComponent(s)));
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));

export function buildPrompt(item, current) {
  return `You are the Ultrastable executor. Make the smallest complete change that closes this item.\n\nITEM ${item.id}: ${item.title}\n${item.body}\n\n` +
    (current ? `CURRENT ${current.path}:\n${current.content.slice(0, 20000)}\n\n` : '') +
    `Answer with one JSON object only: {"summary": string, "files": [{"path": string, "content": string}]} (full file contents, at most ${MAX_FILES} files, never under .github/ or autonomy/).`;
}

export const nativeProvider = {
  id: 'worker-native',
  available: env => Boolean(env.GITHUB_DISPATCH_TOKEN && env.AI),
  async dispatch(env, fetchImpl = fetch) { return runNative(env, { fetchImpl }); },
};

// CODE-QUEUE-1: the in-tick doer parks every item that needs a code change as `needs-code:` in D1, and before this nothing read them: the
// executor reported "idle" every tick while 66 such items waited (2026-11-15). The executor now takes them too, alternating with the repo
// queue each 10-minute slot so neither starves. A taken item is marked `in-pr: <url>`; its PR carries a ## Handoff block so the server's
// handoff closer closes the item after merge and deploy. A PR closed without merge returns the item to `needs-code:` for the next attempt.
export const DB_CANDIDATES = 6;
const PATH_RE = /\b(?:[\w.-]+\/)+[\w.-]+\.(?:m?js|py|json|sql|toml|md)\b/g;
export const pathsIn = text => [...new Set(String(text || '').match(PATH_RE) || [])].slice(0, 4);
export const deployFor = paths => [...new Set(paths.map(p => p.startsWith('seed/worker/') ? 'ultrastable-tick' : p.startsWith('site/') ? 'ultrastable-site' : p.startsWith('dashboard/') ? 'ultrastable-dashboard' : null).filter(Boolean))].join(', ');

export async function reopenClosedUnmerged(db) {
  if (!db) return 0;
  const r = await db.prepare(`UPDATE items SET blocker = 'needs-code: previous PR closed without merge; retried by worker-native', updated_at = datetime('now')
    WHERE status = 'blocked' AND blocker LIKE 'in-pr:%' AND id IN (SELECT item FROM handoffs WHERE state = 'closed_unmerged' AND item IS NOT NULL)`).run().catch(() => null);
  return (r && r.meta && r.meta.changes) || 0;
}

export async function runNative(env, { fetchImpl = fetch, agent = runCodeAgent, now = Date.now() } = {}) {
  const lanes = [() => runRepoQueue(env, { fetchImpl, agent }), () => runDbQueue(env, { fetchImpl, agent, now })];
  if (Math.floor(now / 600000) % 2 === 0) lanes.reverse();   // even slot: D1 backlog first
  let last = null;
  for (const lane of lanes) { last = await lane(); if (!last.idle) return last; }
  return { ok: true, detail: 'idle: repo queue worked and no needs-code item in the backlog' + (last && last.note ? ' (' + last.note + ')' : '') };
}

function github(env, fetchImpl) {
  const repo = env.GITHUB_REPO || 'ultrastable/ultrastable';
  const call = async (method, path, body) => {
    const r = await fetchImpl(API + path, { method, headers: { authorization: 'Bearer ' + env.GITHUB_DISPATCH_TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-native-executor', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : null };
  };
  const file = async path => { const r = await call('GET', `/repos/${repo}/contents/${path}?ref=main`); return r.ok && r.json && r.json.content ? { path, sha: r.json.sha, content: unb64(r.json.content) } : null; };
  return { repo, call, file };
}

async function openPr({ repo, call, file }, { id, branch, change, title, extraBody = '' }) {
  const main = await call('GET', `/repos/${repo}/git/ref/heads/main`);
  if (!main.ok) return { ok: false, detail: 'cannot read main ref ' + main.status };
  const mk = await call('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: main.json.object.sha });
  if (!mk.ok) return { ok: false, detail: `branch ${branch}: HTTP ${mk.status}` };
  for (const f of change.files) {
    const have = await call('GET', `/repos/${repo}/contents/${f.path}?ref=${branch}`);
    const put = await call('PUT', `/repos/${repo}/contents/${f.path}`, { message: `${id}: ${String(change.summary).slice(0, 80)}`, content: b64(f.content), branch, ...(have.ok && have.json.sha ? { sha: have.json.sha } : {}) });
    if (!put.ok) return { ok: false, detail: `${id}: write ${f.path} HTTP ${put.status}` };
  }
  const body = `${id}: ${change.summary}\n\nWritten by the Worker-native executor (host: cloudflare-worker, agent: ${change.adapter}); no Actions minutes used.\n\n## Self-audit\nReal output: unverified until checks run; the lane merges only on green.\nNot thinking about: whether the model's change is the smallest complete one; the checks and the reviewer decide.\n${extraBody}`;
  const pr = await call('POST', `/repos/${repo}/pulls`, { title: `${id}: ${String(title).replace(/^[^:]+:\s*/, '').slice(0, 90)}`, head: branch, base: 'main', body });
  return pr.ok ? { ok: true, number: pr.json.number, url: pr.json.html_url || `https://github.com/${repo}/pull/${pr.json.number}`, detail: `opened ${repo}#${pr.json.number} for ${id} via ${change.adapter}` } : { ok: false, detail: `pull request: HTTP ${pr.status}` };
}

export async function runDbQueue(env, { fetchImpl = fetch, agent = runCodeAgent, now = Date.now() } = {}) {
  const db = env.DB;
  if (!db) return { idle: true, ok: true, note: 'no DB binding' };
  const reopened = await reopenClosedUnmerged(db);
  const rows = (await db.prepare(`SELECT id, title, kind, owner_role, done_check, closing_probe, blocker FROM items WHERE status = 'blocked' AND blocker LIKE 'needs-code:%'
    ORDER BY priority DESC, updated_at ASC LIMIT ?`).bind(DB_CANDIDATES).all()).results || [];
  if (!rows.length) return { idle: true, ok: true, note: reopened ? `${reopened} reopened` : '' };
  const gh = github(env, fetchImpl);
  const it = rows[0];
  const text = `${it.title}\n${it.done_check || ''}\n${it.closing_probe || ''}\n${it.blocker || ''}`;
  let cur = null;
  for (const p of pathsIn(text)) { cur = await gh.file(p); if (cur) break; }
  const body = `**Done check:** ${it.done_check || 'none'}\n**Closing probe:** ${it.closing_probe || 'none'}\n**Triage:** ${String(it.blocker || '').replace(/^needs-code:\s*/, '')}\n**Role:** ${it.owner_role}`;
  let change;
  try {
    change = await agent(env, buildPrompt({ id: it.id, title: it.title, body }, cur)); guard(change.files);
    for (const f of change.files) { const old = await gh.file(f.path); shrinkGuard(f.path, old && old.content, f.content); }
  } catch (e) {
    const why = String(e && e.message).slice(0, 200);
    await db.prepare(`UPDATE items SET blocker = ?, updated_at = datetime('now') WHERE id = ?`).bind(`needs-code: worker-native attempt failed (${why}); retried after the other candidates`, it.id).run();
    return { ok: false, detail: `${it.id}: ${why}` };
  }
  const stamp = new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const branch = `worker/${String(it.id).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60)}-${stamp}`;
  const deploy = deployFor(change.files.map(f => f.path));
  const handoff = `\n## Handoff\nitem: ${it.id}\nagent: worker-native (${change.adapter})\n${deploy ? `deploy: ${deploy}\n` : ''}`;
  const pr = await openPr(gh, { id: it.id, branch, change, title: it.title, extraBody: handoff });
  if (pr.ok) await db.prepare(`UPDATE items SET blocker = ?, updated_at = datetime('now') WHERE id = ?`).bind(`in-pr: ${pr.url} | agent: worker-native | model: ${change.model || change.adapter}`.slice(0, 400), it.id).run();
  return pr;
}

async function runRepoQueue(env, { fetchImpl = fetch, agent = runCodeAgent } = {}) {
  const repo = env.GITHUB_REPO || 'ultrastable/ultrastable';
  const call = async (method, path, body) => {
    const r = await fetchImpl(API + path, { method, headers: { authorization: 'Bearer ' + env.GITHUB_DISPATCH_TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-native-executor', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : null };
  };
  const file = async path => { const r = await call('GET', `/repos/${repo}/contents/${path}?ref=main`); return r.ok && r.json && r.json.content ? { path, sha: r.json.sha, content: unb64(r.json.content) } : null; };
  const q = await file('ops/priority-queue.json');
  if (!q) return { ok: false, detail: 'ops/priority-queue.json not readable (repo access?)' };
  const queue = JSON.parse(q.content).slice(0, CANDIDATES);
  for (const row of queue) {
    const branch = `worker/${String(row.id).toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    if ((await call('GET', `/repos/${repo}/git/ref/heads/${branch}`)).ok) continue;       // already worked: the lane/sweeper own that branch
    const rec = await file(`docs/issues/${row.id}.json`);
    if (!rec) continue;
    const item = JSON.parse(rec.content); item.body = item.body || '';
    if (/\*\*Status:\*\*\s*(closed|done|superseded)/i.test(item.body)) continue;
    const fm = /\*\*Done check:\*\*\s*file:(\S+)/.exec(item.body);
    if (fm && await file(fm[1].replace(/[;,.]$/, ''))) continue;                          // probe already passes on main: the closer closes it
    const ct = /code-task:\s*repo=\S+\s+path=(\S+)/.exec(item.body);
    const cur = ct ? await file(ct[1]) : null;
    let change;
    try {
      change = await agent(env, buildPrompt({ id: row.id, title: item.title, body: item.body }, cur)); guard(change.files);
      for (const f of change.files) { const old = await file(f.path); shrinkGuard(f.path, old && old.content, f.content); }
    }
    catch (e) { return { ok: false, detail: `${row.id}: ${String(e && e.message).slice(0, 200)}` }; }
    const main = await call('GET', `/repos/${repo}/git/ref/heads/main`);
    if (!main.ok) return { ok: false, detail: 'cannot read main ref ' + main.status };
    const mk = await call('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: main.json.object.sha });
    if (!mk.ok) return { ok: false, detail: `branch ${branch}: HTTP ${mk.status}` };
    for (const f of change.files) {
      const have = await call('GET', `/repos/${repo}/contents/${f.path}?ref=${branch}`);
      const put = await call('PUT', `/repos/${repo}/contents/${f.path}`, { message: `${row.id}: ${String(change.summary).slice(0, 80)}`, content: b64(f.content), branch, ...(have.ok && have.json.sha ? { sha: have.json.sha } : {}) });
      if (!put.ok) return { ok: false, detail: `${row.id}: write ${f.path} HTTP ${put.status}` };
    }
    const body = `${row.id}: ${change.summary}\n\nWritten by the Worker-native executor (host: cloudflare-worker, agent: ${change.adapter}); no Actions minutes used.\n\n## Self-audit\nReal output: unverified until checks run; the lane merges only on green.\nNot thinking about: whether the model's change closes the item's done check; the closing probe decides.\nFixed: issue ${row.id} stays open until its probe passes.`;
    const pr = await call('POST', `/repos/${repo}/pulls`, { title: `${row.id}: ${item.title.replace(/^[^:]+:\s*/, '').slice(0, 90)}`, head: branch, base: 'main', body });
    return pr.ok ? { ok: true, detail: `opened ${repo}#${pr.json.number} for ${row.id} via ${change.adapter}` } : { ok: false, detail: `pull request: HTTP ${pr.status}` };
  }
  return { ok: true, idle: true, detail: 'idle: every top item already has a worker branch' };
}
