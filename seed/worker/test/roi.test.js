// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, tune, detectPlan, AI_PAID_CAP_USD } from '../src/roi.js';
const day = (d, read, w = 1000) => ({ day: d, resources: { d1_rows_read: { peak: read, n: 100, over80: 10 }, d1_rows_written: { peak: w, n: 100, over80: 0 }, workers_requests: { peak: 5e4, n: 100, over80: 0 }, ai_neurons: { peak: 4e3, n: 100, over80: 0 } } });
test('too little data stays free', () => { const r = analyze({ days: [day('a', 4.9e6)] }); assert.equal(r.recommendation.action, 'stay-free'); });
test('three days under shed stays free, paid AI is $0', () => { const r = analyze({ days: [day('a', 4e6), day('b', 4e6), day('c', 3e6)] }); assert.equal(r.recommendation.action, 'stay-free'); assert.equal(r.hard_cap.paid_ai_usd_month, AI_PAID_CAP_USD); assert.equal(r.options.find(o => o.id === 'workers-ai-overage').verdict, 'stay-free'); });
test('two shed days in three recommends Workers Paid at about 5 USD', () => { const r = analyze({ days: [day('a', 4.9e6), day('b', 4.8e6), day('c', 3e6)] }); assert.equal(r.recommendation.for, 'cf-workers-paid'); assert.ok(r.options[0].projected_usd_month < 6); });
test('default mode is free-only', () => assert.equal(analyze({ days: [] }).mode, 'free-only'));
test('tuning stretches loops past 80% of a limit and uses headroom when far under', () => { assert.equal(tune({ a: 0.96 }).action, 'slow'); assert.equal(tune({ a: 0.3 }).action, 'use-headroom'); assert.equal(tune({ a: 0.75 }).action, 'hold'); });
test('plan is free unless CF_PLAN=paid; a paid tenant is never told to pay again', () => { assert.equal(detectPlan({}), 'free'); assert.equal(detectPlan({ CF_PLAN: 'paid' }), 'paid'); const r = analyze({ plan: 'paid', days: [day('a', 4.9e6), day('b', 4.9e6), day('c', 4.9e6)] }); assert.equal(r.recommendation.action, 'stay-free'); });
