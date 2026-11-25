#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// CACHE-FRESH-1: after a deploy, fetch each page the way a visitor does (no cache bypass) and again with a cache-busting query.
// Fails (exit 1) when the cached page still carries an older build than the origin, or when the edge may hold a page longer than a minute.
// Polls up to --wait-s (default 180) so a cache already holding the old page has time to expire. Usage: stale_probe.mjs https://site/ /claims /live
import { staleVerdict } from '../worker/src/freshcache.js';
const args = process.argv.slice(2), wi = args.indexOf('--wait-s'), wait = wi >= 0 ? Number(args.splice(wi, 2)[1]) : 180;
const [origin, ...paths] = args;
if (!origin) { console.error('usage: stale_probe.mjs <origin> [paths...]'); process.exit(2); }
const UA = { 'user-agent': 'ultrastable-stale-probe/1 (+https://ultrastable.io)' };
async function read(url) { const r = await fetch(url, { headers: UA }); await r.arrayBuffer(); return { status: r.status, build: r.headers.get('x-ultrastable-build') || '', cdn: r.headers.get('cdn-cache-control') || '' }; }
async function check(p) {
  const u = new URL(p || '/', origin);
  const plain = await read(u.href), bu = new URL(u.href); bu.searchParams.set('cb', String(Date.now()));
  const busted = await read(bu.href);
  return { path: u.pathname, plain, busted, ...staleVerdict(plain, busted) };
}
let out = [];
for (let t = 0; ; t += 30) {
  out = await Promise.all((paths.length ? paths : ['/']).map(check));
  if (out.every(r => r.ok) || t >= wait) break;
  await new Promise(s => setTimeout(s, 30000));
}
console.log(JSON.stringify(out, null, 1));
process.exit(out.every(r => r.ok) ? 0 : 1);
