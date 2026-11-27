// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The floor guard (US-09-R11): a banned model pattern in a worker's source or in its deployed bundle files an item per worker.
// Comment-only lines, the banned list's own declarations (lines between floor-list:begin and floor-list:end) and lines carrying a
// marker are skipped; a line is never skipped merely because it contains a banned pattern as plain text, because that is exactly
// the line the guard exists to find. A purge reverted by a
// concurrent redeploy is the case it exists for, so the bundle is read as well as the source. A worker that cannot be read is
// unmeasured, never clean. An exemption (model, role, evidence, expiry) suppresses a finding except for a reader-facing role.
import { iso, msOf, all, fileItem, closeItem, exempts } from './util.js';

const COMMENT_ONLY = /^\s*(\/\/|#|\/\*|\*\/?|<!--|--\s)/;
const BEGIN = /floor-list:begin/, END = /floor-list:end/;

const TOKEN_CHAR = /[A-Za-z0-9._:/@-]/;
/** The whole model identifier around a match ('vendor-mini' around '-mini'), so an exemption can name the model, not a fragment of it. */
export function enclosingToken(line, index, length) {
  let a = index, z = index + length;
  while (a > 0 && TOKEN_CHAR.test(line[a - 1])) a--;
  while (z < line.length && TOKEN_CHAR.test(line[z])) z++;
  return line.slice(a, z);
}

function scanText(text, banned, markers, out, base) {
  let inList = false;
  text.split('\n').forEach((line, i) => {
    if (BEGIN.test(line)) { inList = true; return; }
    if (END.test(line)) { inList = false; return; }
    if (inList || COMMENT_ONLY.test(line) || markers.some(m => line.includes(m))) return;
    for (const b of banned) {
      let m; try { m = new RegExp(b.pattern, 'i').exec(line); } catch { throw new Error(`floor guard: banned pattern is not a regular expression: ${b.pattern}`); }
      if (m) out.push({ ...base, line: i + 1, pattern: b.pattern, reason: b.reason, match: m[0], model: enclosingToken(line, m.index, m[0].length) });
    }
  });
}

/**
 * Pure scan. workers: [{ name, role?, source: [{ path, text }] | null, bundle: string | null }]. `source: null` means the worker
 * could not be read. Returns { findings, unmeasured, exempt }.
 */
export function scan({ workers, banned, markers = ['floor-ok:'], exemptions = [], nowIso = iso(Date.now()) }) {
  const findings = [], unmeasured = [], exempt = [];
  for (const w of workers) {
    if (!Array.isArray(w.source)) { unmeasured.push(w.name); continue; }
    const mine = [];
    for (const f of w.source) scanText(String(f.text ?? ''), banned, markers, mine, { worker: w.name, where: 'source', path: f.path });
    const sourceClean = mine.length === 0;
    if (typeof w.bundle === 'string') {
      const b = [];
      scanText(w.bundle, banned, markers, b, { worker: w.name, where: 'bundle', path: '(bundle)' });
      for (const x of b) mine.push(sourceClean ? { ...x, note: 'reverted by a concurrent redeploy: the source is clean, the deployed bundle is not' } : x);
    }
    for (const f of mine) {
      const role = w.role || 'unspecified', ex = exempts(exemptions, { kind: 'floor', model: f.model, role, nowIso }) || exempts(exemptions, { kind: 'floor', model: f.match, role, nowIso });
      (ex ? exempt : findings).push(ex ? { ...f, exemption: ex.id ?? null, evidence: ex.evidence } : f);
    }
  }
  return { findings, unmeasured, exempt };
}

/** Exit status of a run: 0 clean (every worker meets the floor), 1 a finding or an unreadable worker, 3 below the floor only under exemptions. */
export const EXIT = { clean: 0, findings: 1, exempt_only: 3 };

/**
 * One run for a tick or a CLI: ports { db, now, listWorkers: async () => workers }. Files FLOOR-<worker> (priority 5) per worker
 * with a finding or that could not be read, closes the item of a worker that scans clean. An exempt finding (US-09-R24) is listed
 * and not filed, but the model is still below the floor: the worker's item is left as it is (not closed, not filed again),
 * `meets_floor` is false and the run exits 3, so a closing probe that waits for exit 0 cannot pass through an exemption.
 */
export async function floorGuardRun(ctx) {
  const ts = iso(msOf(ctx.now ?? Date.now)), db = ctx.db;
  const banned = await all(db, `SELECT pattern, reason FROM ladder_floor_banned ORDER BY pattern`);
  const exemptions = await all(db, `SELECT * FROM ladder_exemptions WHERE kind='floor'`);
  let workers;
  try { workers = await ctx.listWorkers(); } catch (e) {
    await fileItem(db, { id: 'FLOOR-UNMEASURED', title: `The floor guard could not list the workers: ${String(e?.message || e).slice(0, 160)}`, done_check: 'the guard lists every worker', closing_probe: 'floor guard: exit 0', priority: 5 }, ts);
    return { exit_code: 1, findings: [], unmeasured: ['*'], filed: ['FLOOR-UNMEASURED'] };
  }
  await closeItem(db, 'FLOOR-UNMEASURED', 'the guard listed every worker', ts);
  const r = scan({ workers, banned, exemptions, nowIso: ts }), filed = [];
  const bad = new Set(r.findings.map(f => f.worker));
  for (const name of bad) {
    const fs = r.findings.filter(f => f.worker === name);
    await fileItem(db, { id: `FLOOR-${name}`, title: `Worker ${name} names a model below the floor: ${[...new Set(fs.map(f => f.model || f.match))].join(', ')} (${fs.map(f => `${f.where}:${f.path}:${f.line}`).slice(0, 3).join('; ')})`,
      done_check: 'scan finds no banned model pattern in source or bundle', closing_probe: 'floor guard: worker clean', priority: 5 }, ts);
    filed.push(`FLOOR-${name}`);
  }
  for (const name of r.unmeasured) {
    await fileItem(db, { id: `FLOOR-${name}`, title: `Worker ${name} could not be read: unmeasured, not clean`, done_check: 'the worker source is readable and scans clean', closing_probe: 'floor guard: worker clean', priority: 5 }, ts);
    filed.push(`FLOOR-${name}`);
  }
  const exemptWorkers = [...new Set(r.exempt.map(f => f.worker))].filter(name => !bad.has(name));
  for (const w of workers) if (!bad.has(w.name) && !exemptWorkers.includes(w.name) && !r.unmeasured.includes(w.name)) await closeItem(db, `FLOOR-${w.name}`, 'scan finds no banned model pattern', ts);
  const exit_code = r.findings.length || r.unmeasured.length ? EXIT.findings : r.exempt.length ? EXIT.exempt_only : EXIT.clean;
  return { exit_code, meets_floor: exit_code === EXIT.clean, ...r, exempt_workers: exemptWorkers, filed };
}
