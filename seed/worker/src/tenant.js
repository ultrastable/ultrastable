// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// Q-TENANT-row-isolation (TENANT-1): one rule for which rows a runtime may act on. Migration 0026 adds `tenant_id TEXT` to items, claims, gate_cards and
// trust_ledger; NULL means this runtime's own tenant (the convention of objectives and metrics, migration 0004), a value means another tenant's row.
// A runtime selects, claims, advances, closes and counts only rows where tenant_id IS NULL OR tenant_id = <its own org slug>, and every row it writes carries
// no tenant (NULL). The predicate adds no query and no scan: it is evaluated on rows the existing status / PK access path already reads.
export const OWN_SQL = (col = 'tenant_id') => `(${col} IS NULL OR ${col} = ?)`;

// The tenant a runtime acts for: a tick ctx (config.org_slug), an env (TENANT) or a plain slug. Never undefined: bind() must not receive undefined.
export function tenantOf(x) {
  if (typeof x === 'string') return x;
  if (!x) return '';
  if (x.config && x.config.org_slug) return String(x.config.org_slug);
  return String(x.TENANT || x.org_slug || '');
}
