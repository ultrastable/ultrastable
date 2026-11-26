// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-00-T03: for each RUNNING label, a production ledger row or log from the last 7 days. RUNNING says a component is in production use, and
// only production can show that; this module reads the labels out of the specifications and asks a ledger port for the evidence.
//   runningLabels(specs)    the status lines that label a component RUNNING (a sentence that only mentions the word is not a label)
//   checkRunning(...)       each label found (a row inside the window), missing (rows, none inside it) or unmeasured (the ledger could not be read)
//   jsonlLedger(text)       a ledger port over JSON lines { label, at } (an export of the production system's own log)
// Pure functions over text and a port: no network, no clock of its own. An unreadable ledger is never a pass (US-00-R04).
export const WINDOW_DAYS = 7;

const STATUS_HEADING = /^##\s+.*\bstatus\b/i;
// RUNNING as a label: after a colon, a full stop or a semicolon ("L2 records: RUNNING in production", "... a tick. RUNNING in production as ..."), or "is/are RUNNING".
const LABEL = /(?:^|[:.;(])\s*RUNNING\b(?!\s+label)(?!-only)|\b(?:is|are)\s+RUNNING\b/;
// A sentence that says there is none ("Nothing in the seed is labelled RUNNING") is not a label.
const NEGATED = /\b(?:nothing|none|no\s+\w+)\b[^.]*\blabell?ed\s+RUNNING\b|\bnot\s+labell?ed\s+RUNNING\b/i;

/** specs: [{ file, text }] -> [{ spec, line, text, key }]. Only bullet lines of a status section count; `key` is the component phrase the line leads with. */
export function runningLabels(specs) {
  const out = [];
  for (const { file, text } of specs) {
    const spec = /US-SPEC-(\d\d)/.exec(file)?.[0];
    if (!spec) continue;
    let inStatus = false;
    text.split('\n').forEach((raw, i) => {
      if (/^##\s/.test(raw)) inStatus = STATUS_HEADING.test(raw);
      if (!inStatus || !/^\s*[-*]\s/.test(raw)) return;
      const body = raw.replace(/^\s*[-*]\s+/, '').replace(/`/g, '');
      if (!LABEL.test(body) || NEGATED.test(body)) return;
      const key = body.split(/[:.]\s/)[0].replace(/\s+/g, ' ').trim().slice(0, 90);
      out.push({ spec, line: i + 1, text: body.slice(0, 200), key });
    });
  }
  return out;
}

const STAMP = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)/;
/** A ledger time as YYYY-MM-DD HH:MM:SS (US-00-R05), or null when it is not a time. */
export const stampOf = at => { const m = STAMP.exec(String(at ?? '')); return m ? `${m[1]} ${m[2]}` : null; };
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

/** A ledger port over JSON lines: { "label": "<component phrase>" | "US-SPEC-NN: <phrase>", "at": "...", "source": "..." }. A line that is not JSON is an error
 *  (the ledger is unreadable, not empty). */
export function jsonlLedger(text) {
  const rows = String(text).split('\n').filter(l => l.trim()).map((l, n) => { try { return JSON.parse(l); } catch { throw new Error(`ledger line ${n + 1} is not JSON`); } });
  return { async rowsFor(label) { return rows.filter(r => r && (r.label === label.key || r.label === `${label.spec}: ${label.key}` || (r.spec === label.spec && r.key === label.key))); } };
}

/** labels: from runningLabels; ledger: { rowsFor(label) -> [{ at }] } or null; now: ms; days: the window. Returns { ok, window_from, results }. ok only when every label is found. */
export async function checkRunning({ labels, ledger, now, days = WINDOW_DAYS }) {
  const from = iso(now - days * 86400e3); const to = iso(now);
  const results = [];
  for (const l of labels) {
    const base = { spec: l.spec, line: l.line, key: l.key };
    if (!ledger) { results.push({ ...base, status: 'unmeasured', reason: 'no production ledger was given' }); continue; }
    let rows;
    try { rows = await ledger.rowsFor(l); } catch (e) { results.push({ ...base, status: 'unmeasured', reason: `the ledger could not be read: ${String(e && e.message).slice(0, 120)}` }); continue; }
    const times = (rows || []).map(r => stampOf(r && r.at)).filter(Boolean).sort();
    const inside = times.filter(t => t >= from && t <= to);
    if (inside.length) results.push({ ...base, status: 'found', newest: inside.at(-1), rows: inside.length });
    else results.push({ ...base, status: 'missing', newest: times.at(-1) ?? null, reason: times.length ? `newest row ${times.at(-1)} is older than ${from}` : 'no ledger row names it' });
  }
  return { ok: results.every(r => r.status === 'found'), window_from: from, window_to: to, results };
}
