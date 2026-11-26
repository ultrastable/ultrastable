// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-19 conformance for Door A, the web launcher: each title cites the requirement or test id it proves.
// Every outside call goes to a fake Cloudflare; nothing reaches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import launcher from '../src/index.js';
import { launcherPage } from '../src/page.js';
import { provision, verifyPreview } from '../src/provision.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const U = 'https://launch.example';
const CLAIM = 'claim-token-SECRET', TOKEN = 'account-token-SECRET';

function fakeCloudflare({ failAt = null } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = String(url), method = init.method || 'GET';
    calls.push({ url: u, method, body: typeof init.body === 'string' ? init.body : init.body ? '[form]' : '' });
    const ok = result => new Response(JSON.stringify({ success: true, result }), { status: 200 });
    if (failAt && u.includes(failAt)) return new Response(JSON.stringify({ success: false, errors: [{ message: `denied ${TOKEN} ${CLAIM}` }] }), { status: 403 });
    if (u.includes('/challenge')) return ok({ challengeToken: 'ct', seed: 'AAAA', k: 2, g: 2 });
    if (u.endsWith('/provisioning/previews')) return ok({ account: { id: 'a1', apiToken: TOKEN, expiresAt: 'x' }, claim: { token: CLAIM, url: `https://dash.example/claim?claimToken=${CLAIM}`, expiresAt: 'x' } });
    if (u.endsWith('/d1/database')) return ok({ uuid: 'd1' });
    if (u.endsWith('/workers/subdomain')) return ok({ subdomain: 'sub' });
    return ok({});
  };
  return { f, calls };
}
async function withGlobalFetch(fake, fn) { const orig = globalThis.fetch; globalThis.fetch = fake.f; try { return await fn(); } finally { globalThis.fetch = orig; } }

const body = (extra = {}) => ({ proof: { challengeToken: 'ct', solution: { checkpoints: 'AAAA' } }, idea: 'A neighbourhood tool library for borrowing tools', outcomes: ['Book a drill'], limit: 5, acceptedCloudflareTerms: true, acceptedLicense: true, ...extra });
const post = (b, origin = U) => new Request(U + '/api/provision', { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(b) });
const PROOF = { challengeToken: 'ct', solution: { checkpoints: 'AAAA' } };
const ANSWERS = { idea: 'A neighbourhood tool library where people borrow tools instead of buying them', outcomes: ['A page where neighbours can book a drill'], limit: 0 };
const RELEASE = { bundle: 'export default {}', bundleSha256: 'abc', migrationsSql: 'CREATE TABLE IF NOT EXISTS items (id TEXT);', compatibilityDate: '2026-10-01' };
const page = () => launcherPage({ bundleSha256: 'a'.repeat(64) });
const visible = html => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('T19-1 / US-19-R01: a person with only a browser reaches a live preview, and no visible step names a terminal', async () => {
  const text = visible(page()).replace('No code, no terminal.', '').replace('or a terminal?', '');
  assert.doesNotMatch(text, /terminal|command line|npm|npx|wrangler|api token|secret|git clone|python/i);
  const fake = fakeCloudflare();
  await withGlobalFetch(fake, async () => {
    const ch = await (await launcher.fetch(new Request(U + '/api/challenge'), {})).json();
    assert.equal(ch.challengeToken, 'ct');
    const res = await launcher.fetch(post(body()), {});
    assert.equal(res.status, 200);
    const r = await res.json();
    assert.match(r.url, /^https:\/\/.+\.sub\.workers\.dev$/);
    assert.ok(r.consoleKey && r.claimUrl, 'an address, a key to open it and a link to keep it');
  });
});

test('US-19-R02: the first screen offers no agent or developer path as a step; the pointer to one is a footer line', () => {
  const html = page();
  const first = html.slice(html.indexOf('<section id="s1"'), html.indexOf('</section>', html.indexOf('<section id="s1"')));
  assert.doesNotMatch(first, /agent|developer|terminal|assistant|github/i);
  const footer = html.slice(html.lastIndexOf('<p class="mut" style="margin-top:2rem">'), html.indexOf('</main>'));
  assert.match(footer, /AI assistant or a terminal/);
  assert.ok(html.indexOf('<section id="s5"') < html.lastIndexOf('<p class="mut" style="margin-top:2rem">'), 'the pointer comes after every step');
});

test('T19-2 / US-19-R06: nothing is created without the person accepting Cloudflare terms and the safety check, and the acceptance is passed on', async () => {
  const none = fakeCloudflare();
  await assert.rejects(() => provision({ fetch: none.f, proof: PROOF, answers: ANSWERS, acceptedCloudflareTerms: false, release: RELEASE }), /terms/i);
  await assert.rejects(() => provision({ fetch: none.f, proof: PROOF, answers: ANSWERS, acceptedCloudflareTerms: 'yes', release: RELEASE }), /terms/i, 'only an explicit true counts');
  await assert.rejects(() => provision({ fetch: none.f, proof: null, answers: ANSWERS, acceptedCloudflareTerms: true, release: RELEASE }), /safety check/);
  assert.equal(none.calls.length, 0, 'no call was made without both');
  const ok = fakeCloudflare();
  await provision({ fetch: ok.f, proof: PROOF, answers: ANSWERS, acceptedCloudflareTerms: true, release: RELEASE });
  const sent = JSON.parse(ok.calls[0].body);
  assert.equal(sent.acceptTermsOfService, 'yes');
  assert.match(sent.termsOfService, /cloudflare\.com\/terms/);
  assert.match(sent.privacyPolicy, /cloudflare\.com\/privacypolicy/);
});

test('US-19-R05: neither agreement is pre-ticked, the licence is summarised, and an unconfirmed licence is refused before any call', async () => {
  const html = page();
  assert.doesNotMatch(html, /\schecked[\s>=]/);
  assert.match(html, /free for non-commercial use/i);
  assert.match(html, /commercial license applies/i);
  assert.match(html, /id="go" disabled/);
  const fake = fakeCloudflare();
  await withGlobalFetch(fake, async () => {
    const res = await launcher.fetch(post(body({ acceptedLicense: false })), {});
    assert.equal(res.status, 400);
  });
  assert.equal(fake.calls.length, 0);
});

test('T19-3 / US-19-R07: the claim link is in the HTTP response only: no log line, no storage, no page, no error', async () => {
  const seen = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => seen.push(a.join(' '));
  let res, json;
  const fake = fakeCloudflare();
  const bad = fakeCloudflare({ failAt: '/workers/scripts/' });
  let errText;
  try {
    await withGlobalFetch(fake, async () => { res = await launcher.fetch(post(body()), {}); json = await res.json(); });
    await withGlobalFetch(bad, async () => { errText = JSON.stringify(await (await launcher.fetch(post(body()), {})).json()); });
  } finally { Object.assign(console, orig); }
  assert.deepEqual(seen, [], 'nothing was logged');
  assert.match(json.claimUrl, new RegExp(CLAIM));
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(!errText.includes(CLAIM) && !errText.includes(TOKEN), 'a refusal never repeats the claim link or the token');
  assert.ok(!page().includes(CLAIM) && !page().includes('claimToken='), 'the page HTML never carries a claim link');
  const home = await launcher.fetch(new Request(U + '/'), {});
  assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(home.headers.get('cache-control'), 'no-store');
  const src = ['index.js', 'provision.js', 'page.js'].map(f => readFileSync(path.join(HERE, '..', 'src', f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /localStorage|sessionStorage|document\.cookie|indexedDB|\.put\(/);
});

test('US-19-R08: the launcher stores nothing about the person: no bindings to write to, and the idea goes only into the preview database', async () => {
  const src = ['index.js', 'provision.js'].map(f => readFileSync(path.join(HERE, '..', 'src', f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /env\.(DB|KV|BUCKET|STORE|ANALYTICS)\b/);
  const wrangler = readFileSync(path.join(HERE, '..', 'wrangler.template.jsonc'), 'utf8');
  assert.doesNotMatch(wrangler, /d1_databases|kv_namespaces|r2_buckets|analytics_engine/);
  const fake = fakeCloudflare();
  const words = 'a quite unmistakable sentence about a goat cheese co-operative';
  await provision({ fetch: fake.f, proof: PROOF, answers: { ...ANSWERS, idea: words }, acceptedCloudflareTerms: true, release: RELEASE });
  const holding = fake.calls.filter(c => c.body.includes(words));
  assert.equal(holding.length, 1);
  assert.match(holding[0].url, /\/d1\/database\/d1\/query$/, 'only the person\'s own preview database receives it');
});

test('US-19-R09: a refused rate limit, a failed robot check, a spent daily cap and an unready public mode each stop the request before anything is created', async () => {
  const fake = fakeCloudflare();
  await withGlobalFetch(fake, async () => {
    assert.equal((await launcher.fetch(post(body()), { RATE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
    assert.equal((await launcher.fetch(post(body()), { TURNSTILE_SECRET: 's' })).status, 403);
    const spent = { get: () => ({ fetch: async () => Response.json({ ok: false, used: 25, max: 25 }) }), idFromName: n => n };
    assert.equal((await launcher.fetch(post(body()), { PROVISION_CAP: spent })).status, 503);
    assert.equal((await launcher.fetch(post(body()), { PROVISION_CAP: { get: () => { throw new Error('down'); }, idFromName: n => n } })).status, 503, 'a cap that cannot be read counts as spent');
    assert.equal((await launcher.fetch(new Request(U + '/'), { LAUNCHER_MODE: 'public' })).status, 503);
    assert.equal((await launcher.fetch(post(body()), { LAUNCHER_MODE: 'public' })).status, 503);
    assert.equal((await launcher.fetch(new Request(U + '/health'), { LAUNCHER_MODE: 'public' })).status, 200, 'health still answers');
  });
  assert.equal(fake.calls.length, 0, 'no outside call was made by any refused request');
});

test('T19-4 / T19-7 / US-19-R03 / US-19-R14 / US-19-R32: a challenge page or a foreign address is never "verified"; the door says "not verified"', async () => {
  const challenged = async () => new Response('<html>Just a moment</html>', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
  const foreign = async () => new Response('<html>some other site</html>', { status: 200 });
  const worker = async () => Response.json({ ok: true, preview: true, org: 'x', last_tick: null });
  const down = async () => { throw new Error('connect refused'); };
  assert.equal((await verifyPreview('https://x.example', challenged)).status, 'not_verified');
  assert.match((await verifyPreview('https://x.example', challenged)).reason, /safety page/);
  assert.equal((await verifyPreview('https://x.example', foreign)).status, 'not_verified');
  assert.equal((await verifyPreview('https://x.example', down)).status, 'not_verified');
  assert.equal((await verifyPreview('https://x.example', worker)).status, 'verified');
  // the door reports it: the provision result carries the verification, defaulting to not verified, and the page says so
  const { f } = fakeCloudflare();
  const r = await provision({ fetch: f, proof: PROOF, answers: ANSWERS, acceptedCloudflareTerms: true, release: RELEASE, verify: u => verifyPreview(u, challenged) });
  assert.equal(r.verification.status, 'not_verified');
  const bare = await provision({ fetch: fakeCloudflare().f, proof: PROOF, answers: ANSWERS, acceptedCloudflareTerms: true, release: RELEASE });
  assert.equal(bare.verification.status, 'not_verified', 'with no probe at all the door never claims it verified');
  assert.match(page(), /has not been verified yet/);
  assert.doesNotMatch(visible(page()), /Your preview is verified/);
});

test('US-19-R04: before the first question the page states scope, the platform and why, what it costs, and that it is needed only to start', () => {
  const html = page();
  const facts = html.slice(html.indexOf('id="facts"'), html.indexOf('</ul>', html.indexOf('id="facts"')));
  assert.ok(html.indexOf('id="facts"') < html.indexOf('<label for="idea">'));
  assert.match(facts, /does not write business plans/);
  assert.match(facts, /Cloudflare Workers/);
  assert.match(facts, /stops at its limits instead of billing/);
  assert.match(facts, /why-cloudflare\.md/);
  assert.match(facts, /preview is free/);
  assert.match(facts, /model spending stays at zero unless you approve more/);
  assert.match(facts, /only needed to start/);
});
