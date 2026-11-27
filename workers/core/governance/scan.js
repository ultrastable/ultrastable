// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The two clocks of the self-amending loop that gather their own input (US-SPEC-07 sections 3 and 3.2). scanSources is the
// recognition scan of US-07-R31: drafts come from declared sources (item comments, pull request bodies, runner summaries,
// console messages), each is scanned once, and no model is needed. goalCycle is the daily goal cycle of US-07-R24: signals
// (metrics in breach, failing probes, tick errors) become falsifiable candidate goals that pass through adoptGoals, with an
// optional model port that adds candidates. Ports: db, now, sources [{ name, read(sinceIso, limit) }], signals [{ name, read() }], synthesize.
import { all, first, run, iso } from './register.js';
import { recognize } from './engine.js';
import { adoptGoals, similarity } from './objectives.js';

/**
 * US-07-R31. Each source returns [{ ref, draft, at?, scope?, ctx? }] for the drafts written at or after the time it is given (`at` is the draft's own ISO time). A draft whose
 * (source, ref) was scanned before is skipped; the others go through recognize(), which stores the scan, records hits and
 * applies the redirect. A source that throws is reported in `errors` and the other sources still run. At most `limit` drafts are scanned per call.
 * `ports` are recognize()'s own (classifier, deduct, execute, dispatch, ...). Returns { scanned, skipped, hits, errors, truncated }.
 */
export async function scanSources(db, { sources = [], now = Date.now(), limit = 50, ports = {} } = {}) {
  const out = { scanned: 0, skipped: 0, hits: 0, errors: [], truncated: [] };
  const nowIso = iso(now);
  for (const src of sources) {
    if (!src || !src.name || typeof src.read !== 'function') { out.errors.push({ source: src && src.name, error: 'a source needs a name and a read function' }); continue; }
    const last = await first(db, `SELECT MAX(scanned_at) AS at FROM governance_scan_cursor WHERE source = ?`, src.name);
    const since = (last && last.at) || iso(now - 7 * 86400e3);
    let drafts;
    try { drafts = await src.read(since, limit); }
    catch (e) { out.errors.push({ source: src.name, error: String(e && e.message).slice(0, 160) }); continue; }
    // Unscanned drafts, oldest first when every draft carries its own `at`, so a truncated pass leaves the newer ones for the next.
    const fresh = [];
    for (const d of Array.isArray(drafts) ? drafts : []) {
      if (!d || !d.ref || typeof d.draft !== 'string') { out.errors.push({ source: src.name, error: 'a draft needs a ref and a draft text' }); continue; }
      if (await first(db, `SELECT 1 AS x FROM governance_scan_cursor WHERE source = ? AND ref = ?`, src.name, d.ref)) { out.skipped++; continue; }
      fresh.push(d);
    }
    if (fresh.length && fresh.every(d => typeof d.at === 'string' && d.at)) fresh.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    // The cursor of a source is MAX(scanned_at) and is handed to its next read as `since`. A row therefore records the draft's own
    // time (`at`, never later than this pass), so a draft left unscanned by the limit is not older than the cursor and the next read
    // returns it. A draft with no `at` is stamped with this pass only when its source was not cut; a cut source keeps its old cursor.
    const cut = fresh.length > Math.max(0, limit - out.scanned);
    for (const d of fresh) {
      if (out.scanned >= limit) { out.truncated.push(`${src.name}:${d.ref}`); continue; } // not scanned, not marked: the next pass takes it
      const r = await recognize(db, { draft: d.draft, source: src.name, source_ref: d.ref, scope: d.scope || src.scope || 'report', ctx: d.ctx }, { ...ports, now });
      const at = typeof d.at === 'string' && d.at ? (d.at < nowIso ? d.at : nowIso) : (cut ? since : nowIso);
      await run(db, `INSERT INTO governance_scan_cursor (source, ref, scan_id, scanned_at) VALUES (?,?,?,?)`, src.name, d.ref, r.scan_id ?? null, at);
      out.scanned++; out.hits += r.hits.length;
    }
  }
  return out;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * US-07-R24. Reads every signal source, turns each signal { key, text, probe?, definition_of_done?, severity?, alignment?,
 * parent_objective? } into a candidate { id SIG-<key>-<day>, definition_of_done (its probe, else its own words), falsifiability
 * 1 with a probe and 0.5 without, leverage from severity (default 0.6), novelty 1 minus the highest similarity to a goal of the
 * last 30 days }, adds what the optional `synthesize({ signals, goals, objectives })` port returns, and runs adoptGoals() on all
 * of them. A signal source or a synthesizer that fails is reported and the rest still run. Returns { signals, candidates, adopted, rejected, errors }.
 */
export async function goalCycle(db, { now = Date.now(), signals = [], synthesize, adopt = {} } = {}) {
  const out = { signals: 0, candidates: 0, adopted: [], rejected: [], errors: [] };
  const day = iso(now).slice(0, 10);
  const recent = await all(db, `SELECT id, text FROM governance_goals WHERE adopted_at >= ?`, iso(now - 30 * 86400e3));
  const seen = [];
  for (const src of signals) {
    try { for (const s of (await src.read()) || []) if (s && s.key && s.text) seen.push({ ...s, source: src.name }); }
    catch (e) { out.errors.push({ source: src && src.name, error: String(e && e.message).slice(0, 160) }); }
  }
  out.signals = seen.length;
  const candidates = [];
  for (const s of seen) {
    const id = `SIG-${slug(s.key)}-${day}`;
    if (await first(db, `SELECT 1 AS x FROM governance_goals WHERE id = ?`, id) || candidates.some(c => c.id === id)) continue; // idempotent within the day
    const sim = recent.reduce((m, g) => { const x = similarity(s.text, g.text); return Math.max(m, x.jaccard, x.containment); }, 0);
    candidates.push({
      id, text: String(s.text), definition_of_done: s.definition_of_done || s.probe || `the signal "${s.key}" is no longer reported`,
      done_probe: s.probe ?? null, falsifiability: s.probe ? 1 : 0.5, leverage: typeof s.severity === 'number' ? Math.min(1, Math.max(0, s.severity)) : 0.6,
      novelty: 1 - sim, author: 'goal-cycle', alignment: s.alignment, parent_objective: s.parent_objective,
    });
  }
  if (typeof synthesize === 'function') {
    try {
      const objectives = await all(db, `SELECT id, text FROM governance_objectives WHERE status = 'ratified' ORDER BY id`);
      for (const c of (await synthesize({ signals: seen, goals: recent, objectives })) || []) if (c && c.id && c.text) candidates.push({ author: 'synthesizer', ...c });
    } catch (e) { out.errors.push({ source: 'synthesize', error: String(e && e.message).slice(0, 160) }); }
  }
  out.candidates = candidates.length;
  if (candidates.length) { const r = await adoptGoals(db, candidates, { now, ...adopt }); out.adopted = r.adopted; out.rejected = r.rejected; }
  return out;
}
