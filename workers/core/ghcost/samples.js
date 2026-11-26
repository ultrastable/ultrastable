// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// core/ghcost: a sanitized sample of every live billing read, and a probe of its shape against the documented field set
// (US-24-R22). A recorded real response is the only proof the watchdog reads the real shape; this records one on every live
// read, with organization and repository names hashed, and reports drift instead of silently counting zero minutes.
import { run, first, fileItem, closeItem, recordProbe } from './util.js';
import { hash32 } from './census.js';

export const DOCUMENTED_FIELDS = ['date', 'product', 'sku', 'quantity', 'unitType', 'pricePerUnit', 'grossAmount', 'discountAmount', 'netAmount', 'organizationName', 'repositoryName'];
/** Fields the minutes computation cannot do without: losing one makes every repository read as zero. */
export const REQUIRED_FIELDS = ['date', 'product', 'quantity', 'unitType', 'pricePerUnit', 'repositoryName'];
const HASHED = ['organizationName', 'repositoryName'];
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Pure: compare the field set of `report.usageItems` with the documented set. `blocking` drift stops the watchdog deciding. */
export function shapeProbe(report) {
  const items = report?.usageItems;
  if (!Array.isArray(items)) return { result: 'unmeasured', evidence: 'no usageItems list', blocking: true, added: [], removed: [] };
  if (!items.length) return { result: 'unmeasured', evidence: 'an empty usage list shows no shape', blocking: false, added: [], removed: [] };
  const seen = new Set(items.flatMap(i => Object.keys(i || {})));
  const added = [...seen].filter(k => !DOCUMENTED_FIELDS.includes(k)).sort(), removed = DOCUMENTED_FIELDS.filter(k => !seen.has(k));
  const minutesRows = items.filter(i => String(i?.product || '').toLowerCase() === 'actions');
  const unitDrift = minutesRows.length > 0 && !minutesRows.some(i => String(i.unitType || '').toLowerCase() === 'minutes');
  const blocking = removed.some(k => REQUIRED_FIELDS.includes(k)) || unitDrift;
  const drift = added.length || removed.length || unitDrift;
  return { result: drift ? 'drift' : 'pass', added, removed, unit_types: [...new Set(minutesRows.map(i => i.unitType))].sort(), blocking,
    evidence: drift ? `added [${added}] removed [${removed}]${unitDrift ? ' no Actions row has unitType Minutes' : ''}` : `${seen.size} fields as documented` };
}

/** Names that identify the organization or a repository are replaced by a stable hash: the shape survives, the names do not. */
export function sanitize(report, max = 5) {
  const items = (report?.usageItems || []).slice(0, max).map(i => Object.fromEntries(Object.entries(i || {}).map(([k, v]) => [k, HASHED.includes(k) && v != null ? 'h:' + hash32(v).toString(16) : v])));
  const fields = {};
  for (const i of report?.usageItems || []) for (const [k, v] of Object.entries(i || {})) fields[k] = fields[k] && fields[k] !== typeOf(v) ? 'mixed' : typeOf(v);
  return { fields, sample: items, items: (report?.usageItems || []).length };
}

/** Store one sample and probe it. A blocking drift files GHCOST-SHAPE-DRIFT (priority 5); a clean shape closes it. */
export async function recordSample(db, kind, report, ts, { source = 'live' } = {}) {
  const s = sanitize(report), p = shapeProbe(report);
  await run(db, `INSERT INTO ghcost_samples (kind, source, fields, items, sample, shape, checked_at) VALUES (?,?,?,?,?,?,?)`, kind, source, JSON.stringify(s.fields), s.items, JSON.stringify(s.sample), p.result, ts);
  await recordProbe(db, 'shape:' + kind, p.result === 'pass' ? 'pass' : p.result === 'drift' ? 'fail' : 'unknown', p.evidence, ts);
  if (p.result === 'drift') {
    await fileItem(db, { id: 'GHCOST-SHAPE-DRIFT', title: `The billing usage response no longer has the documented fields: ${p.evidence}`,
      done_check: 'the usage response carries the documented field set, or the documented set is updated from a recorded sample', closing_probe: "ghcost_samples: latest kind='usage' shape is pass", priority: 5 }, ts);
  } else if (p.result === 'pass') await closeItem(db, 'GHCOST-SHAPE-DRIFT', 'the usage response has the documented shape', ts);
  return p;
}

/** The most recent stored sample of a kind, or null. */
export const lastSample = (db, kind) => first(db, `SELECT * FROM ghcost_samples WHERE kind=? ORDER BY id DESC LIMIT 1`, kind);

/**
 * Replay a stored response: a JSON text previously saved from a live read. It must be a usage report; nothing is invented
 * here (NO-FABRICATION-1): a text that is not a usage report is refused.
 */
export function parseRecorded(text) {
  let r; try { r = JSON.parse(text); } catch { throw new Error('ghcost: recorded response is not JSON'); }
  if (!r || !Array.isArray(r.usageItems)) throw new Error('ghcost: recorded response has no usageItems list');
  return r;
}
