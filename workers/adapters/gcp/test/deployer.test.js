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
      return Response.json({ name: 'operations/x' });
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
      return Response.json({ name: 'operations/x' });
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
