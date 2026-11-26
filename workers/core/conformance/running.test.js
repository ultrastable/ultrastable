// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-00-T03: every RUNNING label needs a production ledger row from the last 7 days. The ledger is a port; these tests use fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runningLabels, checkRunning, jsonlLedger, stampOf, WINDOW_DAYS } from './running.js';
import { specDir, readSpecs } from './cli.js';

const SPEC = { file: 'US-SPEC-90-example.md', text: `# US-SPEC-90: Example

## 3. Terms
- Widget: RUNNING in production is a word in a terms section, which is not a status line.

## 8. Reference implementation status
- Widget store: RUNNING in production under its own column names.
- Tick: BUILT in \`core/x.js\` (tests in \`core/x.test.js\`). RUNNING in production as an hourly tick (one manager).
- US-90-T03 (a production ledger row behind each RUNNING label): PLANNED. Nothing in the seed is labelled RUNNING, and the check needs a ledger.
- Planned piece: PLANNED. RUNNING-only items are listed by the backlog tool, not here.
- Queue: the queue is RUNNING in production.
` };
const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const DAY = 86400e3;
const at = ms => new Date(ms).toISOString();
const fake = rowsByKey => ({ async rowsFor(l) { return rowsByKey[l.key] || []; } });

test('US-00-T03: the labels are the status lines that label a component RUNNING, not a sentence that mentions the word or says there is none', () => {
  const labels = runningLabels([SPEC]);
  assert.deepEqual(labels.map(l => l.key), ['Widget store', 'Tick', 'Queue']);
  assert.ok(labels.every(l => l.spec === 'US-SPEC-90'));
  assert.deepEqual(runningLabels([{ file: 'README.md', text: '## 8. status\n- A: RUNNING in X.' }]), [], 'a file that is not a specification has no labels');
});

test('US-00-T03: a RUNNING label with a ledger row from the last 7 days is found; one with only older rows is missing', async () => {
  const labels = runningLabels([SPEC]);
  const r = await checkRunning({ labels, now: NOW, ledger: fake({
    'Widget store': [{ at: at(NOW - 2 * DAY) }],
    Tick: [{ at: at(NOW - 8 * DAY) }, { at: at(NOW - 30 * DAY) }],
    Queue: [] }) });
  assert.deepEqual(r.results.map(x => [x.key, x.status]), [['Widget store', 'found'], ['Tick', 'missing'], ['Queue', 'missing']]);
  assert.match(r.results[1].reason, /newest row 2026-11-18 12:00:00 is older than 2026-11-19 12:00:00/);
  assert.match(r.results[2].reason, /no ledger row names it/);
  assert.equal(r.ok, false);
  assert.equal(r.results[0].newest, '2026-11-24 12:00:00');
});

test('US-00-T03: an unreadable or absent ledger makes every label unmeasured, never found', async () => {
  const labels = runningLabels([SPEC]);
  const none = await checkRunning({ labels, now: NOW, ledger: null });
  assert.deepEqual(none.results.map(x => x.status), ['unmeasured', 'unmeasured', 'unmeasured']); assert.equal(none.ok, false);
  const broken = await checkRunning({ labels, now: NOW, ledger: { async rowsFor() { throw new Error('connection refused'); } } });
  assert.deepEqual(broken.results.map(x => x.status), ['unmeasured', 'unmeasured', 'unmeasured']);
  assert.match(broken.results[0].reason, /the ledger could not be read: connection refused/);
  assert.equal((await checkRunning({ labels: [], now: NOW, ledger: null })).ok, true, 'a specification with no RUNNING label has nothing to prove');
});

test('US-00-R05 and US-00-T03: ledger and clock are compared as YYYY-MM-DD HH:MM:SS strings; the window edge counts, a future row and a row that is not a time do not', async () => {
  const labels = runningLabels([SPEC]).slice(0, 1);
  const edge = at(NOW - WINDOW_DAYS * DAY);
  assert.equal((await checkRunning({ labels, now: NOW, ledger: fake({ 'Widget store': [{ at: edge }] }) })).results[0].status, 'found');
  assert.equal((await checkRunning({ labels, now: NOW, ledger: fake({ 'Widget store': [{ at: at(NOW - WINDOW_DAYS * DAY - 1000) }] }) })).results[0].status, 'missing');
  assert.equal((await checkRunning({ labels, now: NOW, ledger: fake({ 'Widget store': [{ at: at(NOW + 3600e3) }, { at: 'yesterday' }, { at: null }, {}] }) })).results[0].status, 'missing');
  assert.equal(stampOf('2026-11-25T08:30:00.123Z'), '2026-11-25 08:30:00'); assert.equal(stampOf('2026-11-25 08:30:00'), '2026-11-25 08:30:00'); assert.equal(stampOf('x'), null);
  assert.equal((await checkRunning({ labels, now: NOW, days: 1, ledger: fake({ 'Widget store': [{ at: at(NOW - 2 * DAY) }] }) })).results[0].status, 'missing', 'the window is a parameter');
});

test('US-00-T03: a ledger of JSON lines answers by the component phrase, by SPEC: phrase or by spec and key; a line that is not JSON makes the ledger unreadable', async () => {
  const labels = runningLabels([SPEC]);
  const text = [{ label: 'Widget store', at: at(NOW - DAY), source: 'production.tick_runs' }, { label: 'US-SPEC-90: Tick', at: at(NOW - DAY) }, { spec: 'US-SPEC-90', key: 'Queue', at: at(NOW - DAY) }, { label: 'Other', at: at(NOW) }].map(r => JSON.stringify(r)).join('\n') + '\n';
  const r = await checkRunning({ labels, now: NOW, ledger: jsonlLedger(text) });
  assert.deepEqual(r.results.map(x => x.status), ['found', 'found', 'found']); assert.equal(r.ok, true);
  assert.throws(() => jsonlLedger('{"label":"x"}\n{bad'), /ledger line 2 is not JSON/);
});

test('US-00-T03: in these specifications the RUNNING lines of the data model and the tick are labels, and without a production ledger they read unmeasured', async (t) => {
  const dir = specDir();
  if (!dir) return t.skip('no specification directory');
  const labels = runningLabels(readSpecs(dir));
  assert.ok(labels.some(l => l.spec === 'US-SPEC-01'), 'the L2 records of the data model');
  assert.ok(labels.some(l => l.spec === 'US-SPEC-03'), 'the L2 tick and the L3 kernel of the tick');
  const r = await checkRunning({ labels, now: NOW, ledger: null });
  assert.equal(r.ok, false); assert.ok(r.results.every(x => x.status === 'unmeasured'));
});
