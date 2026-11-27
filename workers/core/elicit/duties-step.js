// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The elicitation duties of the tick (US-SPEC-16 R10, R20, R21, R27): default every overdue Ask across every project, check every card that would be shown against the glossary
// and the card rules, derive open Needs through the host's ports (idea, records, probes, cited research), and read researched sources again. A duty of the tick means nobody has to
// open the walkthrough for it to happen. Ports: db, elicit, fetch (optional), derive (optional).
import { verifyResearched } from './research.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const slug = s => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');

/** opts: { db, elicit, fetch, now, derive } where derive is `async project => ({ records, probes, research })` (the ports of `elicit.derive`) or omitted. The step is the same shape as
 *  `elicitAuditStep`: { name, run(db, ctx) } with notes pushed on ctx.notes. A duty that throws is noted and the others still run. */
export function elicitDutiesStep({ db, elicit, fetch: fetchFn = null, now = () => Date.now(), derive = null } = {}) {
  return { name: 'elicit_duties', run: async (_db, ctx) => {
    const notes = ctx?.notes || [];
    const guard = async (what, f) => { try { return await f(); } catch (e) { notes.push(`elicit duties: ${what} failed (${String(e?.message || e).slice(0, 120)})`); return null; } };
    const defaulted = await guard('expiry', () => elicit.expireAll());
    if (defaulted) notes.push(`elicit duties: ${defaulted} overdue Ask${defaulted === 1 ? '' : 's'} fell to the default`);
    const leaks = (await guard('the card review', () => elicit.reviewAll())) || [];
    for (const l of leaks) {
      await db.prepare(`INSERT OR IGNORE INTO items (id, title, kind, project, owner_role, done_check, closing_probe, priority, status) VALUES (?,?,'work','elicit','portfolio-manager',?,'manual',20,'open')`)
        .bind(`ELICIT-CARD-${slug(l.project)}-${slug(l.need_id)}`, `A card for "${l.need_id}" in ${l.project} breaks the card rules: ${l.problems.join('; ').slice(0, 200)}`, `elicit.reviewCards("${l.project}") returns no problem for ${l.need_id}`).run();
    }
    if (leaks.length) notes.push(`elicit duties: ${leaks.length} card${leaks.length === 1 ? '' : 's'} break the card rules`);
    if (typeof derive === 'function') {
      for (const { project } of await all(db, `SELECT DISTINCT project FROM elicit_needs WHERE state='open'`)) {
        const r = await guard(`derivation for ${project}`, async () => elicit.derive(project, (await derive(project)) || {}));
        if (r?.derived?.length) notes.push(`elicit duties: ${r.derived.length} need${r.derived.length === 1 ? '' : 's'} derived for ${project} instead of asked`);
      }
    }
    if (typeof fetchFn === 'function') {
      for (const { project } of await all(db, `SELECT DISTINCT project FROM elicit_needs WHERE provenance='researched'`)) {
        const v = await guard(`reading the cited sources for ${project}`, () => verifyResearched({ db, elicit, fetch: fetchFn, now }, project));
        if (v?.reopened.length) notes.push(`elicit duties: ${v.reopened.length} researched need${v.reopened.length === 1 ? '' : 's'} reopened in ${project}: the cited source is gone`);
      }
    }
  } };
}
