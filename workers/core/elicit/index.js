// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Elicitation (US-SPEC-16, issue #60): the front door for a person who does not know what they do not know.
// A needs register, Ask cards answerable by recognition, stated defaults with an assumption log, a read-back with provenance,
// a computed readiness score, and a four-sweep ignorance audit. Ports only: db, now. No agent interprets an answer: an
// answer maps to a register write deterministically (US-16-R07).
import { draftArtifact, draftAssumptionLog, lintDraft } from './draft.js';
export const EXTRA_OPTIONS = ['Not sure', 'Tell me more'];
export const DEFAULT_JARGON = ['schema', 'architecture', 'stack', 'api', 'endpoint', 'database', 'repository', 'deploy', 'oauth', 'webhook', 'backend', 'frontend', 'latency'];
const PROFESSIONAL = /legal|law|tax|medical|health|financ|safety|privacy notice|licen[cs]e/i;
const SWEEPS = ['catalog', 'analogy', 'redteam', 'surprise'];
/** US-16 5.3: a need whose value of information is below this is defaulted without asking, when it is reversible. A chosen default, not a measured one. */
export const DEFAULT_DEFER_BELOW = 0.15;
/** US-16-R16: the default quiet period, in the person's local time, applied once a time zone is known. */
export const DEFAULT_QUIET = { from: 22, to: 7 };
/** A valid IANA time zone name, or false. */
export const validTimezone = tz => { try { new Intl.DateTimeFormat('en', { timeZone: String(tz) }); return typeof tz === 'string' && tz.length > 0; } catch { return false; } };
const SATISFIED = ['answered', 'defaulted', 'derived'];
const words = s => String(s || '').trim().split(/\s+/).filter(Boolean);
const iso = ms => new Date(ms).toISOString();
/** The kernel's time format (core/src/tick.js compares the predictions table's due_at with it as text), so a default prediction falls due on its own hour. */
const kernelTime = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

/** US-16-R19: the metric a default-holds prediction names in the kernel's predictions table. The organization passes `elicitMetrics` to the tick (the
 *  `metrics` option of runTick), so the kernel scorer reads the need instead of grading an unknown metric as a miss. */
export const DEFAULT_HOLDS_METRIC = 'elicit_default_holds';
/** Read a default-holds prediction row (section 5.3): 1 when its need still stands on the default value (or the person later chose that value), 0 when it ended
 *  on another value. NaN when the need is gone, has no default, or is not settled: that is unmeasured, and the kernel records the miss with that reason. */
export async function defaultHolds(db, _nowMs, row) {
  const n = await db.prepare(`SELECT state, value, default_value FROM elicit_needs WHERE 'ELICIT-' || project || '-' || id = ?`).bind(String(row?.id ?? '')).first();
  if (!n || n.default_value == null || !SATISFIED.includes(n.state)) return NaN;
  return String(n.value) === String(n.default_value) ? 1 : 0;
}
/** The domain metrics of this module for the kernel scorer: { name: async (db, nowMs, predictionRow) => number }. */
export const elicitMetrics = Object.freeze({ [DEFAULT_HOLDS_METRIC]: defaultHolds });
/** A model family as a comparable name: trimmed and lower-cased; '' when none is given. */
const familyOf = f => String(f ?? '').trim().toLowerCase();
const priorityOf = n => Number(n.p_wrong) * Number(n.rework) * Number(n.dependents);

/** Problems with an Ask card, or [] (US-16-R02, R03, section 5.1, T16-2). `defines` lists jargon terms the card explains itself. */
export function validateCard(card, { jargon = DEFAULT_JARGON } = {}) {
  const p = [];
  for (const f of ['need_id', 'question', 'why', 'cue', 'default', 'default_consequence', 'reversibility', 'priority']) {
    if (card[f] === undefined || card[f] === null || card[f] === '') p.push(`missing ${f}`);
  }
  if (words(card.question).length > 25) p.push('question is longer than 25 words');
  if (!['reversible', 'not reversible'].includes(card.reversibility)) p.push('reversibility must be reversible or not reversible');
  const opts = Array.isArray(card.options) ? card.options : [];
  const real = opts.filter(o => !EXTRA_OPTIONS.includes(o));
  if (!card.free_text && (real.length < 2 || real.length > 4)) p.push('options must be two to four');
  if (!EXTRA_OPTIONS.every(o => opts.includes(o))) p.push('options must include Not sure and Tell me more');
  const text = [card.question, card.why, card.cue, ...real].join(' ').toLowerCase();
  const defined = (card.defines || []).map(x => String(x).toLowerCase());
  for (const j of jargon) if (new RegExp(`\\b${j}\\b`).test(text) && !defined.includes(j)) p.push(`jargon without definition: ${j}`);
  return p;
}

/** Put a card into the person's words (US-16-R03). entries: [{ term, plain, person_term }]. A system term the person has their own
 *  word for is replaced by that word; a system term with only a plain explanation stays and is defined in the same card. */
export function applyGlossary(card, entries = []) {
  const out = { ...card, options: [...(card.options || [])], defines: [...(card.defines || [])], definitions: { ...(card.definitions || {}) } };
  const swap = (text, re, to) => (typeof text === 'string' ? text.replace(re, to) : text);
  for (const e of entries) {
    const re = new RegExp(`\\b${String(e.term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const shown = [out.question, out.why, out.cue, out.default_consequence, ...out.options].some(t => typeof t === 'string' && new RegExp(re.source, 'i').test(t));
    if (!shown) continue;
    if (e.person_term) {
      for (const f of ['question', 'why', 'cue', 'default_consequence']) out[f] = swap(out[f], re, e.person_term);
      out.options = out.options.map(o => (EXTRA_OPTIONS.includes(o) ? o : swap(o, re, e.person_term)));
    } else if (e.plain) { out.defines.push(String(e.term).toLowerCase()); out.definitions[String(e.term).toLowerCase()] = e.plain; }
  }
  return out;
}

export function createElicit({ db, now = () => Date.now(), config = {}, predict = null } = {}) {
  const clock = typeof now === 'function' ? now : () => now;
  const cfg = { max_open: 3, daily_cap: 5, quiet: null, expiry_hours: 72, spend_cap_usd: 0, defer_below: DEFAULT_DEFER_BELOW, timezone: null, g1_threshold: 0.7, jargon: DEFAULT_JARGON, fatigue_after: 3, priority_list: 3, outcomes: false, default_review_hours: 720, require_exhaustion: false, learn_after: 5, agree_after: 3, derive_surfaces: ['idea', 'record', 'probe', 'research'], ...config };
  // Outcome learning (5.3) is on when the host passes a predict port ({ recordDecision, registerMetric }, core/predict) or sets config.outcomes; it needs the
  // tables of outcomes/migrations. Without either, nothing is written to them and behaviour is the plain register.
  const learn = cfg.outcomes === true || Boolean(predict);
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const one = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  const needRow = (project, id) => one(`SELECT * FROM elicit_needs WHERE project=? AND id=?`, project, id);
  const gateId = (project, id) => `elicit-${project}-${id}`;
  const gated = n => !n.reversible || !!n.identity_bound || !!n.exposes_private || n.cost_usd > cfg.spend_cap_usd;
  // US-16-R16: the quiet period is read in the person's local time. With no time zone and no configured period nothing is silenced.
  const localHour = () => {
    if (!cfg.timezone || !validTimezone(cfg.timezone)) return new Date(clock()).getUTCHours();
    return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: cfg.timezone }).format(new Date(clock())));
  };
  const quiet = () => {
    const q = cfg.quiet || (cfg.timezone && validTimezone(cfg.timezone) ? DEFAULT_QUIET : null);
    if (!q) return false;
    const h = localHour(); const { from, to } = q;
    return from > to ? (h >= from || h < to) : (h >= from && h < to);
  };
  const hasTable = async name => Boolean(await one(`SELECT 1 AS x FROM sqlite_master WHERE name=?`, name));
  /** Failed predictions scored since the last audit of the project that no audit has turned into a lesson yet (section 6, surprise sweep). */
  async function surprisesSince(project) {
    const lastRun = (await one(`SELECT MAX(created_at) AS t FROM elicit_audit WHERE project=?`, project))?.t || null;
    const since = lastRun ? lastRun.replace('T', ' ').slice(0, 19) : null;
    const lessoned = new Set((await all(`SELECT finding FROM elicit_audit WHERE project=? AND sweep='surprise' AND finding LIKE 'failed prediction %'`, project)).map(r => /^failed prediction (\S+):/.exec(r.finding)?.[1]));
    return [
      // The legacy table has no scored_at, and a prediction is graded after its due_at (so after an audit that ran in between): it is read whole and the lessoned set below
      // keeps a miss from becoming a lesson twice.
      ...await all(`SELECT id, metric FROM predictions WHERE verdict IS NOT NULL AND verdict <> 'hit'`).catch(() => []),
      ...((await hasTable('predict_predictions')) ? await all(`SELECT id, subject AS metric FROM predict_predictions WHERE matched = 0 AND (? IS NULL OR scored_at > ?)`, since, since) : []),
    ].filter(m => !lessoned.has(m.id));
  }
  let auditSeq = 0;
  let derivationsTable = null;
  const hasDerivations = async () => (derivationsTable ??= Boolean(await one(`SELECT 1 AS x FROM sqlite_master WHERE name='elicit_derivations'`)));
  const logAttempt = async (project, need, surface, result, detail) => { if (await hasDerivations()) await run(`INSERT INTO elicit_derivations (project, need_id, surface, result, detail, at) VALUES (?,?,?,?,?,?)`, project, need, surface, result, detail ?? null, iso(clock())); };
  const queueRerun = async (n, why) => {
    const itemId = `ELICIT-RERUN-${n.project}-${n.artifact}`.toUpperCase().replace(/[^A-Z0-9-]+/g, '-');
    await run(`INSERT INTO items (id, title, kind, project, owner_role, done_check, closing_probe, priority, status) VALUES (?,?,'work',?,'portfolio-manager',?,'manual',15,'open')
      ON CONFLICT(id) DO UPDATE SET status='open', updated_at=datetime('now')`, itemId, `Re-run ${n.artifact}: ${why} "${n.label}"`, n.project, `${n.artifact} regenerated from the changed need ${n.id}, and elicit.lintDraft passes on the new draft (every statement tagged)`);
    return itemId;
  };

  const toCard = n => ({
    need_id: n.id, question: n.question, why: n.why, cue: n.cue,
    options: [...JSON.parse(n.options), ...EXTRA_OPTIONS], default: n.default_value, default_marked: true,
    default_consequence: n.default_consequence, reversibility: n.reversible ? 'reversible' : 'not reversible',
    priority: n.priority, free_text: !!n.free_text, defines: [], changed: n.revisit && n.revisit.startsWith('This changed:') ? n.revisit : null,
  });

  async function setDefault(n, reason) {
    const t = iso(clock());
    await run(`UPDATE elicit_needs SET state='defaulted', value=?, provenance='default', answered_at=?, revisit='at the next demonstration or review' WHERE project=? AND id=?`, n.default_value, t, n.project, n.id);
    await run(`INSERT INTO elicit_assumptions (project, need_id, value, reason, revisit_trigger, created_at) VALUES (?,?,?,?,?,?)`,
      n.project, n.id, n.default_value, reason, 'revisit at the next demonstration or review, or when the person answers', t);
    await predictDefault(n);
    await settle(n.project, n.id, n.default_value);
  }

  /** US-16-R32: the value of information of an Ask is a prediction. When a need is first asked, its outcome row is opened and the estimate is logged as a
   *  decision with a parsable prediction (`elicit_default_held.<row> >= 1 within <expiry + 24> h`, confidence 1 - p_wrong); when the need leaves the asked
   *  state the row is settled, and the scorer in core/predict grades the prediction from it. */
  const learnedOf = async id => {
    const r = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN default_held = 0 THEN 1 ELSE 0 END), 0) AS changed FROM elicit_outcomes WHERE need_id=? AND settled_at IS NOT NULL`, id);
    return { n: r.n, changed: r.changed, p_wrong: (r.changed + 1) / (r.n + 2) };
  };
  async function openOutcome(n) {
    if (!learn) return;
    const l = await learnedOf(n.id);
    const p = l.n >= cfg.learn_after ? l.p_wrong : n.p_wrong;
    const ins = await run(`INSERT OR IGNORE INTO elicit_outcomes (project, need_id, estimate_p_wrong, rework, dependents, priority, default_value, asked_at) VALUES (?,?,?,?,?,?,?,?)`,
      n.project, n.id, p, n.rework, n.dependents, p * n.rework * n.dependents, n.default_value, iso(clock()));
    if (!predict || !ins.meta?.changes) return;
    const row = await one(`SELECT id FROM elicit_outcomes WHERE project=? AND need_id=?`, n.project, n.id);
    const metric = `elicit_default_held.${row.id}`;
    await predict.registerMetric(db, { name: metric, read_sql: `SELECT CASE WHEN settled_at IS NULL THEN NULL WHEN default_held = 1 THEN 1 ELSE 0 END FROM elicit_outcomes WHERE id = ${row.id}`, description: `1 when the default for ${n.id} in ${n.project} held` });
    await predict.recordDecision(db, {
      id: `ELICIT-VOI-${n.project}-${n.id}`, decision: `ask "${n.label}" with the default "${n.default_value}"`, reason: `estimated chance the default is wrong: ${p.toFixed(2)}`,
      predicted_outcome: `${metric} >= 1 within ${cfg.expiry_hours + 24} h`, revert_path: 'the person corrects it in the read-back', confidence: Math.min(1, Math.max(0, 1 - p)),
      decision_type: 'elicit_voi', surface: 'elicit', action_class: 'ask',
    }, { now: clock() });
  }
  async function settle(project, id, finalValue) {
    if (!learn) return;
    const o = await one(`SELECT default_value FROM elicit_outcomes WHERE project=? AND need_id=?`, project, id);
    if (!o) return;
    await run(`UPDATE elicit_outcomes SET settled_at=?, final_value=?, default_held=? WHERE project=? AND need_id=?`, iso(clock()), finalValue == null ? null : String(finalValue), o.default_value != null && String(finalValue) === String(o.default_value) ? 1 : 0, project, id);
  }
  /** Learning across projects: a catalog need whose last `agree_after` stated answers agree is derived from the record; one asked `learn_after` times whose
   *  default always held is defaulted without asking (askbar's prune rule, generalised); a learned estimate replaces the catalog's p_wrong once `learn_after` outcomes exist. */
  async function learnFromRecord(project) {
    if (!learn) return;
    for (const n of await all(`SELECT * FROM elicit_needs WHERE project=? AND state='open'`, project)) {
      if (await one(`SELECT 1 AS x FROM elicit_assumptions WHERE project=? AND need_id=? AND reason='contradicted'`, project, n.id)) continue; // evidence said the record is wrong here
      const l = await learnedOf(n.id);
      if (l.n >= cfg.learn_after) {
        const p = l.p_wrong; await run(`UPDATE elicit_needs SET p_wrong=?, priority=? WHERE project=? AND id=?`, p, p * n.rework * n.dependents, project, n.id);
        if (l.changed === 0 && !gated(n) && n.default_value != null) { await setDefault(n, 'learned_default'); continue; }
      }
      if (gated(n) || n.free_text) continue;
      const last = await all(`SELECT value FROM elicit_needs WHERE id=? AND project<>? AND state='answered' AND provenance='stated' ORDER BY answered_at DESC LIMIT ?`, n.id, project, cfg.agree_after);
      if (last.length === cfg.agree_after && last.every(r => r.value === last[0].value) && JSON.parse(n.options).includes(last[0].value)) {
        await run(`UPDATE elicit_needs SET state='derived', value=?, provenance='derived', source=? WHERE project=? AND id=?`, last[0].value, `record: last ${cfg.agree_after} answers agree`, project, n.id);
      }
    }
  }

  // Section 5.3 and US-16-R19: a default in effect is a prediction that the default holds. It is written to the prediction table when the default
  // is taken and scored when the person answers or corrects (hit when they choose the default value, miss otherwise) or when its
  // review time passes with the default still standing: then the kernel scorer reads DEFAULT_HOLDS_METRIC (`elicitMetrics`), and `scoreDefaults` is the
  // same reading for a host that runs no kernel tick. p_wrong on the need is the estimate the score is compared with. due_at is in the kernel's format.
  const predId = n => `ELICIT-${n.project}-${n.id}`;
  const predictDefault = n => run(`INSERT OR IGNORE INTO predictions (id, item_id, metric, op, target, due_at) VALUES (?,?,?,?,?,?)`,
    predId(n), null, DEFAULT_HOLDS_METRIC, '=', 1, kernelTime(clock() + cfg.default_review_hours * 3600e3));
  const scoreDefault = (n, value) => run(`UPDATE predictions SET observed=?, verdict=? WHERE id=? AND verdict IS NULL`,
    String(value) === String(n.default_value) ? 1 : 0, String(value) === String(n.default_value) ? 'hit' : 'miss', predId(n));

  /** US-16-R17: related needs are asked as one sequence, not interleaved. Groups are the artifacts the needs feed; the group
   *  holding the most valuable need goes first, and inside a group the order is by value of information. */
  async function batched(project, where) {
    const rows = await all(`SELECT * FROM elicit_needs WHERE project=? AND ${where} ORDER BY priority DESC, id`, project);
    const order = [...new Set(rows.map(r => r.artifact))];
    return order.flatMap(a => rows.filter(r => r.artifact === a));
  }

  /** US-16-R18: has the person stopped answering? True when the last `fatigue_after` Asks that ended all ended by timeout. */
  async function fatigue(project) {
    const ends = [
      ...(await all(`SELECT answered_at AS at, 'answer' AS kind FROM elicit_needs WHERE project=? AND state='answered' AND provenance='stated'`, project)),
      ...(await all(`SELECT created_at AS at, CASE reason WHEN 'timeout' THEN 'timeout' ELSE 'answer' END AS kind FROM elicit_assumptions WHERE project=? AND reason IN ('timeout','not_sure')`, project)),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    let n = 0; for (const e of ends) { if (e.kind !== 'timeout') break; n++; }
    return { stopped: n >= cfg.fatigue_after, consecutive_timeouts: n };
  }

  return {
    config: cfg,
    toCard,
    fatigue,
    surprisesSince,

    /** Record the person's own word for a system term, or a plain explanation of it (US-16-R03, section 8). */
    async learnTerm(term, { plain = null, person_term = null } = {}) {
      const t = String(term || '').trim().toLowerCase();
      if (!t || (!plain && !person_term)) return { ok: false, error: 'a term needs a plain explanation or the person\'s own word for it' };
      await run(`INSERT INTO elicit_glossary (term, plain, person_term, created_at) VALUES (?,?,?,?) ON CONFLICT(term) DO UPDATE SET plain=COALESCE(excluded.plain, elicit_glossary.plain), person_term=COALESCE(excluded.person_term, elicit_glossary.person_term)`,
        t, plain ?? person_term, person_term, iso(clock()));
      return { ok: true, term: t };
    },
    glossary: () => all(`SELECT term, plain, person_term FROM elicit_glossary ORDER BY term`),

    /** Check every card that would be shown, after the glossary mapping, against the card rules (failure mode "jargon leak"). */
    async reviewCards(project) {
      const glossary = await all(`SELECT term, plain, person_term FROM elicit_glossary`);
      const out = [];
      for (const n of await all(`SELECT * FROM elicit_needs WHERE project=? AND state IN ('open','asked','gated')`, project)) {
        const problems = validateCard(applyGlossary(toCard(n), glossary), { jargon: cfg.jargon });
        if (problems.length) out.push({ need_id: n.id, problems });
      }
      return out;
    },

    /** Build the needs register from a catalog (the REQUIRED artifact fields), deriving what the idea text already answers (US-16-R01, T16-1). */
    async registerNeeds(project, catalog, { idea = '' } = {}) {
      const rejected = [];
      for (const c of catalog) {
        const problems = validateCard({
          need_id: c.id, question: c.question, why: c.why, cue: c.cue, options: [...(c.options || []), ...EXTRA_OPTIONS], free_text: c.free_text,
          default: c.default ?? 'unset', default_consequence: c.default_consequence || 'x', reversibility: c.reversible === false ? 'not reversible' : 'reversible', priority: 0, defines: c.defines,
        }, { jargon: cfg.jargon });
        if (problems.length) { rejected.push({ id: c.id, problems }); continue; }
        const m = c.derive_from ? new RegExp(c.derive_from, 'i').exec(idea) : null;
        const priority = priorityOf({ p_wrong: c.p_wrong ?? 0.5, rework: c.rework ?? 1, dependents: c.dependents ?? 1 });
        await run(`INSERT OR IGNORE INTO elicit_needs (project, id, label, artifact, must, reversible, identity_bound, exposes_private, cost_usd, question, why, cue, options, default_value, default_consequence,
          free_text, p_wrong, rework, dependents, priority, state, value, provenance, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        project, c.id, c.label, c.artifact, c.must === false ? 0 : 1, c.reversible === false ? 0 : 1, c.identity_bound ? 1 : 0, c.exposes_private ? 1 : 0, c.cost_usd || 0,
        c.question, c.why, c.cue, JSON.stringify(c.options || []), c.default ?? null, c.default_consequence || null, c.free_text ? 1 : 0, c.p_wrong ?? 0.5, c.rework ?? 1, c.dependents ?? 1, priority,
        m ? 'derived' : 'open', m ? m[0] : null, m ? 'derived' : null, m ? 'idea file' : null);
        for (const f of c.feeds || []) {
          const [artifact, ...field] = String(f).split('.');
          if (await one(`SELECT 1 AS x FROM sqlite_master WHERE name='elicit_need_feeds'`)) await run(`INSERT OR IGNORE INTO elicit_need_feeds (project, need_id, artifact, field) VALUES (?,?,?,?)`, project, c.id, artifact, field.join('.'));
        }
        if (c.derive_from) await logAttempt(project, c.id, 'idea', m ? 'hit' : 'miss', m ? m[0] : 'no match in the idea text');
        else await logAttempt(project, c.id, 'idea', 'miss', 'no pattern for this need');
      }
      return { registered: (await all(`SELECT id FROM elicit_needs WHERE project=?`, project)).length, rejected };
    },

    /** Move needs forward: expire old asks, file gate cards for needs that cannot be defaulted, default low-priority reversible needs,
     *  then open Asks up to the open cap, the daily cap and the quiet period (US-16-R04, R06, R10, R16). Returns the open Ask cards. */
    async nextAsks(project) {
      await this.expire(project);
      await learnFromRecord(project);
      // US-16-R01 (PATHFINDER-1 discipline): with require_exhaustion no need is asked, or turned into a gate card for the person, before every configured
      // derivation surface has an attempt on record. Needs still waiting are listed on the result (`awaiting_derivation`).
      const waiting = new Set();
      if (cfg.require_exhaustion && await hasDerivations()) {
        for (const n of await all(`SELECT id FROM elicit_needs WHERE project=? AND state='open'`, project)) {
          const done = new Set((await all(`SELECT DISTINCT surface FROM elicit_derivations WHERE project=? AND need_id=?`, project, n.id)).map(r => r.surface));
          if (!cfg.derive_surfaces.every(sf => done.has(sf))) waiting.add(n.id);
        }
      }
      for (const n of await all(`SELECT * FROM elicit_needs WHERE project=? AND state='open' ORDER BY priority DESC, id`, project)) {
        if (waiting.has(n.id)) continue;
        if (gated(n)) {
          await run(`UPDATE elicit_needs SET state='gated', asked_at=? WHERE project=? AND id=?`, iso(clock()), project, n.id);
          await run(`INSERT OR IGNORE INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES (?,?,?,?,?,?)`,
            gateId(project, n.id), `answer needed: ${n.label}`, 'A wrong default here could not be undone, would use the person identity, spend above the cap or expose private data.',
            'work that depends on this waits; other work continues', 'elicit', `elicit_answered:${project}:${n.id}`);
        } else if (n.priority < cfg.defer_below && n.default_value != null) await setDefault(n, 'low_priority');
      }
      // US-16-R06: a need that is still gated always has an open card. A card closed any other way than by the answer is reopened.
      let reopened = 0;
      for (const n of await all(`SELECT id FROM elicit_needs WHERE project=? AND state='gated'`, project)) {
        const r = await run(`UPDATE gate_cards SET status='open', closed_at=NULL WHERE id=? AND status='closed'`, gateId(project, n.id));
        reopened += r.meta?.changes || 0;
      }
      const tired = await fatigue(project);
      if (tired.stopped) {
        // US-16-R18: the person stopped answering. Do not ask more often: keep only the priority list and default the rest.
        const open = await all(`SELECT * FROM elicit_needs WHERE project=? AND state='open' ORDER BY priority DESC, id`, project);
        for (const n of open.slice(cfg.priority_list)) if (n.default_value != null && !gated(n)) await setDefault(n, 'fatigue');
      }
      if (!quiet()) {
        const open = (await one(`SELECT COUNT(*) AS n FROM elicit_needs WHERE project=? AND state='asked'`, project)).n;
        const day = iso(clock()).slice(0, 10);
        const today = (await one(`SELECT COUNT(*) AS n FROM elicit_needs WHERE project=? AND state<>'gated' AND substr(asked_at,1,10)=?`, project, day)).n;
        const maxOpen = tired.stopped ? Math.min(1, cfg.max_open) : cfg.max_open;
        const room = Math.max(0, Math.min(maxOpen - open, cfg.daily_cap - today));
        for (const n of (await batched(project, `state='open'`)).filter(r => !waiting.has(r.id)).slice(0, room)) {
          await run(`UPDATE elicit_needs SET state='asked', asked_at=?, expires_at=? WHERE project=? AND id=?`, iso(clock()), iso(clock() + cfg.expiry_hours * 3600e3), project, n.id);
          await openOutcome(n);
        }
      }
      const glossary = await all(`SELECT term, plain, person_term FROM elicit_glossary`);
      const rows = await batched(project, `state IN ('asked','gated')`);
      const cards = rows.map((n, i) => {
        const same = rows.filter(r => r.artifact === n.artifact);
        return { ...applyGlossary(toCard(n), glossary), sequence: { artifact: n.artifact, position: same.indexOf(n) + 1, of: same.length } };
      });
      Object.defineProperty(cards, 'reopened', { value: reopened, enumerable: false });
      Object.defineProperty(cards, 'awaiting_derivation', { value: [...waiting], enumerable: false });
      return cards;
    },

    /** An unanswered Ask becomes its default after its time (US-16-R10). Gated needs never expire to a default. */
    async expire(project) {
      let n = 0;
      for (const r of await all(`SELECT * FROM elicit_needs WHERE project=? AND state='asked' AND expires_at<=?`, project, iso(clock()))) {
        if (r.default_value == null) continue;
        await setDefault(r, 'timeout'); n++;
      }
      return n;
    },

    /** US-16-R01 and R30: try to settle each open need before asking, on every surface in order (idea, existing records, tool probes, cited research),
     *  and record every attempt. Ports are data: records[need_id] and probes[need_id] are async () => value | null; research is async (need) => { value, sources: [{ url, title }] } | null.
     *  A research value with no source is never applied (a system-unknown is researched with a source or escalated, never guessed silently). A port that throws is
     *  logged as an error and the next surface is still tried. A value a later contradiction ruled out is not applied again. With `every_hours` (the tick's cadence) a need
     *  whose last record, probe or research attempt is newer than that is skipped (counted in `skipped`), so a pass on every tick does not log a row per surface each time. */
    async derive(project, { records = {}, probes = {}, research = null, every_hours = null } = {}) {
      if (!(await hasDerivations())) throw new Error('derive needs the tables of outcomes/migrations');
      const out = { derived: [], attempts: 0, skipped: 0 };
      const since = Number.isFinite(Number(every_hours)) && every_hours !== null && Number(every_hours) > 0 ? iso(clock() - Number(every_hours) * 3600e3) : null;
      for (const n of await all(`SELECT * FROM elicit_needs WHERE project=? AND state='open' ORDER BY priority DESC, id`, project)) {
        if (since && (await one(`SELECT MAX(at) AS at FROM elicit_derivations WHERE project=? AND need_id=? AND surface IN ('record','probe','research')`, project, n.id))?.at > since) { out.skipped++; continue; }
        const banned = new Set((await all(`SELECT value FROM elicit_assumptions WHERE project=? AND need_id=? AND reason='contradicted'`, project, n.id)).map(r => r.value));
        const options = JSON.parse(n.options);
        const valid = v => v != null && String(v).trim() !== '' && (n.free_text || options.includes(String(v)));
        const tries = [
          ['record', records[n.id] ? async () => ({ value: await records[n.id]() }) : null, 'derived'],
          ['probe', probes[n.id] ? async () => ({ value: await probes[n.id]() }) : null, 'derived'],
          ['research', research ? async () => research(n) : null, 'researched'],
        ];
        for (const [surface, fn, provenance] of tries) {
          if (!cfg.derive_surfaces.includes(surface)) continue;
          out.attempts++;
          if (!fn) { await logAttempt(project, n.id, surface, 'miss', 'no port for this surface'); continue; }
          let r;
          try { r = await fn(); } catch (e) { await logAttempt(project, n.id, surface, 'error', String(e?.message || e).slice(0, 200)); continue; }
          if (!r || r.value == null) { await logAttempt(project, n.id, surface, 'miss', 'nothing found'); continue; }
          if (surface === 'research' && !(Array.isArray(r.sources) && r.sources.some(x => x?.url))) { await logAttempt(project, n.id, surface, 'no_source', `a value was found but it cites no source: ${String(r.value).slice(0, 80)}`); continue; }
          if (!valid(r.value)) { await logAttempt(project, n.id, surface, 'miss', 'the value is not one of the options'); continue; }
          if (banned.has(String(r.value))) { await logAttempt(project, n.id, surface, 'miss', 'the same value later contradicted by evidence'); continue; }
          const source = surface === 'research' ? r.sources.find(x => x?.url).url : surface;
          await run(`UPDATE elicit_needs SET state='derived', value=?, provenance=?, source=? WHERE project=? AND id=? AND state='open'`, String(r.value), provenance, source, project, n.id);
          await logAttempt(project, n.id, surface, 'hit', `${r.value} from ${source}`);
          out.derived.push({ need_id: n.id, value: String(r.value), provenance, source });
          break;
        }
      }
      return out;
    },

    /** US-16-R11: the draft of one artifact from the register, every statement tagged with its provenance; A-INI-4 is the assumption log with revert paths. */
    draft: (project, artifact) => draftArtifact(db, project, artifact),
    assumptionLog: project => draftAssumptionLog(db, project),
    lintDraft: (project, text) => lintDraft(db, project, text),

    /** US-16-R31 (section 4: Answered -> Open and Derived -> Open): later evidence contradicts a settled need. It returns to open (asked again, or gated again), the previous
     *  value stays in the assumption log with the evidence, readiness drops and the artifact it feeds is queued to be redone. The same evidence twice changes nothing more. */
    async contradict(project, id, { evidence, source = 'evidence' } = {}) {
      const n = await needRow(project, id);
      if (!n) return { ok: false, error: 'no such need' };
      const ev = String(evidence ?? '').trim();
      if (!ev) return { ok: false, error: 'a contradiction names its evidence' };
      const trigger = `contradicted by ${source}: ${ev}`;
      if (await one(`SELECT 1 AS x FROM elicit_assumptions WHERE project=? AND need_id=? AND reason='contradicted' AND revisit_trigger=?`, project, id, trigger)) return { ok: true, already: true, state: n.state };
      if (!['answered', 'derived'].includes(n.state)) return { ok: false, error: 'only an answered or derived need can be contradicted' };
      const t = iso(clock());
      await run(`INSERT INTO elicit_assumptions (project, need_id, value, reason, revisit_trigger, created_at, superseded_at) VALUES (?,?,?,?,?,?,?)`, project, id, n.value, 'contradicted', trigger, t, t);
      await run(`UPDATE elicit_needs SET state='open', value=NULL, provenance=NULL, source=NULL, answered_at=NULL, asked_at=NULL, expires_at=NULL, revisit=? WHERE project=? AND id=?`, `This changed: ${ev}`, project, id);
      const rerun = await queueRerun(n, 'new evidence changed');
      return { ok: true, state: 'open', rerun: [rerun] };
    },

    /** The tick's duties across every project (US-16-R10, R03): default every overdue Ask, and check every card that would be shown against the glossary. */
    async expireAll() {
      let n = 0;
      for (const r of await all(`SELECT DISTINCT project FROM elicit_needs WHERE state='asked' AND expires_at<=?`, iso(clock()))) n += await this.expire(r.project);
      return n;
    },
    async reviewAll() {
      const out = [];
      for (const r of await all(`SELECT DISTINCT project FROM elicit_needs`)) for (const f of await this.reviewCards(r.project)) out.push({ project: r.project, ...f });
      return out;
    },

    /** Record an answer. `choice` is an option, `Not sure` (default plus assumption log) or `Tell me more` (explain, same card). */
    async answer(project, id, { choice, text, channel = 'console' } = {}) {
      const n = await needRow(project, id);
      if (!n) return { ok: false, error: 'no such need' };
      if (choice === 'Tell me more') {
        await run(`UPDATE elicit_needs SET more_count = more_count + 1 WHERE project=? AND id=?`, project, id);
        const count = n.more_count + 1;
        if (count >= 3) await run(`INSERT OR IGNORE INTO elicit_glossary (term, plain, created_at) VALUES (?,?,?)`, n.label.toLowerCase(), n.why, iso(clock()));
        return { ok: true, explain: `${n.why} For example: ${n.cue}`, card: toCard(n), taught: count >= 3 };
      }
      if (choice === 'Not sure') {
        // US-16-R07: a stated answer (or a derived value) is never replaced by the default; changing it is a correction in the read-back.
        if (['answered', 'derived'].includes(n.state)) return { ok: false, refusal: 'already_answered', error: 'you already answered this; use the read-back to change it', card: toCard(n) };
        if (gated(n) || n.default_value == null) return { ok: false, refusal: 'cannot_default', error: 'this one has no safe default; it stays with the person', card: toCard(n) };
        await setDefault(n, 'not_sure');
        return { ok: true, state: 'defaulted', value: n.default_value };
      }
      const options = JSON.parse(n.options);
      const value = n.free_text ? String(choice ?? text ?? '').trim() : choice;
      if (!value || (!n.free_text && !options.includes(value))) return { ok: false, error: 'answer must be one of the options' };
      await run(`UPDATE elicit_needs SET state='answered', value=?, provenance='stated', answer_text=?, channel=?, answered_at=?, revisit=NULL WHERE project=? AND id=?`, value, text ?? String(choice), channel, iso(clock()), project, id);
      await run(`UPDATE elicit_assumptions SET superseded_at=? WHERE project=? AND need_id=? AND superseded_at IS NULL`, iso(clock()), project, id);
      await run(`UPDATE gate_cards SET status='closed', closed_at=datetime('now') WHERE id=? AND status='open'`, gateId(project, id));
      if (n.state === 'defaulted') await scoreDefault(n, value);
      await settle(project, id, value);
      return { ok: true, state: 'answered', value };
    },

    /** Section 5.3: score the defaults whose review time has passed with the default still in effect (the prediction held). A due_at written in the older
     *  ISO form is read the same way. */
    async scoreDefaults(project) {
      let n = 0;
      for (const r of await all(`SELECT * FROM elicit_needs WHERE project=? AND state='defaulted'`, project)) {
        const res = await run(`UPDATE predictions SET observed=1, verdict='hit' WHERE id=? AND verdict IS NULL AND replace(substr(due_at,1,19),'T',' ')<=?`, predId(r), kernelTime(clock()));
        n += res?.meta?.changes || 0;
      }
      return n;
    },

    /** US-16-R19: an unscored default prediction written before the kernel could read it (metric `elicit_default_holds:<project>:<need>`, due_at in ISO form)
     *  is rewritten to the metric and the time format the kernel scorer reads. Idempotent; returns the number of rows changed. */
    async repairDefaultPredictions() {
      const r = await run(`UPDATE predictions SET metric=?, due_at=replace(substr(due_at,1,19),'T',' ') WHERE id LIKE 'ELICIT-%' AND verdict IS NULL
        AND (substr(metric,1,21)='elicit_default_holds:' OR (metric=? AND instr(due_at,'T')>0))`, DEFAULT_HOLDS_METRIC, DEFAULT_HOLDS_METRIC);
      return r?.meta?.changes || 0;
    },

    /** Section 5.3: how good were the value-of-information estimates? Over the scored defaults: the share that turned out wrong against the
     *  mean estimated p_wrong, and the Brier score of the estimate. With nothing scored the rates are null (unmeasured), never 0. */
    async voiCalibration(project) {
      const rows = await all(`SELECT n.id, n.p_wrong, n.priority, p.verdict FROM elicit_needs n JOIN predictions p ON p.id = 'ELICIT-' || n.project || '-' || n.id WHERE n.project=? AND p.verdict IS NOT NULL`, project);
      const pending = (await one(`SELECT COUNT(*) AS n FROM elicit_needs n JOIN predictions p ON p.id = 'ELICIT-' || n.project || '-' || n.id WHERE n.project=? AND p.verdict IS NULL`, project)).n;
      if (!rows.length) return { scored: 0, pending, wrong: 0, wrong_rate: null, mean_p_wrong: null, brier: null };
      const wrong = rows.filter(r => r.verdict === 'miss').length;
      const mean = rows.reduce((a, r) => a + r.p_wrong, 0) / rows.length;
      const brier = rows.reduce((a, r) => a + (r.p_wrong - (r.verdict === 'miss' ? 1 : 0)) ** 2, 0) / rows.length;
      return { scored: rows.length, pending, wrong, wrong_rate: wrong / rows.length, mean_p_wrong: mean, brier };
    },

    /** Computed, never asserted (US-16-R15). G1 needs g1_threshold; G2 needs every MUST need satisfied and every non-reversible one answered or derived (T16-7). */
    async readiness(project) {
      const musts = await all(`SELECT id, state, reversible FROM elicit_needs WHERE project=? AND must=1`, project);
      const ok = musts.filter(n => SATISFIED.includes(n.state));
      const score = musts.length ? ok.length / musts.length : 1;
      const blocking = musts.filter(n => !n.reversible && !['answered', 'derived'].includes(n.state)).map(n => n.id);
      return { score, musts: musts.length, threshold: cfg.g1_threshold, satisfied: ok.length, g1: score >= cfg.g1_threshold, g2: score === 1 && !blocking.length, blocking, missing: musts.filter(n => !SATISFIED.includes(n.state)).map(n => n.id) };
    },

    /** The spec restated in plain words, defaults first, every statement tagged with its provenance (US-16-R11, R12). */
    async readBack(project) {
      const rows = await all(`SELECT * FROM elicit_needs WHERE project=? AND state IN ('answered','defaulted','derived') ORDER BY (state='defaulted') DESC, artifact, id`, project);
      const log = await all(`SELECT id, need_id FROM elicit_assumptions WHERE project=? AND superseded_at IS NULL`, project);
      const statements = rows.map(n => ({
        need_id: n.id, provenance: n.provenance, value: n.value, artifact: n.artifact, assumption: n.provenance === 'default',
        assumption_id: n.provenance === 'default' ? (log.find(a => a.need_id === n.id)?.id ?? null) : null,
        text: n.provenance === 'default' ? `We assumed ${n.label.toLowerCase()} is "${n.value}". If that is wrong: ${n.default_consequence}` : `${n.label}: ${n.value}`,
      }));
      return { statements, text: statements.map(s => `- ${s.text} [${s.provenance}]`).join('\n'), defaults: statements.filter(s => s.assumption).length };
    },

    /** A correction from the read-back: updates the register and queues a re-run of the artifact it feeds (US-16-R13, T16-8). */
    async correct(project, id, value, { channel = 'console', text } = {}) {
      const n = await needRow(project, id);
      if (!n) return { ok: false, error: 'no such need' };
      const given = String(value ?? '').trim();
      if (!given) return { ok: false, error: 'say what it should be' };
      if (!n.free_text && !JSON.parse(n.options).includes(given)) return { ok: false, error: 'answer must be one of the options' };
      await run(`UPDATE elicit_needs SET state='answered', value=?, provenance='stated', answer_text=?, channel=?, answered_at=?, revisit=NULL WHERE project=? AND id=?`, given, text ?? given, channel, iso(clock()), project, id);
      await run(`UPDATE elicit_assumptions SET superseded_at=? WHERE project=? AND need_id=? AND superseded_at IS NULL`, iso(clock()), project, id);
      if (n.state === 'defaulted') await scoreDefault(n, value);
      await settle(project, id, given);
      const itemId = await queueRerun(n, 'the person corrected');
      return { ok: true, rerun: [itemId] };
    },

    /** The four-sweep ignorance audit (section 6, T16-9). Inputs are data; the red-team sweep is an injected function and must come from a
     *  different model family than the author. Evidence rows are written for every sweep that ran; `complete` is true only if all four did. */
    async audit(project, { required_fields = [], analogies = [], redteam, author_family = null, surprises = [], trigger = 'manual' } = {}) {
      const run_id = `AUD-${clock().toString(36)}-${(auditSeq++).toString(36)}`;
      const t = iso(clock());
      const add = (sweep, finding, disposition, evidence) => run(`INSERT INTO elicit_audit (project, run_id, sweep, finding, disposition, evidence, created_at) VALUES (?,?,?,?,?,?,?)`, project, run_id, sweep, finding, disposition, evidence ?? null, t);
      const has = hasTable;
      const misses = await surprisesSince(project); // read before this run writes its own rows
      const ran = new Set();
      const known = new Set((await all(`SELECT artifact, label FROM elicit_needs WHERE project=?`, project)).map(n => `${n.artifact}:${n.label}`));
      if (await has('elicit_need_feeds')) for (const f of await all(`SELECT artifact, field FROM elicit_need_feeds WHERE project=?`, project)) known.add(`${f.artifact}:${f.field}`);
      const missing = required_fields.filter(f => !known.has(`${f.artifact}:${f.field}`));
      for (const f of missing) await add('catalog', `${f.artifact}.${f.field} has no need in the register`, 'need', 'catalog diff');
      await add('catalog', `checked ${required_fields.length} required fields; ${missing.length} without a need`, 'dismissed', 'catalog diff');
      ran.add('catalog');
      for (const a of analogies) {
        const pro = PROFESSIONAL.test(a.item) || PROFESSIONAL.test(a.topic || '');
        const disp = pro ? 'needs_professional' : (a.disposition || 'risk');
        await add('analogy', `${a.topic ? a.topic + ': ' : ''}${a.item}`, disp, a.source ? `source: ${a.source}` : 'no source');
        if (pro && a.blocking !== false) {
          await run(`INSERT OR IGNORE INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES (?,?,?,?,?,?)`,
            `elicit-pro-${project}-${(a.topic || a.item).slice(0, 30).replace(/[^A-Za-z0-9]+/g, '-')}`, `needs a qualified professional: ${a.item}`,
            'The system does not give legal, medical, financial or safety advice (SCOPE.md).', 'recorded as a risk; work that does not depend on it continues', 'elicit', 'manual');
        }
      }
      if (analogies.length) ran.add('analogy');
      let independent = false; // no red-team sweep ran, so none was independent
      if (typeof redteam === 'function') {
        const r = await redteam({ project, needs: await all(`SELECT id, label, value, provenance FROM elicit_needs WHERE project=?`, project) });
        // Families compare as names, not as spellings: "Claude" and " claude " are one family.
        const authorFam = familyOf(author_family); const gotFam = familyOf(r?.family);
        if (authorFam && gotFam && authorFam === gotFam) throw new Error('red-team sweep must come from a different model family than the author');
        // US-16 section 6: an independent sweep is one whose family is known and is not the author's. An unknown family (the reviewer's or the author's), or the rule floor, is
        // recorded as such and never as independence.
        independent = Boolean(authorFam && gotFam) && !r?.floor;
        const why = authorFam ? '; unverified independence' : '; author family unknown; unverified independence';
        const ev = r?.floor ? 'model family: none (rule floor); no independent model available' : `model family: ${gotFam ? String(r.family).trim() : 'unknown'}${independent ? '' : why}`;
        await add('redteam', `question: ${r?.question || 'what would make this fail or harm someone that the person has not mentioned?'}`, 'dismissed', ev);
        for (const pt of r?.points || []) await add('redteam', pt.point, pt.disposition || 'risk', ev);
        ran.add('redteam');
      }
      for (const m of misses) await add('surprise', `failed prediction ${m.id}: ${m.metric}`, 'lesson', (await has('predict_predictions')) ? 'prediction records' : 'predictions table');
      for (const s of surprises) await add('surprise', s.what, s.kind || 'lesson', s.evidence || 'runtime record');
      await add('surprise', `reviewed ${misses.length + surprises.length} surprises`, 'dismissed', 'surprise review');
      ran.add('surprise');
      if (await has('elicit_audit_runs')) await run(`INSERT OR IGNORE INTO elicit_audit_runs (project, run_id, trigger, independent, at) VALUES (?,?,?,?,?)`, project, run_id, trigger, independent ? 1 : 0, t);
      return { run_id, ran: [...ran], missing_sweeps: SWEEPS.filter(s => !ran.has(s)), complete: SWEEPS.every(s => ran.has(s)) && independent, independent, new_needs: missing.length };
    },
  };
}
