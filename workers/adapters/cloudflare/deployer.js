// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Deployer port over the public Cloudflare Workers HTTP API, through an injected fetch. No network at import time.
// Port: { liveVersion, liveDigest, publish, rollback } as core/deploy asks for them.
// config: { accountId, scripts?: {unit: scriptName}, apiBase?, tokenEnv? }. The token is read from env at call time and never stored or logged.
export function cloudflareDeployer({ fetch, config, env }) {
  const base = config.apiBase || 'https://api.cloudflare.com/client/v4';
  const name = (unit) => (config.scripts && config.scripts[unit]) || unit;
  const url = (unit, tail = '') => `${base}/accounts/${config.accountId}/workers/scripts/${encodeURIComponent(name(unit))}${tail}`;
  function token() {
    const t = env[config.tokenEnv || 'CLOUDFLARE_API_TOKEN'];
    if (!t) throw new Error('deployer token not present in env');
    return t;
  }
  async function call(u, init) {
    const res = await fetch(u, { ...init, headers: { authorization: 'Bearer ' + token(), ...(init.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) throw new Error(`workers api ${init.method} failed: status ${res.status}`);
    return body;
  }
  async function liveVersion(unit) {
    const body = await call(url(unit, '/deployments'), { method: 'GET' });
    const d = ((body.result && body.result.deployments) || [])[0];
    const v = d && d.versions && d.versions[0];
    return v ? v.version_id : null;
  }
  const hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  // US-07-R13: the live script read back from the platform, one SHA-256 per module, the way deploy/deploy-workers.mjs digests it, so
  // core/deploy compares what serves with what was published. A multipart answer holds one part per module; a single body is keyed by
  // its cf-entrypoint header. An answer that cannot be read throws, and core/deploy counts that as a mismatch inside its window.
  async function liveDigest(unit) {
    const res = await fetch(url(unit, '/content/v2'), { method: 'GET', headers: { authorization: 'Bearer ' + token() } });
    if (!res.ok) throw new Error(`workers api GET content failed: status ${res.status}`);
    const files = {};
    if ((res.headers.get('content-type') || '').startsWith('multipart/')) {
      for (const [k, v] of await res.formData()) files[k] = await hex(typeof v === 'string' ? new TextEncoder().encode(v) : await v.arrayBuffer());
    } else {
      files[res.headers.get('cf-entrypoint') || 'worker.js'] = await hex(await res.arrayBuffer());
    }
    return files;
  }
  return {
    liveVersion,
    liveDigest,
    async publish(unit, artifact) {
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ main_module: 'worker.js', compatibility_date: artifact.compatibilityDate || '2026-01-01', observability: { enabled: true, head_sampling_rate: 1 } })], { type: 'application/json' }));
      form.append('worker.js', new Blob([artifact.body], { type: 'application/javascript+module' }), 'worker.js');
      await call(url(unit), { method: 'PUT', body: form });
      return { version: await liveVersion(unit) };
    },
    async rollback(unit, toVersion) {
      await call(url(unit, '/deployments'), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategy: 'percentage', versions: [{ version_id: toVersion, percentage: 100 }] }) });
    },
  };
}
