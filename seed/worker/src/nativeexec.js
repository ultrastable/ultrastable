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

export async function runNative(env, { fetchImpl = fetch, agent = runCodeAgent } = {}) {
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
  return { ok: true, detail: 'idle: every top item already has a worker branch' };
}
