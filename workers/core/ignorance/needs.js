// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The needs register of core/elicit seen as ignorance (US-SPEC-16 5.5, section 6): every default taken for the person is an assumption nobody tested, so it is a
// subject with one untested assumption and the registry holds a gap for it; the person's answer or a derived value is a tested one and holds none. The gap closes with
// the answer as its evidence. Reads elicit_needs only; writes nothing of its own.
import { gapId } from './index.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
export const needSubjectId = (project, id) => `need:${project}:${id}`;
const assumptionText = n => `the default "${n.value}" is right`;

/** The subjects for core/ignorance `run`: one per settled need of the project (or of every project when none is named). */
export async function needSubjects(db, project = null) {
  const rows = await all(db, `SELECT project, id, label, value, provenance, state FROM elicit_needs WHERE state IN ('defaulted','answered','derived') ${project ? 'AND project = ?' : ''} ORDER BY project, id`, ...(project ? [project] : []));
  return rows.map(n => ({
    id: needSubjectId(n.project, n.id), type: 'item', title: n.label, claim: `${n.label}: ${n.value}`, evidence: [], who: n.provenance,
    assumptions: n.provenance === 'default' ? [{ text: assumptionText(n), tested: false }] : [{ text: `the person's ${n.provenance === 'derived' ? 'recorded' : 'stated'} value stands`, tested: true }],
  }));
}

/** Close the gap of every need that is no longer an untested default, with the value that replaced it as the evidence (disposition resolved). Returns the ids closed. */
export async function reconcileNeedGaps({ registry, db, project = null }) {
  const closed = [];
  const rows = await all(db, `SELECT project, id, value, provenance, state FROM elicit_needs ${project ? 'WHERE project = ?' : ''}`, ...(project ? [project] : []));
  const open = await registry.list({ status: 'open' });
  for (const n of rows) {
    if (n.provenance === 'default' && n.state === 'defaulted') continue;
    // every untested-assumption gap of this need's subject is the default that has now been replaced
    for (const g of open.filter(x => x.subject === needSubjectId(n.project, n.id) && x.kind === 'untested_assumption')) {
      await registry.close(g.id, { disposition: 'resolved', evidence: n.state === 'open' ? 'the need is open again' : `the default was replaced by ${n.provenance}: ${n.value}` });
      closed.push(g.id);
    }
  }
  return closed;
}
export { gapId };
