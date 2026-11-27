// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The elicitation duties of the tick (US-SPEC-16 R10, R19, R27, R29, R30): default every overdue Ask across every project, keep the default predictions readable by the
// kernel scorer, check every card that would be shown against the glossary and the card rules (closing the item of a card that is clean again), derive open Needs through the
// host's ports (idea, records, probes, cited research) and read researched sources again, each on its own cadence. A duty of the tick means nobody has to open the walkthrough
// for it to happen. Ports: db, elicit, fetch (optional), derive (optional).
import { verifyResearched } from './research.js';
import { DEFAULT_HOLDS_METRIC } from './index.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const slug = s => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
const kernelTime = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
/** The default cadences (hours): a Need is derived through the host's ports at most once a day, and a cited source is read again at most once a day, so the duties
 *  write a bounded number of rows and make a bounded number of requests whatever the tick interval. `elicit.config.derive_every_hours` and `verify_every_hours` override them. */
export const DERIVE_EVERY_HOURS = 24;
export const VERIFY_EVERY_HOURS = 24;
const METRIC_ITEM = 'ELICIT-DEFAULT-METRIC';
const TERMINAL = `('done','superseded','cancelled')`;

/** opts: { db, elicit, fetch, now, derive } where derive is `async project => ({ records, probes, research })` (the ports of `elicit.derive`) or omitted. The step is the same shape as
 *  `elicitAuditStep`: { name, run(db, ctx) } with notes pushed on ctx.notes. A duty that throws is noted and the others still run. */
export function elicitDutiesStep({ db, elicit, fetch: fetchFn = null, now = () => Date.now(), derive = null } = {}) {
  const clock = typeof now === 'function' ? now : () => now;
  const hours = (key, fallback) => { const v = Number(elicit?.config?.[key]); return Number.isFinite(v) && v >= 0 ? v : fallback; };
  const closeItem = (id, why, evidence) => db.prepare(`UPDATE items SET status='done', blocker=NULL, disposition=?, updated_at=? WHERE id=? AND status NOT IN ${TERMINAL}`)
    .bind(why.slice(0, 300), kernelTime(clock()), id).run().then(async r => {
      if (!r.meta?.changes) return 0;
      await db.prepare(`DELETE FROM claims WHERE item_id=?`).bind(id).run();
      await db.prepare(`INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES (?, 'elicit-duties', 'work_tracker', 'execute', 'verified', ?, ?)`)
        .bind(id, evidence.slice(0, 300), kernelTime(clock())).run();
      return 1;
    });
  // Filed open, or reopened when an earlier pass closed it; an item that is still being worked is left as it is.
  const fileItem = (id, title, owner, doneCheck, probe, priority) => db.prepare(`INSERT INTO items (id, title, kind, project, owner_role, done_check, closing_probe, priority, status)
      VALUES (?,?,'work','elicit',?,?,?,?,'open') ON CONFLICT(id) DO UPDATE SET status='open', title=excluded.title, blocker=NULL, updated_at=datetime('now') WHERE items.status IN ${TERMINAL}`)
    .bind(id, title.slice(0, 300), owner, doneCheck, probe, priority).run().then(r => r.meta?.changes || 0);

  return { name: 'elicit_duties', run: async (_db, ctx) => {
    const notes = ctx?.notes || [];
    const guard = async (what, f) => { try { return await f(); } catch (e) { notes.push(`elicit duties: ${what} failed (${String(e?.message || e).slice(0, 120)})`); return null; } };
    const defaulted = await guard('expiry', () => elicit.expireAll());
    if (defaulted) notes.push(`elicit duties: ${defaulted} overdue Ask${defaulted === 1 ? '' : 's'} fell to the default`);

    // US-16-R19: a default prediction is scored by the kernel through DEFAULT_HOLDS_METRIC. Rows in the older shape are rewritten so the kernel can read them; when the
    // tick carries no reader for the metric while one is pending, one item says so (the kernel would grade it a miss), and it closes on the first pass that has the reader.
    const repaired = await guard('repairing the default predictions', () => (typeof elicit.repairDefaultPredictions === 'function' ? elicit.repairDefaultPredictions() : 0));
    if (repaired) notes.push(`elicit duties: ${repaired} default prediction${repaired === 1 ? '' : 's'} rewritten so the kernel scorer can read ${repaired === 1 ? 'it' : 'them'}`);
    await guard('the default prediction reader', async () => {
      const wired = typeof ctx?.metrics?.[DEFAULT_HOLDS_METRIC] === 'function';
      if (wired) {
        if (await closeItem(METRIC_ITEM, `closed by elicit duties: the tick reads ${DEFAULT_HOLDS_METRIC}`, `the tick's metrics carry ${DEFAULT_HOLDS_METRIC}`)) notes.push(`elicit duties: the tick now reads ${DEFAULT_HOLDS_METRIC}`);
        return;
      }
      const pending = (await first(db, `SELECT COUNT(*) AS n FROM predictions WHERE id LIKE 'ELICIT-%' AND metric=? AND verdict IS NULL`, DEFAULT_HOLDS_METRIC))?.n || 0;
      if (pending && await fileItem(METRIC_ITEM, `${pending} default prediction${pending === 1 ? '' : 's'} would be graded a miss: the tick has no reader for ${DEFAULT_HOLDS_METRIC}`, 'operations',
        `the organization passes elicitMetrics (core/elicit/index.js) to the tick's metrics, and the next elicit_duties pass sees ${DEFAULT_HOLDS_METRIC} there`, `elicit_duties sees ${DEFAULT_HOLDS_METRIC} on the tick`, 10)) {
        notes.push(`elicit duties: the tick has no reader for ${DEFAULT_HOLDS_METRIC}; filed ${METRIC_ITEM}`);
      }
    });

    // US-16-R29: one item per card that breaks the card rules, reopened when a card that was clean breaks them again; an item whose card is clean (or no longer shown) is closed.
    const leaks = await guard('the card review', () => elicit.reviewAll());
    if (leaks) {
      const leaking = new Set();
      let filed = 0;
      for (const l of leaks) {
        const id = `ELICIT-CARD-${slug(l.project)}-${slug(l.need_id)}`; leaking.add(id);
        filed += await fileItem(id, `A card for "${l.need_id}" in ${l.project} breaks the card rules: ${l.problems.join('; ').slice(0, 200)}`, 'portfolio-manager',
          `elicit.reviewCards("${l.project}") returns no problem for ${l.need_id}`, `elicit duties: reviewCards("${l.project}") has no problem for ${l.need_id}`, 20);
      }
      if (filed) notes.push(`elicit duties: ${filed} card${filed === 1 ? '' : 's'} break the card rules`);
      let closed = 0;
      for (const { id } of await all(db, `SELECT id FROM items WHERE id LIKE 'ELICIT-CARD-%' AND status NOT IN ${TERMINAL}`)) {
        if (leaking.has(id)) continue;
        closed += await closeItem(id, 'closed by elicit duties: the card review finds no problem with this card, or the card is no longer shown', 'reviewAll: no problem reported for this card');
      }
      if (closed) notes.push(`elicit duties: ${closed} card item${closed === 1 ? '' : 's'} closed: the card passes the card rules`);
    }

    // US-16-R30: derivation through the host's ports, for the Needs whose last attempt is older than the cadence.
    if (typeof derive === 'function') {
      const every = hours('derive_every_hours', DERIVE_EVERY_HOURS);
      const since = new Date(clock() - every * 3600e3).toISOString();
      const due = (await guard('finding the needs due for derivation', () => all(db, `SELECT DISTINCT n.project FROM elicit_needs n WHERE n.state='open' AND NOT EXISTS (SELECT 1 FROM elicit_derivations d
        WHERE d.project=n.project AND d.need_id=n.id AND d.surface IN ('record','probe','research') AND d.at > ?)`, since))) || [];
      for (const { project } of due) {
        const r = await guard(`derivation for ${project}`, async () => elicit.derive(project, { ...((await derive(project)) || {}), every_hours: every }));
        if (r?.derived?.length) notes.push(`elicit duties: ${r.derived.length} need${r.derived.length === 1 ? '' : 's'} derived for ${project} instead of asked`);
      }
    }
    // US-16-R27: each researched Need's cited source is read again once per cadence.
    if (typeof fetchFn === 'function') {
      const every = hours('verify_every_hours', VERIFY_EVERY_HOURS);
      for (const { project } of await all(db, `SELECT DISTINCT project FROM elicit_needs WHERE provenance='researched'`)) {
        const v = await guard(`reading the cited sources for ${project}`, () => verifyResearched({ db, elicit, fetch: fetchFn, now: clock, every_hours: every }, project));
        if (v?.reopened.length) notes.push(`elicit duties: ${v.reopened.length} researched need${v.reopened.length === 1 ? '' : 's'} reopened in ${project}: the cited source is gone`);
      }
    }
  } };
}
