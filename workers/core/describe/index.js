// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// core/describe: self-description and the claims registry (US-SPEC-22). Ports: db, fetch, now, readFile.
// The describe loop writes only to the database (class A, US-22-R09); publishing is a pack's job.

export const SECTIONS = [
  ['purpose', 'Purpose'], ['capabilities', 'Capabilities'], ['scope', 'Scope'], ['operation', 'Operation'],
  ['performance', 'Performance'], ['packs', 'Packs'], ['limits', 'Limits and PLANNED'], ['other', 'Other facts'],
];
const FORMS = ['statement', 'page', 'json', 'llms'];
const MARKER = /\[claim:([A-Za-z0-9._-]+)\]/g;

const iso = t => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
const ms = n => (n instanceof Date ? n.getTime() : n ?? Date.now());
const parseTs = s => Date.parse(String(s).replace(' ', 'T') + 'Z');
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const parseJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ---------- registry ----------

export async function addClaims(db, claims) {
  let added = 0;
  for (const c of claims) {
    const i = c.probe.indexOf(':');
    const r = await run(db, `INSERT OR IGNORE INTO describe_claims (id, text, probe_kind, probe_arg, expect, max_age_hours, public)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, c.id, c.text, c.probe.slice(0, i), c.probe.slice(i + 1), c.expect, c.max_age_hours ?? 24, c.public ?? 1);
    added += r.meta?.changes ?? 0;
  }
  return added;
}

// A claim may appear in public output only if it is public, not withdrawn, passed, and fresh (US-22-R02, T22-4).
export function isPublishable(c, now) {
  if (!c || !c.public || c.withdrawn || c.last_result !== 'pass' || !c.last_checked_at) return false;
  const age = ms(now) - parseTs(c.last_checked_at);
  return Number.isFinite(age) && age <= c.max_age_hours * 3600e3;
}

export async function publishableClaims(db, now) {
  return (await all(db, `SELECT * FROM describe_claims ORDER BY id`)).filter(c => isPublishable(c, now));
}

// Text of a claim with its probe values filled in. Numbers always carry their date (US-22-R06).
export function renderClaimText(c) {
  const ev = parseJson(c.evidence, {});
  const date = (c.last_checked_at || '').slice(0, 10);
  const hasNum = c.text.includes('{value}');
  let t = c.text.replaceAll('{value}', ev.value ?? '').replaceAll('{names}', ev.names ?? 'none').replaceAll('{date}', date);
  if (hasNum && !c.text.includes('{date}')) t = `${t.replace(/[.!?\s]+$/, '')} (as of ${date})`;
  return t;
}
export const claimSentence = c => `${renderClaimText(c).replace(/[.!?\s]+$/, '')} [claim:${c.id}].`;
export const extractClaimIds = text => [...new Set([...String(text).matchAll(MARKER)].map(m => m[1]))].sort();

// ---------- probes ----------

const SQL_FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|truncate|begin|commit|rollback)\b/i;

// Accepts one SELECT only. Anything else is rejected (probes are read-only, US-22-R01).
export function assertReadOnlySql(sql) {
  const s = String(sql).trim().replace(/;\s*$/, '');
  if (!/^select\b/i.test(s)) throw new Error('sql probe must be a single SELECT');
  if (s.includes(';')) throw new Error('sql probe must be a single statement');
  if (/--|\/\*/.test(s)) throw new Error('sql probe must not contain comments');
  if (SQL_FORBIDDEN.test(s)) throw new Error('sql probe contains a write or control keyword');
  return s;
}

const OPS = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '=': (a, b) => a === b, '!=': (a, b) => a !== b };

// An expect may end with `| unmeasured:quiet` (US-22-R10): when the probe has nothing to measure yet (no row, a NULL value, or a table this
// deployment does not have) the claim is withdrawn as unmeasured and no repair item is filed, because nothing is broken. Without it, no
// row or a missing table is a failure and files its repair item as before. Unmeasured is never published as zero.
export function splitExpect(expect) {
  const [cond, ...flags] = String(expect).split('|').map(x => x.trim());
  return { cond, quiet: flags.includes('unmeasured:quiet') };
}

// Returns true, false, or null (expect not understood: the result is unknown).
export function evaluate(expect, { value, text }) {
  const e = String(expect).trim();
  if (e === 'exists') return true;
  if (e === 'nonempty') return value !== null && value !== undefined && value !== '';
  if (e.startsWith('contains:')) return String(text ?? value ?? '').includes(e.slice(9));
  if (e.startsWith('status:')) return Number(value) === Number(e.slice(7));
  const m = e.match(/^(>=|<=|!=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return value === null || value === undefined || value === '' || Number.isNaN(Number(value)) ? false : OPS[m[1]](Number(value), Number(m[2]));
  return null;
}

async function measure(c, { db, fetch, now, readFile, specStatus }) {
  switch (c.probe_kind) {
    case 'sql': {
      const sql = assertReadOnlySql(c.probe_arg.replaceAll('{now}', `'${iso(ms(now))}'`));
      const row = (await all(db, sql))[0];
      if (!row) return { value: null, text: '' };
      const cols = Object.keys(row);
      return { value: row[cols[0]], names: row.names ?? undefined, text: String(row[cols[0]]) };
    }
    case 'file': {
      if (!readFile) throw new Error('no readFile port');
      let text;
      try { text = await readFile(c.probe_arg); } catch (e) { return { missing: `unreadable: ${e.message}` }; }
      return { value: text, text: String(text) };
    }
    case 'http': {
      if (!fetch) throw new Error('no fetch port');
      const res = await fetch(c.probe_arg, { method: 'GET', signal: AbortSignal.timeout(10000) });
      const text = (await res.text()).slice(0, 20000);
      return { value: res.status, text };
    }
    case 'spec': {
      if (!specStatus) throw new Error('no spec status snapshot');
      const [a, b] = c.probe_arg.includes('.') ? c.probe_arg.split('.') : [null, c.probe_arg];
      const src = a ? specStatus.by_spec?.[a] : specStatus;
      if (!src || typeof src[b] !== 'number') throw new Error(`spec status has no ${c.probe_arg}`);
      const names = b === 'PLANNED' ? (src.planned_names || specStatus.planned_names || []).slice(0, 12).join(', ') || 'none' : undefined;
      return { value: src[b], names, text: String(src[b]) };
    }
    default: throw new Error(`unknown probe kind ${c.probe_kind}`);
  }
}

export async function probeClaim(c, ports) {
  const { cond, quiet } = splitExpect(c.expect);
  try {
    const m = await measure(c, ports);
    if (m.missing) return { result: 'fail', evidence: { detail: m.missing } };
    if (quiet && c.probe_kind === 'sql' && (m.value === null || m.value === undefined || m.value === '')) {
      return { result: 'unknown', evidence: { detail: 'unmeasured: the probe returned no value', unmeasured: true } };
    }
    const ok = evaluate(cond, m);
    const ev = { value: typeof m.value === 'string' ? undefined : m.value, names: m.names };
    if (ok === null) return { result: 'unknown', evidence: { ...ev, detail: `expect not understood: ${c.expect}` } };
    return { result: ok ? 'pass' : 'fail', evidence: { ...ev, detail: ok ? 'expectation held' : `expected ${cond}, got ${String(m.value).slice(0, 80)}` } };
  } catch (e) {
    const detail = String(e.message).slice(0, 200);
    if (quiet && /no such table/i.test(detail)) return { result: 'unknown', evidence: { detail: 'unmeasured: ' + detail, unmeasured: true } };
    return { result: 'unknown', evidence: { detail } };
  }
}

async function fileRepair(db, c, reason, nowMs, ownerRole) {
  const id = `DESCRIBE-${c.id}`;
  const existing = await first(db, `SELECT status FROM items WHERE id = ?`, id);
  if (!existing) {
    await run(db, `INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, surface, action_class)
      VALUES (?, ?, 'fix', ?, ?, ?, 20, 'ready', 'describe', 'A')`,
      id, `Claim ${c.id} withdrawn from public output: ${reason}`.slice(0, 300), ownerRole,
      `the probe for claim ${c.id} passes again and the claim is public`, `describe:${c.id}`);
    return id;
  }
  if (['done', 'superseded', 'cancelled'].includes(existing.status)) {
    await run(db, `UPDATE items SET status='ready', disposition=NULL, updated_at=? WHERE id=?`, iso(nowMs), id);
    return id;
  }
  return null;
}

async function withdraw(db, c, reason, nowMs, ownerRole, quiet = false) {
  await run(db, `UPDATE describe_claims SET withdrawn=1, withdrawn_at=COALESCE(withdrawn_at, ?) WHERE id=?`, iso(nowMs), c.id);
  return quiet ? null : fileRepair(db, c, reason, nowMs, ownerRole);
}

// Re-check every public claim. Fail or unknown withdraws it and files a repair item; a later pass reinstates it.
export async function runProbes({ db, fetch, now, readFile, specStatus, ownerRole = 'operations' }) {
  const nowMs = ms(now);
  const out = { checked: 0, pass: 0, fail: 0, unknown: 0, withdrawn: [], filed: [] };
  for (const c of await all(db, `SELECT * FROM describe_claims WHERE public = 1 ORDER BY id`)) {
    const r = await probeClaim(c, { db, fetch, now: nowMs, readFile, specStatus });
    out.checked++; out[r.result]++;
    await run(db, `UPDATE describe_claims SET last_result=?, last_checked_at=?, evidence=? WHERE id=?`, r.result, iso(nowMs), JSON.stringify(r.evidence), c.id);
    if (r.result === 'pass') {
      await run(db, `UPDATE describe_claims SET withdrawn=0, withdrawn_at=NULL WHERE id=?`, c.id);
      // The repair item's closing probe is this same probe (US-22-R17): it closes only when the probe passes again.
      await run(db, `UPDATE items SET status='done', disposition='the probe passes again and the claim is public', updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, iso(nowMs), `DESCRIBE-${c.id}`);
    } else {
      out.withdrawn.push(c.id);
      const f = await withdraw(db, c, `probe ${r.result}: ${r.evidence.detail}`, nowMs, ownerRole, Boolean(r.evidence.unmeasured));
      if (f) out.filed.push(f);
    }
  }
  return out;
}

// Claims whose last check is older than their freshness limit are withdrawn (US-22-R02, T22-4).
export async function withdrawStale({ db, now, ownerRole = 'operations' }) {
  const nowMs = ms(now), done = [];
  for (const c of await all(db, `SELECT * FROM describe_claims WHERE public = 1 AND withdrawn = 0`)) {
    if (isPublishable(c, nowMs)) continue;
    await withdraw(db, c, c.last_result === 'pass' ? 'stale beyond its freshness limit' : `last result ${c.last_result ?? 'none'}`, nowMs, ownerRole, Boolean(parseJson(c.evidence, {}).unmeasured));
    done.push(c.id);
  }
  return done;
}

// ---------- self-model ----------

const sectionOf = id => { const p = id.split('.')[0]; return SECTIONS.some(([k]) => k === p) ? p : 'other'; };

// Out-of-scope rows of a SCOPE.md table, for the scope argument of buildSelfModel.
// Accepts the table form under "What it does not do" and the bullet form under "Out of scope by default" (the SCOPE.md of this repository).
export function parseScopeMd(md) {
  const out = []; let on = false;
  for (const line of String(md).split('\n')) {
    if (/^##\s+(What it does not do|Out of scope)/i.test(line)) { on = true; continue; }
    if (on && /^##\s/.test(line)) break;
    const m = on && line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (m && !/^(-+|Out of scope)$/i.test(m[1])) { out.push({ item: m[1], why: m[2] }); continue; }
    const b = on && line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (b) out.push({ item: b[1], why: '' });
  }
  return out;
}

// ---------- voice rules that need no host (US-22-R07, R08) ----------

// The same data as voice-rules.json (a test keeps them equal), so a default composition applies the voice rules with nothing injected.
export const DEFAULT_VOICE_RULES = {
  version: '1.0.0',
  banned: ['world-class', 'revolutionary', 'cutting-edge', 'best-in-class', 'game-changing', 'seamless', 'effortless', 'guaranteed', 'state-of-the-art', 'unlock the power'],
  out_of_scope: [
    { pack: 'outreach', terms: ['marketing', 'outreach', 'sales campaign', 'social account', 'social media'] },
    { pack: 'drafts', terms: ['business plan', 'patent', 'trademark', 'pitch deck', 'funding application'] },
    { pack: 'advice', terms: ['legal advice', 'tax advice', 'investment advice', 'medical advice'] },
    { pack: 'money', terms: ['hires people', 'pays contractors', 'moves money', 'transfers funds'] },
    { pack: 'research', terms: ['writes papers', 'research papers'] },
  ],
  negation: ['not', 'never', 'no', 'without', 'out of scope', 'off by default', 'planned'],
};

const LEAD = /^(writing|write|running|run|building|build|doing|do|giving|give|filing|file|making|make|hire|pay|move|any|anything that|anything|all|other)\s+(?:(?:an?|the|other)\s+)?/i;
// Terms a SCOPE.md out-of-scope row forbids: its noun phrases of two or more words, lowercased, with a singular form so "business plans" also
// catches "business plan". A single word is left to the data rules (voice-rules.json), because one generic word would reject ordinary
// sentences; a row that is a clause rather than a noun phrase ("anything that needs ...") derives nothing.
export function scopeTerms(item) {
  const terms = new Set();
  const text = String(item || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[.;:]+$/, '').trim();
  if (/^anything that\b/.test(text)) return [];
  for (const raw of text.split(/,|\bor\b|\band\b/)) {
    const t = raw.trim().replace(LEAD, '').replace(/\s+for\s+.*$/, '').replace(/\s+/g, ' ').trim();
    if (t.length < 6 || !t.includes(' ')) continue;
    terms.add(t);
    if (/s$/.test(t) && !/ss$/.test(t)) terms.add(t.slice(0, -1));
  }
  return [...terms];
}

// Out-of-scope groups derived from SCOPE.md rows. A row that names its pack ("outreach pack") or shares a term with a default group
// takes that pack, so enabling the pack lifts the rule; any other row never lifts (pack 'scope').
export function deriveScopeRules(outOfScope = [], base = DEFAULT_VOICE_RULES) {
  const groups = [];
  for (const row of outOfScope || []) {
    const item = typeof row === 'string' ? row : row?.item, why = typeof row === 'string' ? '' : row?.why || '';
    const terms = scopeTerms(item);
    if (!terms.length) continue;
    const named = /\b([a-z][a-z-]*)\s+pack\b/i.exec(`${item} ${why}`)?.[1]?.toLowerCase();
    const shared = (base.out_of_scope || []).find(g => (g.terms || []).some(bt => terms.some(t => t === bt || t.includes(bt) || bt.includes(t))));
    groups.push({ pack: named || shared?.pack || 'scope', terms });
  }
  return groups;
}

// The rules a generation or a check applies: the injected data, or the defaults when none was injected, plus the SCOPE.md terms.
export function effectiveVoiceRules(voiceRules, scope = {}) {
  const given = voiceRules && Object.keys(voiceRules).length ? voiceRules : DEFAULT_VOICE_RULES;
  return { ...given, out_of_scope: [...(given.out_of_scope || []), ...deriveScopeRules(scope?.out_of_scope, given)] };
}

// One call for any pack that communicates (US-22-R05): free text passes only if every sentence carries a registry claim id that is publishable
// now, states no number outside its claim, and meets the voice rules (injected, or the defaults, plus SCOPE.md terms).
export async function checkAgainstRegistry({ db, text, now = Date.now(), voiceRules = {}, scope = {}, enabledPacks = [] }) {
  const claims = await publishableClaims(db, now);
  const r = checkVoice(text, claims, effectiveVoiceRules(voiceRules, scope), { enabledPacks });
  return { ok: r.ok, violations: r.violations, version: r.version, claim_ids: extractClaimIds(text) };
}

// specStatus: { BUILT, RUNNING_ONLY, PLANNED, 'NOT COVERED', total, planned_names }. packs: [{id, enabled, charter, guard_metrics}].
// scope: { purpose?, in_scope?: [], out_of_scope?: [] }. Built only from records and the injected snapshots.
export async function buildSelfModel({ db, specStatus = null, packs = [], scope = {}, now = Date.now() }) {
  const claims = await publishableClaims(db, now);
  const n = async (sql) => (await first(db, sql))?.n ?? 0;
  const purposeRow = await first(db, `SELECT value FROM org WHERE key = 'purpose'`);
  const lastTick = await first(db, `SELECT finished_at FROM tick_runs WHERE finished_at IS NOT NULL AND steps_completed = steps_total ORDER BY id DESC LIMIT 1`);
  // Figures whose table or denominator may not exist yet: null with the reason, never 0 (US-22-R10, NO-FABRICATION-1).
  const not_measured = {};
  const tryFirst = async (key, sql, ...a) => { try { return await first(db, sql, ...a); } catch (e) { not_measured[key] = `unmeasured: ${String(e.message).slice(0, 100)}`; return null; } };
  const merged = await n(`SELECT COUNT(*) AS n FROM outcomes WHERE action_class = 'merge' AND result = 'verified'`);
  const rejected = await n(`SELECT COUNT(*) AS n FROM outcomes WHERE action_class = 'merge' AND result IN ('failed', 'hidden_failure')`);
  let costPerMerged = null;
  if (!merged) not_measured.cost_per_merged_change = 'unmeasured: no merged change yet';
  else {
    const spend = await tryFirst('cost_per_merged_change', `SELECT SUM(cost_usd) AS usd FROM router_calls`);
    if (spend && spend.usd !== null && spend.usd !== undefined) costPerMerged = Math.round((Number(spend.usd) / merged) * 1e4) / 1e4;
  }
  const up = await first(db, `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN steps_completed = steps_total THEN 1 ELSE 0 END), 0) AS ok FROM tick_runs WHERE started_at >= ?`, iso(ms(now) - 7 * 86400e3));
  const uptime7d = up.total ? Math.round((up.ok / up.total) * 1000) / 10 : null;
  if (uptime7d === null) not_measured.uptime_7d = 'unmeasured: no tick in the last 7 days';
  const unknownsRow = await tryFirst('open_unknowns', `SELECT COUNT(*) AS n FROM elicit_needs WHERE state IN ('open', 'asked', 'gated')`);
  const facts = {
    purpose: scope.purpose || purposeRow?.value || null,
    capabilities: { built: specStatus?.BUILT ?? null, running_only: specStatus?.RUNNING_ONLY ?? null, planned: specStatus?.PLANNED ?? null, total: specStatus?.total ?? null },
    scope: { in_scope: scope.in_scope || [], out_of_scope: scope.out_of_scope || [] },
    operation: { ticks_completed: await n(`SELECT COUNT(*) AS n FROM tick_runs WHERE steps_completed = steps_total`), last_complete_tick_at: lastTick?.finished_at || null, uptime_7d_percent: uptime7d },
    performance: {
      predictions_scored: await n(`SELECT COUNT(*) AS n FROM predictions WHERE verdict IS NOT NULL`),
      predictions_hit: await n(`SELECT COUNT(*) AS n FROM predictions WHERE verdict = 'hit'`),
      items_done: await n(`SELECT COUNT(*) AS n FROM items WHERE status = 'done'`),
      verified_outcomes: await n(`SELECT COUNT(*) AS n FROM outcomes WHERE result = 'verified'`),
      changes_merged: merged, changes_rejected: rejected, cost_per_merged_change_usd: costPerMerged,
      autonomy_rungs: await all(db, `SELECT surface, action_class, rung FROM trust_ledger ORDER BY surface, action_class`),
    },
    packs: packs.map(p => ({ id: p.id, enabled: !!p.enabled, charter: p.charter || null, guard_metrics: p.guard_metrics || [] })),
    limits: {
      planned_names: specStatus?.planned_names || [],
      blocked_items: (await all(db, `SELECT id FROM items WHERE status = 'blocked' ORDER BY id`)).map(r => r.id),
      open_gate_cards: await n(`SELECT COUNT(*) AS n FROM gate_cards WHERE status = 'open'`),
      open_unknowns: unknownsRow ? Number(unknownsRow.n) : null,
    },
    not_measured,
  };
  const sections = SECTIONS.map(([key, title]) => ({ key, title, claim_ids: claims.filter(c => sectionOf(c.id) === key).map(c => c.id) }));
  const warnings = sections.filter(s => s.key !== 'other' && !s.claim_ids.length).map(s => `section ${s.key} has no published claim`);
  return { generated_at: iso(ms(now)), sections, claim_ids: claims.map(c => c.id), facts, warnings };
}

// ---------- three forms from one model ----------

// Default compose: deterministic. A model may replace it, but the voice checker still gates every sentence (US-22-R05).
export const defaultCompose = ({ form, claims }) =>
  form === 'statement' ? claims.map(c => c.sentence).join(' ') : claims.map(c => `- ${c.sentence}`).join('\n');

export async function render(model, claims, { compose = defaultCompose, title = 'About this organization' } = {}) {
  const byId = new Map(claims.map(c => [c.id, c]));
  const view = id => { const c = byId.get(id); return { id, text: renderClaimText(c), sentence: claimSentence(c), claim: c }; };
  const secs = model.sections.map(s => ({ ...s, items: s.claim_ids.filter(id => byId.has(id)).map(view) })).filter(s => s.items.length || s.key !== 'other');
  const lead = ['capabilities', 'limits'];
  const statementItems = secs.filter(s => lead.includes(s.key)).concat(secs.filter(s => !lead.includes(s.key))).flatMap(s => s.items);
  const ids = statementItems.map(i => i.id).sort();
  const statement = (await compose({ form: 'statement', section: 'all', claims: statementItems })).trim();
  const body = async form => {
    const parts = [];
    for (const s of secs) {
      const text = s.items.length ? (await compose({ form, section: s.key, claims: s.items })).trim() : '_No published claim for this section._';
      parts.push(`## ${s.title}\n\n${text}`);
    }
    return parts;
  };
  const quote = model.facts?.purpose ? [`> ${String(model.facts.purpose).replace(/\n+/g, ' ')}`] : [];
  const page = [`# ${title}`, `_Generated ${model.generated_at} from records. Every sentence carries a claim id._`, ...quote, ...(await body('page'))].join('\n\n') + '\n';
  const llms = [`# ${title}`, ...(await body('llms'))].join('\n\n') + '\n';
  const json = JSON.stringify({
    title, generated_at: model.generated_at, claim_ids: ids,
    sections: secs.map(s => ({ key: s.key, title: s.title, claims: s.items.map(i => ({ id: i.id, text: i.text, as_of: (i.claim.last_checked_at || '').slice(0, 10), evidence: parseJson(i.claim.evidence, {}) })) })),
  }, null, 2);
  return { statement: statement + '\n', page, json, llms, claim_ids: ids };
}

// ---------- voice checker (run by a different agent from the writer, US-22-R07) ----------

const stripMarkers = s => s.replace(MARKER, '');
const DATE = /\b\d{4}-\d{2}-\d{2}\b/;

function* sentences(text) {
  for (const raw of String(text).split('\n')) {
    const line = raw.trim().replace(/^([-*]|\d+\.)\s+/, '');
    if (!line || /^(#|>|\|)/.test(line) || /^_.*_$/.test(line)) continue;
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z[])/)) if (s.trim()) yield s.trim();
  }
}

// Pure function of (text, claims, rules): it never sees or calls the writer. claims = the registry claims allowed in output.
export function checkVoice(text, claims, voiceRules = {}, { enabledPacks = [] } = {}) {
  const byId = new Map((claims || []).map(c => [c.id, c]));
  const negation = new RegExp(`\\b(${(voiceRules.negation || ['not', 'never', 'no']).join('|')})\\b`, 'i');
  const violations = [];
  const bad = (sentence, rule, detail) => violations.push({ sentence, rule, detail });
  for (const s of sentences(text)) {
    const ids = [...s.matchAll(MARKER)].map(m => m[1]);
    if (!ids.length) { bad(s, 'no_claim', 'sentence carries no claim id'); continue; }
    const unknown = ids.filter(id => !byId.has(id));
    if (unknown.length) { bad(s, 'unknown_claim', `not in the registry: ${unknown.join(', ')}`); continue; }
    const body = stripMarkers(s);
    const allowedNums = new Set(ids.map(id => renderClaimText(byId.get(id))).join(' ').match(/\d+(?:\.\d+)?/g) || []);
    const nums = body.match(/\d+(?:\.\d+)?/g) || [];
    if (nums.length && !DATE.test(body) && !/\bestimate/i.test(body)) bad(s, 'number_without_date', 'numbers must carry a date or be labeled as an estimate');
    for (const num of nums) if (!allowedNums.has(num)) { bad(s, 'number_not_in_claim', `number ${num} is not in the cited claim`); break; }
    for (const b of voiceRules.banned || []) if (body.toLowerCase().includes(b.toLowerCase())) bad(s, 'banned_phrase', b);
    for (const g of voiceRules.out_of_scope || []) {
      if (enabledPacks.includes(g.pack) || negation.test(body)) continue;
      const hit = (g.terms || []).find(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(body));
      if (hit) bad(s, 'out_of_scope', `${hit} is out of scope unless the ${g.pack} pack is enabled`);
    }
  }
  return { ok: violations.length === 0, version: voiceRules.version || null, violations };
}

// ---------- the loop ----------

async function generate({ db, now, specStatus, packs, scope, compose, voiceRules, checker = checkVoice, title }) {
  const model = await buildSelfModel({ db, specStatus, packs, scope, now });
  const claims = await publishableClaims(db, now);
  const out = await render(model, claims, { compose, title });
  const enabledPacks = packs.filter(p => p.enabled).map(p => p.id);
  const rules = effectiveVoiceRules(voiceRules, scope);
  const problems = [];
  for (const f of ['statement', 'page', 'llms']) {
    const r = checker(out[f], claims, rules, { enabledPacks });
    if (!r.ok) problems.push({ form: f, violations: r.violations });
  }
  return { model, out, problems };
}

// One pass of the loop: probe, withdraw, build, render, check, and only then store (class A: db writes only).
export async function describeOnce({ db, fetch, now, readFile, specStatus, packs = [], scope = {}, compose, voiceRules = {}, checker, ownerRole = 'operations', title }) {
  const nowMs = ms(now);
  const probes = await runProbes({ db, fetch, now: nowMs, readFile, specStatus, ownerRole });
  const stale = await withdrawStale({ db, now: nowMs, ownerRole });
  const g = await generate({ db, now: nowMs, specStatus, packs, scope, compose, voiceRules, checker, title });
  if (g.problems.length) {
    const id = `DESCRIBE-voice-${iso(nowMs).slice(0, 10)}`;
    if (!(await first(db, `SELECT id FROM items WHERE id = ?`, id))) {
      await run(db, `INSERT INTO items (id, title, kind, owner_role, done_check, priority, status, surface, action_class)
        VALUES (?, ?, 'fix', ?, 'the voice checker accepts the next generated description', 20, 'ready', 'describe', 'A')`,
        id, `Voice check rejected generated output: ${g.problems.map(p => `${p.form}:${p.violations[0].rule}`).join(', ')}`.slice(0, 300), ownerRole);
    }
    return { probes, stale, stored: false, problems: g.problems };
  }
  const at = iso(nowMs);
  for (const f of FORMS) await run(db, `INSERT INTO describe_outputs (form, claim_ids, body, generated_at) VALUES (?, ?, ?, ?)`, f, JSON.stringify(g.out.claim_ids), g.out[f], at);
  return { probes, stale, stored: true, problems: [], claim_ids: g.out.claim_ids };
}

// Plug into runTick: runTick(db, { config, extraSteps: [...describeExtraSteps(opts)] }). Writes only to the db.
// opts: { fetch, readFile, getSpecStatus: async () => snapshot (or specStatus), packs, scope, compose, voiceRules, checker, ownerRole, title }
export function describeExtraSteps(opts = {}) {
  return [{
    name: 'describe',
    async run(db, ctx) {
      const specStatus = opts.getSpecStatus ? await opts.getSpecStatus() : opts.specStatus || null;
      const r = await describeOnce({ ...opts, db, now: ctx.now, specStatus });
      ctx.notes.push(`describe: ${r.probes.pass}/${r.probes.checked} claims pass, ${r.probes.withdrawn.length} withdrawn, output ${r.stored ? 'stored' : 'rejected by voice check'}`);
    },
  }];
}

// ---------- HTTP ----------

const TYPES = { page: 'text/markdown; charset=utf-8', json: 'application/json; charset=utf-8', llms: 'text/plain; charset=utf-8', statement: 'text/plain; charset=utf-8' };
const ROUTES = { '/describe': 'page', '/describe.json': 'json', '/llms.txt': 'llms', '/describe/statement': 'statement' };
export const FEED_ROUTES = ['/describe/claims.json', '/describe/claims', '/describe/claims/probe'];
export const DESCRIBE_ROUTES = [...Object.keys(ROUTES), ...FEED_ROUTES];

// The claims feed (US-22-R11): every claim that may be published now, with its probe, expectation, last result, check time, freshness and
// evidence, so a reader can re-run the check. Non-public claims are absent; a withdrawn public claim appears only as an id and its last result
// (never its text), so the withdrawal is visible without publishing a sentence that is no longer true. Its claim ids are those of /describe.json.
export async function claimsFeed(db, now = Date.now()) {
  const nowMs = ms(now), rows = await all(db, `SELECT * FROM describe_claims WHERE public = 1 ORDER BY id`);
  const claims = [], withdrawn = [];
  for (const c of rows) {
    if (isPublishable(c, nowMs)) {
      const checked = parseTs(c.last_checked_at);
      claims.push({
        id: c.id, text: renderClaimText(c), probe: `${c.probe_kind}:${c.probe_arg}`, expect: c.expect, last_result: c.last_result,
        last_checked_at: c.last_checked_at, max_age_hours: c.max_age_hours, age_hours: Math.round(((nowMs - checked) / 3600e3) * 100) / 100,
        evidence: parseJson(c.evidence, {}), publishable: true,
      });
    } else withdrawn.push({ id: c.id, last_result: c.last_result ?? null, last_checked_at: c.last_checked_at ?? null, withdrawn: Boolean(c.withdrawn) });
  }
  return { generated_at: iso(nowMs), claim_ids: claims.map(c => c.id), claims, withdrawn };
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// The feed as a page: escaped, no script, light and dark. The page offers the re-probe as a plain form (POST /describe/claims/probe).
export function renderClaimsPage(feed, { reprobe = true } = {}) {
  const rows = feed.claims.map(c => `<tr><th scope="row">${esc(c.id)}</th><td>${esc(c.text)}</td><td><code>${esc(c.probe)}</code><br>expects <code>${esc(c.expect)}</code></td><td>${esc(c.last_result)} at ${esc(c.last_checked_at)} (${esc(c.age_hours)} h old, limit ${esc(c.max_age_hours)} h)<br>${esc(c.evidence?.detail || '')}</td></tr>`).join('\n');
  const gone = feed.withdrawn.map(w => `<li><code>${esc(w.id)}</code>: last result ${esc(w.last_result ?? 'none')}${w.withdrawn ? ', withdrawn' : ', stale or unchecked'}</li>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Claims and how to check them</title>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#14171a;--line:#c8ced4}@media (prefers-color-scheme:dark){:root{--bg:#101316;--fg:#e8ecef;--line:#39424a}}body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0 auto;padding:16px;max-width:60rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--line);padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}button{min-height:44px;padding:0 16px;font:inherit}</style>
<h1>Claims and how to check them</h1><p>Generated ${esc(feed.generated_at)}. Each claim below passed its probe within its freshness limit. A claim that did not is not shown as true.</p>
<table><thead><tr><th>Claim</th><th>Statement</th><th>Probe</th><th>Last result</th></tr></thead><tbody>
${rows || '<tr><td colspan="4">No claim is publishable right now.</td></tr>'}
</tbody></table>
<h2>Withdrawn or stale</h2><ul>${gone || '<li>None.</li>'}</ul>
${reprobe ? '<form method="post" action="/describe/claims/probe"><button type="submit">Check every claim again now</button></form>' : ''}
</html>
`;
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': TYPES.json, 'cache-control': 'no-store', ...headers } });

// handle(request, { db, now, specStatus, packs, scope, compose, voiceRules, probe, min_probe_interval_seconds }).
// Serves the latest stored output only while every claim in it is still publishable; otherwise it re-renders from the live registry
// (nothing is written), so a withdrawn or stale claim never stays on the page (US-22-R02). /describe/claims.json and /describe/claims
// are read from the registry on every request. POST /describe/claims/probe re-runs every public probe (US-22-R12) through the ports the
// host supplies in ctx.probe ({ fetch, readFile, specStatus }), at most once per min_probe_interval_seconds (default 300): 429 inside the
// interval, 503 when the host supplied no ports.
export async function handle(request, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const nowMs = ms(ctx.now);
  if (path === '/describe/claims/probe') {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
    if (!ctx.probe) return json({ error: 'probe_unavailable', detail: 'this host supplied no probe ports' }, 503);
    const last = await first(ctx.db, `SELECT MAX(last_checked_at) AS t FROM describe_claims WHERE public = 1`);
    const minGap = (ctx.min_probe_interval_seconds ?? 300) * 1000, since = last?.t ? nowMs - parseTs(last.t) : Infinity;
    if (since < minGap) {
      const retry = Math.ceil((minGap - since) / 1000);
      return json({ error: 'too_soon', retry_after_seconds: retry }, 429, { 'retry-after': String(retry) });
    }
    const probes = await runProbes({ db: ctx.db, now: nowMs, ownerRole: ctx.ownerRole || 'operations', ...ctx.probe });
    return json({ probes: { checked: probes.checked, pass: probes.pass, fail: probes.fail, unknown: probes.unknown, withdrawn: probes.withdrawn }, feed: await claimsFeed(ctx.db, nowMs) });
  }
  if (path === '/describe/claims.json' || path === '/describe/claims') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    const feed = await claimsFeed(ctx.db, nowMs);
    const body = path.endsWith('.json') ? JSON.stringify(feed, null, 2) : renderClaimsPage(feed, { reprobe: Boolean(ctx.probe) });
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: { 'content-type': path.endsWith('.json') ? TYPES.json : 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const form = ROUTES[path];
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
  if (!form) return new Response('not found', { status: 404 });
  const row = await first(ctx.db, `SELECT body, claim_ids FROM describe_outputs WHERE form = ? ORDER BY id DESC LIMIT 1`, form);
  const ok = new Set((await publishableClaims(ctx.db, nowMs)).map(c => c.id));
  let body = null;
  if (row && parseJson(row.claim_ids, []).every(id => ok.has(id))) body = row.body;
  else if (row) {
    const g = await generate({ db: ctx.db, now: nowMs, specStatus: ctx.specStatus || null, packs: ctx.packs || [], scope: ctx.scope || {}, compose: ctx.compose, voiceRules: ctx.voiceRules || {}, checker: ctx.checker });
    if (!g.problems.length && g.out.claim_ids.length) body = g.out[form];
  }
  if (body === null) return new Response('no published description yet', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: { 'content-type': TYPES[form], 'cache-control': 'public, max-age=300' } });
}
