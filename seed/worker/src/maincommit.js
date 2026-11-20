// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// MAIN-WRITER-1 (Q-GATE-ACTIONS-BYPASS): GitHub refuses the Actions app as a ruleset bypass actor, so a rule that requires `checks` on main would stop every
// workflow-token push (regen-generated, deploy records, watchdog, ledgers). Workflows now send their data commits here instead: the run presents its GitHub
// Actions OIDC token (audience ultrastable-main), this Worker verifies it and writes ONE commit to main with the org's own GitHub App, which the ruleset
// exempts. No credential is minted by a person, and protected paths (rules, workflows, policy) are refused, so this route cannot change a guard.
const API = 'https://api.github.com';
export const OIDC_ISSUER = 'https://token.actions.githubusercontent.com', OIDC_AUDIENCE = 'ultrastable-main';
export const MAX_DATA_PRS = 3;
export const MAX_FILES = 20;  // one commit costs files + 4 subrequests; the Free plan allows 50 per invocation
const PROTECTED = [/^\.github\//, /^autonomy\//, /^agents\//, /^github\/org-settings\.json$/, /(^|\/)(AGENTS|CLAUDE|CONTRIBUTING)\.md$/, /^(LICENSE|SCOPE\.md)/, /^doctrine\/(directive|standing-order|closed-loop|server-side)\.json$/];
export const isProtected = (p) => PROTECTED.some(r => r.test(p));
export const safePath = (p) => typeof p === 'string' && p.length > 0 && p.length < 300 && !p.startsWith('/') && !p.split('/').some(s => s === '..' || s === '' || s === '.git');

const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
let jwks = null;
export async function verifyOidc(jwt, { repo, fetch: f = fetch, now = Date.now() } = {}) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return { ok: false, why: 'not a JWT' };
  let head, c;
  try { head = JSON.parse(new TextDecoder().decode(b64u(parts[0]))); c = JSON.parse(new TextDecoder().decode(b64u(parts[1]))); } catch (e) { return { ok: false, why: 'unreadable JWT' }; }
  if (head.alg !== 'RS256') return { ok: false, why: 'alg ' + head.alg };
  const t = Math.floor(now / 1000);
  if (c.iss !== OIDC_ISSUER || c.aud !== OIDC_AUDIENCE || c.repository !== repo || c.ref !== 'refs/heads/main') return { ok: false, why: 'claims do not name ' + repo + ' main' };
  if (!(c.exp > t) || (c.nbf && c.nbf > t + 60)) return { ok: false, why: 'expired or not yet valid' };
  if (!jwks || jwks.at < now - 3600e3 || !jwks.keys.some(k => k.kid === head.kid)) { const r = await f(OIDC_ISSUER + '/.well-known/jwks'); jwks = { at: now, keys: (await r.json()).keys || [] }; }
  const jwk = jwks.keys.find(k => k.kid === head.kid);
  if (!jwk) return { ok: false, why: 'unknown key' };
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  return good ? { ok: true, run: c.run_id, workflow: c.workflow, sha: c.sha } : { ok: false, why: 'bad signature' };
}
export const _resetJwks = () => { jwks = null; };

// Validates a request body: { message, files: [{ path, content (base64) | append (base64) | delete: true }] }.
export function checkBody(b) {
  if (!b || typeof b.message !== 'string' || !b.message) return 'message is required';
  if (!Array.isArray(b.files) || !b.files.length) return 'files is required';
  if (b.files.length > MAX_FILES) return `at most ${MAX_FILES} files per commit`;
  for (const x of b.files) {
    if (!x || !safePath(x.path)) return 'bad path ' + (x && x.path);
    if (isProtected(x.path)) return 'protected path ' + x.path;
    if (!x.delete && typeof x.content !== 'string' && typeof x.append !== 'string') return 'no content for ' + x.path;
  }
  return null;
}

// Writes one commit to main with the App token. Appends are applied to the newest main, so concurrent ledger writers never overwrite each other.
export async function commitToMain({ token, repo, body, fetch: f = fetch }) {
  const err = checkBody(body); if (err) return { ok: false, status: 400, error: err };
  const h = { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-main-writer', 'content-type': 'application/json' };
  const call = async (m, p, j) => { const r = await f(API + '/repos/' + repo + p, { method: m, headers: h, body: j ? JSON.stringify(j) : undefined }); let json = null; try { json = await r.json(); } catch (e) { json = null; /* an empty body is fine; the status decides */ } return { ok: r.ok, status: r.status, json }; };
  const ref = await call('GET', '/git/ref/heads/main'); if (!ref.ok) return { ok: false, status: 502, error: 'read main ' + ref.status };
  const parent = ref.json.object.sha;
  const tree = [];
  for (const x of body.files) {
    if (x.delete) { tree.push({ path: x.path, mode: '100644', type: 'blob', sha: null }); continue; }
    let content = x.content;
    if (typeof x.append === 'string') {
      const cur = await f(`${API}/repos/${repo}/contents/${x.path.split('/').map(encodeURIComponent).join('/')}?ref=${parent}`, { headers: { ...h, accept: 'application/vnd.github.raw' } });
      const old = cur.status === 200 ? new Uint8Array(await cur.arrayBuffer()) : new Uint8Array();
      const add = Uint8Array.from(atob(x.append), c => c.charCodeAt(0));
      const joined = new Uint8Array(old.length + add.length); joined.set(old); joined.set(add, old.length);
      let s = ''; for (const byte of joined) s += String.fromCharCode(byte);
      content = btoa(s);
    }
    const blob = await call('POST', '/git/blobs', { content, encoding: 'base64' });
    if (!blob.ok) return { ok: false, status: 502, error: 'blob ' + blob.status };
    tree.push({ path: x.path, mode: '100644', type: 'blob', sha: blob.json.sha });
  }
  const base = await call('GET', '/git/commits/' + parent); if (!base.ok) return { ok: false, status: 502, error: 'read commit ' + base.status };
  const t = await call('POST', '/git/trees', { base_tree: base.json.tree.sha, tree }); if (!t.ok) return { ok: false, status: 502, error: 'tree ' + t.status };
  const c = await call('POST', '/git/commits', { message: body.message.slice(0, 200), tree: t.json.sha, parents: [parent] }); if (!c.ok) return { ok: false, status: 502, error: 'commit ' + c.status };
  const u = await call('PATCH', '/git/refs/heads/main', { sha: c.json.sha, force: false });
  if (!u.ok) {
    // 422 is either a main that moved (not a fast forward: the client retries and appends reapply) or a ruleset that refuses the App (seen live 2026-11-20:
    // every watchdog and smoke-live commit answered 422 and nothing landed). In the second case the same commit goes up as a pull request opened by the App:
    // unlike a PR opened with a workflow token, it starts `checks`, so the merge lane can land it. The refusal text is returned, never swallowed.
    const why = String((u.json && u.json.message) || '').slice(0, 200);
    if (u.status === 422 && !/fast.?forward/i.test(why)) return viaPullRequest({ call, sha: c.json.sha, body, why });
    return { ok: false, status: u.status === 422 ? 409 : 502, error: 'main moved or refused ' + u.status + (why ? ': ' + why : '') };  // 409: the client retries; appends reapply on the new main
  }
  return { ok: true, status: 200, sha: c.json.sha };
}

// MAIN-WRITER-PR-1: a data commit the ruleset refuses lands as a branch plus a pull request opened by the App, which starts `checks` on it.
async function viaPullRequest({ call, sha, body, why }) {
  // DATA-PR-CAP-1 (seen live 2026-11-20): with main refusing the app, every workflow's data commit became its own pull request, 14 in ten minutes. A refusal
  // that lasts is one defect, not a pull request per commit: at most MAX_DATA_PRS are open at a time, and past that the route fails loudly so the cause is fixed.
  const open = await call('GET', '/pulls?state=open&per_page=100');
  const n = open.ok && Array.isArray(open.json) ? open.json.filter(p => String((p.head || {}).ref || '').startsWith('agent/data-')).length : 0;
  if (n >= MAX_DATA_PRS) return { ok: false, status: 503, error: 'main refused (' + why + ') and ' + n + ' data pull requests are already open' };
  const branch = 'agent/data-' + sha.slice(0, 10);
  const ref = await call('POST', '/git/refs', { ref: 'refs/heads/' + branch, sha });
  if (!ref.ok && ref.status !== 422) return { ok: false, status: 502, error: 'main refused (' + why + '); branch ' + ref.status };
  const pr = await call('POST', '/pulls', { title: body.message.slice(0, 200), head: branch, base: 'main', body: 'MAIN-WRITER-PR-1: a data commit written by a workflow; the main ruleset refused a direct write (' + why + ').\n\nItem: MAIN-WRITER-PR-1\nPrediction: n/a, data-only change' });
  if (!pr.ok && pr.status !== 422) return { ok: false, status: 502, error: 'main refused (' + why + '); pull request ' + pr.status + ' ' + String((pr.json && pr.json.message) || '').slice(0, 120) };
  return { ok: true, status: 200, sha, mode: 'pull_request', branch, pr: (pr.json && pr.json.number) || null };
}
