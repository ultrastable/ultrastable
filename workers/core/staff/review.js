// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Item-level reviews (US-02-R03, US-04-R04): a reviewer is a different agent from every doer of the item and, where both families
// are known, from a different model family; a review is additive, so it carries a plus (filed as a kind 'plus' item with its
// expected value) or says in its record that none was proposed, and a detector lists the reviews that said so.
// The review record is an outcomes row (surface 'review', action class 'review'); nothing here needs a table of its own.
import { all, first, run, iso, ensureItem } from '../kernel/util.js';
import { modelFamily } from '../kernel/lifecycle.js';

const NO_PLUS = '[no plus proposed]';
const missingTable = (e) => /no such table/i.test(String(e && e.message));

// Every agent that did the item and every model family that worked on it. Sources: the live claim, the role instances dispatched
// the item, outcomes recorded by doers (not reviews, and not managers' operations on the item), the agent leading a doer line
// ('staff: site/home.js'), and the families the router recorded for doer calls on the item.
export async function doersOf(db, itemId) {
  const agents = new Set(), families = new Set();
  for (const r of await all(db, `SELECT agent FROM claims WHERE item_id = ?`, itemId)) if (r.agent) agents.add(r.agent);
  for (const r of await all(db, `SELECT DISTINCT role_id AS a FROM dispatches WHERE item_id = ?`, itemId)) if (r.a) agents.add(r.a);
  for (const r of await all(db, `SELECT DISTINCT agent AS a FROM outcomes WHERE item_id = ? AND surface NOT IN ('review','manager-ops') AND agent IS NOT NULL`, itemId)) agents.add(r.a);
  try {
    const m = await first(db, `SELECT doer FROM kernel_item_meta WHERE item_id = ?`, itemId);
    const lead = /^([A-Za-z0-9._-]+):\s/.exec(m?.doer || '');
    if (lead) agents.add(lead[1]);
  } catch (e) { if (!missingTable(e)) throw e; }
  try { for (const r of await all(db, `SELECT DISTINCT family FROM router_calls WHERE item_id = ? AND kind = 'doer' AND outcome = 'ok' AND family IS NOT NULL`, itemId)) families.add(r.family); }
  catch (e) { if (!missingTable(e)) throw e; }
  return { agents: [...agents].sort(), families: [...families].sort() };
}

// Record a review. Refuses (throws) a reviewer that did the item, and a reviewer of a family that worked on it when the family is
// known. args: { item_id, reviewer, reviewer_model?, reviewer_family?, doer_models?, doer_families?, verdict: 'pass'|'fail', evidence,
// plus?: { title, expected_value }, familyOf?, now }.
export async function recordReview(db, a) {
  const it = await first(db, `SELECT id, project, title FROM items WHERE id = ?`, a.item_id);
  if (!it) throw new Error(`no such item ${a.item_id}`);
  if (!a.reviewer || !String(a.reviewer).trim()) throw new Error('a review names its reviewer');
  if (!['pass', 'fail'].includes(a.verdict)) throw new Error('verdict must be pass or fail');
  if (!a.evidence || !String(a.evidence).trim()) throw new Error('a review records its evidence');
  const d = await doersOf(db, a.item_id);
  if (d.agents.includes(a.reviewer)) throw new Error(`reviewer must differ from the doer of the item: ${a.reviewer} worked on ${a.item_id} (US-02-R03)`);
  const fam = (m) => modelFamily(m, { familyOf: a.familyOf });
  const mine = a.reviewer_family ? String(a.reviewer_family).toLowerCase() : fam(a.reviewer_model);
  const theirs = new Set([...d.families, ...(a.doer_families || []).map(x => String(x).toLowerCase()), ...(a.doer_models || []).map(fam)].filter(Boolean));
  if (mine && theirs.has(mine)) throw new Error(`reviewer must differ from the doer by model family: ${mine} worked on ${a.item_id} (US-02-R03)`);
  const now = a.now ?? Date.now();
  let plusItem = null;
  if (a.plus !== undefined && a.plus !== null) {
    if (!a.plus.title || !String(a.plus.title).trim() || !a.plus.expected_value || !String(a.plus.expected_value).trim()) throw new Error('a plus proposed by a review has a title and its expected value (US-04-R03, R04)');
    const n = (await first(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE ?`, `PLUS-${it.id}-%`)).n + 1;
    plusItem = `PLUS-${it.id}-${n}`;
    await ensureItem(db, { id: plusItem, title: String(a.plus.title), kind: 'plus', project: it.project, owner_role: a.plus.owner_role || 'product-manager', priority: a.plus.priority ?? 30,
      done_check: `expected value: ${a.plus.expected_value}. Proposed by the review of ${it.id} by ${a.reviewer}`, closing_probe: 'the improvement is applied and its effect measured' });
  }
  const evidence = `${a.verdict}: ${String(a.evidence).trim().slice(0, 380)} ${plusItem ? `[plus ${plusItem}]` : NO_PLUS}`; // the marker stays at the end, so it is never cut off
  const r = await run(db, `INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES (?,?,?,?,?,?,?)`,
    it.id, a.reviewer, 'review', 'review', 'verified', evidence, iso(now));   // the review was recorded; a 'fail' verdict is a correct review, not a failed one
  return { ok: true, review_id: r.meta.last_row_id, item_id: it.id, verdict: a.verdict, plus_item: plusItem, doers: d.agents, families_checked: [...theirs].sort() };
}

// US-04-R04 detector: reviews recorded since a time that proposed no plus.
export async function reviewsWithoutPlus(db, { since = null } = {}) {
  const rows = await all(db, `SELECT id, item_id, agent, evidence, at FROM outcomes WHERE surface = 'review' AND action_class = 'review' AND evidence LIKE ? ${since ? 'AND at >= ?' : ''} ORDER BY id`,
    ...[`%${NO_PLUS}`, ...(since ? [iso(since)] : [])]);
  return rows.map(r => ({ review_id: r.id, item_id: r.item_id, reviewer: r.agent, at: r.at }));
}
