// HANDOFF-1: a code agent's work ends at an open PR; the server records, notices the merge, deploys, probes, then closes the item or rolls back and reopens it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { parseHandoff, parseVerify, runHandoffs, collectModules, topologyBindings, makeDeployer } from '../src/handoff.js';

const BODY = 'Fix\n\n## Handoff\nitem: SG-2\nagent: codex\nverify: GET https://ultrastable.io/api/v1/status expect "settled"\ndeploy: ultrastable-tick\n\n## Self-audit\nReal output: x';

function gh(state) {
  const calls = [];
  const f = async (url, o = {}) => {
    const m = o.method || 'GET', path = url.replace('https://api.github.com', ''); calls.push(m + ' ' + path + (o.body && m === 'POST' ? ' ' + o.body : ''));
    const R = (j, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(j) });
    if (m === 'GET' && path.startsWith('/repos/o/r/pulls?state=closed')) return R(state.closed || []);
    if (m === 'GET' && path.startsWith('/repos/o/r/pulls?')) return R(state.prs);
    if (m === 'GET' && /\/pulls\/7$/.test(path)) return R(state.detail);
    if (m === 'POST' && path.endsWith('/comments')) return R({ id: 1 }, 201);
    if (m === 'GET' && path === '/repos/o/r') return R({ default_branch: 'main' });
    if (m === 'GET' && path === '/repos/o/r/commits/main') return R({ sha: state.head || 'head1' });
    return R({ message: 'unexpected ' + m + ' ' + path }, 404);
  };
  return { f, calls };
}
function seedItem(db) { db.raw.exec("INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('SG-2','SG-2: x','staff','x','claimed'); INSERT INTO claims (item_id,agent) VALUES ('SG-2','staff-1');"); }

test('parseHandoff reads the block and stops at the next heading', () => {
  assert.deepEqual(parseHandoff(BODY), { item: 'SG-2', agent: 'codex', verify: 'GET https://ultrastable.io/api/v1/status expect "settled"', deploy: 'ultrastable-tick' });
  assert.equal(parseHandoff('no block here'), null);
  assert.deepEqual(parseVerify('GET https://a.b/c expect "ok yes" status 201'), { method: 'GET', url: 'https://a.b/c', expect: 'ok yes', status: 201 });
  assert.equal(parseVerify('curl http://insecure'), null, 'only https probes run');
});

test('open PR -> registered -> merged -> deployed -> verified closes the item', async () => {
  const db = makeDb(); seedItem(db);
  const st = { prs: [{ number: 7, title: 'Fix', body: BODY, head: { sha: 'aaa' }, labels: [] }], detail: { merged: false, state: 'open', mergeable_state: 'clean' } };
  const { f, calls } = gh(st);
  const deployed = [];
  const deployer = async (w, sha) => { deployed.push(w + '@' + sha); return { ok: true, version: 'v9' }; };
  const probe = async (spec) => ({ ok: true, detail: 'probe ok for ' + spec });
  let r = await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: f, deployer, probe });
  assert.deepEqual(r.registered, ['o/r#7']);
  assert.ok(calls.some(c => c.includes('/issues/7/comments') && c.includes('handoff received')), 'the PR is told the agent is done');
  assert.equal((await db.prepare('SELECT state FROM handoffs').first()).state, 'open');
  st.detail = { merged: true, merge_commit_sha: 'mmm', state: 'closed' }; st.prs = [];
  r = await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: f, deployer, probe });
  assert.deepEqual(r.merged, ['o/r#7']); assert.deepEqual(r.deployed, ['o/r#7']); assert.deepEqual(r.verified, ['o/r#7']);
  assert.deepEqual(deployed, ['ultrastable-tick@head1'], 'deployed from the base branch head, which contains the merge and never rolls back a newer one');
  assert.match((await db.prepare("SELECT detail FROM handoff_events WHERE state='deployed'").first()).detail, /from head1/);
  const h = await db.prepare('SELECT * FROM handoffs').first();
  assert.equal(h.state, 'verified'); assert.equal(h.merge_sha, 'mmm');
  assert.equal((await db.prepare("SELECT status FROM items WHERE id='SG-2'").first()).status, 'done');
  assert.equal(await db.prepare("SELECT * FROM claims WHERE item_id='SG-2'").first(), null, 'claim released');
  const ev = (await db.prepare('SELECT state FROM handoff_events ORDER BY id').all()).results.map(x => x.state);
  assert.deepEqual(ev, ['open', 'merged', 'deployed', 'verified']);
  r = await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: f, deployer, probe });
  assert.equal(r.verified.length, 0, 'a verified handoff is never re-run');
});

test('a PR merged before any tick saw it open is still owned by the server', async () => {
  const db = makeDb(); seedItem(db);
  const NOW = Date.parse('2026-11-14T16:00:00Z');
  const st = { prs: [], closed: [{ number: 7, title: 'Fix', body: BODY, head: { sha: 'aaa' }, labels: [], merged_at: '2026-11-14T15:00:00Z' }, { number: 6, title: 'old', body: BODY, head: { sha: 'b' }, labels: [], merged_at: '2026-11-10T15:00:00Z' }], detail: { merged: true, merge_commit_sha: 'mmm', state: 'closed' } };
  const r = await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: gh(st).f, deployer: async () => ({ ok: true }), probe: async () => ({ ok: true, detail: 'ok' }), now: NOW });
  assert.deepEqual(r.registered, ['o/r#7'], 'merged within a day: registered; older merges are left alone');
  assert.deepEqual(r.verified, ['o/r#7']);
  const again = await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: gh(st).f, deployer: async () => ({ ok: true }), probe: async () => ({ ok: true }), now: NOW });
  assert.equal(again.registered.length, 0, 'not re-registered once known');
});

test('a red probe rolls the deploy back and puts the item back to ready', async () => {
  const db = makeDb(); seedItem(db);
  const st = { prs: [{ number: 7, title: 'Fix', body: BODY, head: { sha: 'aaa' }, labels: [] }], detail: { merged: true, merge_commit_sha: 'mmm', state: 'closed' } };
  const { f, calls } = gh(st); const rolled = [];
  const r = await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: f, deployer: async () => ({ ok: true }), rollback: async (w) => { rolled.push(w); return { ok: true, detail: 'rolled back to v8' }; }, probe: async () => ({ ok: false, detail: 'GET ... -> 500' }) });
  assert.deepEqual(r.rolled_back, ['o/r#7']); assert.deepEqual(rolled, ['ultrastable-tick']);
  assert.equal((await db.prepare('SELECT state FROM handoffs').first()).state, 'rolled_back');
  assert.equal((await db.prepare("SELECT status FROM items WHERE id='SG-2'").first()).status, 'ready');
  assert.ok(calls.some(c => c.includes('live probe failed')));
});

test('deploy failures retry, then block the item with the reason; conflicts are owned server-side; no deployer is reported, not faked', async () => {
  const db = makeDb(); seedItem(db);
  const st = { prs: [{ number: 7, title: 'Fix', body: BODY, head: { sha: 'aaa' }, labels: [] }], detail: { merged: true, merge_commit_sha: 'mmm', state: 'closed' } };
  const { f } = gh(st);
  for (let i = 0; i < 3; i++) await runHandoffs({ db, token: 't', repos: ['o/r'], fetch: f, deployer: async () => ({ ok: false, detail: 'upload: 10021' }), probe: async () => ({ ok: true }) });
  const h = await db.prepare('SELECT * FROM handoffs').first();
  assert.equal(h.attempts, 3); assert.equal(h.state, 'blocked');
  const it = await db.prepare("SELECT status, blocker FROM items WHERE id='SG-2'").first(); assert.equal(it.status, 'blocked'); assert.match(it.blocker, /10021/);

  const db2 = makeDb(); const s2 = { prs: [{ number: 7, title: 'x', body: 'body', head: { sha: 'b' }, labels: [{ name: 'handoff' }] }], detail: { merged: false, state: 'open', mergeable_state: 'dirty' } };
  const g2 = gh(s2); await runHandoffs({ db: db2, token: 't', repos: ['o/r'], fetch: g2.f });
  assert.equal((await db2.prepare('SELECT state FROM handoffs').first()).state, 'conflict', 'label alone is a handoff; a conflict is recorded');

  const db3 = makeDb(); const s3 = { prs: [{ number: 7, title: 'x', body: BODY, head: { sha: 'b' }, labels: [] }], detail: { merged: true, merge_commit_sha: 'm', state: 'closed' } };
  const r3 = await runHandoffs({ db: db3, token: 't', repos: ['o/r'], fetch: gh(s3).f });
  assert.deepEqual(r3.failed, ['o/r#7']); assert.match((await db3.prepare('SELECT detail FROM handoffs').first()).detail, /no deployer/);
  assert.equal((await runHandoffs({ db: db3, token: '', repos: ['o/r'] })).status, 'no-token');
});

test('collectModules flattens nested relative imports and the deployer posts them with topology bindings', async () => {
  const files = { 'site/worker.js': 'import a from "./a.js";\nimport { x } from "../seed/lib/a.js";\nexport default {}', 'site/a.js': 'import "./b.js"; export default 1', 'site/b.js': 'export const b = 2', 'seed/lib/a.js': 'export const x = 3' };
  const mods = await collectModules(async p => { if (!(p in files)) throw new Error('missing ' + p); return files[p]; }, 'site/worker.js');
  assert.deepEqual(mods.map(m => m.name), ['worker.js', 'a.js', 'a-1.js', 'b.js']);
  assert.match(mods[0].src, /from "\.\/a\.js"/); assert.match(mods[0].src, /from "\.\/a-1\.js"/); assert.match(mods[1].src, /import "\.\/b\.js"/);
  const jm = await collectModules(async p => ({ 'w/i.js': "import spec from '../b/q.json' with { type: 'json' };\nexport default spec", 'b/q.json': '{ "a": 1 }' })[p], 'w/i.js');
  assert.deepEqual(jm.map(m => m.name), ['i.js', 'q.json.js']); assert.equal(jm[0].src, "import spec from './q.json.js';\nexport default spec");
  assert.equal(jm[1].src, 'export default {"a":1};\n'); assert.ok(jm.every(m => m.type === 'application/javascript+module'), 'no JSON module type is sent (10162)');
  const topo = { compatibility_date: '2026-11-12', stores: { d1: [{ name: 'ultrastable-org', id: 'D', state: 'live' }], kv: [] }, workers: [{ id: 'ultrastable-site', state: 'live', main: 'site/worker.js', bindings: { d1: { ORG: 'ultrastable-org' }, ai: ['AI'], services: { TICK: 'ultrastable-tick' } } }, { id: 'ultrastable-tick', state: 'live' }] };
  assert.deepEqual(topologyBindings(topo, 'ultrastable-site').bindings, [{ type: 'd1', name: 'ORG', id: 'D' }, { type: 'ai', name: 'AI' }, { type: 'service', name: 'TICK', service: 'ultrastable-tick' }]);
  const read = async (url) => { const p = decodeURIComponent(url.split('/contents/')[1].split('?')[0]); const body = p === 'doctrine/topology.json' ? JSON.stringify(topo) : files[p]; return { ok: body != null, status: body != null ? 200 : 404, text: async () => body }; };
  let posted = null; const site = { fetch: async (u, o) => { posted = { u, key: o.headers['x-internal-key'], body: JSON.parse(o.body) }; return { ok: true, json: async () => ({ ok: true, version: 'v1' }) }; } };
  const r = await makeDeployer({ token: 't', fetch: read, site, key: 'K' })('ultrastable-site', 'abc123', 'o/r');
  assert.equal(r.ok, true); assert.equal(posted.key, 'K'); assert.equal(posted.body.main, 'worker.js'); assert.equal(posted.body.modules.length, 4); assert.equal(posted.body.bindings[0].name, 'ORG');
  assert.equal((await makeDeployer({ token: 't', fetch: read, site, key: 'K' })('ultrastable-nope', 'abc', 'o/r')).ok, false);
  files['site/b.js'] = undefined; delete files['site/b.js'];
  const g = await makeDeployer({ token: 't', fetch: read, site, key: 'K', generated: { 'site/b.js': 'export const b = 9' } })('ultrastable-site', 'abc123', 'o/r');
  assert.equal(g.ok, true, 'a generated module not in git is supplied by the tick');
  const cfgFiles = { 'seed/autonomy/policy.json': '{"trust":{"t":1},"ladder":{"l":1},"surfaces":{}}', 'seed/autonomy/failure-modes.json': '{"modes":[{"id":"a"}]}', 'instances/ultrastable/failure-modes.json': '{"modes":[{"id":"b"}]}', 'seed/autonomy/criticality.json': '{"floor":0.5}', 'instances/ultrastable/cost-budgets.json': '{"budgets":[{"id":"d1"}]}' };
  const { tickConfigSource } = await import('../src/handoff.js');
  const cs = await tickConfigSource(async p => cfgFiles[p]);
  const cfg = JSON.parse(cs.slice(cs.indexOf('export default ') + 15, cs.lastIndexOf(';')));
  assert.equal(cfg.org_slug, 'ultrastable'); assert.deepEqual(cfg.failure_modes.modes.map(m => m.id), ['a', 'b']); assert.equal(cfg.criticality.floor, 0.5); assert.deepEqual(cfg.cost_budgets, [{ id: 'd1' }]); assert.equal(posted.body.modules.find(m => m.name === 'b.js').src, 'export const b = 9');
});
