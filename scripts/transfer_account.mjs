// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// Move Ultrastable's assets from the Qniverse account to the Ultrastable account, keeping them partitioned.
// Usage: node scripts/transfer_account.mjs [--apply]   (default is a dry-run plan; nothing is written)
// Needs SRC_CLOUDFLARE_API_TOKEN (read, old account) and DST_CLOUDFLARE_API_TOKEN (write, new account); ids come from deploy/cloudflare-accounts.json.
// Moves only names in ASSETS (ultrastable-*); QNFO workers and data are never touched.
import { readFileSync } from 'node:fs';

export const ASSETS = /^ultrastable-/;
const API = 'https://api.cloudflare.com/client/v4';

export async function cf(f, token, method, path, body, raw) {
  const r = await f(API + path, { method, headers: { authorization: 'Bearer ' + token, ...(body && !raw ? { 'content-type': 'application/json' } : {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  if (raw === 'text') return r.text();
  const j = await r.json();
  if (!j.success) throw new Error(`${method} ${path}: ${(j.errors || []).map(e => e.message).join('; ')}`);
  return j.result;
}

export async function plan(f, tok, acct) {
  const [workers, d1, kv] = await Promise.all([
    cf(f, tok, 'GET', `/accounts/${acct}/workers/scripts`),
    cf(f, tok, 'GET', `/accounts/${acct}/d1/database`),
    cf(f, tok, 'GET', `/accounts/${acct}/storage/kv/namespaces`),
  ]);
  return {
    workers: workers.map(w => w.id).filter(n => ASSETS.test(n)),
    d1: d1.filter(d => ASSETS.test(d.name)).map(d => ({ name: d.name, uuid: d.uuid })),
    kv: kv.filter(k => ASSETS.test(k.title)).map(k => ({ title: k.title, id: k.id })),
  };
}

export async function apply(f, srcTok, src, dstTok, dst, p) {
  const done = [];
  for (const d of p.d1) { // export SQL from source, create and import on target
    const exp = await cf(f, srcTok, 'POST', `/accounts/${src}/d1/database/${d.uuid}/export`, { output_format: 'polling' });
    const sql = await (await f(exp.result?.signed_url || exp.signed_url)).text();
    const created = await cf(f, dstTok, 'POST', `/accounts/${dst}/d1/database`, { name: d.name });
    await cf(f, dstTok, 'POST', `/accounts/${dst}/d1/database/${created.uuid}/query`, { sql });
    done.push('d1:' + d.name);
  }
  for (const k of p.kv) {
    const made = await cf(f, dstTok, 'POST', `/accounts/${dst}/storage/kv/namespaces`, { title: k.title });
    const keys = await cf(f, srcTok, 'GET', `/accounts/${src}/storage/kv/namespaces/${k.id}/keys`);
    const items = [];
    for (const key of keys) items.push({ key: key.name, value: await cf(f, srcTok, 'GET', `/accounts/${src}/storage/kv/namespaces/${k.id}/values/${encodeURIComponent(key.name)}`, undefined, 'text') });
    if (items.length) await cf(f, dstTok, 'PUT', `/accounts/${dst}/storage/kv/namespaces/${made.id}/bulk`, items);
    done.push('kv:' + k.title);
  }
  // Workers redeploy from this repository (canonical source) with the new D1/KV ids, see deploy/first-run; listed so none is forgotten.
  for (const w of p.workers) done.push('worker-redeploy:' + w);
  return done;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const acc = JSON.parse(readFileSync(new URL('../deploy/cloudflare-accounts.json', import.meta.url), 'utf8'));
  const [s, d] = [acc.current.id, acc.target.id];
  const st = process.env.SRC_CLOUDFLARE_API_TOKEN, dt = process.env.DST_CLOUDFLARE_API_TOKEN;
  if (!st) { console.error('SRC_CLOUDFLARE_API_TOKEN not set; plan needs read on the old account'); process.exit(2); }
  const p = await plan(fetch, st, s);
  console.log(JSON.stringify(p, null, 2));
  if (process.argv.includes('--apply')) {
    if (!dt) { console.error('DST_CLOUDFLARE_API_TOKEN not set'); process.exit(2); }
    console.log(JSON.stringify(await apply(fetch, st, s, dt, d, p), null, 2));
  }
}
