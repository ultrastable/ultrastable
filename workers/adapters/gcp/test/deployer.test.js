// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudRunDeployer } from '../deployer.js';

const config = { project: 'proj-1', region: 'region-1', services: { api: 'api-svc' } };

test('cloud run deployer: liveVersion, publish and rollback use the v2 Admin API', async () => {
  const calls = [];
  let rev = 'rev-1';
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.authorization, body: init.body && JSON.parse(init.body) });
    if (init.method === 'PATCH') {
      const b = JSON.parse(init.body);
      rev = b.traffic ? b.traffic[0].revision : 'rev-2';
      return Response.json({ name: 'operations/x', done: true });   // an operation that is already done when the patch answers
    }
    return Response.json({ latestReadyRevision: rev });
  };
  const dep = cloudRunDeployer({ fetch, config, env: { GCP_ACCESS_TOKEN: 'tkn-value' } });
  assert.equal(await dep.liveVersion('api'), 'rev-1');
  assert.equal(calls[0].url, 'https://run.googleapis.com/v2/projects/proj-1/locations/region-1/services/api-svc');
  assert.equal(calls[0].auth, 'Bearer tkn-value');
  assert.deepEqual(await dep.publish('api', { image: 'registry.example/app:2' }), { version: 'rev-2' });
  assert.equal(calls.find(c => c.method === 'PATCH').body.template.containers[0].image, 'registry.example/app:2');
  await dep.rollback('api', 'rev-1');
  assert.equal(await dep.liveVersion('api'), 'rev-1');
});

test('cloud run deployer: missing token and API errors throw without leaking the token', async () => {
  await assert.rejects(cloudRunDeployer({ fetch: async () => { throw new Error('unreachable'); }, config, env: {} }).liveVersion('api'), /token not present/);
  const bad = cloudRunDeployer({ fetch: async () => Response.json({}, { status: 500 }), config, env: { GCP_ACCESS_TOKEN: 'tkn-value' } });
  await assert.rejects(bad.liveVersion('api'), (e) => /500/.test(e.message) && !e.message.includes('tkn-value'));
});

test('US-14-R08: the canary path puts 10 percent on a tagged new revision and the rest on the live one, returns the tagged URL to probe, then promotes or rolls back', async () => {
  const calls = []; let latest = 'rev-1'; let traffic = [{ revision: 'rev-1', percent: 100 }];
  const fetch = async (url, init) => {
    const b = init.body && JSON.parse(init.body);
    calls.push({ method: init.method, body: b });
    if (init.method === 'PATCH') {
      if (b.template) latest = 'rev-2';
      if (b.traffic) traffic = b.traffic.map(t => ({ revision: t.revision, percent: t.percent, tag: t.tag, uri: t.tag ? `https://${t.tag}---api-svc-abc.a.run.app` : undefined }));
      return Response.json({ name: 'operations/x', done: true });   // an operation that is already done when the patch answers
    }
    return Response.json({ latestReadyRevision: latest, trafficStatuses: traffic });
  };
  const dep = cloudRunDeployer({ fetch, config, env: { GCP_ACCESS_TOKEN: 'tkn-value' } });
  const c = await dep.canary('api', { image: 'registry.example/app:2' });
  assert.deepEqual({ version: c.version, previous: c.previous, percent: c.percent, tag: c.tag }, { version: 'rev-2', previous: 'rev-1', percent: 10, tag: 'canary' });
  assert.equal(c.probeUrl, 'https://canary---api-svc-abc.a.run.app');
  const patches = calls.filter(x => x.method === 'PATCH').map(x => x.body);
  assert.deepEqual(patches[0].traffic, [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'rev-1', percent: 100 }], 'the new revision starts with no traffic');
  assert.deepEqual(patches[1].traffic.map(t => [t.revision, t.percent, t.tag ?? null]), [['rev-2', 10, 'canary'], ['rev-1', 90, null]]);
  await dep.promote('api', 'rev-2');
  assert.deepEqual(traffic.map(t => [t.revision, t.percent]), [['rev-2', 100]]);
  await dep.rollback('api', 'rev-1');
  assert.deepEqual(traffic.map(t => [t.revision, t.percent]), [['rev-1', 100]]);
  await assert.rejects(dep.canary('api', { image: 'x' }, { percent: 100 }), /above 0 and below 100/);
  await assert.rejects(dep.canary('api', { image: 'x' }, { tag: 'Bad Tag' }), /lowercase label/);
});

test('US-14-R08: a canary whose new revision never became ready throws and shifts no traffic', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push(init.method + ' ' + (init.body || '')); return init.method === 'PATCH' ? Response.json({}) : Response.json({ latestReadyRevision: 'rev-1' }); };
  const dep = cloudRunDeployer({ fetch, config, env: { GCP_ACCESS_TOKEN: 'tkn-value' } });
  await assert.rejects(dep.canary('api', { image: 'x' }), /did not become ready/);
  assert.equal(calls.filter(c => c.startsWith('PATCH')).length, 1, 'only the pinned create, never a traffic shift');
});

// A fake Cloud Run Admin API v2 that behaves like the real one: services.patch answers with a long-running Operation, and the new revision and
// the traffic split take effect only when that operation completes (after `polls` reads of it). Revision names are full resource names.
function lroCloudRun({ polls = 2, fail = null, never = false, tagUri = true } = {}) {
  const SVC = 'projects/proj-1/locations/region-1/services/api-svc';
  const s = { latest: `${SVC}/revisions/api-svc-00001-aaa`, traffic: [{ revision: 'api-svc-00001-aaa', percent: 100 }], ops: {}, n: 1, calls: [], sleeps: 0 };
  s.fetch = async (url, init) => {
    const b = init.body && JSON.parse(init.body);
    s.calls.push({ method: init.method, url, body: b });
    const op = /\/(projects\/[^/]+\/locations\/[^/]+\/operations\/[^/]+)$/.exec(url);
    if (op && init.method === 'GET') {
      const o = s.ops[op[1]];
      if (never || ++o.reads < polls) return Response.json({ name: op[1], metadata: {} });              // done is omitted while it runs (proto3)
      if (!o.applied) { o.applied = true; o.apply(); }
      return Response.json(fail ? { name: op[1], done: true, error: { code: 9, message: fail } } : { name: op[1], done: true, response: { name: SVC } });
    }
    if (init.method === 'PATCH') {
      const name = `projects/proj-1/locations/region-1/operations/op-${Object.keys(s.ops).length + 1}`;
      s.ops[name] = { reads: 0, apply: () => {
        if (fail) return;
        if (b.template) s.latest = `${SVC}/revisions/api-svc-0000${++s.n}-bbb`;
        if (b.traffic) s.traffic = b.traffic.map(t => ({ revision: t.revision, percent: t.percent, tag: t.tag, uri: t.tag && tagUri ? `https://${t.tag}---api-svc-abc.a.run.app` : undefined }));
      } };
      return Response.json({ name, metadata: {} });
    }
    return Response.json({ name: SVC, latestReadyRevision: s.latest, trafficStatuses: s.traffic });
  };
  s.sleep = async () => { s.sleeps++; };
  return s;
}

test('US-14-R08: the canary waits for each long-running operation before it reads the new revision and the tagged URL; revisions go by their short name', async () => {
  const api = lroCloudRun({ polls: 3 });
  const dep = cloudRunDeployer({ fetch: api.fetch, config, env: { GCP_ACCESS_TOKEN: 'tkn-value' }, sleep: api.sleep });
  const c = await dep.canary('api', { image: 'registry.example/app:2' });
  assert.deepEqual({ version: c.version, previous: c.previous, percent: c.percent }, { version: 'api-svc-00002-bbb', previous: 'api-svc-00001-aaa', percent: 10 });
  assert.equal(c.probeUrl, 'https://canary---api-svc-abc.a.run.app');
  assert.deepEqual(api.traffic.map(t => [t.revision, t.percent]), [['api-svc-00002-bbb', 10], ['api-svc-00001-aaa', 90]], 'the split names revisions, not resource paths');
  const opReads = api.calls.filter(x => x.method === 'GET' && /\/operations\//.test(x.url));
  assert.equal(opReads.length, 6, 'each of the two patches is polled until done');
  assert.ok(opReads.every(x => x.url.startsWith('https://run.googleapis.com/v2/projects/proj-1/locations/region-1/operations/')));
  assert.ok(api.sleeps >= 4, 'the polls wait between reads through the injected sleep');
  await dep.promote('api', c.version);
  assert.deepEqual(api.traffic.map(t => [t.revision, t.percent]), [['api-svc-00002-bbb', 100]]);
  assert.deepEqual(await dep.publish('api', { image: 'registry.example/app:3' }), { version: 'api-svc-00003-bbb' });
});

test('US-14-R08: a failed operation throws with its message and moves no traffic; one that never finishes stops after its bound', async () => {
  const bad = lroCloudRun({ fail: 'revision failed to start' });
  const dep = cloudRunDeployer({ fetch: bad.fetch, config, env: { GCP_ACCESS_TOKEN: 'tkn-value' }, sleep: bad.sleep });
  await assert.rejects(dep.canary('api', { image: 'x' }), e => /revision failed to start/.test(e.message) && !e.message.includes('tkn-value'));
  assert.equal(bad.calls.filter(x => x.method === 'PATCH').length, 1, 'no traffic shift after a failed create');
  const stuck = lroCloudRun({ never: true });
  const dep2 = cloudRunDeployer({ fetch: stuck.fetch, config: { ...config, poll_max: 5 }, env: { GCP_ACCESS_TOKEN: 'tkn-value' }, sleep: stuck.sleep });
  await assert.rejects(dep2.publish('api', { image: 'x' }), /did not finish after 5 polls/);
  assert.equal(stuck.sleeps, 5);
});

test('US-14-R08: a canary whose tagged revision has no URL puts all traffic back on the live revision and throws', async () => {
  const api = lroCloudRun({ tagUri: false });
  const dep = cloudRunDeployer({ fetch: api.fetch, config, env: { GCP_ACCESS_TOKEN: 'tkn-value' }, sleep: api.sleep });
  await assert.rejects(dep.canary('api', { image: 'x' }), /no URL to probe/);
  assert.deepEqual(api.traffic.map(t => [t.revision, t.percent]), [['api-svc-00001-aaa', 100]]);
});
