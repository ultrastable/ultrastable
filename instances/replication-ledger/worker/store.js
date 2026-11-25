// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The ledger's live state in D1 (binding DB, database ultrastable-replication-ledger). data/findings.json is the seed; everything the
// discovery loop finds (findings, machine-read attempts, leads, retraction flags, Crossref checks, standing moves, beats) lives here and
// is merged with the seed on every request, so the pages show the record as of the last beat. The schema is created by the Worker itself
// (CREATE ... IF NOT EXISTS), so a fresh database needs no migration step and no person.

import seed from "./data/findings.json" with { type: "json" };
import { standing } from "./standing.js";
import { doiKey } from "./ledger.js";
import { BEAT, checkFinding, discoverFindings } from "./discover.js";
import { lookup, check } from "./crossref.js";

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS findings (id TEXT PRIMARY KEY, body TEXT NOT NULL, found_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS attempts (doi TEXT NOT NULL, finding_id TEXT NOT NULL, body TEXT NOT NULL, found_at TEXT NOT NULL, PRIMARY KEY (finding_id, doi))`,
  `CREATE TABLE IF NOT EXISTS leads (doi TEXT NOT NULL, finding_id TEXT NOT NULL, body TEXT NOT NULL, found_at TEXT NOT NULL, PRIMARY KEY (finding_id, doi))`,
  `CREATE TABLE IF NOT EXISTS checks (finding_id TEXT PRIMARY KEY, checked_at TEXT NOT NULL, openalex TEXT, retracted INTEGER NOT NULL DEFAULT 0, cited_by INTEGER)`,
  `CREATE TABLE IF NOT EXISTS cites (doi TEXT PRIMARY KEY, ok INTEGER NOT NULL, issues TEXT NOT NULL, checked_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS standing_changes (at TEXT NOT NULL, finding_id TEXT NOT NULL, from_st TEXT, to_st TEXT NOT NULL, doi TEXT, outcome TEXT)`,
  `CREATE TABLE IF NOT EXISTS beats (n INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, ended_at TEXT, trigger TEXT, checked INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, leads INTEGER DEFAULT 0, findings INTEGER DEFAULT 0, cites INTEGER DEFAULT 0, errors TEXT DEFAULT '[]')`
];

const ready = new WeakMap();
export function ensure(db) {
  if (!ready.has(db)) ready.set(db, db.batch(SCHEMA.map(s => db.prepare(s))).catch(e => { ready.delete(db); throw e; }));
  return ready.get(db);
}
const all = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).all()).results || [];

// The ledger as served: seed plus everything discovered, with per-finding live facts. Without a database it is the seed alone.
export async function load(env) {
  const base = structuredClone(seed);
  const live = { beat: null, beats: [], checks: {}, changes: [], leads: 0, cites: {} };
  if (!env?.DB) return { ledger: base, live };
  await ensure(env.DB);
  const [fs, at, ck, ch, bt, ld, ct] = await Promise.all([
    all(env.DB, "SELECT body FROM findings ORDER BY found_at"),
    all(env.DB, "SELECT finding_id, body FROM attempts ORDER BY found_at"),
    all(env.DB, "SELECT * FROM checks"),
    all(env.DB, "SELECT * FROM standing_changes ORDER BY at DESC LIMIT 100"),
    all(env.DB, "SELECT * FROM beats WHERE ended_at IS NOT NULL ORDER BY n DESC LIMIT 24"),
    all(env.DB, "SELECT COUNT(*) AS n FROM leads"),
    all(env.DB, "SELECT * FROM cites")]);
  for (const r of fs) { const f = JSON.parse(r.body); if (!base.findings.some(x => x.id === f.id)) base.findings.push(f); }
  const byId = Object.fromEntries(base.findings.map(f => [f.id, f]));
  for (const r of at) {
    const f = byId[r.finding_id], a = JSON.parse(r.body);
    if (f && !(f.replications || []).some(x => doiKey(x.cite?.doi) === doiKey(a.cite?.doi))) (f.replications ||= []).push(a);
  }
  for (const c of ck) live.checks[c.finding_id] = c;
  for (const c of ct) live.cites[c.doi] = c;
  Object.assign(live, { beat: bt[0] || null, beats: bt, changes: ch, leads: ld[0]?.n || 0 });
  return { ledger: base, live };
}

export const minutesSince = iso => iso ? Math.round((Date.now() - Date.parse(iso)) / 6e4) : null;

// One beat. Idempotent: every write is keyed (finding, DOI), so a repeated beat files nothing twice.
export async function beat(env, { trigger = "cron", fetchImpl = fetch, now = new Date().toISOString() } = {}) {
  const db = env.DB;
  await ensure(db);
  const running = await all(db, "SELECT n FROM beats WHERE ended_at IS NULL AND started_at > ?", new Date(Date.now() - 15 * 6e4).toISOString());
  if (running.length) return { skipped: "a beat is already running" };
  const { meta } = await db.prepare("INSERT INTO beats (started_at, trigger) VALUES (?, ?)").bind(now, trigger).run();
  const n = meta.last_row_id, errors = [], tally = { checked: 0, attempts: 0, leads: 0, findings: 0, cites: 0 };
  const { ledger } = await load(env);
  const checks = Object.fromEntries((await all(db, "SELECT finding_id, checked_at FROM checks")).map(r => [r.finding_id, r.checked_at]));
  const order = [...ledger.findings].sort((a, b) => String(checks[a.id] || "").localeCompare(String(checks[b.id] || "")));
  let reads = BEAT.READS;
  for (const f of order.slice(0, BEAT.FINDINGS)) {
    try {
      const known = new Set([...(f.replications || []).map(r => doiKey(r.cite?.doi)),
        ...(await all(db, "SELECT doi FROM leads WHERE finding_id = ?", f.id)).map(r => r.doi)].filter(Boolean));
      const before = standing(f.replications);
      const r = await checkFinding(f, { fetchImpl, ai: env.AI, known, reads });
      reads -= r.attempts.length + r.leads.length;
      const w = [db.prepare("INSERT OR REPLACE INTO checks (finding_id, checked_at, openalex, retracted, cited_by) VALUES (?, ?, ?, ?, ?)").bind(f.id, now, r.openalex, r.retracted ? 1 : 0, r.cited_by)];
      let reps = [...(f.replications || [])];
      for (const a of r.attempts) {
        a.added = now.slice(0, 10);
        const prev = standing(reps); reps = [...reps, a]; const next = standing(reps);
        w.push(db.prepare("INSERT OR IGNORE INTO attempts (doi, finding_id, body, found_at) VALUES (?, ?, ?, ?)").bind(doiKey(a.cite.doi), f.id, JSON.stringify(a), now));
        if (prev.standing !== next.standing) w.push(db.prepare("INSERT INTO standing_changes (at, finding_id, from_st, to_st, doi, outcome) VALUES (?, ?, ?, ?, ?, ?)").bind(now, f.id, prev.standing, next.standing, a.cite.doi, a.outcome));
      }
      for (const l of r.leads) w.push(db.prepare("INSERT OR IGNORE INTO leads (doi, finding_id, body, found_at) VALUES (?, ?, ?, ?)").bind(doiKey(l.cite.doi), f.id, JSON.stringify(l), now));
      if (!checks[f.id] && before.standing && f.discovered) w.push(db.prepare("INSERT INTO standing_changes (at, finding_id, from_st, to_st) VALUES (?, ?, NULL, ?)").bind(now, f.id, standing(reps).standing));
      await db.batch(w);
      tally.checked++; tally.attempts += r.attempts.length; tally.leads += r.leads.length;
    } catch (e) { errors.push(`${f.id}: ${String(e.message || e).slice(0, 160)}`); }
  }
  try {
    const { found, search } = await discoverFindings(n, { fetchImpl, knownDois: new Set(ledger.findings.map(f => doiKey(f.original?.doi))), knownIds: new Set(ledger.findings.map(f => f.id)) });
    for (const f of found) await db.prepare("INSERT OR IGNORE INTO findings (id, body, found_at) VALUES (?, ?, ?)").bind(f.id, JSON.stringify(f), now).run();
    tally.findings = found.length; tally.search = search;
  } catch (e) { errors.push(`discover: ${String(e.message || e).slice(0, 160)}`); }
  const done = new Set((await all(db, "SELECT doi FROM cites")).map(r => r.doi));
  const todo = [...seed.findings.flatMap(f => [f.original, ...(f.replications || []).map(r => r.cite)]), ...(seed.projects || []).map(p => p.cite)]
    .filter(c => c?.doi && !done.has(doiKey(c.doi))).slice(0, BEAT.CROSSREF);
  for (const c of todo) {
    try {
      const m = await lookup(c.doi, fetchImpl);
      const issues = m ? check(c, m) : ["DOI not found at Crossref"];
      await db.prepare("INSERT OR REPLACE INTO cites (doi, ok, issues, checked_at) VALUES (?, ?, ?, ?)").bind(doiKey(c.doi), issues.length ? 0 : 1, JSON.stringify(issues), now).run();
      tally.cites++;
    } catch (e) { errors.push(`crossref ${c.doi}: ${String(e.message || e).slice(0, 120)}`); }
  }
  await db.prepare("UPDATE beats SET ended_at = ?, checked = ?, attempts = ?, leads = ?, findings = ?, cites = ?, errors = ? WHERE n = ?")
    .bind(new Date().toISOString(), tally.checked, tally.attempts, tally.leads, tally.findings, tally.cites, JSON.stringify(errors), n).run();
  return { n, ...tally, errors };
}

// Freshness: the oldest finding check, in days. A finding never checked counts from the first beat.
export function freshness(ledger, live) {
  const first = live.beats.at(-1)?.started_at;
  const ages = ledger.findings.map(f => live.checks[f.id]?.checked_at || first).filter(Boolean).map(t => (Date.now() - Date.parse(t)) / 864e5);
  const oldest = ages.length ? Math.max(...ages) : null;
  const beatAge = minutesSince(live.beat?.ended_at);
  return { ok: oldest != null && oldest <= BEAT.STALE_DAYS && beatAge != null && beatAge <= 6 * 60, oldest_check_days: oldest == null ? null : Math.round(oldest * 10) / 10,
    last_beat_minutes: beatAge, stale_after_days: BEAT.STALE_DAYS };
}
