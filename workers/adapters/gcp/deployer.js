// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Deployer port over the Cloud Run Admin API v2, through an injected fetch. Not yet run against a real project.
// config: { project, region, services?: {unit: serviceName}, apiBase?, tokenEnv? }. artifact: { image }.
// publish / rollback are the port core/deploy calls. canary / promote are the staged path of US-SPEC-14 section 3 (Deploy row): canary makes a new
// revision that takes `percent` (default 10) of traffic on a tagged URL and leaves the rest on the revision that was live, so the probes run
// against the tagged URL before anyone else sees the change; promote sends 100% to the new revision; rollback sends 100% back. core/deploy does not
// call canary yet (US-SPEC-14 section 8).
export function cloudRunDeployer({ fetch, config, env }) {
  const base = config.apiBase || 'https://run.googleapis.com/v2';
  const svc = (unit) => (config.services && config.services[unit]) || unit;
  const url = (unit) => `${base}/projects/${config.project}/locations/${config.region}/services/${encodeURIComponent(svc(unit))}`;
  async function call(u, init) {
    const t = env[config.tokenEnv || 'GCP_ACCESS_TOKEN'];
    if (!t) throw new Error('deployer token not present in env');
    const res = await fetch(u, { ...init, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`cloud run api ${init.method} failed: status ${res.status}`);
    return body;
  }
  const REV = 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION';
  const liveVersion = async (unit) => (await call(url(unit), { method: 'GET' })).latestReadyRevision ?? null;
  return {
    liveVersion,
    async publish(unit, artifact) {
      await call(url(unit), { method: 'PATCH', body: JSON.stringify({ template: { containers: [{ image: artifact.image }] } }) });
      return { version: await liveVersion(unit) };
    },
    /** A new revision with `percent` of traffic and a tag; the previous revision keeps the rest. Returns the tagged URL to probe. */
    async canary(unit, artifact, { percent = 10, tag = 'canary' } = {}) {
      if (!(percent > 0 && percent < 100)) throw new Error('canary percent must be above 0 and below 100');
      if (!/^[a-z][a-z0-9-]{0,29}$/.test(tag)) throw new Error('canary tag must be a lowercase label');
      const previous = await liveVersion(unit);
      if (!previous) throw new Error('there is no live revision to keep the rest of the traffic on');
      // The new revision is created with all traffic pinned to the live one, so it takes none until it is shifted below.
      await call(url(unit), { method: 'PATCH', body: JSON.stringify({ template: { containers: [{ image: artifact.image }] }, traffic: [{ type: REV, revision: previous, percent: 100 }] }) });
      const version = await liveVersion(unit);
      if (!version || version === previous) throw new Error('the new revision did not become ready');
      await call(url(unit), { method: 'PATCH', body: JSON.stringify({ traffic: [{ type: REV, revision: version, percent, tag }, { type: REV, revision: previous, percent: 100 - percent }] }) });
      const svcNow = await call(url(unit), { method: 'GET' });
      const t = (svcNow.trafficStatuses || svcNow.traffic || []).find(x => x.tag === tag);
      return { version, previous, percent, tag, probeUrl: t?.uri ?? null };
    },
    /** All traffic to `version` (the canary after its probes passed). */
    async promote(unit, version) {
      await call(url(unit), { method: 'PATCH', body: JSON.stringify({ traffic: [{ type: REV, revision: version, percent: 100 }] }) });
    },
    async rollback(unit, toVersion) {
      await call(url(unit), { method: 'PATCH', body: JSON.stringify({ traffic: [{ type: REV, revision: toVersion, percent: 100 }] }) });
    },
  };
}
