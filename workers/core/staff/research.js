// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The research agent behind origination (US-02-R08, US-SPEC-03 s4): given a program, it asks a model for one improvement in the five
// fields TITLE, WHY, code-task, code-anchor, EDIT. The model is a port (core/modelport complete, core/router call; the free edge
// rung needs no key), the reply is checked here before origination sees it (fields present, the target not a control-plane file,
// the anchor found exactly once when a file reader is given), and one retry carries the validation error back to the model.
// A model that cannot be called throws, and originate records that as a refused origination: the tick never errors on it.
import { parseProposal } from './originate.js';
import { isControlPlane } from './index.js';

const HEAD_LINES = 60;
const LABEL = { title: 'TITLE', why: 'WHY', code_task: 'code-task', code_anchor: 'code-anchor', edit: 'EDIT' };

function prompt(req, candidate, head, problem) {
  const lines = [
    `You are the research agent of program ${req.program_id} (persona ${req.persona}).`,
    req.charter ? `Charter: ${req.charter}` : null,
    `The program has ${req.open_roadmap_items} open roadmap item(s). Propose exactly one improvement that is small, additive and reversible.`,
    `Answer with these fields, one per line, nothing else: ${req.fields.join(', ')}.`,
    'code-task is a repository path of an ordinary source file. code-anchor is a string that occurs exactly once in that file. EDIT is the change to make at the anchor.',
    'Never name a control-plane file: the tick, policy, governance, permission configuration, agent instructions or workflows.',
    candidate ? `Candidate file ${candidate} begins:\n${head}` : null,
    problem ? `Your last answer was refused: ${problem}. Answer again with the corrected fields.` : null,
  ];
  return [{ role: 'system', content: 'You propose one change as five labelled fields.' }, { role: 'user', content: lines.filter(Boolean).join('\n') }];
}

// -> the research port of originate: async (request) => text. ports: complete({ role, kind, messages }) -> { text } | string,
// readFile(path) -> text, config: { control_plane, control_plane_extra }.
export function createResearchAgent({ complete, readFile = null, config = {}, maxRetries = 1 } = {}) {
  if (typeof complete !== 'function') throw new Error('createResearchAgent needs a complete port');
  const check = async (text) => {
    const { fields: f, missing } = parseProposal(text);
    if (missing.length) return `the answer lacks: ${missing.map(k => LABEL[k] || k).join(', ')}`;
    if (isControlPlane(f.code_task, config)) return `${f.code_task} is a control-plane file`;
    if (readFile) {
      let src; try { src = await readFile(f.code_task); } catch (e) { return `cannot read ${f.code_task}: ${e.message}`; }
      const n = String(src ?? '').split(f.code_anchor).length - 1;
      if (n !== 1) return `the anchor occurs ${n} time(s) in ${f.code_task}; exactly once is required`;
    }
    return null;
  };
  return async function research(req) {
    let problem = null, text = '', candidate = null, head = '';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const r = await complete({ role: 'manager', kind: 'research', messages: prompt(req, candidate, head, problem) });
      text = typeof r === 'string' ? r : r?.text;
      if (typeof text !== 'string') throw new Error('the model returned no text');
      problem = await check(text);
      if (!problem) return text;
      const { fields: f } = parseProposal(text); // show the head of the file the model chose, if it chose one we may read
      if (readFile && f.code_task && !isControlPlane(f.code_task, config)) { try { candidate = f.code_task; head = String(await readFile(f.code_task)).split(/\r?\n/).slice(0, HEAD_LINES).join('\n'); } catch { candidate = null; } }
    }
    return text; // still invalid: origination re-validates, refuses it with the reason and records it (a refusal is an input, not an error)
  };
}
