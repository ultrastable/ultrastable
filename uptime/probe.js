// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// UPTIME-1: the dead-site detector. Pure and injectable (fetch, now): resolves every declared hostname through two public resolvers (DNS over HTTPS), fetches it,
// and says what is wrong in one word per host: ok, dns (no answer or NXDOMAIN), tls/http (answers but not 200 after redirects), or down.
export const RESOLVERS = [
  { id: 'cloudflare', url: (n, t) => 'https://cloudflare-dns.com/dns-query?name=' + n + '&type=' + t },
  { id: 'google', url: (n, t) => 'https://dns.google/resolve?name=' + n + '&type=' + t },
];
const apex = (h) => h.split('.').slice(-2).join('.');

export async function dohQuery(resolver, name, type, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(resolver.url(name, type), { headers: { accept: 'application/dns-json' } });
    if (r.status !== 200) return { ok: false, status: -1, why: 'HTTP ' + r.status, answers: [] };
    const j = await r.json();
    return { ok: j.Status === 0 && (j.Answer || []).length > 0, status: j.Status, answers: (j.Answer || []).map(a => a.data) };
  } catch (e) { return { ok: false, status: -1, why: String(e && e.message || e).slice(0, 80), answers: [] }; }
}

export async function checkHost(host, { fetchImpl = fetch, expectNs = [] } = {}) {
  const dns = {};
  for (const r of RESOLVERS) {
    const a = await dohQuery(r, host, 'AAAA', fetchImpl);
    dns[r.id] = a.ok ? 'ok' : (a.status === 3 ? 'nxdomain' : a.status === 2 ? 'servfail' : (a.why || 'empty'));
  }
  const ns = await dohQuery(RESOLVERS[0], apex(host), 'NS', fetchImpl);
  const nsNames = ns.answers.map(x => String(x).replace(/\.$/, '').toLowerCase());
  const nsWrong = expectNs.length > 0 && nsNames.length > 0 && !nsNames.every(n => expectNs.includes(n));
  let http = null, verdict;
  try {
    const r = await fetchImpl('https://' + host + '/', { redirect: 'follow', headers: { 'user-agent': 'ultrastable-uptime/1' } });
    http = r.status;
  } catch (e) { http = 'err:' + String(e && e.message || e).slice(0, 60); }
  const dnsOk = Object.values(dns).every(v => v === 'ok');
  if (http === 200 && dnsOk && !nsWrong) verdict = 'ok';
  else if (!Object.values(dns).some(v => v === 'ok')) verdict = 'dns';
  else if (http !== 200) verdict = 'http';
  else verdict = nsWrong ? 'ns' : 'dns';
  return { host, verdict, http, dns, ns: nsNames };
}

export async function checkAll(hosts, opts = {}) {
  const out = [];
  for (const h of hosts) out.push(await checkHost(h, opts));
  return out;
}
