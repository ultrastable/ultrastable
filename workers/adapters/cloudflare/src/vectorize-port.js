// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// TS-9: a VectorPort over a Cloudflare Vectorize index binding. Each tenant writes into its own Vectorize namespace
// (`<tenant>:<ns>`), so a promoted tenant never reads another tenant's vectors.
export function vectorizePort(index, tenantId) {
  const space = (ns) => `${tenantId}:${ns || ''}`.slice(0, 64);
  return {
    async upsert(id, values, { ns = '', meta = null } = {}) {
      await index.upsert([{ id: `${tenantId}:${id}`.slice(0, 64), values, namespace: space(ns), metadata: meta ? { meta: JSON.stringify(meta) } : undefined }]);
    },
    async query(values, { k = 5, ns = '' } = {}) {
      const r = await index.query(values, { topK: k, namespace: space(ns), returnMetadata: 'all' });
      const prefix = `${tenantId}:`;
      return (r.matches || []).map(m => ({ id: String(m.id).startsWith(prefix) ? String(m.id).slice(prefix.length) : String(m.id), score: m.score, meta: m.metadata?.meta ? JSON.parse(m.metadata.meta) : null }));
    },
  };
}
