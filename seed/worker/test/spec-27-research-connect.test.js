// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-27: the research pass uses the connection engine to propose links between a study's findings and the standing rules (scripts/research_connect.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../../scripts/research_connect.mjs', import.meta.url));
const run = input => { const r = spawnSync(process.execPath, [SCRIPT], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
const RULES = [
  { id: 'R1', text: 'every loop closes itself with a closing probe and a write back of the verified outcome' },
  { id: 'R2', text: 'hosting cost is capped by a monthly budget' },
  { id: 'R3', text: 'pages show the footer built on ultrastable' },
  { id: 'R4', text: 'credentials are never printed or committed' },
  { id: 'R5', text: 'design uses one set of tokens for colours and spacing' },
  { id: 'R6', text: 'tenants live in their own repository' },
];

test('US-27-R64: leads link a finding to the rules it resembles, by the lexical route and a cutoff of mean plus two standard deviations, and never to a rule already mapped', () => {
  const findings = [{ id: 'F1', text: 'an agent that closes every loop must verify the result with a closing probe and write the outcome back', mapped: [] }, { id: 'F2', text: 'cost of cloud hosting rises with traffic', mapped: ['R2'] }];
  const out = run({ findings, rules: RULES });
  assert.match(out.route, /^lexical-512-/, 'no network and no credential, so the pass always completes'); assert.deepEqual(Object.keys(out).sort(), ['cutoff', 'leads', 'route']);
  assert.deepEqual(out.leads.map(l => [l.finding, l.rule]), [['F1', 'R1']]); assert.ok(out.leads[0].score > out.cutoff && out.cutoff > 0);
  const mapped = run({ findings: [{ ...findings[0], mapped: ['R1'] }], rules: RULES }); assert.ok(!mapped.leads.some(l => l.rule === 'R1'), 'a rule the finding already maps to is not a lead');
  const many = run({ findings, rules: RULES }).leads.filter(l => l.finding === 'F1'); assert.ok(many.length <= 2, 'at most the two nearest rules a finding');
});

test('US-27-R64: with no findings or no rules the pass says so plainly and proposes nothing, and a lead names only a finding, a rule and a score', () => {
  assert.deepEqual(run({ findings: [], rules: RULES }), { route: null, leads: [] }); assert.deepEqual(run({ findings: [{ id: 'F', text: 'x', mapped: [] }], rules: [] }), { route: null, leads: [] }); assert.deepEqual(run(''), { route: null, leads: [] });
  const out = run({ findings: [{ id: 'F1', text: 'an agent that closes every loop must verify the result with a closing probe and write the outcome back', mapped: [] }], rules: RULES });
  assert.ok(out.leads.length >= 1 && out.leads.every(l => Object.keys(l).sort().join() === 'finding,rule,score'), 'a proposal: no mapping is written into the study');
});
