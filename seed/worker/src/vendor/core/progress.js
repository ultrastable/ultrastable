// VENDORED from ultrastable/workers core/progress/index.js so a seed checkout is self-contained (SEED-SELFCONTAINED-1); tests/foundation/test_failmine.py keeps it identical.
// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Usage and contract: core/progress/README.md.
// PROGRESS-1: visible progress from shipped changes only. Tenant-agnostic and pure: the caller supplies events that already happened
// (a merged change, a release, a launch); nothing here invents, pads or re-dates one.
// event: { id, at (ISO), system, title, url, kind ('change' | 'release' | 'launch'), by }
const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const H = 3600e3;
export const PERIODS = { daily: 24, weekly: 24 * 7, monthly: 24 * 30 };

// A merge that only records state (a ledger row, a regenerated file, a deploy record) happened, and is listed, but it is not what a
// returning reader came for: it never counts toward cadence and digests list it after the substantive changes.
const BOOKKEEPING = /^(?:(?:lane|host-sync|hostsync|loop-evidence|regen|ledger|evidence|record|write-?back|branchsweep|sessions?|spinoff: portfolio tick|deploy-workers: record|merge )\b|chore\(deps\))|\[skip ci\]/i;
// SUBSTANCE-1 (Rowan, 2026-11-21): a change whose diff was classified (workers/core/substance) counts only when it altered executable behaviour, so a
// bumped number, a hash, an unused import or a ledger merge is never progress whatever its title says; an unclassified change falls back to the title.
export const substantive = e => e.kind !== 'change' || (e.substance && e.substance !== 'unknown' ? e.substance === 'substantive' : !BOOKKEEPING.test(String(e.title || '')));
const SYSTEM_ORIGINS = ['unattended executor', 'bot'];

// Is the system itself moving? state: shipping (a substantive change the system made itself inside max_hours), sessions-only (substantive work
// came only from people or agent sessions), trivial-only (the system merged changes, none substantive), stalled (nothing merged in max_hours).
export function pulse(events, { now = Date.now(), max_hours = 48, window_days = 7 } = {}) {
  const ch = normalize(events).filter(e => e.kind === 'change'), from = now - window_days * 86400e3, recent = ch.filter(e => Date.parse(e.at) >= from);
  const sys = e => SYSTEM_ORIGINS.includes(e.by), hrs = e => e ? Math.round((now - Date.parse(e.at)) / 360e3) / 10 : null;
  const lastSub = ch.find(substantive), lastSysSub = ch.find(e => sys(e) && substantive(e)), lastAny = ch[0] || null, lastSys = ch.find(sys);
  const within = e => e && (now - Date.parse(e.at)) <= max_hours * 3600e3;
  const state = within(lastSysSub) ? 'shipping' : within(lastSub) ? 'sessions-only' : within(lastSys) ? 'trivial-only' : within(lastAny) ? 'trivial-only' : 'stalled';
  const count = (pred) => recent.filter(pred).length;
  const cls = e => e.substance || (substantive(e) ? 'substantive?' : 'record?');
  return { state, max_hours, window_days,
    last_substantive: lastSub ? { at: lastSub.at, title: lastSub.title, url: lastSub.url, by: lastSub.by, hours_ago: hrs(lastSub) } : null,
    last_substantive_by_system: lastSysSub ? { at: lastSysSub.at, title: lastSysSub.title, url: lastSysSub.url, hours_ago: hrs(lastSysSub) } : null,
    last_merge: lastAny ? { at: lastAny.at, title: lastAny.title, hours_ago: hrs(lastAny) } : null,
    week: { merged: recent.length, substantive: count(substantive), not_substantive: count(e => !substantive(e)), by_system: count(sys), substantive_by_system: count(e => sys(e) && substantive(e)),
      trivial: count(e => e.substance === 'trivial'), record: count(e => e.substance === 'record'), unclassified: count(e => !e.substance) },
    classes: Object.fromEntries(['substantive', 'trivial', 'record', 'unknown', 'substantive?', 'record?'].map(k => [k, count(e => cls(e) === k)])) };
}

// Sort newest first, drop events without a parseable time, and drop duplicates by id.
export function normalize(events) {
  const seen = new Set(), out = [];
  for (const e of events || []) {
    const t = Date.parse(e && e.at);
    if (!e || isNaN(t) || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ ...e, at: new Date(t).toISOString() });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// What shipped in one period ending at `now`. Counts are of the events given, split by system and by kind.
export function digest(events, { now = Date.now(), period = 'daily' } = {}) {
  const hours = PERIODS[period];
  if (!hours) throw new Error('unknown period ' + period);
  const from = now - hours * H;
  const items = normalize(events).filter(e => { const t = Date.parse(e.at); return t > from && t <= now; });
  const by_system = {}, by_kind = {};
  for (const e of items) { by_system[e.system] = (by_system[e.system] || 0) + 1; by_kind[e.kind] = (by_kind[e.kind] || 0) + 1; }
  const main = items.filter(substantive);
  return { period, from: new Date(from).toISOString(), to: new Date(now).toISOString(), count: items.length, substantive: main.length, by_system, by_kind,
    items: [...main, ...items.filter(e => !substantive(e))] };
}

// Is a system still shipping? Judged from its newest substantive event against the interval it declared.
// moving: inside the interval. slow: past it. stalled: past `stall` intervals. unmeasured: no event was ever seen, which is never read as moving.
export function cadence(events, { now = Date.now(), expect_hours = 24, stall = 2 } = {}) {
  const main = normalize(events).filter(substantive);
  if (!main.length) return { state: 'unmeasured', last_at: null, hours_since: null, expect_hours, shipped_24h: 0, shipped_7d: 0 };
  const hours = (now - Date.parse(main[0].at)) / H, n = h => main.filter(e => now - Date.parse(e.at) <= h * H).length;
  return { state: hours <= expect_hours ? 'moving' : hours <= expect_hours * stall ? 'slow' : 'stalled', last_at: main[0].at, hours_since: Math.round(hours * 10) / 10,
    expect_hours, shipped_24h: n(24), shipped_7d: n(168) };
}

// Events newer than a reader's last visit. `since` is the reader's own stored time; a reader with none sees nothing marked.
export function sinceVisit(events, since) {
  const t = Date.parse(since);
  return isNaN(t) ? [] : normalize(events).filter(e => Date.parse(e.at) > t);
}

export function toAtom({ title, link, feedUrl, items, hub }) {
  const list = normalize(items), upd = list.length ? list[0].at : '1970-01-01T00:00:00.000Z';
  const rows = list.map(e => `<entry><id>${esc(feedUrl)}#${esc(e.id)}</id><title>${esc((e.system_name || e.system) + ': ' + e.title)}</title><updated>${esc(e.at)}</updated><link href="${esc(e.url || link)}"/><category term="${esc(e.kind)}"/><summary>${esc(e.title)}</summary></entry>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${esc(feedUrl)}</id><title>${esc(title)}</title><updated>${esc(upd)}</updated><link rel="self" href="${esc(feedUrl)}"/>${hub ? `<link rel="hub" href="${esc(hub)}"/>` : ''}<link href="${esc(link)}"/>${rows}</feed>`;
}

// The reader's last visit lives in the reader's own browser (localStorage), never on a server and never in a cookie. The script marks every
// element carrying data-at newer than the stored time, fills the element with id `into` with the count, then stores the time of this visit.
// It reads the previous value before writing, so a reload within `graceMin` minutes still shows the same marks.
export function sinceVisitScript({ key = 'us-last-visit', into = 'since', graceMin = 30 } = {}) {
  return `(function(){try{var k=${JSON.stringify(key)},g=${Number(graceMin)}*6e4,now=Date.now(),raw=JSON.parse(localStorage.getItem(k)||'null')||{},prev=raw.prev||0,last=raw.last||0;`
    + `if(last&&now-last>g){prev=last}var n=0;document.querySelectorAll('[data-at]').forEach(function(el){var t=Date.parse(el.getAttribute('data-at'));if(prev&&t>prev){el.classList.add('is-new');n++}});`
    + `var o=document.getElementById(${JSON.stringify(into)});if(o){o.textContent=!prev?'This is your first visit on this device. Next time, this line counts what shipped since.':n?n+' shipped since your last visit on '+new Date(prev).toLocaleString()+'. They are marked below.':'Nothing new has shipped since your last visit on '+new Date(prev).toLocaleString()+'.'}`
    + `localStorage.setItem(k,JSON.stringify({prev:prev,last:now}))}catch(e){}})();`;
}
