// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// ORG-THEORY-1: Perez Lopez (1974), each test a statement of the paper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as O from '../src/organization.js';

const reg = JSON.parse(readFileSync(new URL('../../autonomy/secondloop.json', import.meta.url), 'utf8'));

test('every organisation concept in the register is an export of organization.js, and every export is registered', () => {
  const mine = reg.concepts.filter(c => c.code === 'worker/src/organization.js');
  assert.ok(mine.length >= 5);
  for (const c of mine) for (const e of c.exports) assert.equal(typeof O[e], 'function', `${c.id}: no export ${e}`);
  assert.deepEqual(Object.keys(O).filter(k => !mine.some(c => c.exports.includes(k))), []);
});

test('ch. III: effectiveness is known beforehand, efficiency is learnt, consistency is what the learning changed', () => {
  const before = O.actionValues({ effectiveness: 5, expected_efficiency: -1 });
  assert.deepEqual([before.motivation, before.known, before.consistency], [4, false, null]);
  const after = O.actionValues({ effectiveness: 5, expected_efficiency: -1, observed_efficiency: -4 });
  assert.deepEqual([after.motivation, after.consistency], [1, -3], 'the reward is unchanged; the motivation fell because of what was learnt');
});

test('ch. III: a wrong model and an incomplete model are different lessons with different remedies', () => {
  assert.equal(O.learningKind({ predicted: 10, observed: 4 }).kind, 'incorrect');
  const inc = O.learningKind({ predicted: 10, observed: 10, unmodelled: -3 });
  assert.equal(inc.kind, 'incomplete'); assert.match(inc.remedy, /essential variable/);
  assert.equal(O.learningKind({ predicted: 10, observed: 10 }).kind, 'none');
  assert.equal(O.learningKind({ predicted: 10, observed: null }).kind, 'unmeasured');
});

test('ch. V: an organisation must be effective, attractive and consistent; two of three is not survival', () => {
  const good = [{ id: 't1', member: 'm', contribution: 10, reward: 4, expected_efficiency: -1, observed_efficiency: 0 }];
  const g = O.controlSystem(good);
  assert.deepEqual(g.levels, { effective: true, attractive: true, consistent: true }); assert.equal(g.survives, true);
  assert.deepEqual(g.identified, ['m'], 'the member found more congruence than expected');
  const alien = O.controlSystem([{ ...good[0], observed_efficiency: -3 }]);
  assert.deepEqual(alien.levels, { effective: true, attractive: true, consistent: false });
  assert.equal(alien.survives, false); assert.deepEqual(alien.alienated, ['m'], 'still belongs, for the reward alone');
  assert.equal(O.controlSystem([{ ...good[0], reward: 12 }]).levels.effective, false, 'it spends more to motivate than it gains');
  assert.equal(O.controlSystem([{ ...good[0], observed_efficiency: -9 }]).levels.attractive, false);
});

test('ch. V: an organisation that has never read the effect of its tasks is blind, and blind is not consistent', () => {
  const b = O.controlSystem([{ id: 't', member: 'm', contribution: 10, reward: 4 }]);
  assert.deepEqual([b.blind_share, b.levels.consistent, b.survives], [1, false, false]);
  assert.equal(O.controlSystem([]).survives, false); assert.equal(O.controlSystem([]).blind_share, null);
  assert.equal('score' in b, false, 'no single number: that would be an unstated purpose');
});

test('ch. V: compensating falling efficiency with reward buys a countable number of periods', () => {
  assert.equal(O.horizon({ contribution: 10, efficiency: 0, drift: 0 }), null, 'a consistent task has no end date');
  assert.equal(O.horizon({ contribution: 10, efficiency: 2, drift: 1 }), null);
  const h = O.horizon({ contribution: 10, efficiency: 0, drift: -2 });
  assert.equal(h, 4);
  const need = t => Math.max(0, 0 - (0 - 2 * t));                       // the reward that holds the member in period t
  assert.ok(need(h) < 10 && need(h + 1) >= 10, 'the period after the horizon costs as much as the task brings');
  assert.equal(O.horizon({ contribution: 3, efficiency: -5, drift: 0 }), 0, 'already costs more than it brings');
});

test('the closing theorem: values forbid a task that harms the one who does it, however well it pays', () => {
  const p = O.prescribe([
    { id: 'lucrative', contribution: 50, reward: 5, observed_efficiency: -2 },
    { id: 'modest', contribution: 8, reward: 5, observed_efficiency: 1 },
    { id: 'better', contribution: 12, reward: 5, expected_efficiency: 0 },
    { id: 'unread', contribution: 30, reward: 5 },
  ]);
  assert.deepEqual(p.prescribed, ['better', 'modest']);
  assert.deepEqual(p.probation, ['unread'], 'unknown effect is a trial to be read, never assumed harmless');
  assert.deepEqual(p.forbidden, [{ id: 'lucrative', margin: 45, efficiency: -2 }]);
});

test('footnote 3: the evoked set cannot leave out the failures of the action it is asked about', () => {
  const memory = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `ok${i}`, action_class: 'deploy', outcome: 'commit', at: i })),
    { id: 'bad1', action_class: 'deploy', outcome: 'rollback', at: 0 }, { id: 'bad2', action_class: 'deploy', outcome: 'failed', at: 1 },
    { id: 'other', action_class: 'post', outcome: 'rollback', at: 5 },
  ];
  const e = O.evoke(memory, 'deploy', { room: 5 });
  assert.deepEqual(e.evoked.slice(0, 2).map(r => r.id), ['bad1', 'bad2']);
  assert.deepEqual([e.evoked.length, e.failures, e.truncated], [5, 2, 9], 'what was left out is counted, not dropped silently');
  assert.equal(O.evoke(memory, 'deploy', { room: 1 }).evoked.length, 2, 'failures are evoked even when they exceed the room');
});

test('ch. I: the minimum organisation is two coupled ultrastable systems, and one side in limits is not equilibrium', () => {
  const org = [{ id: 'margin', lower: 0, value: 3 }], member = [{ id: 'needs', lower: 0, value: -1 }];
  assert.deepEqual(O.coupledPair(org, member), { equilibrium: false, out: { a: [], b: ['needs'] }, one_sided: true });
  assert.equal(O.coupledPair(org, [{ id: 'needs', lower: 0, value: 2 }]).equilibrium, true);
  assert.equal(O.coupledPair(org, [{ id: 'needs', lower: 0, value: null }]).equilibrium, false, 'unread is out of limits');
  assert.equal(O.coupledPair(org, []).equilibrium, false);
});
