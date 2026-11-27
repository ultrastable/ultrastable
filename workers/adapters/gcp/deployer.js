// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Deployer port over the Cloud Run Admin API v2, through an injected fetch. Not yet run against a real project.
// config: { project, region, services?: {unit: serviceName}, apiBase?, tokenEnv?, poll_every_ms?, poll_max? }. artifact: { image }.
// publish / rollback are the port core/deploy calls. canary / promote are the staged path of US-SPEC-14 section 3 (Deploy row): canary makes a new
// revision that takes `percent` (default 10) of traffic on a tagged URL and leaves the rest on the revision that was live, so the probes run
// against the tagged URL before anyone else sees the change; promote sends 100% to the new revision; rollback sends 100% back. core/deploy does not
// call canary yet (US-SPEC-14 section 8).
// services.patch answers with a long-running Operation: the new revision and the traffic split take effect only when it completes, so every patch
// is followed by reads of the operation (GET {apiBase}/{operation.name}, `sleep` between reads, at most poll_max) before anything is read back.
// latestReadyRevision is a full resource name; traffic targets take the revision's own name, so versions are kept as that last segment.
export function cloudRunDeployer({ fetch, config, env, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
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
  const everyMs = config.poll_every_ms ?? 2000; const maxPolls = config.poll_max ?? 90;
  const isOperation = b => !!b && typeof b.name === 'string' && /(^|\/)operations\//.test(b.name);
  /** Wait for a long-running operation to finish; a body that is not an operation is returned as it is. */
  async function settled(body, what) {
    if (!isOperation(body)) return body;
    let op = body;
    for (let polls = 0; !op.done; polls++) {
      if (polls >= maxPolls) throw new Error(`cloud run ${what} did not finish after ${maxPolls} polls`);
      await sleep(everyMs);
      op = await call(`${base}/${op.name}`, { method: 'GET' });
    }
    if (op.error) throw new Error(`cloud run ${what} failed: ${String(op.error.message || op.error.code || 'the operation reported an error').slice(0, 200)}`);
    return op.response ?? null;
  }
  const patch = async (unit, body, what) => settled(await call(url(unit), { method: 'PATCH', body: JSON.stringify(body) }), what);
  const shortName = r => (r == null ? null : String(r).split('/').pop());
  const service = (unit) => call(url(unit), { method: 'GET' });
  const liveVersion = async (unit) => shortName((await service(unit)).latestReadyRevision);
  const allTo = (unit, revision, what) => patch(unit, { traffic: [{ type: REV, revision, percent: 100 }] }, what);
  return {
    liveVersion,
    async publish(unit, artifact) {
      await patch(unit, { template: { containers: [{ image: artifact.image }] } }, 'publish');
      return { version: await liveVersion(unit) };
    },
    /** A new revision with `percent` of traffic and a tag; the previous revision keeps the rest. Returns the tagged URL to probe. */
    async canary(unit, artifact, { percent = 10, tag = 'canary' } = {}) {
      if (!(percent > 0 && percent < 100)) throw new Error('canary percent must be above 0 and below 100');
      if (!/^[a-z][a-z0-9-]{0,29}$/.test(tag)) throw new Error('canary tag must be a lowercase label');
      const previous = await liveVersion(unit);
      if (!previous) throw new Error('there is no live revision to keep the rest of the traffic on');
      // The new revision is created with all traffic pinned to the live one, so it takes none until it is shifted below.
      await patch(unit, { template: { containers: [{ image: artifact.image }] }, traffic: [{ type: REV, revision: previous, percent: 100 }] }, 'canary revision');
      const version = await liveVersion(unit);
      if (!version || version === previous) throw new Error('the new revision did not become ready');
      await patch(unit, { traffic: [{ type: REV, revision: version, percent, tag }, { type: REV, revision: previous, percent: 100 - percent }] }, 'canary traffic split');
      const svcNow = await service(unit);
      const t = (svcNow.trafficStatuses || svcNow.traffic || []).find(x => x.tag === tag);
      if (!t?.uri) {                                   // a canary nobody can probe is not kept: all traffic goes back to the live revision
        await allTo(unit, previous, 'canary undo');
        throw new Error(`the tagged revision has no URL to probe; all traffic is back on ${previous}`);
      }
      return { version, previous, percent, tag, probeUrl: t.uri };
    },
    /** All traffic to `version` (the canary after its probes passed). */
    async promote(unit, version) { await allTo(unit, shortName(version), 'promote'); },
    async rollback(unit, toVersion) { await allTo(unit, shortName(toVersion), 'rollback'); },
  };
}
