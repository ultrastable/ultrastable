// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Calibration of the weights of the six-term F by ridge regression over the stored sla_objective rows (US-SPEC-13 R20). For each
// cycle t the target is how far the triad moved toward (human-gated 0, drift 0, self-healing active) by cycle t+1, and the inputs are
// the measured terms at t. A term's weight follows how strongly it predicts that improvement in the direction the specification fixes
// for it (F_SIGN): a weight never flips sign, and a term that predicts the wrong way gets 0 and is named. Terms with no reading (or no
// variation in the history) keep the weight in effect. The result is a proposal only: it is stored in sla_calibrations and filed through
// the report-card writer; it is never written into the weights in effect (US-13-R06).
import { ridgeFit, gram, inverse, standardize, mean, sd } from '../_shared/linalg.js';

const round6 = x => Math.round(x * 1e6) / 1e6;
/** Improvement of the triad from one stored cycle to the next, as one scalar: fewer gated, less drift, self-healing gained. */
export const improvement = (a, b) => (a.human_gated - b.human_gated) + (a.drift - b.drift) + ((b.self_healing ? 1 : 0) - (a.self_healing ? 1 : 0));

export async function calibrateWeights({ db, l3, terms: F_TERMS, sign, weights, minRows = 12, at, lambda = 1e-3 }) {
  const stored = (await db.prepare(`SELECT id, terms, triad FROM sla_objective ORDER BY id`).all()).results || [];
  if (stored.length < minRows) return { ok: false, refused: 'history', reason: `${stored.length} stored objective row(s); ${minRows} are needed before the weights can be fitted` };
  const rows = stored.map(r => ({ terms: JSON.parse(r.terms), triad: JSON.parse(r.triad) }));
  const n = rows.length - 1;
  const y = Array.from({ length: n }, (_, i) => improvement(rows[i].triad, rows[i + 1].triad));
  const kept = {};
  const fitTerms = [];
  for (const k of F_TERMS) {
    if (!rows.every(r => r.terms[k]?.measured)) { kept[k] = 'no reading in every stored row (unmeasured)'; continue; }
    const col = rows.slice(0, n).map(r => Number(r.terms[k].value));
    if (!(sd(col) > 1e-12)) { kept[k] = 'the term did not vary over the stored history'; continue; }
    fitTerms.push(k);
  }
  if (!fitTerms.length) return { ok: false, refused: 'terms', reason: 'no term was measured and varying over the stored history', kept };
  const raw = Array.from({ length: n }, (_, i) => fitTerms.map(k => Number(rows[i].terms[k].value)));
  const { Z, sds } = standardize(raw);
  const X = Z.map(z => [1, ...z]);
  let beta;
  try { beta = ridgeFit(X, y, lambda); } catch (e) { return { ok: false, refused: 'fit', reason: `the fit failed: ${String(e.message).slice(0, 80)}`, kept }; }
  const pred = X.map(r => r.reduce((s, v, j) => s + v * beta[j], 0));
  const ybar = mean(y); const sst = y.reduce((s, v) => s + (v - ybar) ** 2, 0); const sse = y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
  const r2 = sst > 0 ? Math.round((1 - sse / sst) * 1e4) / 1e4 : null;
  let tvals = fitTerms.map(() => null);
  const dof = n - X[0].length;
  if (dof > 0 && sst > 0) {
    try { const inv = inverse(gram(X, lambda)); const s2 = sse / dof; tvals = fitTerms.map((_, j) => (s2 > 0 ? round6(beta[j + 1] / Math.sqrt(s2 * inv[j + 1][j + 1])) : null)); } catch { /* t stays null */ }
  }
  const per = {}; const rawW = {};
  fitTerms.forEach((k, j) => {
    const signed = sign[k] * beta[j + 1];
    per[k] = { coefficient: round6(beta[j + 1]), t: tvals[j], direction: signed >= 0 ? 'as specified' : 'wrong direction: weight 0' };
    rawW[k] = Math.max(0, signed) / sds[j];
  });
  const total = Object.values(rawW).reduce((a, b) => a + b, 0);
  if (!(total > 0)) return { ok: false, refused: 'direction', reason: 'no term predicts an improvement of the triad in the direction the specification fixes for it', fit: { n, r2, terms: per }, kept };
  const current = fitTerms.reduce((s, k) => s + Number(weights[k] ?? 0), 0);
  const scale = current / total;                                  // the weights of the fitted terms keep the sum they had, so F stays on its scale
  const proposed = { ...weights };
  for (const k of fitTerms) proposed[k] = round6(rawW[k] * scale);
  const fit = { n, r2, terms: per, kept };
  const ins = await db.prepare(`INSERT INTO sla_calibrations (at, rows_used, weights, previous, fit) VALUES (?,?,?,?,?)`).bind(at, stored.length, JSON.stringify(proposed), JSON.stringify(weights), JSON.stringify(fit)).run();
  const id = ins.meta.last_row_id;
  let proposal_id = null;
  if (l3?.proposeObjectiveChange) {
    const text = `Calibration ${id}: set the weights of F to ${JSON.stringify(proposed)} (now ${JSON.stringify(weights)}), fitted over ${n} cycles, r2 ${r2}. `
      + `A term that predicted the wrong way got 0: ${Object.entries(per).filter(([, v]) => v.direction !== 'as specified').map(([k]) => k).join(', ') || 'none'}. Adopt by setting sla.weights and sla.adopted_calibration = ${id} in configuration.`;
    proposal_id = (await l3.proposeObjectiveChange(text)).id ?? null;
    await db.prepare(`UPDATE sla_calibrations SET proposal_id=? WHERE id=?`).bind(proposal_id, id).run();
  }
  return { ok: true, id, rows_used: stored.length, weights: proposed, previous: weights, fit, proposal_id };
}
