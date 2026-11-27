// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Outside audit of the scorer (US-SPEC-05 section 3.2, US-05-R23). The system scores its own predictions, so its hit rate is
// self-reported; this module is the path by which a party that is not the system re-reads them. exportForAudit gives the
// auditor the scored rows with the decision text and the revert path (and a hash so both sides can show they read the same
// rows); recordAudit takes the auditor's verdict. The auditor is a port: a person, another organization's system, a held-out
// grader. This module calls nothing. Ports: db, now.
const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();

async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Canonical JSON: keys sorted at every level, so the same rows always give the same text.
const canon = (v) => Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v ?? null);

/**
 * The scored predictions since `since` (ISO, default all), oldest first, at most `limit`: what was predicted, what was
 * observed, the system's verdict, the decision text and the revert path. `sha256` is over the canonical rows.
 */
export async function exportForAudit(db, { since = null, limit = 500 } = {}) {
  const rows = (await all(db, `SELECT p.id, p.subject, p.op, p.value, p.value2, p.due_at, p.observed, p.matched, p.scored_at, p.confidence,
      d.actor, d.decision, d.predicted_outcome, d.revert_path
    FROM predict_predictions p LEFT JOIN predict_decisions d ON d.id = p.decision_id
    WHERE p.matched IS NOT NULL AND (? IS NULL OR p.scored_at >= ?) ORDER BY p.scored_at, p.id LIMIT ?`, since, since, limit))
    .map(r => ({ ...r, verdict: r.matched ? 'hit' : 'miss' }));
  return { rows, count: rows.length, since, sha256: await sha256Hex(canon(rows)) };
}

/**
 * Record one outside verdict. Refused when the auditor is the actor that made the decision (that is the system re-reading
 * itself) or when the prediction is not scored. A verdict that differs from the system's files one item,
 * PREDICT-AUDIT-<prediction>, whose closing probe reads 1 once no outside verdict differs from the score as it stands now
 * (the score corrected, or the auditor's verdict replaced); `cannot-tell` counts for neither side.
 */
export async function recordAudit(db, { prediction_id, auditor, verdict, evidence }, { now = Date.now(), owner_role = 'operations' } = {}) {
  if (!prediction_id || !auditor || !evidence || !String(evidence).trim()) throw new Error('an audit requires prediction_id, auditor and evidence');
  if (!['hit', 'miss', 'cannot-tell'].includes(verdict)) throw new Error(`unknown verdict ${verdict}`);
  const p = await first(db, `SELECT p.id, p.matched, d.actor FROM predict_predictions p LEFT JOIN predict_decisions d ON d.id = p.decision_id WHERE p.id = ?`, prediction_id);
  if (!p) throw new Error(`unknown prediction ${prediction_id}`);
  if (p.matched === null || p.matched === undefined) return { ok: false, reason: 'the prediction is not scored yet' };
  if (p.actor && String(p.actor) === String(auditor)) return { ok: false, reason: 'the auditor made the decision: the system cannot audit itself' };
  const systemVerdict = p.matched ? 'hit' : 'miss';
  const agrees = verdict === 'cannot-tell' ? null : verdict === systemVerdict ? 1 : 0;
  const nowIso = iso(now);
  await run(db, `INSERT INTO predict_audits (prediction_id, auditor, verdict, system_verdict, agrees, evidence, audited_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(prediction_id, auditor) DO UPDATE SET verdict=excluded.verdict, system_verdict=excluded.system_verdict, agrees=excluded.agrees, evidence=excluded.evidence, audited_at=excluded.audited_at`,
    prediction_id, auditor, verdict, systemVerdict, agrees, String(evidence).slice(0, 500), nowIso);
  let item = null;
  if (agrees === 0) {
    item = `PREDICT-AUDIT-${prediction_id}`;
    if (!(await first(db, `SELECT 1 AS x FROM items WHERE id = ?`, item))) {
      await run(db, `INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, created_at, updated_at) VALUES (?,?,'fix',?,?,?,5,'ready',?,?)`,
        item, `Outside audit by ${auditor} scored prediction ${prediction_id} as a ${verdict}; the system scored a ${systemVerdict}`.slice(0, 300), owner_role,
        'the audit and the score agree: the score is corrected with its reason, or the auditor withdraws the verdict',
        `SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM predict_audits a JOIN predict_predictions p ON p.id = a.prediction_id WHERE a.prediction_id = '${String(prediction_id).replace(/'/g, "''")}' AND a.verdict IN ('hit','miss') AND a.verdict <> CASE WHEN p.matched = 1 THEN 'hit' ELSE 'miss' END`, nowIso, nowIso);
    }
  }
  return { ok: true, agrees: agrees === null ? null : Boolean(agrees), item };
}

/** Agreement per auditor: { auditor, n, agreed, share }, `cannot-tell` verdicts excluded from n. n is 0 until a real outside party has acted. */
export async function auditAgreement(db) {
  const per = (await all(db, `SELECT auditor, COUNT(*) AS n, SUM(agrees) AS agreed FROM predict_audits WHERE agrees IS NOT NULL GROUP BY auditor ORDER BY auditor`))
    .map(r => ({ auditor: r.auditor, n: r.n, agreed: r.agreed || 0, share: r.n ? (r.agreed || 0) / r.n : null }));
  const n = per.reduce((s, r) => s + r.n, 0), agreed = per.reduce((s, r) => s + r.agreed, 0);
  return { n, agreed, share: n ? agreed / n : null, per_auditor: per };
}
