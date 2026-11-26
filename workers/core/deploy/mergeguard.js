// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Merge guard (US-SPEC-07 section 4, US-07-R18): the one function a merge step calls before it merges. It is the reference
// module's form of the platform's green guard (seed/worker/src/greenguard.js). A merge is allowed only when the review gate
// holds no marker for the head and the head's checks are finished and green. An empty list of checks is not green: a queued
// suite, or a head too new to have reported, holds. An answer that cannot be read holds: unknown is not green.
// Ports: reviewGate { mergeAllowed(change_id, head) }, now () => ms, config { fresh_ms, ignore_checks }. No ambient state.
export const FRESH_MS = 15 * 60000;
const GREEN = ['success', 'neutral', 'skipped'];

/**
 * decide({ change_id, head, head_committed_at, checks, suites, required })
 *   checks: [{ name, status, conclusion }]  every check run on the head, as the code host reports them
 *   suites: [{ status }]                    its check suites (read only when `checks` is empty)
 *   required: [name]                        checks that must show `success` on this head (a repository's full-suite run)
 * Returns { ok, reasons[] }. `ok` is true only when `reasons` is empty.
 */
export function createMergeGuard({ reviewGate, now = () => Date.now(), config = {} } = {}) {
  const fresh = config.fresh_ms ?? FRESH_MS;
  const ignore = new Set(config.ignore_checks || []);
  return {
    async decide(req = {}) {
      const reasons = [];
      if (reviewGate) {
        try {
          const m = await reviewGate.mergeAllowed(req.change_id, req.head);
          if (!m || m.ok !== true) reasons.push(`review gate: ${(m && m.reason) || 'not allowed'}${m && m.marker ? ` (${m.marker})` : ''}`);
        } catch (e) { reasons.push(`review gate unreadable: ${String(e && e.message).slice(0, 120)}`); }
      }
      if (!Array.isArray(req.checks)) { reasons.push('the check list could not be read'); return { ok: false, reasons }; }
      const runs = req.checks.filter(c => c && !ignore.has(c.name));
      if (!runs.length) {
        if (!Array.isArray(req.suites)) { reasons.push('the check suites could not be read'); return { ok: false, reasons }; }
        const suites = req.suites.filter(Boolean);
        const waiting = suites.find(s => s.status !== 'completed');
        if (waiting) reasons.push(`checks queued (${waiting.status})`);
        else if (!suites.length) {
          const at = Date.parse(req.head_committed_at || '');
          if (!Number.isFinite(at)) reasons.push('the head commit time could not be read, so a head with no checks cannot be judged old enough to have reported');
          else if (now() - at < fresh) reasons.push(`no checks reported yet on ${String(req.head || '').slice(0, 7)}`);
        }
      }
      const open = runs.find(c => c.status !== 'completed');
      if (open) reasons.push(`${open.name} still running`);
      const red = runs.find(c => c.status === 'completed' && !GREEN.includes(c.conclusion));
      if (red) reasons.push(`${red.name} ${red.conclusion ?? 'has no conclusion'}`);
      for (const need of req.required || []) {
        if (!runs.some(c => c.name === need && c.status === 'completed' && c.conclusion === 'success')) reasons.push(`${need} has not passed on ${String(req.head || '').slice(0, 7)}`);
      }
      return { ok: reasons.length === 0, reasons };
    },
  };
}
