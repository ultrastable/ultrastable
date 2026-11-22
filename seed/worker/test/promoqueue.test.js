// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// TENANT-PROMO-1: the shared tenant promotion queue and the publisher's tenant-fair order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promoQueue, guard, compose, tenantOf } from '../src/promoqueue.js';
import { fairOrder, priority } from '../src/social.js';

const items = Array.from({ length: 5 }, (_, i) => ({ id: 'b' + i, path: '/e/b' + i, text: 'Common belief number ' + i + '. The evidence points another way.', kind: 'belief' }));
const base = { tenant: 'demo', site: 'https://demo.example', hook: 'Demo runs on Ultrastable.', items, start: '2026-11-23', every_days: 2 };

test('TENANT-PROMO-1: posts are staggered, carry hook and link, stay inside the window and repeat with new ids', () => {
  const q = promoQueue({ ...base, now: Date.parse('2026-12-10T12:00:00Z') });
  assert.equal(q.refused.length, 0);
  assert.ok(q.posts.length > 0 && q.posts.length <= 19);
  for (const p of q.posts) {
    assert.ok(p.text.includes(base.hook) && p.text.includes(p.url), p.id);
    assert.ok(p.text.length <= 300);
    assert.equal(p.tenant, 'demo');
    assert.ok(p.date >= '2026-12-03' && p.date <= '2027-01-09', p.date);
  }
  const ids = q.posts.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.ok(ids.some(id => /:c\d+$/.test(id)), 'a second cycle gets new ids');
  const dates = q.posts.map(p => p.date);
  assert.deepEqual(dates, dates.slice().sort());
});

test('TENANT-PROMO-1: nothing is queued before the start date window, and an empty tenant queues nothing', () => {
  assert.equal(promoQueue({ ...base, now: Date.parse('2026-10-01T00:00:00Z') }).posts.length, 0);
  assert.equal(promoQueue({ ...base, items: [] }).posts.length, 0);
});

test('TENANT-PROMO-1: compose shortens the body only; the guard refuses mentions, ridicule and missing hooks', () => {
  const t = compose('x '.repeat(400), 'https://demo.example/e/1', 'Demo runs on Ultrastable.');
  assert.ok(t.length <= 300 && t.endsWith('https://demo.example/e/1\nDemo runs on Ultrastable.'));
  assert.deepEqual(guard(t, { hook: 'Demo runs on Ultrastable.', link: 'https://demo.example/e/1' }), []);
  assert.ok(guard('hi @someone https://a.b H', { hook: 'H', link: 'https://a.b' }).length);
  assert.ok(guard('people who think this are stupid https://a.b H', { hook: 'H', link: 'https://a.b' }).length);
  assert.ok(guard('fine https://a.b', { hook: 'H', link: 'https://a.b' }).includes('no hook'));
});

test('TENANT-PROMO-1: tenants share one rung and the tenant that posted least this week goes first', () => {
  assert.equal(tenantOf({ arm: 'ps-solution' }), 'practical-solutions');
  assert.equal(tenantOf({ tenant: 'unlearn', arm: 'unlearn-belief' }), 'unlearn');
  assert.equal(priority({ tenant: 'unlearn', arm: 'unlearn-belief', kind: 'tenant' }), priority({ arm: 'ps-solution', kind: 'backlog' }));
  const now = Date.parse('2026-11-25T12:00:00Z');
  const rows = [1, 2, 3].map(i => ({ id: 'ps' + i, arm: 'ps-solution', at: '2026-11-2' + (2 + i) + 'T08:00:00Z' }));
  const due = [{ id: 'a', arm: 'ps-solution', kind: 'backlog', date: '2026-11-01' }, { id: 'b', tenant: 'unlearn', arm: 'unlearn-belief', kind: 'tenant', date: '2026-11-24' }, { id: 'c', arm: 'meta-story', date: '2026-11-25' }];
  assert.deepEqual(fairOrder(due, rows, now).map(p => p.id), ['c', 'b', 'a']);
});
