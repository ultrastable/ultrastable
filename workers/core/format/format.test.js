// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { figure, pct, count, sig, rate, machine, unitOf, falsePrecision } from './index.js';

test('percentages are whole numbers, one decimal below 10', () => { assert.equal(pct(82.0999908447266), '82%'); assert.equal(pct(27.9879394), '28%'); assert.equal(pct(4.26), '4.3%'); });
test('counts use two or three significant figures and a unit word', () => {
  assert.equal(count(1000000), '1.0 million'); assert.equal(count(1300000), '1.3 million'); assert.equal(count(12345678), '12 million'); assert.equal(count(123456789), '123 million');
  assert.equal(count(82000), '82 thousand'); assert.equal(count(2.5e9), '2.5 billion'); assert.equal(count(1234), '1,200'); assert.equal(count(37.2412), '37.2'); assert.equal(sig(0.0123456, 3), '0.0123');
});
test('values carry the unit their title names, rounded', () => {
  assert.equal(figure(82.0999908447266, 'Trained teachers (% of female teachers)'), '82%');
  assert.equal(figure(37.2418, 'Mortality rate, under-5 (per 1,000 live births)'), '37.2 per 1,000 live births');
  assert.equal(figure(1234, 'Exclusive breastfeeding (in thousands)'), '1.2 million');
  assert.equal(unitOf('Road traffic death rate (per 100 000 population)').label, 'per 100,000 population'); assert.equal(figure(null, 'x'), '');
});
test('a rate of change is readable and states its direction', () => { assert.equal(rate(Math.log(0.95)), 'down 5.0% a year'); assert.equal(rate(Math.log(1.2)), 'up 20% a year'); assert.match(rate(0.0001), /^flat/); });
test('machine values drop float noise; the lint finds false precision and spares identifiers', () => {
  assert.equal(machine(82.0999908447266), 82.1);
  assert.ok(falsePrecision('<p>World figure 82.0999908447266 (2024)</p>')); assert.ok(falsePrecision('<p>1000000 people</p>'));
  assert.equal(falsePrecision('<p>doi 10.5281/zenodo.21901984 and code HIV_0000000023</p><script>x=1.23456789</script>'), null);
});
