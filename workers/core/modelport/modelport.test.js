// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-14 section 3: the Models port (alias to endpoint, completion with token counts, US-14-R10 deploy check) and the
// Role runtime port (one instance per role).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeDb } from '../_shared/testdb.js';
import { createModelPort, createRoleRuntime } from './index.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
const aliases = (reviewerFamily = 'family-b') => ({
  small: { endpoint: 'edge', model: 'm-small', family: 'family-a' },
  medium: { endpoint: 'edge', model: 'm-medium', family: 'family-a' },
  large: { endpoint: 'hosted', model: 'm-large', family: reviewerFamily, key_env: 'HOSTED_KEY' },
});
const endpoints = {
  edge: async ({ model, messages }) => ({ text: `${model}:${messages.at(-1).content}`, tokens_in: 7, tokens_out: 3 }),
  hosted: async ({ model }) => ({ text: `${model}:ok`, tokens_in: 11, tokens_out: 5 }),
};
const port = (over = {}) => createModelPort({ config: { aliases: aliases(), roles: { doer: 'medium', reviewer: 'large' } }, endpoints, env: { HOSTED_KEY: true }, ...over });

test('Models port: an alias resolves to an endpoint and returns a completion with token counts', async () => {
  const p = port();
  assert.deepEqual(p.resolve('small'), { ok: true, alias: 'small', endpoint: 'edge', model: 'm-small', family: 'family-a' });
  assert.deepEqual(await p.complete('small', { messages: [{ role: 'user', content: 'hi' }] }), { ok: true, text: 'm-small:hi', tokens_in: 7, tokens_out: 3, alias: 'small', model: 'm-small', family: 'family-a' });
  assert.equal(p.resolve('huge').ok, false);
});

test('Models port: an endpoint that returns no token counts, or throws, is an error and never a made-up completion', async () => {
  const p = port({ endpoints: { edge: async () => ({ text: 'x' }), hosted: async () => { throw new Error('503 from upstream'); } } });
  assert.match((await p.complete('small', { messages: [] })).error, /token counts/);
  const r = await p.complete('large', { messages: [] });
  assert.equal(r.ok, false); assert.match(r.error, /503 from upstream/); assert.equal(r.family, 'family-b');
});

test('US-14-R04: the port sees only whether a key is present; a missing key makes the alias unusable', async () => {
  const p = port({ env: { HOSTED_KEY: false } });
  assert.match(p.resolve('large').error, /HOSTED_KEY is not present/);
  assert.equal((await p.complete('large', { messages: [] })).ok, false);
  const leaky = port({ env: { HOSTED_KEY: 'a-secret-value' } });
  assert.equal(leaky.resolve('large').ok, false, 'a value in place of the presence flag is not accepted');
});

test('US-14-R10: the deploy check fails when reviewer and doer resolve to one family while two are available', () => {
  assert.deepEqual(port().deployCheck().errors, []);
  assert.deepEqual(port().deployCheck().families, ['family-a', 'family-b']);
  const same = port({ config: { aliases: aliases(), roles: { doer: 'medium', reviewer: 'small' } } }).deployCheck();
  assert.equal(same.ok, false); assert.match(same.errors[0], /both resolve to family family-a while 2 families are available/);
});

test('US-14-R10: with one family available the check passes with a warning; a second family whose key is absent does not count', () => {
  const one = port({ config: { aliases: aliases('family-a'), roles: { doer: 'medium', reviewer: 'large' } } }).deployCheck();
  assert.equal(one.ok, true); assert.match(one.warnings[0], /only one model family/);
  const noKey = port({ config: { aliases: aliases(), roles: { doer: 'medium', reviewer: 'small' } }, env: {} }).deployCheck();
  assert.ok(!noKey.errors.some(e => /both resolve/.test(e))); assert.ok(noKey.errors.some(e => /HOSTED_KEY/.test(e)));
  const bad = port({ config: { aliases: aliases(), roles: { doer: 'medium', reviewer: 'xl' } } }).deployCheck();
  assert.ok(bad.errors.some(e => /role reviewer names alias xl/.test(e)));
});

const mk = (handlers, cfg = {}) => {
  const db = makeDb([MIG]); const t = { v: T0 };
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('pm-1','product-manager',1,'medium'),('staff-1','staff',1,'small'),('staff-2','staff',1,'custom-model-name');
    INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('A','Write the page','staff','x','claimed'),('B','b','staff','x','claimed'),('C','c','product-manager','x','claimed');`);
  return { db, t, rt: createRoleRuntime({ db, models: port(), handlers, now: () => t.v, config: cfg }) };
};

test('Role runtime: one instance per role row, and a run records the model, family and tokens it used', async () => {
  const { db, rt } = mk({ default: async ({ role, item, complete }) => { const r = await complete({ messages: [{ role: 'user', content: item.title }] }); return { ok: r.ok, detail: `${role.id} said ${r.text}` }; } });
  assert.deepEqual((await rt.instances()).map(i => i.role_id), ['pm-1', 'staff-1', 'staff-2']);
  const r = await rt.runRole('staff-1', { item: { id: 'A', title: 'Write the page' } });
  assert.deepEqual(r, { ok: true, detail: 'staff-1 said m-small:Write the page', alias: 'small', tokens_in: 7, tokens_out: 3, model: 'm-small', family: 'family-a' });
  const row = db.raw.prepare(`SELECT * FROM modelport_runs`).get();
  assert.equal(row.role_id, 'staff-1'); assert.equal(row.item_id, 'A'); assert.equal(row.tokens_in, 7); assert.equal(row.status, 'done'); assert.equal(row.at, '2026-11-15 12:00:00');
  assert.equal((await rt.runRole('staff-2', { item: { id: 'B', title: 'b' } })).alias, 'small', 'a role whose model is not an alias uses the default alias');
  assert.equal((await rt.runRole('nobody')).ok, false);
  const inst = (await rt.instances()).find(i => i.role_id === 'staff-1');
  assert.equal(inst.runs, 1); assert.equal(inst.lease_until, null);
});

test('Role runtime: an instance runs one piece of work at a time; a second runtime is refused until the lease ends', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const { db, t, rt } = mk({ default: async () => { await gate; return { ok: true, detail: 'finished' }; } });
  const other = createRoleRuntime({ db, models: port(), handlers: { default: async () => ({ ok: true, detail: 'other' }) }, now: () => t.v, config: { holder: 'runtime-2' } });
  const first = rt.runRole('staff-1');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(await rt.runRole('staff-1'), { ok: false, busy: true, error: 'this role instance is already running' });
  assert.equal((await other.runRole('staff-1')).busy, true);
  assert.equal((await other.runRole('staff-2')).ok, true, 'another role is not blocked');
  release(); assert.equal((await first).ok, true);
  assert.equal((await other.runRole('staff-1')).ok, true);
  // a runtime that died mid-run: its lease expires and the instance can run again
  await rt.instances();
  db.raw.exec(`UPDATE modelport_instances SET holder='dead', lease_until='2026-11-15 12:10:00' WHERE role_id='pm-1'`);
  assert.equal((await rt.runRole('pm-1')).busy, true);
  t.v += 11 * 60e3;
  assert.equal((await rt.runRole('pm-1')).ok, true);
});

test('Role runtime: queued dispatches are worked by their role instance and end done or failed; a throwing handler is a failed run', async () => {
  const { db, rt } = mk({ staff: async ({ item }) => { if (item.id === 'B') throw new Error('tool crashed'); return { ok: true, detail: `did ${item.id}` }; }, 'product-manager': async () => ({ ok: true, detail: 'planned' }) });
  db.raw.exec(`INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (1,'staff-1','A','small'),(1,'staff-1','B','small'),(1,'pm-1','C','medium')`);
  assert.deepEqual(await rt.runDispatches(), { done: 2, failed: 1, busy: 0 });
  assert.deepEqual(db.raw.prepare(`SELECT item_id, status FROM dispatches ORDER BY id`).all().map(r => `${r.item_id}:${r.status}`), ['A:done', 'B:failed', 'C:done']);
  assert.match(db.raw.prepare(`SELECT detail FROM modelport_runs WHERE item_id='B'`).get().detail, /tool crashed/);
  assert.deepEqual(await rt.runDispatches(), { done: 0, failed: 0, busy: 0 });
  const none = createRoleRuntime({ db, models: port(), handlers: {} });
  assert.match((await none.runRole('staff-1')).error, /no handler for role staff/);
});

test('US-14-R10 and US-14-R16: the command line check prints the same errors as deployCheck and exits 1; a good config exits 0', async () => {
  const { checkConfig, main } = await import('./cli.js');
  // bad: the reviewer alias (small) is the doer's family while family-b is available through large
  const cfg = bad => ({ modelport: { aliases: aliases(), roles: { doer: 'medium', reviewer: bad ? 'small' : 'large' } } });
  const direct = createModelPort({ config: cfg(true).modelport, endpoints, env: { HOSTED_KEY: true } }).deployCheck();
  assert.equal(direct.ok, false);
  assert.deepEqual(checkConfig(cfg(true), { HOSTED_KEY: 'present' }).errors, direct.errors);
  assert.equal(checkConfig(cfg(false), { HOSTED_KEY: 'present' }).ok, true);
  assert.equal(checkConfig(cfg(true), {}).ok, false, 'an alias whose key is missing is itself an error');
  assert.equal(checkConfig(cfg(true), { HOSTED_KEY: 'x' }, ['edge']).ok, false, 'an endpoint the host does not offer is an error');
  const dir = mkdtempSync(path.join(tmpdir(), 'us-mp-'));
  try {
    const bad = path.join(dir, 'bad.json'); const good = path.join(dir, 'good.json');
    writeFileSync(bad, JSON.stringify(cfg(true))); writeFileSync(good, JSON.stringify(cfg(false)));
    const lines = [];
    assert.equal(main([bad], { HOSTED_KEY: 'x' }, l => lines.push(l)), 1);
    assert.match(JSON.parse(lines[0]).errors[0], /reviewer and doer both resolve to family family-a while 2 families/);
    assert.equal(main([good], { HOSTED_KEY: 'x' }, l => lines.push(l)), 0);
    assert.equal(main([path.join(dir, 'missing.json')], {}, l => lines.push(l)), 2);
    assert.equal(main([], {}, l => lines.push(l)), 2);
    // US-14-R16: keys that live in the host's secret store are declared, never read from the deploying shell
    assert.equal(main([good], {}, l => lines.push(l)), 1, 'without the flag a missing key is still an error');
    assert.equal(main([good, '--keys-declared'], {}, l => lines.push(l)), 0);
    assert.equal(main([bad, '--keys-declared'], {}, l => lines.push(l)), 1, 'declared keys never hide a shared family');
    assert.equal(main(['--present', 'HOSTED_KEY', good], {}, l => lines.push(l)), 0, 'an explicit present list is honoured, in any argument order');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the role runtime as a Durable Object, container jobs and an agent engine, on fakes (US-14 section 3, role runtime) ----------------------
import { makeRoleRuntimeDO, roleStub } from './durable.js';
import { containerHandler, agentHandler } from './handlers.js';
import { execute as runContainerJob } from '../../adapters/cloudflare/containers/executor.js';

class FakeBase { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
const fakeCtx = name => { const m = new Map(); let alarm = null; return { id: { toString: () => name }, storage: {
  get: async k => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async k => m.delete(k),
  setAlarm: async t => { alarm = t; }, getAlarm: async () => alarm, deleteAlarm: async () => { alarm = null; } }, _m: m }; };
const mkDO = (handlers, name = 'do-staff-1') => {
  const { db, t } = mk({});
  const DO = makeRoleRuntimeDO(FakeBase, { handlers, models: port(), dbOf: env => env.DB, now: () => t.v });
  const make = n => { const ctx = fakeCtx(n); return { ctx, obj: new DO(ctx, { DB: db }) }; };
  return { db, t, make, ...make(name) };
};

test('Durable Object role runtime: one lease per role in the object\'s own storage; a second concurrent run is busy and another role is not blocked', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const { obj, ctx, make } = mkDO({ default: async () => { await gate; return { ok: true, detail: 'finished' }; } });
  const first = obj.runRole('staff-1');
  await new Promise(r => setImmediate(r));
  assert.equal((await ctx.storage.get('lease')).holder, 'do:do-staff-1');
  assert.deepEqual(await obj.runRole('staff-1'), { ok: false, busy: true, error: 'this role instance is already running' });
  const other = make('do-staff-2');                                                   // another role's object has its own storage and lease
  const second = other.obj.runRole('staff-2'); await new Promise(r => setImmediate(r));
  assert.equal((await other.ctx.storage.get('lease')).holder, 'do:do-staff-2');
  release(); assert.equal((await first).ok, true); assert.equal((await second).ok, true);
  assert.equal(await ctx.storage.get('lease'), undefined, 'the lease is released');
  assert.deepEqual((await obj.instances()).map(i => [i.role_id, i.holder, i.runs]), [['staff-1', null, 1]]);
});

test('Durable Object role runtime: a lease the object died holding expires and the role runs again', async () => {
  const { obj, ctx, t } = mkDO({ default: async () => ({ ok: true, detail: 'ok' }) });
  await ctx.storage.put('lease', { holder: 'dead', until: t.v + 10 * 60e3 });
  assert.equal((await obj.runRole('staff-1')).busy, true);
  t.v += 11 * 60e3;
  assert.equal((await obj.runRole('staff-1')).ok, true);
});

test('Durable Object role runtime: the alarm works this role\'s queued dispatches and re-arms itself while work remains; the same results as the in-process runtime', async () => {
  const handlers = { staff: async ({ item }) => (item.id === 'B' ? { ok: false, detail: 'refused' } : { ok: true, detail: `did ${item.id}` }) };
  const { db, obj, ctx, t } = mkDO(handlers);
  db.raw.exec(`INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (1,'staff-1','A','small'),(1,'staff-1','B','small'),(1,'pm-1','C','medium')`);
  await obj.runRole('staff-1', { item: { id: 'A', title: 'a' } });                      // makes this object the instance of staff-1
  await obj.wake(500); assert.equal(await ctx.storage.getAlarm(), t.v + 500);
  assert.deepEqual(await obj.alarm(), { done: 1, failed: 1, busy: 0, role: 'staff-1' });
  assert.deepEqual(db.raw.prepare(`SELECT item_id, status FROM dispatches ORDER BY id`).all().map(r => `${r.item_id}:${r.status}`), ['A:done', 'B:failed', 'C:queued'], 'only this role\'s rows are worked');
  assert.equal(await ctx.storage.getAlarm(), t.v + 500, 'nothing of this role is left, so no alarm was armed beyond the one set');
  // the in-process runtime on the same data gives the same statuses
  const same = mk(handlers); same.db.raw.exec(`INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (1,'staff-1','A','small'),(1,'staff-1','B','small')`);
  await same.rt.runDispatches();
  assert.deepEqual(same.db.raw.prepare(`SELECT item_id, status FROM dispatches ORDER BY id`).all().map(r => `${r.item_id}:${r.status}`), ['A:done', 'B:failed']);
  assert.throws(() => roleStub({ ROLE_RUNTIME: {} }, '../x'), /bad_role_id/);
  assert.deepEqual(await mkDO({}).obj.runDispatches(), { done: 0, failed: 0, busy: 0, role: null });
});

test('Durable Object role runtime: a busy dispatch is put back and the alarm arms again', async () => {
  const { db, obj, ctx, t } = mkDO({ default: async () => ({ ok: true, detail: 'ok' }) });
  await obj.runRole('staff-1');
  db.raw.exec(`INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (1,'staff-1','A','small')`);
  await ctx.storage.deleteAlarm(); await ctx.storage.put('lease', { holder: 'other', until: t.v + 60e3 });
  const r = await obj.alarm();
  assert.equal(r.busy, 1); assert.equal(db.raw.prepare(`SELECT status FROM dispatches`).get().status, 'queued');
  assert.equal(await ctx.storage.getAlarm(), t.v + 60e3, 'armed again');
});

test('a container-job handler runs a queued dispatch through the ordered executors and fails over to the second', async () => {
  const executors = [{ name: 'platform', run: async () => { throw new Error('no container binding here'); } }, { name: 'http', run: async job => ({ exit_code: 0, stdout: `ran ${job.command}` }) }];
  const handler = containerHandler({ execute: job => runContainerJob({ executors }, job), buildJob: ({ item }) => (item ? { command: `echo ${item.id}` } : null) });
  const { db, rt } = mk({ default: handler });
  db.raw.exec(`INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (1,'staff-1','A','small')`);
  assert.deepEqual(await rt.runDispatches(), { done: 1, failed: 0, busy: 0 });
  assert.match(db.raw.prepare(`SELECT detail FROM modelport_runs`).get().detail, /^http exit 0: ran echo A/);
  const refused = containerHandler({ execute: job => runContainerJob({ executors }, job), buildJob: () => ({ command: '   ' }) });
  assert.match((await refused({ role: {}, item: { id: 'A' } })).detail, /invalid_job: command required/);
  const none = containerHandler({ execute: job => runContainerJob({ executors: [] }, job), buildJob: () => ({ command: 'true' }) });
  assert.deepEqual(await none({ role: {}, item: { id: 'A' } }), { ok: false, detail: 'no_executor' });
  assert.deepEqual(await containerHandler({ execute: async () => ({}), buildJob: () => null })({ item: null }), { ok: false, detail: 'no job could be built for this item' });
  assert.throws(() => containerHandler({}), /needs execute and buildJob/);
});

test('an agent-engine handler returns the final answer of a bounded turn or an explicit refusal', async () => {
  const seen = [];
  const ok = agentHandler({ createRuntime: ({ role }) => ({ turn: async (sid, text) => { seen.push([role.id, sid, text]); return { ok: true, text: 'the page is written', steps: 1 }; } }) });
  assert.deepEqual(await ok({ role: { id: 'staff-1' }, item: { id: 'A', title: 'Write the page', done_check: 'page live' } }), { ok: true, detail: 'the page is written' });
  assert.deepEqual(seen[0], ['staff-1', 'staff-1:A', 'Work item A: Write the page. Done check: page live']);
  const stuck = agentHandler({ createRuntime: () => ({ turn: async () => ({ ok: false, refusal: 'max_steps', steps: 4 }) }) });
  assert.deepEqual(await stuck({ role: { id: 'r' }, item: { id: 'A' } }), { ok: false, detail: 'the agent refused: max_steps after 4 step(s)' });
  assert.throws(() => agentHandler({}), /needs createRuntime/);
});

// ---- more endpoints: Vertex AI and any chat-completions server (US-14 section 3, Models row) ---------------------------------------------------
import { vertexEndpoint, openAiCompatibleEndpoint, toVertexBody } from './endpoints.js';

const VTOKEN = 'ya29.vertex-secret-token';
const fakeFetch = (status, body) => { const f = async (url, init) => { f.calls.push({ url, init }); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); }; f.calls = []; return f; };

test('the Vertex endpoint posts to the project and region route and returns the completion with token counts', async () => {
  const f = fakeFetch(200, { candidates: [{ content: { parts: [{ text: 'hello ' }, { text: 'world' }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 } });
  const ep = vertexEndpoint({ fetch: f, project: 'my-proj', location: 'europe-west4', tokenProvider: async () => VTOKEN });
  const out = await ep({ model: 'gemini-2.5-flash', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yes' }, { role: 'user', content: 'again' }], max_tokens: 50 });
  assert.deepEqual(out, { text: 'hello world', tokens_in: 12, tokens_out: 4 });
  assert.equal(f.calls[0].url, 'https://europe-west4-aiplatform.googleapis.com/v1/projects/my-proj/locations/europe-west4/publishers/google/models/gemini-2.5-flash:generateContent');
  assert.equal(f.calls[0].init.headers.authorization, `Bearer ${VTOKEN}`);
  const body = JSON.parse(f.calls[0].init.body);
  assert.deepEqual(body.contents.map(c => c.role), ['user', 'model', 'user']); assert.equal(body.systemInstruction.parts[0].text, 'be brief'); assert.equal(body.generationConfig.maxOutputTokens, 50);
  assert.deepEqual(toVertexBody([{ role: 'user', content: 'x' }]).systemInstruction, undefined);
  const noUsage = vertexEndpoint({ fetch: fakeFetch(200, { candidates: [{ content: { parts: [{ text: 'abcd' }] } }] }), project: 'p', location: 'l', tokenProvider: VTOKEN });
  const r = await noUsage({ model: 'm', messages: [{ role: 'user', content: 'abcdefgh' }] });
  assert.ok(r.tokens_in > 0 && r.tokens_out === 1, 'token counts are estimated when the service gives none');
});

test('US-14-R04: an endpoint failure never contains the token value, and a missing project, region or token is named', async () => {
  const leaky = vertexEndpoint({ fetch: fakeFetch(403, { error: { message: `permission denied for ${VTOKEN}` } }), project: 'p', location: 'l', tokenProvider: VTOKEN });
  const e = await leaky({ model: 'm', messages: [] }).catch(x => x);
  assert.match(e.message, /Vertex answered 403/); assert.ok(!e.message.includes(VTOKEN));
  await assert.rejects(() => vertexEndpoint({ fetch: fakeFetch(200, {}), location: 'l', tokenProvider: VTOKEN })({ model: 'm', messages: [] }), /needs a project/);
  await assert.rejects(() => vertexEndpoint({ fetch: fakeFetch(200, {}), project: 'p', tokenProvider: VTOKEN })({ model: 'm', messages: [] }), /needs a location/);
  await assert.rejects(() => vertexEndpoint({ fetch: fakeFetch(200, {}), project: 'p', location: 'l', tokenProvider: async () => '' })({ model: 'm', messages: [] }), /no token for Vertex/);
  await assert.rejects(() => vertexEndpoint({ fetch: fakeFetch(200, { candidates: [{ finishReason: 'SAFETY' }] }), project: 'p', location: 'l', tokenProvider: VTOKEN })({ model: 'm', messages: [] }), /no text \(SAFETY\)/);
  const oa = openAiCompatibleEndpoint({ fetch: fakeFetch(500, { error: { message: `boom ${VTOKEN}` } }), url: 'https://llm.example/v1/chat/completions', tokenProvider: VTOKEN });
  const e2 = await oa({ model: 'm', messages: [] }).catch(x => x);
  assert.match(e2.message, /answered 500/); assert.ok(!e2.message.includes(VTOKEN));
  await assert.rejects(() => openAiCompatibleEndpoint({ fetch: fakeFetch(200, {}) })({ model: 'm', messages: [] }), /no url/);
  await assert.rejects(() => openAiCompatibleEndpoint({ fetch: fakeFetch(200, { choices: [] }), url: 'https://x' })({ model: 'm', messages: [] }), /no completion/);
});

test('US-14-R10: a Vertex alias and a Workers AI alias are two families and the check passes with a reviewer on the other', async () => {
  const f = fakeFetch(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
  const cfg = { aliases: { medium: { endpoint: 'vertex', model: 'gemini-2.5-flash', family: 'gemini' }, large: { endpoint: 'edge', model: 'm-large', family: 'llama' }, small: { endpoint: 'edge', model: 'm-small', family: 'llama' } }, roles: { doer: 'medium', reviewer: 'large' } };
  const p = createModelPort({ config: cfg, endpoints: { vertex: vertexEndpoint({ fetch: f, project: 'p', location: 'l', tokenProvider: VTOKEN }), edge: endpoints.edge }, env: {} });
  assert.deepEqual(p.deployCheck().errors, []); assert.deepEqual(p.deployCheck().families, ['gemini', 'llama']);
  const r = await p.complete('medium', { messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual([r.ok, r.family, r.tokens_in], [true, 'gemini', 1]);
  const same = createModelPort({ config: { ...cfg, roles: { doer: 'large', reviewer: 'small' } }, endpoints: { vertex: async () => ({}), edge: endpoints.edge }, env: {} }).deployCheck();
  assert.equal(same.ok, false);
});

test('the Durable Object role runtime refuses to start without a way to reach the store', async () => {
  const DO = makeRoleRuntimeDO(FakeBase, { handlers: {}, models: port() });
  await assert.rejects(() => new DO(fakeCtx('x'), {}).runRole('staff-1'), /needs dbOf/);
});
