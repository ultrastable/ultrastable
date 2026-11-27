// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ASHBY-KERNEL-1: the mechanisms taken from W. Ross Ashby's journal index, as pure functions. Each test states the property the journal page gives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { variety, entropy, transmission, requisiteVariety, expectedTrials, components, reducibility, searchBudget, nextTrial, upsets, accessibility, jointRest, cylindrance, protocol, MAX_JOINT } from '../src/ashby.js';

test('variety counts the distinguishable elements; entropy and transmission are in bits', () => {
  assert.deepEqual(variety(['a', 'b', 'a', 'c', 'd']), { n: 4, bits: 2 });
  assert.equal(entropy([1, 1, 1, 1]), 2); assert.equal(entropy([5]), 0); assert.equal(entropy([]), 0);
  const same = [[0, 0], [1, 1], [0, 0], [1, 1]], free = [[0, 0], [0, 1], [1, 0], [1, 1]];
  assert.equal(transmission(same).bits, 1);  // one part fixes the other: a whole bit passes
  assert.equal(transmission(free).bits, 0);  // independence is no variety passing
  assert.equal(transmission([]).bits, null);  // nothing observed is unmeasured
});

test('requisite variety: a disturbance class with no response that held is variety the regulator lets through', () => {
  const r = requisiteVariety([
    { d: 'BREACH-a', r: 'fix-a', ok: true }, { d: 'BREACH-b', r: 'fix-b', ok: true },
    { d: 'FM-c', r: null, ok: false }, { d: 'FM-c', r: 'fix-c', ok: false }, { d: 'MISSED-d', r: null, ok: false }]);
  assert.equal(r.disturbances, 4); assert.equal(r.covered, 2); assert.deepEqual(r.uncovered, ['FM-c', 'MISSED-d']);
  assert.equal(r.regulated_share, 0.5); assert.equal(r.deficit_bits, 1); assert.equal(r.outcome_bits, 1);
  const full = requisiteVariety([{ d: 'x', r: 'k1', ok: true }, { d: 'y', r: 'k2', ok: true }]);
  assert.equal(full.deficit_bits, 0); assert.equal(full.outcome_bits, 0); assert.equal(full.responses, 2);
  assert.equal(requisiteVariety([]).regulated_share, null);  // no disturbance seen is unmeasured, never a healthy 0
});

test('time to adapt: all at once is exponential in the number of parts, part by part is linear', () => {
  assert.equal(expectedTrials(10, 0.5, 'whole'), 1024); assert.equal(expectedTrials(10, 0.5, 'serial'), 20); assert.equal(expectedTrials(10, 0.5, 'parallel'), 2);
  assert.equal(expectedTrials(0), null); assert.equal(expectedTrials(3, 0), null);
});

test('reducibility: step-functions joined through a goal are one irreducible whole, the rest adapt apart', () => {
  const links = [{ knob: 'k1', goal: 'a' }, { knob: 'k2', goal: 'a' }, { knob: 'k2', goal: 'b' }, { knob: 'k3', goal: 'c' }];
  assert.deepEqual(components(links), [{ goals: ['a', 'b'], knobs: ['k1', 'k2'] }, { goals: ['c'], knobs: ['k3'] }]);
  const r = reducibility(links);
  assert.equal(r.parts, 2); assert.equal(r.largest_joint, 2); assert.deepEqual(r.irreducible, []);
  const big = reducibility(Array.from({ length: MAX_JOINT + 1 }, (_, i) => ({ knob: 'k' + i, goal: 'g' })));
  assert.equal(big.largest_joint, MAX_JOINT + 1); assert.equal(big.irreducible.length, 1);  // more than 6 to 10 that must hold together
  assert.equal(big.components[0].trials_at_once, 512); assert.equal(big.components[0].trials_by_parts, 18);
});

test('a search has a finite budget of trials', () => {
  const ok = searchBudget([8, 8], { horizon_h: 365 * 24, trial_h: 24 });
  assert.equal(ok.settings_bits, 6); assert.equal(ok.trials, 365); assert.equal(ok.feasible, true);
  assert.equal(searchBudget([8, 8, 8, 8], { horizon_h: 365 * 24, trial_h: 24 }).feasible, false);  // 4096 settings, 365 trials
});

test('the step-function search tries the declared direction first, then the nearest untried value, and never a rejected one', () => {
  const k = { value: 4, min: 1, max: 8, step: 1 };
  assert.deepEqual(nextTrial(k, { dir: -1 }), { value: 3, exploratory: false, distance: 1, tried: 0, grid: 8 });
  assert.equal(nextTrial(k, { dir: -1, rejected: [3], heldDir: -1 }).value, 5);  // the declared direction failed and rests: the other side
  assert.equal(nextTrial(k, { dir: -1, rejected: [3], heldDir: -1 }).exploratory, true);
  const order = []; let rej = [];
  for (let t; (t = nextTrial(k, { dir: -1, rejected: rej })); rej = [...rej, t.value]) order.push(t.value);
  assert.deepEqual(order, [3, 5, 2, 6, 1, 7, 8]);  // every value once, nearest first
  assert.equal(nextTrial(k, { dir: -1, rejected: order }), null);  // spent: only now is it a design problem
  assert.equal(nextTrial({ value: 1, min: 1, max: 8, step: 1 }, { dir: -1 }).value, 2);  // at a bound the search still has the other side
  assert.equal(nextTrial({ value: 0.25, min: 0.1, max: 0.5, step: 0.05 }, { dir: 1 }).value, 0.3);  // a fractional grid stays on the grid
  assert.equal(nextTrial({ value: 1, min: 1, max: 1, step: 1 }), null);
  // a range the step does not divide: the grid is 1, 3, 5, 7, 9 and never passes the bound
  const odd = { value: 9, min: 1, max: 10, step: 2 };
  assert.equal(nextTrial(odd, { dir: 1 }).value, 7); assert.equal(nextTrial(odd, { dir: 1 }).grid, 5);
  let seen = [], r2 = [];
  for (let t; (t = nextTrial(odd, { dir: 1, rejected: r2 })); r2 = [...r2, t.value]) seen.push(t.value);
  assert.deepEqual(seen, [7, 5, 3, 1]); assert.ok(seen.every(v => v >= 1 && v <= 10));
  // a current value off the grid is read as its nearest grid point, and a very fine grid still moves
  assert.equal(nextTrial({ value: 4.4, min: 1, max: 8, step: 1 }, { dir: 1 }).value, 5);
  assert.equal(nextTrial({ value: 500, min: 0, max: 1000, step: 1 }, { dir: 1 }).value, 501);
  assert.equal(nextTrial({ value: 500, min: 0, max: 1000, step: 1 }, { dir: 1, heldDir: 1 }).value, 499);
  assert.equal(nextTrial({ value: 4, min: 1, max: 8, step: 1 }, { dir: -1, heldDir: -1 }).value, 5, 'a resting direction is not searched');
});

test('veto: a variable that was holding inside its limits and left them after a step vetoes the step', () => {
  const t = 1000, s = (pairs) => pairs.map(([at, ok]) => ({ at, ok }));
  const series = {
    own: s([[t - 30, false], [t + 10, true], [t + 20, true]]),
    held: s([[t - 30, true], [t - 20, true], [t - 10, true], [t + 10, false], [t + 20, false]]),
    blip: s([[t - 30, true], [t - 20, true], [t - 10, true], [t + 10, false], [t + 20, true]]),
    already_out: s([[t - 30, true], [t - 20, false], [t - 10, true], [t + 10, false], [t + 20, false]]),
    young: s([[t - 10, true], [t + 10, false], [t + 20, false]]),
  };
  assert.deepEqual(upsets({ at: t, own: 'own' }, series), ['held']);  // not the step's own goal, not a single blip, not one that was not holding, not one too young to judge
  assert.deepEqual(upsets({ at: t, own: 'own' }, {}), []);
  assert.equal(accessibility(0), 1); assert.equal(accessibility(3), 0.25);  // a step-function that ramifies is offered less readily
});

test('the whole is not the product of its parts when the parts disturb each other', () => {
  const indep = []; for (let i = 0; i < 16; i++) indep.push({ a: i % 2 === 0, b: i % 4 < 2 });
  const j = jointRest(indep); assert.equal(j.product, 0.25); assert.equal(j.observed, 0.25); assert.equal(j.gap, 0);
  const anti = []; for (let i = 0; i < 16; i++) anti.push({ a: i % 2 === 0, b: i % 2 === 1 });
  const k = jointRest(anti); assert.equal(k.product, 0.25); assert.equal(k.observed, 0); assert.equal(k.gap, -0.25);  // each rests half the time, the whole never
  assert.equal(jointRest(indep.slice(0, 5)).observed, null);  // too few readings is unmeasured
});

test('cylindrance is the number of variables that must be looked at together', () => {
  const B = [0, 1], all3 = B.flatMap(x => B.flatMap(y => B.map(z => [x, y, z])));
  assert.equal(cylindrance(all3), 1);  // no constraint at all: each variable alone tells everything
  assert.equal(cylindrance(all3.filter(([x, y]) => x === y)), 2);  // x equals y, z free: pairs suffice
  assert.equal(cylindrance(all3.filter(([x, y, z]) => (x + y + z) % 2 === 0)), 3);  // parity: no pair shows it
  assert.equal(cylindrance([]), null);
});

test('black box: the same state and input with different results proves a variable is not being observed', () => {
  const p = protocol([
    { state: 'off', input: 'k+1', next: 'kept' }, { state: 'off', input: 'k+1', next: 'kept' },
    { state: 'off', input: 'j+1', next: 'kept' }, { state: 'off', input: 'j+1', next: 'reverted' },
    { state: 'off', input: 'm-1', next: 'reverted' }]);
  assert.equal(p.observations, 5); assert.equal(p.repeated, 2); assert.equal(p.determinate_share, 0.5);
  assert.deepEqual(p.hidden, [{ state: 'off', input: 'j+1', nexts: ['kept', 'reverted'] }]);
  assert.equal(protocol([{ state: 1, input: 1, next: 2 }]).determinate_share, null);  // nothing repeated: nothing can be said yet
});
