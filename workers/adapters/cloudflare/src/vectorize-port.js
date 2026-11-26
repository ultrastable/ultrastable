// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Cloudflare adapter for the VectorPort of core/tenantstore (US-SPEC-25 TS-9): one Vectorize index per tenant, given as a binding.
// STATUS: tested against a fake index (vectorize-port.test.js); no Vectorize index is bound in a deployed Worker yet.
// The binding for a tenant is named VEC_<TENANT ID in upper case, dashes as underscores>; no binding means no port, and the store
// then refuses past maxVectors with vector_cap exactly as before.
export const vectorBindingName = (tenantId) => 'VEC_' + String(tenantId).toUpperCase().replace(/-/g, '_');

export function vectorizePort(index) {
  if (!index) return null;
  return {
    async upsert(vectors) {
      return index.upsert(vectors.map(v => ({ id: v.id, values: v.values, ...(v.namespace ? { namespace: v.namespace } : {}), ...(v.metadata ? { metadata: v.metadata } : {}) })));
    },
    async query(values, { topK = 5, namespace = '' } = {}) {
      const r = await index.query(values, { topK: Math.min(topK, 50), returnMetadata: 'all', ...(namespace ? { namespace } : {}) });
      return (r?.matches || []).map(m => ({ id: m.id, score: m.score, metadata: m.metadata ?? null }));
    },
    async remove(ids) { return index.deleteByIds(ids); },
  };
}

export const vectorPortFor = (env, tenantId) => vectorizePort(env?.[vectorBindingName(tenantId)] || null);
