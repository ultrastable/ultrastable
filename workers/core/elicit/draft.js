// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Drafting from the needs register (US-SPEC-16 R11, T16-6): every statement of a drafted artifact carries a provenance tag, and an artifact an agent wrote
// can be linted against the same rule. Tags: [stated], [derived: <source>], [researched: <url>], [default: A-INI-4#<assumption id>]. A need not yet settled is
// listed under "Open questions", never stated as fact. A-INI-4 (US-SPEC-15) is the assumption and default log, each entry with its revert path.
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const TAG = /\[(stated|derived: [^\]]+|researched: [^\]]+|default: A-INI-4#(\d+))\]\s*$/;

/** Draft one artifact of the project from the register. Returns { artifact, statements, open, markdown }. */
export async function draftArtifact(db, project, artifact) {
  if (artifact === 'A-INI-4') return draftAssumptionLog(db, project);
  const rows = await all(db, `SELECT * FROM elicit_needs WHERE project=? AND artifact=? ORDER BY (provenance='default') DESC, id`, project, artifact);
  const log = await all(db, `SELECT id, need_id FROM elicit_assumptions WHERE project=? AND superseded_at IS NULL AND reason <> 'contradicted'`, project);
  const statements = []; const open = [];
  for (const n of rows) {
    if (!['answered', 'defaulted', 'derived'].includes(n.state)) { open.push({ need_id: n.id, text: n.label }); continue; }
    const a = n.provenance === 'default' ? log.find(x => x.need_id === n.id) : null;
    const tag = n.provenance === 'default' ? `default: A-INI-4#${a ? a.id : 0}` : n.provenance === 'researched' ? `researched: ${n.source || 'no source'}` : n.provenance === 'derived' ? `derived: ${n.source || 'record'}` : 'stated';
    statements.push({ need_id: n.id, text: `${n.label}: ${n.value}`, provenance: n.provenance, tag, assumption_id: a ? a.id : null });
  }
  const md = [`# ${artifact}`, '', ...statements.map(s => `- ${s.text} [${s.tag}]`)];
  if (open.length) md.push('', '## Open questions', ...open.map(o => `- ${o.text}`));
  return { artifact, statements, open, markdown: md.join('\n') + '\n' };
}

/** A-INI-4: every default in effect, with why it was taken, when to revisit it and how to revert it. */
export async function draftAssumptionLog(db, project) {
  const rows = await all(db, `SELECT a.id, a.need_id, a.value, a.reason, a.revisit_trigger, n.label, n.default_consequence FROM elicit_assumptions a JOIN elicit_needs n ON n.project = a.project AND n.id = a.need_id
    WHERE a.project=? AND a.superseded_at IS NULL AND a.reason <> 'contradicted' ORDER BY a.id`, project);
  const statements = rows.map(r => ({ need_id: r.need_id, assumption_id: r.id, provenance: 'default', tag: `default: A-INI-4#${r.id}`,
    text: `${r.label}: "${r.value}" (taken because ${String(r.reason).replace(/_/g, ' ')}; revisit: ${r.revisit_trigger}; if it is wrong: ${r.default_consequence || 'change it in the read-back'}; revert path: the person changes it in the read-back and the affected artifact is redone)` }));
  return { artifact: 'A-INI-4', statements, open: [], markdown: ['# A-INI-4', '', ...statements.map(s => `- ${s.text} [${s.tag}]`)].join('\n') + '\n' };
}

/** Lint a draft an agent wrote: every line that states a value ends with a tag, and a default tag names a live assumption log entry of this project. */
export async function lintDraft(db, project, text) {
  const live = new Set((await all(db, `SELECT id FROM elicit_assumptions WHERE project=? AND superseded_at IS NULL AND reason <> 'contradicted'`, project)).map(r => r.id));
  const problems = []; let inOpen = false;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) { inOpen = /^#+\s*open questions\s*$/i.test(line); continue; }
    if (inOpen) continue;
    const m = TAG.exec(line);
    if (!m) { problems.push({ line, problem: 'a statement without a provenance tag' }); continue; }
    if (m[2] !== undefined && !live.has(Number(m[2]))) problems.push({ line, problem: `the default tag names no live assumption log entry (A-INI-4#${m[2]})` });
  }
  return { ok: problems.length === 0, problems };
}
