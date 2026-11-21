// ZERO-MINUTES-1: the executor's work step inside the Worker. Picks the top open issue (driver order, same skip labels as foundation/executor.py),
// asks the Workers AI code agent for a change, applies it under the same path guard through the GitHub REST API and opens the PR. No Actions minute is used.
// Provider interface matches executor.js: { id, available(env), dispatch(env, fetchImpl) } -> { ok, detail }.
import { runCodeAgent, applyEdit, BLOCK_FORMAT } from './codeagent.js';

export const SKIP_LABELS = ['hold', 'blocked', 'owner', 'gate', 'identity-bound', 'wontfix', 'in-progress', 'executor-failed', 'claimed', 'dispatched'];
export const DENY_PREFIXES = ['.git/', '.github/', 'autonomy/', 'ops/executor-log'];
export const DENY_NAMES = ['.env', 'id_rsa', 'credentials'];
export const MAX_FILES = 8, MAX_BYTES = 200000;

export function safePath(p) {
  if (!p || typeof p !== 'string' || p.startsWith('/') || p.includes('\\') || p.split('/').includes('..')) return 'path escapes the repository';
  if (DENY_PREFIXES.some(d => p.startsWith(d)) || DENY_NAMES.includes(p.split('/').pop())) return 'path is on the deny list (workflows, policy, git, secrets)';
  return null;
}

export function checkEdits(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) throw new Error(`need 1..${MAX_FILES} files, got ${files ? files.length : 0}`);
  let total = 0;
  for (const f of files) {
    const why = safePath(f && f.path);
    if (why) throw new Error(`${f && f.path}: ${why}`);
    if (typeof f.content !== 'string' && !(Array.isArray(f.edits) && f.edits.length)) throw new Error(`${f.path}: content or edits required`);
    total += (f.content || '').length + (f.edits || []).reduce((a, e) => a + (e.find || '').length + (e.replace || '').length, 0);
  }
  if (total > MAX_BYTES) throw new Error('change is larger than the executor limit');
}

const names = i => (i.labels || []).map(l => (typeof l === 'string' ? l : l.name));
export function priority(i) {
  let p = 5;
  for (const n of names(i)) { const m = /^(?:p|priority[:/ -]?)(\d)$/i.exec(n); if (m) p = Math.min(p, +m[1]); }
  return [p, i.number];
}
export function pick(issues) {
  const ok = issues.filter(i => !i.pull_request && !names(i).some(n => SKIP_LABELS.includes(n)));
  return ok.sort((a, b) => { const x = priority(a), y = priority(b); return x[0] - y[0] || x[1] - y[1]; })[0] || null;
}

const b64 = s => { const u = new TextEncoder().encode(s); let t = ''; for (const c of u) t += String.fromCharCode(c); return btoa(t); };

const PATH_RE = /(?<![\w/.-])((?:[\w.-]+\/)+[\w.-]+\.(?:py|js|mjs|json|md|sh|sql|html|css|toml|yml))(?![\w/-])/g;
export const namedFiles = (issue, listing) => {
  const have = new Set(listing.split('\n')), out = [];
  for (const m of `${issue.title}\n${issue.body || ''}`.matchAll(PATH_RE)) {
    const p = m[1].replace(/^\.\//, '');
    if (!out.includes(p) && have.has(p) && !p.startsWith('docs/issues/') && !p.startsWith('ops/') && !safePath(p)) out.push(p);
  }
  return out.slice(0, 4);
};

// PATCH-EDIT-1: the model is shown the files the item names (whole when small, head and tail when long) and replies in EDIT blocks.
export function buildPrompt(issue, tree, files = {}) {
  const ctx = Object.entries(files).map(([p, t]) => `--- ${p} (${t.split('\n').length} lines${t.length > 9000 ? ', head and tail only: use EDIT blocks, never a FILE block' : ', complete'}) ---\n` + (t.length > 9000 ? t.slice(0, 4500) + '\n[... middle not shown ...]\n' + t.slice(-2500) : t)).join('\n');
  return 'You are the work step of an autonomous software organization. Resolve this issue with the smallest correct change to the repository. '
    + 'Reply in exactly this format and nothing else:\n' + BLOCK_FORMAT + '\n'
    + 'Never rewrite a whole existing file: change it with EDIT blocks whose FIND lines are copied exactly from CURRENT FILES. '
    + 'Never touch .github/, autonomy/, secrets or git files. Write tests where the change is code. Server-side only: never reference localhost or a listening port.\n\n'
    + `ISSUE #${issue.number}: ${issue.title}\n${(issue.body || '').slice(0, 6000)}\n\nREPOSITORY FILES (partial):\n${tree.slice(0, 6000)}\n`
    + (ctx ? `\nCURRENT FILES (lines not shown still exist and stay unchanged):\n${ctx}\n` : '');
}

export const prExecutor = {
  id: 'worker-pr',
  available: env => Boolean(env.AI && env.GITHUB_DISPATCH_TOKEN && env.GITHUB_REPO && env.EXECUTOR_MODE !== 'actions'),
  async dispatch(env, fetchImpl = fetch, { agent = runCodeAgent } = {}) {
    const repo = env.GITHUB_REPO;
    const gh = async (method, path, body) => {
      const r = await fetchImpl('https://api.github.com' + path, { method, headers: { authorization: 'Bearer ' + env.GITHUB_DISPATCH_TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-worker-executor', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : null };
    };
    const iss = await gh('GET', `/repos/${repo}/issues?state=open&per_page=100`);
    if (!iss.ok) return { ok: false, detail: `issues HTTP ${iss.status}` };
    const issue = pick(iss.json);
    if (!issue) return { ok: true, detail: 'idle: no open issue the executor may take' };
    const n = issue.number;
    await gh('POST', `/repos/${repo}/issues/${n}/labels`, { labels: ['in-progress'] });
    const fail = async why => {
      await gh('POST', `/repos/${repo}/issues/${n}/labels`, { labels: ['executor-failed'] });
      await gh('DELETE', `/repos/${repo}/issues/${n}/labels/in-progress`);
      await gh('POST', `/repos/${repo}/issues/${n}/comments`, { body: `executor (worker) failed: ${why.slice(0, 500)}\n\nRemove \`executor-failed\` to retry.` });
      return { ok: false, detail: `#${n}: ${why.slice(0, 200)}` };
    };
    try {
      const base = (await gh('GET', `/repos/${repo}`)).json.default_branch || 'main';
      const ref = await gh('GET', `/repos/${repo}/git/ref/heads/${base}`);
      const sha = ref.json.object.sha;
      const tree = await gh('GET', `/repos/${repo}/git/trees/${sha}?recursive=1`);
      const listing = (tree.json.tree || []).filter(t => t.type === 'blob').map(t => t.path).join('\n');
      const files = {};
      for (const p of namedFiles(issue, listing)) {
        const c = await gh('GET', `/repos/${repo}/contents/${encodeURI(p)}?ref=${encodeURIComponent(base)}`);
        if (c.ok && c.json.content) files[p] = new TextDecoder().decode(Uint8Array.from(atob(c.json.content.replace(/\n/g, '')), ch => ch.charCodeAt(0)));
      }
      const out = await agent(env, buildPrompt(issue, listing, files));
      checkEdits(out.files);
      const branch = `agent/${n}-${issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '')}`;
      const mk = await gh('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
      if (!mk.ok && mk.status !== 422) throw new Error(`branch ${mk.status}`);
      for (const f of out.files) {
        const cur = await gh('GET', `/repos/${repo}/contents/${encodeURI(f.path)}?ref=${encodeURIComponent(branch)}`);
        let content = f.content;
        if (typeof content !== 'string') {  // edits resolve against the file as it stands on the branch; a missed place fails the item rather than guessing
          if (!cur.ok || !cur.json.content) throw new Error(`${f.path}: edits need an existing file`);
          content = new TextDecoder().decode(Uint8Array.from(atob(cur.json.content.replace(/\n/g, '')), ch => ch.charCodeAt(0)));
          for (const ed of f.edits) content = applyEdit(content, String(ed.find || ''), String(ed.replace || ''), f.path);
        }
        const put = await gh('PUT', `/repos/${repo}/contents/${encodeURI(f.path)}`, { message: `${out.summary || issue.title} (#${n})`.slice(0, 200), content: b64(content), branch, ...(cur.ok && cur.json.sha ? { sha: cur.json.sha } : {}) });
        if (!put.ok) throw new Error(`write ${f.path} HTTP ${put.status}`);
      }
      const pr = await gh('POST', `/repos/${repo}/pulls`, { title: `${out.summary || issue.title} (#${n})`.slice(0, 200), head: branch, base, body: `Closes #${n}\n\nOpened by the Worker executor (${out.adapter}); zero Actions minutes. The Worker gate checks it and the lane merges on green.` });
      if (!pr.ok) throw new Error(`pr ${pr.status}`);
      return { ok: true, detail: `#${n} -> PR ${pr.json.html_url}`, pr: pr.json.html_url };
    } catch (e) { return fail(String(e && e.message)); }
  },
};
