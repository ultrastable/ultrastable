// ZERO-MINUTES-1: the core of `checks` that needs only the PR diff, run in the Worker through the REST API: path guard on agent branches,
// secret scan of added lines, file count and size limits, no workflow edit without the protected-change line. Posts commit status `worker-gate`.
// The full repository checks stay in Actions as a second route; the lane merges on green worker-gate when ZERO_ACTIONS=1 (Actions minutes exhausted).
import { safePath } from './pr-executor.js';

export const SECRET_RES = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /gh[pousr]_[A-Za-z0-9]{36,}/, /AKIA[0-9A-Z]{16}/, /sk-ant-[A-Za-z0-9_-]{20,}/];
export const MAX_PR_FILES = 60, MAX_ADDED_BYTES = 400000;

export function evaluate(files, { agentBranch = false, body = '' } = {}) {
  const bad = [];
  if (files.length > MAX_PR_FILES) bad.push(`${files.length} files exceeds ${MAX_PR_FILES}`);
  let added = 0;
  for (const f of files) {
    const p = f.filename || '';
    if (agentBranch && f.status !== 'removed') { const why = safePath(p); if (why) bad.push(`${p}: ${why}`); }
    if (!agentBranch && p.startsWith('.github/workflows/') && !/^Protected-change:\s*\S/m.test(body)) bad.push(`${p}: protected path without a Protected-change: line`);
    const patch = f.patch || '';
    added += patch.length;
    for (const line of patch.split('\n')) if (line.startsWith('+') && SECRET_RES.some(r => r.test(line))) { bad.push(`${p}: secret-like content`); break; }
  }
  if (added > MAX_ADDED_BYTES) bad.push('diff larger than the gate limit');
  return { ok: bad.length === 0, bad };
}

export async function runGate({ token, repos = [], fetch: f = fetch, context = 'worker-gate', maxPrs = 10 }) {
  if (!token) return { status: 'no-token', checked: [], errors: [] };
  const gh = async (method, path, body) => {
    const r = await f('https://api.github.com' + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-gate', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : null };
  };
  const out = { status: 'ok', checked: [], errors: [] };
  for (const repo of repos) {
    const prs = await gh('GET', `/repos/${repo}/pulls?state=open&per_page=30`);
    if (!prs.ok) { out.errors.push(`${repo} pulls ${prs.status}`); continue; }
    for (const pr of prs.json.slice(0, maxPrs)) {
      const sha = pr.head.sha;
      const st = await gh('GET', `/repos/${repo}/commits/${sha}/statuses?per_page=30`);
      if (st.ok && st.json.some(s => s.context === context)) continue; // already judged this commit
      const files = await gh('GET', `/repos/${repo}/pulls/${pr.number}/files?per_page=100`);
      if (!files.ok) { out.errors.push(`${repo}#${pr.number} files ${files.status}`); continue; }
      const v = evaluate(files.json, { agentBranch: /^(agent|claude)\//.test(pr.head.ref), body: pr.body || '' });
      const post = await gh('POST', `/repos/${repo}/statuses/${sha}`, { state: v.ok ? 'success' : 'failure', context, description: (v.ok ? 'diff gate passed' : v.bad.join('; ')).slice(0, 140) });
      if (!post.ok) { out.errors.push(`${repo}#${pr.number} status ${post.status}`); continue; }
      out.checked.push(`${repo}#${pr.number} ${v.ok ? 'success' : 'failure'}`);
    }
  }
  if (out.errors.length) out.status = 'errors';
  return out;
}
