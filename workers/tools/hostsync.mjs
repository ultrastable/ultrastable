// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// HOSTSYNC-1 CLI, run by GitHub Actions with its own OIDC token and GITHUB_TOKEN (no stored secret). Backend only.
//   node hostsync.mjs run    [--declared deploy/hosting.json] [--root .]   observe the host, write ops/hosting/state.json, redeploy on drift
//   node hostsync.mjs expect --script NAME --sha256 HASH [--root .]        record what a deploy just put on the host (repo to host)
// Declaration (deploy/hosting.json): { gateway, repo, redeploy: { script: "workflow.yml" }, scripts: { name: { crons?, bindings?, workers_dev? } } }.
// Expected module hashes live in ops/hosting/expected.json, written by `expect` after each verified deploy. Events: ops/hosting/events.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { reconcile } = await import(path.join(here, '../core/hostsync/index.js'));
const { gatewayHost } = await import(path.join(here, '../core/hostsync/gateway.js'));

const [cmd, ...rest] = process.argv.slice(2);
const arg = (k, d) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : d; };
const root = path.resolve(arg('root', '.'));
const rd = p => { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const wr = (p, t) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); };
const EXPECTED = 'ops/hosting/expected.json', EVENTS = 'ops/hosting/events.jsonl';
const expected = () => JSON.parse(rd(EXPECTED) || '{}');

if (cmd === 'expect') {
  const script = arg('script'), sha = arg('sha256');
  if (!script || !/^[0-9a-f]{64}$/.test(sha || '')) { console.error('expect needs --script and a 64-hex --sha256'); process.exit(2); }
  const e = expected(); e[script] = { sha256: sha, sha: process.env.GITHUB_SHA || null };
  wr(EXPECTED, JSON.stringify(Object.fromEntries(Object.entries(e).sort()), null, 1) + '\n');
  fs.appendFileSync(path.join(root, EVENTS), JSON.stringify({ at: new Date().toISOString(), kind: 'host-expect', subject: script, summary: 'deploy recorded as expected', data: { sha256: sha } }) + '\n');
  process.exit(0);
}
if (cmd !== 'run') { console.error('usage: hostsync.mjs run|expect'); process.exit(2); }

const declaredFile = JSON.parse(rd(arg('declared', 'deploy/hosting.json')));
const exp = expected();
const declared = { scripts: Object.fromEntries(Object.entries(declaredFile.scripts).map(([n, d]) => [n, { ...d, ...(exp[n] ? { sha256: exp[n].sha256 } : {}) }])) };
const oidc = async aud => {
  const r = await fetch(process.env.ACTIONS_ID_TOKEN_REQUEST_URL + '&audience=' + encodeURIComponent(aud), { headers: { authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN } });
  if (!r.ok) throw new Error('oidc ' + r.status);
  return (await r.json()).value;
};
const redeploy = async script => {
  const wf = (declaredFile.redeploy || {})[script];
  if (!wf) throw new Error('no redeploy workflow declared for ' + script);
  const r = await fetch(`https://api.github.com/repos/${declaredFile.repo}/actions/workflows/${wf}/dispatches`, { method: 'POST', headers: { authorization: 'Bearer ' + process.env.GITHUB_TOKEN, accept: 'application/vnd.github+json' }, body: JSON.stringify({ ref: declaredFile.ref || 'main' }) });
  if (r.status !== 204) throw new Error('dispatch ' + wf + ' ' + r.status);
};
const out = await reconcile({
  host: gatewayHost({ gateway: declaredFile.gateway, oidc }), declared, read: async p => rd(p), write: async (p, t) => wr(p, t),
  redeploy: process.env.GITHUB_TOKEN ? redeploy : null,
  record: async e => fs.appendFileSync(path.join(root, EVENTS), JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n'),
});
console.log(JSON.stringify({ scripts: Object.keys(out.state.scripts).length, drift: out.drift.length, redeployed: out.redeployed, wrote: out.wrote }));
for (const d of out.drift) console.log('drift', d.script, d.field, d.direction);
process.exit(Object.values(out.state.scripts).every(s => !s.found) ? 1 : 0);
