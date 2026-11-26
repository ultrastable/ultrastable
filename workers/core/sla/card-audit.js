// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Independent audit of a report card (US-SPEC-13 R23). The card is the system grading itself, so a second computation reads the same
// ten dimensions by a differently written path (rows are fetched and reduced here, where the card's own path asks SQL for a count) and
// compares each score; the phantom check finds work a person closed that no console action records, which would make the card's
// human-touch count too low; and an optional attestor port (a model of another family, or a person's attestation) is shown the
// card and its evidence and gives a verdict per dimension. A card nobody attested is labelled self-measured by core/console-l3.
const TERMINAL = new Set(['done', 'superseded', 'cancelled']);
const H = 3600e3;
const stamp = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const tenths = (n, d) => (d ? Math.round((n / d) * 50) / 10 : 0);

/** The ten autonomy dimensions again, from fetched rows. Returns { dimension: { n, d, score } }. */
export async function secondPath({ db, cfg, asOf }) {
  const nowS = stamp(asOf); const since = stamp(asOf - cfg.window_days * 24 * H);
  const rows = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const share = (list, ok) => ({ n: list.filter(ok).length, d: list.length });
  const ticks = await rows(`SELECT started_at, finished_at, steps_completed, steps_total FROM tick_runs`);
  const outcomes = await rows(`SELECT result, at FROM outcomes`);
  const preds = await rows(`SELECT verdict, due_at FROM predictions`);
  const items = await rows(`SELECT status, disposition FROM items`);
  const dispatches = await rows(`SELECT status FROM dispatches`);
  const cards = await rows(`SELECT status FROM gate_cards`);
  const sla = await rows(`SELECT s.due_at, i.status FROM sla_rows s JOIN items i ON i.id = s.item_id`);
  const ledger = await rows(`SELECT rung FROM trust_ledger`);
  const active = items.filter(i => !TERMINAL.has(i.status));
  const waiting = cards.filter(c => c.status === 'open').length;
  const top = cfg.rungs.length - 1;
  const raw = {
    check_completion: share(ticks.filter(t => t.started_at >= since), t => t.finished_at != null && t.steps_completed === t.steps_total),
    verified_outcomes: share(outcomes.filter(o => o.at >= since), o => o.result === 'verified'),
    prediction_scoring: share(preds.filter(p => p.due_at <= nowS), p => p.verdict != null),
    prediction_accuracy: share(preds.filter(p => p.verdict != null), p => p.verdict === 'hit'),
    disposition_hygiene: share(items.filter(i => TERMINAL.has(i.status)), i => String(i.disposition || '') !== ''),
    dispatch_success: share(dispatches.filter(d => d.status === 'done' || d.status === 'failed'), d => d.status === 'done'),
    work_without_a_person: { n: Math.max(0, active.length - waiting), d: active.length + (active.length ? 0 : waiting) },
    unblocked_flow: share(active, i => i.status !== 'blocked'),
    on_time: share(sla.filter(r => !TERMINAL.has(r.status)), r => r.due_at >= nowS),
    earned_trust: { n: ledger.reduce((a, r) => a + Math.max(0, cfg.rungs.indexOf(r.rung)), 0), d: top * ledger.length },
  };
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, { ...v, score: tenths(v.n, v.d) }]));
}

/** Items closed by a person role in the window that no console action refers to (the phantom class). */
export async function phantomClosures({ db, cfg, asOf }) {
  const since = stamp(asOf - cfg.window_days * 24 * H);
  const done = (await db.prepare(`SELECT id, owner_role FROM items WHERE status='done' AND updated_at >= ?`).bind(since).all()).results || [];
  const refs = new Set(((await db.prepare(`SELECT ref FROM console_actions WHERE ref IS NOT NULL`).all()).results || []).map(r => r.ref));
  return done.filter(i => cfg.person_roles.includes(i.owner_role) && !refs.has(i.id)).map(i => i.id);
}
