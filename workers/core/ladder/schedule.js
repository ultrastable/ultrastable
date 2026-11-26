// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Scheduled canaries and shadow answers (US-09 steps 2318 and 2320), the part around a live provider that can be built with
// ports. The provider call itself is the host's port: `canary(model, task_class)` -> { tool_calls, schema }, `answer(model,
// decision)` -> the model's answer, `label(decision)` -> the organization's label or null, `decisions()` -> recent decisions
// [{ ref, task_class, model }]. A missing port is reported in the notes of the tick; a throwing port is recorded as an item and
// never counted as a failed canary (an unreachable provider is not evidence that the model got worse).
import { iso, msOf, all, first, fileItem, closeItem } from './util.js';
import { recordCanary, recordShadow, shouldShadow } from './index.js';

/** Probe every matrix row whose last probe is older than `every_h` hours (default 24), at most `max` per call. */
export async function canaryRun({ db, now = Date.now, canary, every_h = 24, max = 10 } = {}) {
  const notes = [], t = msOf(now), ts = iso(t);
  if (typeof canary !== 'function') return { ran: 0, errors: [], notes: ['ladder: no canary port; scheduled canaries not run'] };
  const due = await all(db, `SELECT model, task_class FROM ladder_model_task_matrix WHERE probed_at IS NULL OR probed_at <= ? ORDER BY probed_at LIMIT ?`, iso(t - every_h * 3600000), max);
  let ran = 0; const errors = [];
  for (const row of due) {
    let r;
    try { r = await canary(row.model, row.task_class); }
    catch (e) { errors.push({ model: row.model, task_class: row.task_class, error: String(e?.message || e).slice(0, 160) }); continue; }
    const adm = await first(db, `SELECT evidence FROM ladder_model_admission WHERE model = ? AND task_class = ? AND stage = 'admitted' ORDER BY id DESC LIMIT 1`, row.model, row.task_class);
    let need = {}; try { need = JSON.parse(adm?.evidence || '{}').need || {}; } catch { need = {}; }
    await recordCanary(db, { model: row.model, task_class: row.task_class, tool_calls: r?.tool_calls, schema: r?.schema, need }, { now: t });
    ran++;
  }
  if (errors.length) {
    await fileItem(db, { id: 'LADDER-CANARY-PORT', title: `The canary port failed for ${errors.length} model(s): ${errors[0].model} ${errors[0].error}`, done_check: 'a scheduled canary run completes for every due model', closing_probe: 'ladder canaryRun: errors is empty', priority: 30 }, ts);
    notes.push(`ladder: ${errors.length} canary port error(s) recorded`);
  } else if (due.length) await closeItem(db, 'LADDER-CANARY-PORT', 'a canary run completed', ts);
  return { ran, errors, notes };
}

/** Answer a sample of decisions a second time and compare with the organization's label; feeds rolling agreement and the demotion step. */
export async function shadowRun({ db, now = Date.now, answer, label, decisions, rate = 0.05, max = 20 } = {}) {
  const t = msOf(now);
  if (typeof answer !== 'function' || typeof label !== 'function' || typeof decisions !== 'function') return { sampled: 0, errors: [], notes: ['ladder: no answer, label or decisions port; shadow sampling not run'] };
  const errors = []; let sampled = 0;
  for (const d of await decisions()) {
    if (sampled >= max) break;
    if (!shouldShadow(d.ref, rate)) continue;
    if (await first(db, `SELECT id FROM ladder_shadow_samples WHERE decision_ref = ? AND model = ?`, d.ref, d.model)) continue; // once per decision and model
    try {
      const lab = await label(d);
      if (lab == null) continue; // no label yet: not a sample
      const ans = await answer(d.model, d);
      await recordShadow(db, { model: d.model, task_class: d.task_class, decision_ref: d.ref, model_answer: ans, label: lab }, { now: t });
      sampled++;
    } catch (e) { errors.push({ ref: d.ref, error: String(e?.message || e).slice(0, 160) }); }
  }
  return { sampled, errors, notes: errors.length ? [`ladder: ${errors.length} shadow port error(s) recorded`] : [] };
}
