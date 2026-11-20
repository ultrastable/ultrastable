// ZERO-MINUTES-1: the core of `checks` that needs only the PR diff, run in the Worker through the REST API: path guard on agent branches,
// secret scan of added lines, file count and size limits, no workflow edit without the protected-change line. Posts commit status `worker-gate`.
// The full repository checks stay in Actions as a second route; the lane merges on green worker-gate when ZERO_ACTIONS=1 (Actions minutes exhausted).
import { safePath } from './pr-executor.js';

// Q-GATE-403: writing a commit status needs the App permission "Commit statuses: Read and write" (API name `statuses`). An installation without it
// answers 403 on every pull request, so the gate judges nothing. That is one condition, not one error per pull request: the result names the
// permission, and the tick keeps one gate card GATE-APP-PERMISSION with the consent link while the lane merges on local-checks evidence.
export const STATUS_PERMISSION = 'statuses';
export const forbiddenDetail = (repo, n) => `${repo}#${n} status 403: the GitHub App lacks ${STATUS_PERMISSION}:write`;
// Model-written branches: the Actions executor and code agents push agent/* and claude/*, the Worker-native executor pushes worker/*.
export const MODEL_BRANCH_RE = /^(agent|claude|worker)\//;
// NATIVE-STUB-1 at the gate (GATE-STUB-1): an added line of a model branch that is an elision marker or a "logic here" placeholder fails the gate,
// whichever executor wrote it (#725 replaced this file with "// ... existing code ..." through the Actions executor, which has no shrink guard).
export const STUB_RES = [/(?:\/\/|#|\/\*)\s*\.\.\.\s*(?:existing|rest of|remaining|unchanged)[^\n]*/i, /(?:\/\/|#)\s*(?:TODO:?\s*)?implement\b[^\n]*\bhere\b/i, /(?:\/\/|#)\s*(?:your|add)\s+(?:code|logic|implementation)\s+here/i];
export function stubLines(files) {
  const bad = [];
  for (const f of files) {
    const added = String(f.patch || '').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)).join('\n');
    const hit = STUB_RES.map(r => r.exec(added)).find(Boolean);
    if (hit && !/\.(?:md|txt)$|(?:^|\/)tests?\/|\.test\.m?js$/.test(f.filename || '')) bad.push(`${f.filename}: placeholder (${hit[0].trim().slice(0, 50)})`);
  }
  return bad;
}

export const SECRET_RES = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /gh[pousr]_[A-Za-z0-9]{36,}/, /AKIA[0-9A-Z]{16}/, /sk-ant-[A-Za-z0-9_-]{20,}/];
export const MAX_PR_FILES = 60, MAX_ADDED_BYTES = 400000;
// Q-LESSON-PATCH-GATE (LESSONS-1): 93 fleet failure modes came from a model editing very large files that were checked for syntax only.
// A model-authored branch passes only when no file over MAX_MODEL_EDIT_BYTES (before or after) is edited and every changed .js file parses.
export const MAX_MODEL_EDIT_BYTES = 60 * 1024;
export const JS_RE = /\.(m|c)?js$/;

// The strongest syntax check a Worker can run. `node --check` is the real one, but a Worker has no child process, and eval and
// new Function are refused (and cannot parse module syntax anyway). This scanner walks strings, template literals (with nested ${}),
// comments and regex literals and requires every bracket to close in order. Limit: it catches truncated files, unbalanced splices and
// unterminated strings, not grammar errors inside balanced code (a missing comma, a call to an undefined helper). The Actions route
// (`checks`, or `python3 -m foundation checksrun`) and the injectable `syntax` option of checkModelEdits run `node --check` where Node exists.
// Follow-up (named in the item's evidence): running the tests next to a changed file needs a Node runtime, so it stays with `checks`.
export function jsShapeCheck(src) {
  const stack = [], pairs = { ')': '(', ']': '[', '}': '{' };
  const REGEX_AFTER_WORD = /(?:^|[^\w$.])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
  let i = 0, line = 1, last = ''; // last significant token kind: 'v' value (division follows), 'o' operator (regex may follow)
  const fail = (why) => `line ${line}: ${why}`;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return fail('unterminated comment'); line += (src.slice(i, e).match(/\n/g) || []).length; i = e + 2; continue; }
    if (c === '"' || c === "'") {
      i++; while (i < src.length && src[i] !== c) { if (src[i] === '\n') return fail('unterminated string'); i += src[i] === '\\' ? 2 : 1; }
      if (i >= src.length) return fail('unterminated string'); i++; last = 'v'; continue;
    }
    if (c === '`' || (c === '}' && stack[stack.length - 1] === '${')) {
      if (c === '}') stack.pop();
      i++; while (i < src.length && src[i] !== '`' && !(src[i] === '$' && src[i + 1] === '{')) { if (src[i] === '\n') line++; i += src[i] === '\\' ? 2 : 1; }
      if (i >= src.length) return fail('unterminated template literal');
      if (src[i] === '`') { i++; last = 'v'; } else { stack.push('${'); i += 2; last = 'o'; }
      continue;
    }
    if (c === '/' && (last !== 'v' || REGEX_AFTER_WORD.test(src.slice(Math.max(0, i - 12), i).trimEnd()))) {
      let cls = false; i++;
      while (i < src.length && (cls || src[i] !== '/')) { if (src[i] === '\n') return fail('unterminated regex'); if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i += src[i] === '\\' ? 2 : 1; }
      if (i >= src.length) return fail('unterminated regex'); i++; while (/[a-z]/i.test(src[i] || '')) i++; last = 'v'; continue;
    }
    if (c === '(' || c === '[' || c === '{') { stack.push(c); i++; last = 'o'; continue; }
    if (c === ')' || c === ']' || c === '}') { if (stack.pop() !== pairs[c]) return fail(`unbalanced '${c}'`); i++; last = c === '}' ? 'o' : 'v'; continue; }
    if (/[\w$]/.test(c)) { while (i < src.length && /[\w$.]/.test(src[i])) i++; last = 'v'; continue; }
    i++; last = 'o';
  }
  return stack.length ? fail(`unclosed '${stack[stack.length - 1]}'`) : null;
}

// contents: { [path]: { head: string|null (null when unreadable), headSize, baseSize } } for every non-removed file of a model branch.
// syntax(path, src) returns an error string or null; the Worker passes jsShapeCheck, a Node host may pass a `node --check` runner.
export function checkModelEdits(files, contents, { syntax = (_p, src) => jsShapeCheck(src) } = {}) {
  const bad = [];
  for (const f of files) {
    const p = f.filename || '';
    if (f.status === 'removed') continue;
    const c = contents[p];
    if (!c) { bad.push(`${p}: content unreadable, cannot verify`); continue; }
    const size = Math.max(c.headSize || 0, c.baseSize || 0);
    if (size > MAX_MODEL_EDIT_BYTES) bad.push(`${p}: ${size} bytes is over the ${MAX_MODEL_EDIT_BYTES}-byte limit for model edits`);
    if (JS_RE.test(p)) {
      if (typeof c.head !== 'string') { bad.push(`${p}: content unreadable, cannot syntax-check`); continue; }
      const why = syntax(p, c.head);
      if (why) bad.push(`${p}: syntax ${why}`);
    }
  }
  return { ok: bad.length === 0, bad };
}

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

const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob((b64 || '').replace(/\n/g, '')), (ch) => ch.charCodeAt(0)));
// Reads each changed file at the head (content and size) and, when it existed before, its size at the base. An unreadable file is left out,
// so checkModelEdits refuses it: unknown is not green.
async function readContents(gh, repo, files, headSha, baseSha) {
  const out = {};
  for (const f of files) {
    if (f.status === 'removed') continue;
    const p = f.filename || '', enc = p.split('/').map(encodeURIComponent).join('/');
    const h = await gh('GET', `/repos/${repo}/contents/${enc}?ref=${headSha}`);
    if (!h.ok || !h.json || Array.isArray(h.json)) continue;
    const entry = { headSize: h.json.size || 0, head: h.json.encoding === 'base64' && h.json.content ? decode(h.json.content) : null, baseSize: 0 };
    if (f.status !== 'added' && baseSha) {
      const was = f.previous_filename || p;
      const b = await gh('GET', `/repos/${repo}/contents/${was.split('/').map(encodeURIComponent).join('/')}?ref=${baseSha}`);
      if (b.ok && b.json && !Array.isArray(b.json)) entry.baseSize = b.json.size || 0;
    }
    out[p] = entry;
  }
  return out;
}

export async function runGate({ token, repos = [], fetch: f = fetch, context = 'worker-gate', maxPrs = 10, maxCalls = 30 }) {
  if (!token) return { status: 'no-token', checked: [], errors: [] };
  const gh = async (method, path, body) => {
    const r = await f('https://api.github.com' + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-gate', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : null };
  };
  // SUBREQUEST-METER-1: the gate spends at most `maxCalls` GitHub calls a run. A PR not reached is judged next run (a judged commit is skipped, so the work resumes by itself).
  let calls = 0; const rawGh = gh; const out = { status: 'ok', checked: [], errors: [], deferred: [], forbidden: [] };
  const budgeted = async (...a) => { calls++; return rawGh(...a); };
  const room = () => calls < maxCalls;
  return runGateWith(budgeted, room, { repos, context, maxPrs, out });
}

async function runGateWith(gh, room, { repos, context, maxPrs, out }) {
  for (const repo of repos) {
    const prs = await gh('GET', `/repos/${repo}/pulls?state=open&per_page=30`);
    if (!prs.ok) { out.errors.push(`${repo} pulls ${prs.status}`); continue; }
    for (const pr of prs.json.slice(0, maxPrs)) {
      if (!room()) { out.deferred.push(`${repo}#${pr.number}`); continue; }
      const sha = pr.head.sha;
      const st = await gh('GET', `/repos/${repo}/commits/${sha}/statuses?per_page=30`);
      if (st.ok && st.json.some(s => s.context === context)) continue; // already judged this commit
      const files = await gh('GET', `/repos/${repo}/pulls/${pr.number}/files?per_page=100`);
      if (!files.ok) { out.errors.push(`${repo}#${pr.number} files ${files.status}`); continue; }
      const agentBranch = MODEL_BRANCH_RE.test(pr.head.ref);
      const v = evaluate(files.json, { agentBranch, body: pr.body || '' });
      if (agentBranch) {
        const stubs = stubLines(files.json);
        if (stubs.length) { v.ok = false; v.bad.push(...stubs); }
        const contents = await readContents(gh, repo, files.json, sha, pr.base && pr.base.sha);
        const m = checkModelEdits(files.json, contents);
        if (!m.ok) { v.ok = false; v.bad.push(...m.bad); }
      }
      const post = await gh('POST', `/repos/${repo}/statuses/${sha}`, { state: v.ok ? 'success' : 'failure', context, description: (v.ok ? 'diff gate passed' : v.bad.join('; ')).slice(0, 140) });
      if (post.status === 403) { out.forbidden.push(`${repo}#${pr.number}`); out.forbidden_detail = forbiddenDetail(repo, pr.number); continue; }  // a 403 on one PR (the App cannot write statuses there) is that PR's recorded disposition, not a failed loop
      if (!post.ok) { out.errors.push(`${repo}#${pr.number} status ${post.status}`); continue; }
      out.checked.push(`${repo}#${pr.number} ${v.ok ? 'success' : 'failure'}`);
    }
  }
  if (out.errors.length) out.status = 'errors';
  // every pull request the gate reached was refused and none was judged: the gate checks nothing, and the cause is the App permission
  else if (out.forbidden.length && !out.checked.length && (out.forbidden.length > 1 || !out.deferred.length)) { out.status = 'forbidden'; out.needs = `${STATUS_PERMISSION}:write`; }
  return out;
}

// One machine-readable gate card in step with the gate result: open while the App cannot write statuses, closed by the first judged pull request.
export async function gateCard(db, out, { origin = '' } = {}) {
  if (!db || !out) return null;
  const id = 'GATE-APP-PERMISSION';
  if (out.status === 'forbidden') {
    await db.prepare(`INSERT INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES (?,?,?,?,?,'gate_status_writable')
      ON CONFLICT(id) DO UPDATE SET what=excluded.what, status='open', closed_at=NULL`).bind(id,
        `Allow the GitHub App to write commit statuses (permission ${out.needs}) with one approval at ${origin}/connect/github.`,
        'Only the account owner can accept a new App permission; the App cannot grant it to itself (GitHub API).',
        'The lane merges on local-checks evidence; the Worker gate records each pull request it could not judge.',
        `The gate asked GitHub for ${out.forbidden.length} pull request(s) and was answered 403 on each (${out.forbidden_detail || ''}).`.slice(0, 400)).run();
    return 'open';
  }
  if (out.checked && out.checked.length) { await db.prepare(`UPDATE gate_cards SET status='closed', closed_at=datetime('now') WHERE id=? AND status='open'`).bind(id).run(); return 'closed'; }
  return null;
}
