// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ROLE-DUTIES-1 (Rowan, 2026-11-26: "The Portfolio/program/product managers should be doing this automatically ... Implement all automated
// roles in code."): every manager role has a duty it runs on the server clock without a model. A duty reads the system's own tables (or, for
// market research, one cited public source), records what it read in role_beats, files one work item when its reading is out of bounds and
// closes that item itself when the same reading comes back clear (settle). ROLE-IDLE-1: a switched-on role with no dispatch and no beat inside
// idle_hours is named in one IDLE-ROLES-<day> item for the portfolio manager, closed by the same reading.
// Cost: each duty runs at most once an hour; market research fetches one source per run (round robin), so about 24 subrequests a day.

const HOUR = 3600e3;
const iso = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
const day = (t) => new Date(t).toISOString().slice(0, 10);
const week = (t) => { const d = new Date(t); const j = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - j) / 864e5 + j.getUTCDay() + 1) / 7)).padStart(2, '0')}`; };

async function q(db, sql, ...a) { return ((await db.prepare(sql).bind(...a).all()).results) || []; }
async function one(db, sql, ...a) { return (await q(db, sql, ...a))[0] || null; }
async function ex(db, sql, ...a) { return db.prepare(sql).bind(...a).run(); }

export async function ensureTables(db) {
  await ex(db, `CREATE TABLE IF NOT EXISTS role_beats (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, duty TEXT NOT NULL, at TEXT NOT NULL, reading TEXT, output TEXT)`);
  await ex(db, `CREATE INDEX IF NOT EXISTS role_beats_role_at ON role_beats (role, at)`);
  await ex(db, `CREATE TABLE IF NOT EXISTS market_snapshots (id TEXT PRIMARY KEY, url TEXT NOT NULL, hash TEXT, headline TEXT, seen_at TEXT, changed_at TEXT)`);
}

// Pure: a short stable hash of text (FNV-1a), so a snapshot stores no page body.
export function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }

// Pure: the newest headline of a page or feed: the first Atom/RSS entry title, else the page <title>. Text only, trimmed.
export function headline(body) {
  const clean = (x) => String(x || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const entry = /<(entry|item)[\s>][\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  if (entry) return clean(entry[2]);
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  return clean(t && t[1]);
}

// Pure: the part of a page that counts as a change. Feeds: the first entry. Pages: the visible text, numbers and dates kept (a price or a
// release date is news), scripts and styles dropped so a rotated asset hash is not a change.
export function signature(body) {
  const entry = /<(entry|item)[\s>][\s\S]*?<\/(entry|item)>/i.exec(body);
  const text = (entry ? entry[0] : body).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return hash(text);
}

// Each duty: async (db, ctx) => { reading, breach, item? }. An item names its own id prefix so settle can close it when clear.
export const DUTIES = {
  'portfolio-manager': {
    duty: 'blocked-share',
    async run(db, ctx) {
      const r = await one(db, `SELECT SUM(status='blocked') b, COUNT(*) n FROM items WHERE status NOT IN ('done','superseded','cancelled')`);
      const n = (r && r.n) || 0, b = (r && r.b) || 0, share = n ? b / n : 0;
      const limit = ctx.limits.blocked_share;
      return { reading: `blocked ${b}/${n} open (${(share * 100).toFixed(0)}%, limit ${limit * 100}%)`, breach: n > 0 && share > limit, prefix: 'PORTFOLIO-BLOCKED-',
        item: { id: `PORTFOLIO-BLOCKED-${week(ctx.now)}`, kind: 'fix', priority: 3, title: `Portfolio: ${b} of ${n} open items are blocked (${(share * 100).toFixed(0)}%); move capacity to unblocking the largest blocker class`, done_check: `blocked share of open items at or under ${limit * 100}% (role_duties portfolio-manager reading)` } };
    },
  },
  'program-manager': {
    duty: 'stale-blocked',
    async run(db, ctx) {
      const rows = await q(db, `SELECT id FROM items WHERE status='blocked' AND updated_at < ? ORDER BY priority, updated_at LIMIT 10`, iso(ctx.now - ctx.limits.stale_days * 864e5));
      const c = await one(db, `SELECT COUNT(*) n FROM items WHERE status='blocked' AND updated_at < ?`, iso(ctx.now - ctx.limits.stale_days * 864e5));
      const n = (c && c.n) || 0;
      return { reading: `${n} item(s) blocked over ${ctx.limits.stale_days} days`, breach: n > 0, prefix: 'PROGRAM-STALE-',
        item: { id: `PROGRAM-STALE-${day(ctx.now)}`, kind: 'fix', priority: 4, title: `Program: ${n} item(s) blocked over ${ctx.limits.stale_days} days, oldest first: ${rows.map(r => r.id).join(', ')}. Unblock, supersede or shelve each with a reason`, done_check: `no item blocked over ${ctx.limits.stale_days} days` } };
    },
  },
  'project-manager': {
    duty: 'loop-breaker',
    async run(db, ctx) {
      const rows = await q(db, `SELECT id FROM items WHERE status='blocked' AND blocker LIKE 'loop-breaker%' ORDER BY priority LIMIT 10`);
      const c = await one(db, `SELECT COUNT(*) n FROM items WHERE status='blocked' AND blocker LIKE 'loop-breaker%'`);
      const n = (c && c.n) || 0;
      return { reading: `${n} item(s) parked by the loop breaker`, breach: n > 0, prefix: 'PROJECT-RESCOPE-',
        item: { id: `PROJECT-RESCOPE-${day(ctx.now)}`, kind: 'fix', priority: 4, title: `Project: ${n} item(s) failed three dispatches with no outcome (${rows.map(r => r.id).join(', ')}). Split each into a smaller item with a probe, or supersede it`, done_check: 'no item parked by the loop breaker' } };
    },
  },
  'product-manager': {
    duty: 'market-research',
    async run(db, ctx) {
      const list = (ctx.market && ctx.market.competitors) || [];
      const srcs = list.flatMap(c => (c.sources || []).map(s => ({ id: `${c.id}:${s.url}`, name: c.name || c.id, url: s.url })));
      if (!srcs.length) return { reading: 'no competitor sources declared', breach: false };
      const k = Math.floor(ctx.now / HOUR) % srcs.length, s = srcs[k];
      let body;
      try {
        const res = await ctx.fetch(s.url, { headers: { 'user-agent': 'ultrastable-market-research/1 (+https://ultrastable.io)' }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) return { reading: `${s.name}: ${s.url} answered ${res.status}; unmeasured this pass`, breach: false };
        body = (await res.text()).slice(0, 400000);
      } catch (e) { return { reading: `${s.name}: ${s.url} unreadable (${String(e && e.message).slice(0, 60)}); unmeasured this pass`, breach: false }; }
      const sig = signature(body), head = headline(body);
      const prev = await one(db, `SELECT hash FROM market_snapshots WHERE id=?`, s.id);
      await ex(db, `INSERT INTO market_snapshots (id, url, hash, headline, seen_at, changed_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash, headline=excluded.headline, seen_at=excluded.seen_at, changed_at=CASE WHEN market_snapshots.hash=excluded.hash THEN market_snapshots.changed_at ELSE excluded.changed_at END`, s.id, s.url, sig, head, iso(ctx.now), iso(ctx.now));
      const changed = Boolean(prev && prev.hash !== sig);
      return { reading: `${s.name}: ${prev ? (changed ? 'changed' : 'unchanged') : 'first snapshot'} (${head || 'no headline'}) source ${s.url}`, breach: changed, settle: false,
        item: { id: `MKT-${hash(s.id)}-${day(ctx.now)}`, kind: 'plus', priority: 6, title: `Market: ${s.name} changed, newest headline "${head}". Source: ${s.url}. Compare with Ultrastable and file the capability to adopt, or decline with a reason`, done_check: 'an adopt item or a declined reason recorded for this change', closing_probe: s.url } };
    },
  },
  'qa-engineer': {
    duty: 'unverified-done',
    async run(db, ctx) {
      const c = await one(db, `SELECT COUNT(*) n FROM items i WHERE i.status='done' AND i.updated_at > ? AND NOT EXISTS (SELECT 1 FROM outcomes o WHERE o.item_id=i.id AND o.result='verified')`, iso(ctx.now - 864e5));
      const n = (c && c.n) || 0;
      return { reading: `${n} item(s) closed in 24 h with no verified outcome`, breach: n > ctx.limits.unverified_max, prefix: 'QA-UNVERIFIED-',
        item: { id: `QA-UNVERIFIED-${day(ctx.now)}`, kind: 'fix', priority: 3, title: `QA: ${n} item(s) were closed in the last 24 h without a verified outcome; re-run their closing probes and reopen any that fail`, done_check: `closed-without-verification count at or under ${ctx.limits.unverified_max} over 24 h` } };
    },
  },
  'sre': {
    duty: 'tick-health',
    async run(db, ctx) {
      const r = await one(db, `SELECT COUNT(*) n, SUM(CASE WHEN steps_completed < steps_total OR (errors IS NOT NULL AND errors NOT IN ('', '[]')) THEN 1 ELSE 0 END) bad, MAX(started_at) last FROM tick_runs WHERE started_at > ?`, iso(ctx.now - 864e5));
      const n = (r && r.n) || 0, bad = (r && r.bad) || 0, expected = Math.floor(24 * 60 / ctx.limits.tick_min);
      const first = await one(db, `SELECT MIN(started_at) t FROM tick_runs`);
      if (!first || !first.t || first.t > iso(ctx.now - 864e5)) return { reading: `system younger than 24 h; ${n} ticks so far`, breach: false, prefix: 'SRE-TICK-' };
      const missing = Math.max(0, expected - n);
      return { reading: `${n} ticks in 24 h (expected ${expected}), ${bad} with a failed step`, breach: bad > 0 || missing > expected * 0.1, prefix: 'SRE-TICK-',
        item: { id: `SRE-TICK-${day(ctx.now)}`, kind: 'fix', priority: 2, title: `SRE: ${bad} of ${n} ticks in 24 h had a failed step and ${missing} tick slot(s) were missed; find the step and fix it`, done_check: 'every tick in 24 h completes every step and under 10% of slots are missed' } };
    },
  },
  'security-engineer': {
    duty: 'secret-items',
    async run(db, ctx) {
      const rows = await q(db, `SELECT id FROM items WHERE status NOT IN ('done','superseded','cancelled') AND (lower(title) LIKE '%secret%' OR lower(title) LIKE '%token%' OR lower(title) LIKE '%credential%' OR lower(title) LIKE '%leak%' OR lower(title) LIKE '%vulnerab%') AND created_at < ? LIMIT 10`, iso(ctx.now - 2 * 864e5));
      return { reading: `${rows.length} security item(s) open over 48 h`, breach: rows.length > 0, prefix: 'SEC-STALE-',
        item: { id: `SEC-STALE-${day(ctx.now)}`, kind: 'fix', priority: 1, title: `Security: ${rows.length} item(s) about secrets, tokens or vulnerabilities open over 48 h (${rows.map(r => r.id).join(', ')}); raise them and close each with evidence`, done_check: 'no security item open over 48 h' } };
    },
  },
};

// Close this duty's own open items when the reading is clear. Returns how many it closed.
export async function settle(db, prefix, nowIso) {
  if (!prefix) return 0;
  const r = await ex(db, `UPDATE items SET status='done', disposition='fixed: role duty reading back in bounds', updated_at=? WHERE id LIKE ? AND status NOT IN ('done','superseded','cancelled')`, nowIso, `${prefix}%`);
  return (r && r.meta && r.meta.changes) || 0;
}

export const DEFAULT_LIMITS = { blocked_share: 0.5, stale_days: 7, unverified_max: 0, tick_min: 10, idle_hours: 24 };

export async function roleDutiesStep(db, ctx, ensureItem) {
  await ensureTables(db);
  const now = ctx.now, nowIso = iso(now);
  const c = { now, limits: { ...DEFAULT_LIMITS, ...((ctx.config && ctx.config.role_duties) || {}) }, market: ctx.config && ctx.config.market, fetch: (ctx.env && ctx.env.fetch) || fetch };
  const ran = [], filed = [];
  for (const [role, d] of Object.entries(DUTIES)) {
    const last = await one(db, `SELECT MAX(at) at FROM role_beats WHERE role=? AND duty=?`, role, d.duty);
    if (last && last.at && Date.parse(last.at.replace(' ', 'T') + 'Z') > now - HOUR + 60e3) continue;  // at most hourly
    let out = 'clear', reading = '';
    try {
      const r = await d.run(db, c);
      reading = r.reading;
      if (r.breach && r.item) { const made = await ensureItem(db, { owner_role: role, ...r.item }); out = made ? `filed:${r.item.id}` : `open:${r.item.id}`; if (made) filed.push(r.item.id); }
      else if (r.settle !== false) { const n = await settle(db, r.prefix, nowIso); if (n) out = `settled:${n}`; }
    } catch (e) { out = 'error'; reading = String(e && e.message).slice(0, 200); }
    await ex(db, `INSERT INTO role_beats (role, duty, at, reading, output) VALUES (?, ?, ?, ?, ?)`, role, d.duty, nowIso, reading, out);
    ran.push(role);
  }
  const idle = await idleRoles(db, ctx, c.limits.idle_hours);
  const id = `IDLE-ROLES-${day(now)}`;
  if (idle.length) {
    if (await ensureItem(db, { id, kind: 'fix', priority: 3, owner_role: 'portfolio-manager', title: `Idle roles: ${idle.join(', ')} had no dispatch and no duty beat in ${c.limits.idle_hours} h; give each a duty or real work`, done_check: 'every switched-on role has a dispatch or a duty beat inside idle_hours (ROLE-IDLE-1)' })) filed.push(id);
  } else await settle(db, 'IDLE-ROLES-', nowIso);
  ctx.roleDuties = { ran, filed, idle };
  if (ran.length || filed.length) ctx.notes.push(`role duties: ran ${ran.length}${filed.length ? `, filed ${filed.join(', ')}` : ''}${idle.length ? `; idle: ${idle.join(', ')}` : ''}`);
  return ctx.roleDuties;
}

// ROLE-IDLE-1: switched-on roles with neither a dispatch nor a duty beat in the window. A role hired less than the window ago is not idle yet.
export async function idleRoles(db, ctx, hours) {
  const since = iso(ctx.now - hours * HOUR);
  const rows = await q(db, `SELECT r.role, MAX(d.at) disp, (SELECT MAX(b.at) FROM role_beats b WHERE b.role = r.role) beat FROM roles r LEFT JOIN dispatches d ON d.role_id = r.id GROUP BY r.role`);
  const first = await one(db, `SELECT MIN(started_at) t FROM tick_runs`);
  if (!first || !first.t || first.t > since) return [];  // a young system is judged once it has run for the window
  const off = new Set((((ctx.config && ctx.config.managers) || {}).managers || []).filter(m => m.default === 'off').map(m => m.id));
  return rows.filter(r => !off.has(r.role) && !((r.disp && r.disp >= since) || (r.beat && r.beat >= since))).map(r => r.role).sort();
}
