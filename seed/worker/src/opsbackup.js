// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// BACKUP-SINK-1: the weekly backup drill stores its dumps outside Cloudflare, in the private ops repository under backups/. The drill runs in GitHub Actions
// with no credential for that repository, so it presents its OIDC token (verified by the caller, audience ultrastable-main) and this Worker forwards ONE
// allow-listed GitHub contents request with the org's own App token. Only read, write and delete of files under backups/ in that one repository pass; the
// method and path travel in headers and the body is passed through untouched, so a dump is never parsed or held here.
const API = 'https://api.github.com';
export const OPS_PATH = /^contents\/backups(\/[\w.%-]+)*(\?ref=[\w.-]+)?$/;
export const opsAllowed = (method, path) => ['GET', 'PUT', 'DELETE'].includes(method) && !String(path).includes('..') && OPS_PATH.test(String(path));

export async function opsBackup(request, { token, repo, fetch: f = fetch }) {
  const method = String(request.headers.get('x-gh-method') || 'GET').toUpperCase(), path = String(request.headers.get('x-gh-path') || '');
  if (!opsAllowed(method, path)) return Response.json({ ok: false, error: 'not an allowed backup request: ' + method + ' ' + path.split('?')[0] }, { status: 403 });
  if (!token) return Response.json({ ok: false, error: 'no GitHub App token for the backup repository' }, { status: 503 });
  const body = method === 'GET' ? undefined : request.body;
  const up = await f(`${API}/repos/${repo}/${path}`, { method, body, duplex: body ? 'half' : undefined,
    headers: { authorization: 'Bearer ' + token, accept: request.headers.get('accept') || 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'ultrastable-backup-sink' } });
  return new Response(up.body, { status: up.status, headers: { 'content-type': up.headers.get('content-type') || 'application/json' } });
}
