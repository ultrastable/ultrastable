// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-33, the handoff half of the server-side change lane: the declaration a client leaves on its pull request, the server's record of it, the deploy from the
// base head, the version proof, the live probe, the rollback and the item it closes. GitHub, the site Worker and Cloudflare are injected fakes. Each test names
// the requirement it proves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { parseHandoff, parseVerify, runProbe, runHandoffs, handoffEvent, registerHandoff, compareVersions, meetsVersion, collectModules, topologyBindings, makeDeployer, makeRollback, makeVersionReader, RAW_CHUNK } from '../src/handoff.js';
import { internalDeploy } from '../../../site/deployer.js';

const BODY = 'Fix the thing\n\n## Handoff\nitem: SG-2\nagent: codex\nverify: GET https://ultrastable.io/api/v1/status expect "settled"\ndeploy: ultrastable-tick, ultrastable-site\n\n## Self-audit\nReal output: x';
const R = (j, status = 200) => ({ ok: status < 300, status, headers: new Headers(), text: async () => JSON.stringify(j) });
function github(state) {
  const calls = [];
  const f = async (url, o = {}) => {
    const m = o.method || 'GET', path = url.replace('https://api.github.com', '');
    calls.push({ m, path, body: o.body ? JSON.parse(o.body) : null });
    if (m === 'GET' && path.startsWith('/repos/o/r/pulls?state=closed')) return R(state.closed || []);
    if (m === 'GET' && path.startsWith('/repos/o/r/pulls?')) return R(state.prs || []);
    if (m === 'GET' && /\/pulls\/7$/.test(path)) return R(state.detail);
    if (m === 'POST' && path.endsWith('/comments')) return R({ id: 1 }, 201);
    if (m === 'GET' && path === '/repos/o/r') return R({ default_branch: 'main' });
    if (m === 'GET' && path === '/repos/o/r/commits/main') return R({ sha: state.head || 'basehead1' });
    return R({ message: 'unexpected ' + m + ' ' + path }, 404);
  };
  return { f, calls, comments: () => calls.filter(c => c.path.endsWith('/comments')).map(c => c.body.body) };
}
const seedItem = (db, extra = '') => db.raw.exec("INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('SG-2','SG-2: x','staff','x','claimed'); INSERT INTO claims (item_id,agent) VALUES ('SG-2','staff-1');" + extra);
const merged = { merged: true, merge_commit_sha: 'mmm', state: 'closed' };
const open = (labels = [], body = BODY) => ({ prs: [{ number: 7, title: 'Fix', body, head: { sha: 'aaa' }, labels }], detail: { merged: false, state: 'open', mergeable_state: 'clean' } });
const states = async (db) => (await db.prepare('SELECT state FROM handoff_events ORDER BY id').all()).results.map(r => r.state);

test('US-33-R40: a handoff is declared by the label handoff or by a Handoff block of item, agent, verify and deploy lines that ends at the next heading', async () => {
  assert.deepEqual(parseHandoff(BODY), { item: 'SG-2', agent: 'codex', verify: 'GET https://ultrastable.io/api/v1/status expect "settled"', deploy: 'ultrastable-tick, ultrastable-site' });
  assert.deepEqual(parseHandoff('x\n## Handoff\n- `item`: A-1\n* agent : kimi\n## Next\nverify: GET https://x.y/z'), { item: 'A-1', agent: 'kimi' }, 'bullets and backticks are read; the block stops at the next heading');
  assert.equal(parseHandoff('no block'), null); assert.equal(parseHandoff(null), null);
  assert.deepEqual(parseVerify('GET https://a.b/c'), { method: 'GET', url: 'https://a.b/c', expect: null, status: 200 }, 'the default is HTTP 200');
  assert.deepEqual(parseVerify('HEAD https://a.b/c status 204'), { method: 'HEAD', url: 'https://a.b/c', expect: null, status: 204 });
  assert.equal(parseVerify('GET https://a.b/c expect plain').expect, 'plain'); assert.equal(parseVerify('GET https://a.b/c expect "two words"').expect, 'two words');
  assert.equal(parseVerify('GET http://insecure.example/x'), null, 'only https probes run'); assert.equal(parseVerify('curl https://a.b'), null);
  const seen = []; const probe = (r) => runProbe('GET https://a.b/c expect "ok"', async (url, o) => { seen.push({ url, o }); return r; });
  assert.deepEqual(await probe({ status: 200, text: async () => 'it is ok' }), { ok: true, detail: 'GET https://a.b/c -> 200, contains "ok"' });
  assert.match(seen[0].url, /^https:\/\/a\.b\/c\?handoff_probe=\d+$/, 'a cache-busting query is added'); assert.equal(seen[0].o.headers['cache-control'], 'no-cache');
  assert.match((await probe({ status: 200, text: async () => 'nope' })).detail, /body lacks "ok"/);
  assert.match((await probe({ status: 500, text: async () => 'ok' })).detail, /-> 500, want 200/);
  assert.match((await runProbe('GET https://a.b/c', async () => { throw new Error('boom'); })).detail, /failed: boom/);
  assert.match((await runProbe('see the page')).detail, /no runnable verify line/);
  const db = makeDb(); const g = github(open([{ name: 'handoff' }], 'no block at all'));
  await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: g.f });
  assert.equal((await db.prepare('SELECT id, item FROM handoffs').first()).id, 'o/r#7', 'the label alone is a handoff');
});

test('US-33-R41: open pull requests that declare a handoff, and ones merged in the last day, are registered once, and the pull request is told the server owns it', async () => {
  const NOW = Date.parse('2026-11-26T12:00:00Z');
  const db = makeDb();
  const st = { prs: [{ number: 7, title: 'Fix', body: BODY, head: { sha: 'aaa' }, labels: [] }, { number: 8, title: 'plain', body: 'nothing', head: { sha: 'b' }, labels: [] }],
    closed: [{ number: 9, title: 'fast', body: BODY, head: { sha: 'c' }, labels: [], merged_at: '2026-11-26T11:00:00Z' }, { number: 10, title: 'old', body: BODY, head: { sha: 'd' }, labels: [], merged_at: '2026-11-24T11:00:00Z' }, { number: 11, title: 'closed', body: BODY, head: { sha: 'e' }, labels: [] }],
    detail: { merged: false, state: 'open', mergeable_state: 'clean' } };
  const g = github(st);
  let r = await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: g.f, now: NOW, maxPerTick: 0 });
  assert.deepEqual(r.registered, ['o/r#7', 'o/r#9'], 'no block and no label: not a handoff; merged two days ago or closed unmerged: not picked up');
  const h = await db.prepare("SELECT * FROM handoffs WHERE id='o/r#7'").first();
  assert.deepEqual([h.repo, h.pr, h.item, h.agent, h.deploy, h.head_sha, h.state, h.attempts], ['o/r', 7, 'SG-2', 'codex', 'ultrastable-tick, ultrastable-site', 'aaa', 'open', 0]);
  assert.ok(g.comments().some(c => /handoff received.*ultrastable-tick, ultrastable-site.*closes `SG-2`.*The agent that opened this PR is done/.test(c)));
  r = await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: g.f, now: NOW, maxPerTick: 0 });
  assert.deepEqual(r.registered, [], 'a known handoff is never registered again');
  assert.equal(await registerHandoff(db, { repo: 'o/r', pr: 7, title: 'Fix v2', verify: 'GET https://a.b/c' }), 'o/r#7');
  const again = await db.prepare("SELECT * FROM handoffs WHERE id='o/r#7'").first();
  assert.deepEqual([again.title, again.verify, again.item, again.agent], ['Fix v2', 'GET https://a.b/c', 'SG-2', 'codex'], 'a re-registration updates what it carries and keeps what it lacks');
  assert.equal((await runHandoffs({ repos: ['o/r'], db, token: '' })).status, 'no-token'); assert.equal((await runHandoffs({ repos: ['o/r'], token: 't' })).status, 'no-db');
});

test('US-33-R42: every state change of a handoff is a row, a pull request comment where the author needs it, and a CloudEvents entry in the audit chain', async () => {
  const db = makeDb(); seedItem(db); const g = github(open());
  const dep = async () => ({ ok: true, version: 'v9' }), probe = async () => ({ ok: true, detail: 'probe ok' });
  await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: g.f, deployer: dep, probe });
  g.f.constructor; Object.assign(g, github({ prs: [], detail: merged })); // the pull request is merged before the next tick
  const g2 = github({ prs: [], detail: merged });
  await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: g2.f, deployer: dep, probe });
  assert.deepEqual(await states(db), ['open', 'merged', 'deployed', 'verified']);
  const row = await db.prepare('SELECT * FROM handoffs').first(); assert.deepEqual([row.state, row.merge_sha], ['verified', 'mmm']);
  assert.ok(g2.comments().some(c => /^Ultrastable \(server side, HANDOFF-1\): verified live: probe ok\. Item `SG-2` closed\.$/.test(c)));
  const audit = (await db.prepare("SELECT kind, actor, ref, data FROM audit_log WHERE kind LIKE 'handoff:%' ORDER BY seq").all()).results;
  assert.deepEqual(audit.map(a => a.kind), ['handoff:open', 'handoff:merged', 'handoff:deployed', 'handoff:verified']);
  const ev = JSON.parse(audit[1].data); assert.deepEqual([ev.specversion, ev.type, ev.subject, ev.data.state], ['1.0', 'io.ultrastable.handoff.merged', 'o/r#7', 'merged']);
  assert.equal(handoffEvent('o/r#7', 'blocked', 'x'.repeat(500)).data.detail.length, 300, 'a detail is cut to 300 characters');
  assert.match(handoffEvent('o/r#7', 'open', null, 'acme').source, /^\/tenants\/acme\/loops\/handoff$/);
});

test('US-33-R43: the deploy is of the base branch head, so an older merge can never put production behind a newer one', async () => {
  const db = makeDb(); seedItem(db); const g = github({ ...open(), prs: [], detail: merged, head: 'newest-base-head' });
  await registerHandoff(db, { repo: 'o/r', pr: 7, item: 'SG-2', deploy: 'ultrastable-tick', verify: null });
  const deployed = [];
  const r = await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: g.f, deployer: async (w, sha, repo) => { deployed.push([w, sha, repo]); return { ok: true }; }, probe: async () => ({ ok: true, detail: 'x' }) });
  assert.deepEqual(deployed, [['ultrastable-tick', 'newest-base-head', 'o/r']], 'not the merge commit mmm');
  assert.deepEqual(r.verified, ['o/r#7']);
  assert.equal((await db.prepare("SELECT detail FROM handoff_events WHERE state='verified'").first()).detail, 'no verify line; deploy is the last step', 'no verify line: the deploy is the last step');
  const none = makeDb(); await registerHandoff(none, { repo: 'o/r', pr: 7, deploy: '' });
  const r2 = await runHandoffs({ db: none, token: 't', repos: ['o/r'], fetch: github({ prs: [], detail: merged }).f });
  assert.deepEqual(r2.verified, ['o/r#7'], 'a handoff naming no worker deploys nothing and goes on to its probe');
});

test('US-33-R44: a failed deploy is retried, the third failure blocks the item with the reason, and the tick\'s own subrequest limit is never counted against the change', async () => {
  const db = makeDb(); seedItem(db); const st = { prs: [], detail: merged };
  await registerHandoff(db, { repo: 'o/r', pr: 7, item: 'SG-2', deploy: 'ultrastable-tick' });
  const failing = (detail) => ({ db, token: 't', repos: ['o/r'], fetch: github(st).f, deployer: async () => ({ ok: false, detail }), probe: async () => ({ ok: true }) });
  await runHandoffs(failing('upload: 10021')); let h = await db.prepare('SELECT * FROM handoffs').first();
  assert.deepEqual([h.state, h.attempts], ['deploy_failed', 1]); assert.match(h.detail, /attempt 1: ultrastable-tick: upload: 10021/);
  await runHandoffs(failing('upload: 10021')); await runHandoffs(failing('upload: 10021'));
  h = await db.prepare('SELECT * FROM handoffs').first(); assert.deepEqual([h.state, h.attempts], ['blocked', 3]); assert.match(h.detail, /^deploy failed 3 times: /);
  const it = await db.prepare("SELECT status, blocker FROM items WHERE id='SG-2'").first(); assert.equal(it.status, 'blocked'); assert.match(it.blocker, /^HANDOFF-1 deploy failed: ultrastable-tick: upload: 10021/);
  const db2 = makeDb(); seedItem(db2); await registerHandoff(db2, { repo: 'o/r', pr: 7, item: 'SG-2', deploy: 'ultrastable-tick' });
  const cap = await runHandoffs({ ...failing('Too many subrequests by single Worker invocation.'), db: db2 });
  assert.deepEqual(cap.deferred, ['o/r#7']); const h2 = await db2.prepare('SELECT * FROM handoffs').first(); assert.equal(h2.attempts, 0); assert.match(h2.detail, /^deferred, not an attempt/);
  await runHandoffs({ ...failing('subrequest budget 22/46 used in this invocation'), db: db2 }); assert.equal((await db2.prepare('SELECT attempts FROM handoffs').first()).attempts, 0, 'the worker\'s own meter is capacity too');
  await db2.prepare("UPDATE handoffs SET state = 'blocked', attempts = 3, detail = 'deploy failed 3 times: x: Too many subrequests'").run();
  const back = await runHandoffs({ db: db2, token: 't', repos: ['o/r'], fetch: github(st).f, deployer: async () => ({ ok: true }), probe: async () => ({ ok: true, detail: 'live' }) });
  assert.deepEqual(back.retried, ['o/r#7']); assert.deepEqual(back.verified, ['o/r#7'], 'a handoff blocked only by the limit goes back to the deploy queue');
  const none = await runHandoffs({ db: makeDb(), token: 't', repos: ['o/r'], fetch: github(open()).f });
  assert.equal(none.registered.length, 1);
});

test('US-33-R45: a deploy is proven by the version the worker reports afterwards, never by string equality, and unproven code is rolled back', async () => {
  assert.equal(compareVersions('1.4.0', '1.3.9'), 1); assert.equal(compareVersions('v2.0', '2.0.0'), 0); assert.equal(compareVersions('1.2', '1.10'), -1);
  assert.deepEqual(meetsVersion({ reported: '1.4.0', min_version: '1.3.0' }), { ok: true, detail: 'version 1.4.0 >= min_version 1.3.0' });
  assert.deepEqual(meetsVersion({ reported: '1.2.0', min_version: '1.3.0' }), { ok: false, detail: 'version 1.2.0 < min_version 1.3.0' });
  assert.equal(meetsVersion({ reported: 'dep-b', before: 'dep-a' }).ok, true, 'an opaque id passes when it differs from the one live before');
  assert.deepEqual(meetsVersion({ reported: 'dep-a', before: 'dep-a' }), { ok: false, detail: 'deployment still dep-a: the code did not change' });
  assert.equal(meetsVersion({ reported: '' }).ok, false, 'no reported version fails: an unprovable deploy is not a deploy'); assert.equal(meetsVersion({ reported: null, min_version: '1.0.0' }).ok, false);
  const world = (versionOf) => { const db = makeDb(); seedItem(db); const g = github({ prs: [], detail: merged }); const rolled = [];
    const run = runHandoffs({ db, token: 't', repos: ['o/r'], fetch: g.f, deployer: async () => ({ ok: true, version: 'dep-new' }), rollback: async (w) => { rolled.push(w); return { ok: true, detail: 'rolled back' }; }, versionOf, probe: async () => ({ ok: true, detail: 'live' }) });
    return { db, run, rolled }; };
  await registerHandoff((w => w)(makeDb()), { repo: 'o/r', pr: 7 }).catch(() => {});
  let w = world(async () => ({ ok: true, version: 'dep-old' })); await registerHandoff(w.db, { repo: 'o/r', pr: 7, item: 'SG-2', deploy: 'ultrastable-tick', verify: 'GET https://a.b/c' });
  let r = await w.run; assert.deepEqual(r.rolled_back, ['o/r#7']); assert.deepEqual(w.rolled, ['ultrastable-tick']);
  assert.match((await w.db.prepare("SELECT detail FROM handoff_events WHERE state='verify_failed'").first()).detail, /^version check: ultrastable-tick: deployment still dep-old/);
  w = world(async () => ({ ok: false, version: null, detail: 'site not serving /__internal/version' })); await registerHandoff(w.db, { repo: 'o/r', pr: 7, item: 'SG-2', deploy: 'ultrastable-tick' });
  r = await w.run; assert.deepEqual(r.verified, ['o/r#7'], 'a reader that cannot answer is recorded, not taken as a bad deploy');
  assert.match((await w.db.prepare("SELECT detail FROM handoff_events WHERE detail LIKE 'version check:%'").first()).detail, /version unreadable .* not checked/);
});

test('US-33-R46: the live probe is retried before it is believed, so a deploy that has not reached the edge yet is not rolled back', async () => {
  const db = makeDb(); seedItem(db); await registerHandoff(db, { repo: 'o/r', pr: 7, item: 'SG-2', deploy: 'ultrastable-tick', verify: 'GET https://a.b/c expect "x"' });
  const g = github({ prs: [], detail: merged }); let n = 0; const rolled = [];
  const tick = () => runHandoffs({ db, token: 't', repos: ['o/r'], fetch: g.f, deployer: async () => ({ ok: true }), rollback: async (w) => { rolled.push(w); return { ok: true, detail: 'rb' }; }, probe: async () => (++n < 3 ? { ok: false, detail: 'GET -> 404' } : { ok: true, detail: 'GET -> 200' }) });
  let r = await tick(); assert.deepEqual(r.retried, ['o/r#7']); assert.equal((await db.prepare('SELECT state FROM handoffs').first()).state, 'deployed');
  r = await tick(); assert.deepEqual(r.retried, ['o/r#7']); r = await tick(); assert.deepEqual(r.verified, ['o/r#7']);
  assert.deepEqual(rolled, []); const details = (await db.prepare("SELECT detail FROM handoff_events WHERE detail LIKE 'verify retry %' ORDER BY id").all()).results.map(x => x.detail);
  assert.deepEqual(details, ['verify retry 1/3: GET -> 404', 'verify retry 2/3: GET -> 404']);
});

test('US-33-R47: a probe that stays red rolls back every deploy target and returns the item to ready, and a rollback that was only a propagation race heals itself', async () => {
  const db = makeDb(); seedItem(db); await registerHandoff(db, { repo: 'o/r', pr: 7, item: 'SG-2', deploy: 'ultrastable-tick, ultrastable-site', verify: 'GET https://a.b/c' });
  const g = github({ prs: [], detail: merged }); const rolled = []; let ok = false;
  const tick = (extra = {}) => runHandoffs({ db, token: 't', repos: ['o/r'], fetch: g.f, deployer: async () => ({ ok: true }), rollback: async (w) => { rolled.push(w); return { ok: true, detail: 'to v' + w.length }; }, probe: async () => (ok ? { ok: true, detail: 'GET -> 200' } : { ok: false, detail: 'GET -> 500' }), ...extra });
  await tick(); await tick(); const r = await tick();
  assert.deepEqual(r.rolled_back, ['o/r#7']); assert.deepEqual(rolled, ['ultrastable-tick', 'ultrastable-site']);
  assert.deepEqual(await states(db), ['merged', 'deployed', 'deployed', 'deployed', 'verify_failed', 'rolled_back'], 'two verify retries are events, then the failure and the rollback');
  assert.equal((await db.prepare("SELECT status FROM items WHERE id='SG-2'").first()).status, 'ready');
  assert.match((await db.prepare("SELECT detail FROM handoff_events WHERE state='rolled_back'").first()).detail, /ultrastable-tick: to v16; ultrastable-site: to v16/);
  assert.ok(g.comments().some(c => /live probe failed \(GET -> 500\)\. Rolled back: .*Item `SG-2` is back to ready for the executor\./.test(c)));
  ok = true; const heal = await tick({ deployer: async () => assert.fail('a rolled back handoff is not deployed again') });
  assert.deepEqual(heal.recovered, ['o/r#7']); assert.equal((await db.prepare('SELECT state FROM handoffs').first()).state, 'verified');
  assert.equal((await db.prepare("SELECT status FROM items WHERE id='SG-2'").first()).status, 'done');
  // a version-check rollback is not a race: the old code is what a probe would see, so it never self-heals
  const db2 = makeDb(); seedItem(db2); await registerHandoff(db2, { repo: 'o/r', pr: 7, item: 'SG-2', deploy: 'ultrastable-tick', verify: 'GET https://a.b/c' });
  const bad = { db: db2, token: 't', repos: ['o/r'], fetch: g.f, deployer: async () => ({ ok: true, version: 'same' }), rollback: async () => ({ ok: true, detail: 'rb' }), versionOf: async () => ({ ok: true, version: 'same' }), probe: async () => ({ ok: true, detail: 'ok' }) };
  assert.deepEqual((await runHandoffs(bad)).rolled_back, ['o/r#7']); const after = await runHandoffs(bad);
  assert.deepEqual(after.recovered, []); assert.equal((await db2.prepare('SELECT state FROM handoffs').first()).state, 'rolled_back');
});

test('US-33-R48: a verified handoff closes its item and releases its claim, and only an item of this runtime\'s own tenant', async () => {
  const db = makeDb(); db.raw.exec("INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('MINE-1','x','staff','x','claimed'),('NULL-1','x','staff','x','claimed'); INSERT INTO items (id,title,owner_role,done_check,status,tenant_id) VALUES ('OWN-T','x','staff','x','claimed','mine'),('THEIRS','x','staff','x','claimed','other'); INSERT INTO claims (item_id,agent) VALUES ('MINE-1','a'),('OWN-T','a'),('THEIRS','b');");
  for (const [pr, item] of [[7, 'OWN-T'], [8, 'THEIRS']]) await registerHandoff(db, { repo: 'o/r', pr, item });
  const f = async (url, o = {}) => { const path = url.replace('https://api.github.com', ''), m = /\/pulls\/(\d+)$/.exec(path); if (m && (o.method || 'GET') === 'GET') return R(merged); if (path.includes('/pulls?')) return R([]); if (path === '/repos/o/r') return R({ default_branch: 'main' }); if (path === '/repos/o/r/commits/main') return R({ sha: 'h' }); return R({}, 201); };
  const r = await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: f, deployer: async () => ({ ok: true }), probe: async () => ({ ok: true, detail: 'ok' }), tenant: 'mine' });
  assert.deepEqual(r.verified.sort(), ['o/r#7', 'o/r#8']);
  const st = async (id) => (await db.prepare('SELECT status FROM items WHERE id = ?').bind(id).first()).status;
  assert.equal(await st('OWN-T'), 'done'); assert.equal(await st('THEIRS'), 'claimed', 'an item of another tenant is never advanced, whatever a handoff block names');
  assert.equal(await db.prepare("SELECT * FROM claims WHERE item_id='OWN-T'").first(), null, 'its claim is released'); assert.ok(await db.prepare("SELECT * FROM claims WHERE item_id='THEIRS'").first(), 'the other tenant keeps its claim');
});

test('US-33-R49: the deploy flattens relative imports into one upload, binds only what the topology says is live, and goes through the site Worker that alone holds the Cloudflare credential', async () => {
  const files = { 'w/main.js': 'import a from "./a.js";\nimport spec from "../d/q.json" with { type: \'json\' };\nimport { x } from "../seed/a.js";', 'w/a.js': 'export default 1', 'd/q.json': '{ "k": 1 }', 'seed/a.js': 'export const x = 3' };
  const mods = await collectModules(async p => { if (!(p in files)) throw new Error('missing ' + p); return files[p]; }, 'w/main.js');
  assert.deepEqual(mods.map(m => m.name), ['main.js', 'a.js', 'q.json.js', 'a-1.js'], 'a name that collides is made unique; JSON becomes a JavaScript module');
  assert.match(mods[0].src, /from "\.\/q\.json\.js"/); assert.doesNotMatch(mods[0].src, /type: 'json'/); assert.equal(mods[2].src, 'export default {"k":1};\n');
  assert.ok(mods.every(m => m.type === 'application/javascript+module'));
  let batches = 0; const read = async p => files[p];
  await collectModules(read, 'w/main.js', async (paths) => { batches++; assert.ok(paths.length >= 1); });
  assert.ok(batches >= 2 && batches <= 3, 'one prefetch per import level, not one request per file'); assert.equal(RAW_CHUNK, 12);
  const topo = { compatibility_date: '2026-11-12', stores: { d1: [{ name: 'org', id: 'D1', state: 'live' }, { name: 'later', id: 'D2', state: 'planned' }], kv: [{ name: 'k', id: 'K1', state: 'live' }], r2: [{ name: 'audit', state: 'live' }, { name: 'soon', state: 'planned' }] },
    workers: [{ id: 'ultrastable-tick', state: 'live', main: 'w/main.js', public: false, crons: ['*/10 * * * *'], bindings: { d1: { DB: 'org', LATER: 'later' }, kv: { KV: 'k' }, r2: { AUDIT: 'audit', SOON: 'soon' }, ai: ['AI'], services: { SITE: 'ultrastable-site', GONE: 'ultrastable-gone' }, durable_objects: { TENANT: 'TenantDO' }, vars: { MODE: 'x' } } }, { id: 'ultrastable-site', state: 'live', main: 'site/w.js' }, { id: 'ultrastable-gone', state: 'planned' }] };
  assert.deepEqual(topologyBindings(topo, 'ultrastable-tick').bindings.map(b => `${b.type}:${b.name}`), ['d1:DB', 'kv_namespace:KV', 'r2_bucket:AUDIT', 'ai:AI', 'service:SITE', 'durable_object_namespace:TENANT', 'plain_text:MODE']);
  assert.equal(topologyBindings(topo, 'ultrastable-nope'), null);
  const readGh = async (url) => { const p = decodeURIComponent(url.split('/contents/')[1].split('?')[0]); const body = p === 'doctrine/topology.json' ? JSON.stringify(topo) : files[p]; return { ok: body != null, status: body != null ? 200 : 404, text: async () => body }; };
  let posted; const site = { fetch: async (u, o) => { posted = { u, o, body: JSON.parse(o.body) }; return { ok: true, json: async () => ({ ok: true, version: 'v7' }) }; } };
  const r = await makeDeployer({ token: 't', fetch: readGh, site, key: 'K' })('ultrastable-tick', 'abcdef1234567890', 'o/r');
  assert.equal(r.ok, true); assert.equal(posted.u, 'https://internal/__internal/deploy'); assert.equal(posted.o.headers['x-internal-key'], 'K'); assert.equal(posted.body.tag, 'abcdef123456'); assert.equal(posted.body.workers_dev, true, 'a non-public worker is served on workers.dev');
  assert.deepEqual(posted.body.crons, ['*/10 * * * *']); assert.equal(posted.body.name, 'ultrastable-tick');
  await makeDeployer({ token: 't', fetch: readGh, site, oidc: 'JWT' })('ultrastable-tick', 'abcdef1234567890', 'o/r'); assert.equal(posted.o.headers.authorization, 'Bearer JWT'); assert.equal(posted.o.headers['x-internal-key'], undefined, 'an Actions run proves itself with its OIDC token instead of the shared key');
  assert.match((await makeDeployer({ token: 't', fetch: readGh, site, key: 'K' })('ultrastable-gone', 'abc', 'o/r')).detail, /is planned, not live/); assert.match((await makeDeployer({ token: 't', fetch: readGh, site, key: 'K' })('ultrastable-zz', 'abc', 'o/r')).detail, /is not in doctrine\/topology\.json/);
  // the site Worker's side: a stranger gets 404, the name must be a platform worker, and the credential is read from its own environment only
  const req = (path, headers = {}, body = '{}', method = 'POST') => new Request('https://x.test' + path, { method, headers, body: method === 'POST' ? body : undefined });
  assert.equal(await internalDeploy(req('/page'), { INTERNAL_DEPLOY_KEY: 'K' }), null, 'only /__internal/ paths are handled');
  assert.equal((await internalDeploy(req('/__internal/deploy'), { INTERNAL_DEPLOY_KEY: 'K', CF_DEPLOY_TOKEN: 't', CF_ACCOUNT_ID: 'a' })).status, 404);
  assert.equal((await internalDeploy(req('/__internal/deploy', { 'x-internal-key': 'wrong' }), { INTERNAL_DEPLOY_KEY: 'K', CF_DEPLOY_TOKEN: 't', CF_ACCOUNT_ID: 'a' })).status, 404);
  assert.equal((await internalDeploy(req('/__internal/deploy', { 'x-internal-key': 'K' }, '{}', 'GET'), { INTERNAL_DEPLOY_KEY: 'K', CF_DEPLOY_TOKEN: 't', CF_ACCOUNT_ID: 'a' })).status, 404, 'POST only');
  const env = { INTERNAL_DEPLOY_KEY: 'K', CF_DEPLOY_TOKEN: 't', CF_ACCOUNT_ID: 'a' };
  assert.equal((await internalDeploy(req('/__internal/deploy', { 'x-internal-key': 'K' }, JSON.stringify({ name: 'evil-worker', main: 'a', modules: [{}] })), env)).status, 400);
  assert.equal((await internalDeploy(req('/__internal/deploy', { 'x-internal-key': 'K' }, JSON.stringify({ name: 'ultrastable-tick' })), env)).status, 400);
  assert.equal((await internalDeploy(req('/__internal/deploy', { 'x-internal-key': 'K' }), { INTERNAL_DEPLOY_KEY: 'K' })).status, 503, 'no Cloudflare credential on the site: refused, not faked');
  // rollback and version readers speak to the same route with the key
  let hit; const s2 = { fetch: async (u, o) => { hit = { u, k: o.headers['x-internal-key'] }; return { ok: true, json: async () => ({ ok: true, version: 'dep-1', detail: 'rolled back to v' }) }; } };
  assert.deepEqual(await makeVersionReader({ site: s2, key: 'K' })('ultrastable-tick'), { ok: true, version: 'dep-1', detail: 'rolled back to v' }); assert.equal(hit.u, 'https://internal/__internal/version');
  assert.equal((await makeRollback({ site: s2, key: 'K' })('ultrastable-tick')).ok, true); assert.equal(hit.u, 'https://internal/__internal/rollback'); assert.equal(hit.k, 'K');
});
