// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ORCHESTRATE-1 (Rowan 2026-11-26): "Why can't Ultrastable do this entirely on its own from managers/agents without any user input, 100% server-side?"
// The single-shot executor (nativeexec.js) gives one item to one model call and takes at most three whole files back, so anything larger fails its guards
// and is retried the same way. This module is the missing layer: a run that survives across ticks in D1 and moves through the phases a code agent
// session moves through.
//   plan       one call splits the item into steps; each step names the files it writes and the steps it comes after
//   implement  steps whose predecessors are done and whose files do not overlap are worked together, each seeing the files as earlier steps left them;
//              a step may ask once to read files it was not shown
//   verify     a different model than the authors reads the combined change against the item's done check and names the steps that are wrong
//   fix        the named steps are worked again with the findings, at most MAX_ROUNDS times
//   integrate  every step's files go on one branch as one PR with a Handoff block; the lane and the handoff closer own it from there
// A run starts only for an item the single-shot lane already failed, at most MAX_RUNS_PER_ITEM times, and one tick advances one phase, so the cost of a
// run is bounded by MAX_STEPS and the spend governor in budget.js still applies to every call. Nothing here needs a session, a desktop or a person.
import { runCodeAgent, applyEdit, ADAPTERS, BLOCK_FORMAT } from './codeagent.js';
import { guard, shrinkGuard, stubGuard, substanceGuard, github, openPr, slugOf, deployFor, pathsIn, PROTECTED } from './nativeexec.js';
import { tenantOf } from './tenant.js';
import { recordPlan, settlePlan, safely } from './decisions.js';

export const MAX_STEPS = 6, PARALLEL = 3, MAX_ATTEMPTS = 2, MAX_ROUNDS = 2, MAX_RUNS_PER_ITEM = 2, STEP_FILES = 3, RUN_FILES = 12, STALE_MS = 6 * 3600000;
export const TRIGGER = 'needs-code: worker-native attempt failed';
const SHOWN = 16000;

const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const iso = now => new Date(now).toISOString();
const J = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

export function safe(p) {
  p = String(p || '').replace(/^\.\//, '');
  if (!p || p.startsWith('/') || p.includes('..') || p.includes('\\') || /^[a-z]:/i.test(p)) throw new Error('unsafe path: ' + p);
  if (PROTECTED.some(x => p === x || p.startsWith(x))) throw new Error('protected path: ' + p);
  return p;
}

// The planner's answer, checked before anything is stored: a step with no file to write, a file two unordered steps both write, or a step that waits
// on itself or on a later step would stall or corrupt the run, so the plan is refused and asked for again.
export function validatePlan(out) {
  const steps = out && out.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) throw new Error(`plan needs 1..${MAX_STEPS} steps, got ${Array.isArray(steps) ? steps.length : 'none'}`);
  const plan = steps.map((s, i) => {
    const n = i + 1;
    if (!s || typeof s.title !== 'string' || !s.title.trim() || typeof s.instructions !== 'string' || !s.instructions.trim()) throw new Error(`step ${n}: title and instructions are required`);
    const paths = [...new Set((Array.isArray(s.paths) ? s.paths : []).map(safe))];
    if (!paths.length || paths.length > STEP_FILES) throw new Error(`step ${n}: names ${paths.length} files to write, needs 1..${STEP_FILES}`);
    const after = [...new Set((Array.isArray(s.after) ? s.after : []).map(Number))];
    if (after.some(a => !Number.isInteger(a) || a < 1 || a >= n)) throw new Error(`step ${n}: may only come after an earlier step`);
    return { n, title: s.title.trim().slice(0, 160), instructions: s.instructions.trim().slice(0, 3000), paths, after };
  });
  if (new Set(plan.flatMap(s => s.paths)).size > RUN_FILES) throw new Error(`plan writes more than ${RUN_FILES} files`);
  // two steps that write one file must be ordered, or the later answer would silently replace the earlier one
  const before = (a, b) => b.after.includes(a.n) || b.after.some(m => before(a, plan[m - 1]));
  for (const a of plan) for (const b of plan) if (a.n < b.n && a.paths.some(p => b.paths.includes(p)) && !before(a, b)) b.after.push(a.n);
  return plan;
}

// The planner cannot be shown a whole repository. It is shown the files the item names, their directory neighbours and the paths that share words
// with the item, most shared words first.
export function relevant(listing, text, limit = 160) {
  const paths = listing.split('\n').filter(Boolean), named = pathsIn(text);
  const dirs = new Set(named.map(p => p.slice(0, p.lastIndexOf('/') + 1)));
  const words = [...new Set((String(text).toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || []))];
  const score = p => { const l = p.toLowerCase(); return (named.includes(p) ? 100 : 0) + (dirs.has(p.slice(0, p.lastIndexOf('/') + 1)) ? 5 : 0) + words.filter(w => l.includes(w)).length; };
  return paths.map(p => [score(p), p]).filter(x => x[0] > 0).sort((x, y) => y[0] - x[0] || x[1].localeCompare(y[1])).slice(0, limit).map(x => x[1]);
}

const show = (p, t) => t == null ? `--- ${p} (does not exist yet: write it with a FILE block) ---\n`
  : `--- ${p} (${t.split('\n').length} lines${t.length > SHOWN ? ', head and tail only: change it with EDIT blocks' : ', complete'}) ---\n${t.length > SHOWN ? t.slice(0, SHOWN * 0.6) + '\n[... middle not shown ...]\n' + t.slice(-SHOWN * 0.3) : t}\n`;

export const planPrompt = (r, files) => 'You are the planning manager of an autonomous software organization. One attempt to close this work item with a single change already failed, '
  + `so split it into at most ${MAX_STEPS} small steps a code agent can each finish alone.\n\nITEM ${r.item}: ${r.title}\n${r.body || ''}\n\nREPOSITORY FILES THAT LOOK RELEVANT:\n${files.join('\n')}\n\n`
  + `Answer with one JSON object only: {"steps":[{"title":string,"paths":[string],"instructions":string,"after":[number]}]}. "paths" are the 1..${STEP_FILES} files this step creates or changes `
  + '(real paths from the list, or a new file beside them; never under .github/ or autonomy/). "after" lists the numbers of earlier steps this one needs finished first; leave it empty when the step is independent, '
  + 'so independent steps run together. Include the tests as a step. Every step must change code, tests or data that code reads.';

export const stepPrompt = (r, s, others, files, needs) => `You are one code agent on a team working this item in steps. Do only your step.\n\nITEM ${r.item}: ${r.title}\n${(r.body || '').slice(0, 2000)}\n\n`
  + `THE WHOLE PLAN:\n${others.map(o => `${o.n}. ${o.title} [${o.status}]`).join('\n')}\n\nYOUR STEP ${s.n}: ${s.title}\n${s.instructions}\n`
  + (s.findings ? `\nA REVIEWER REFUSED YOUR EARLIER ANSWER. Fix exactly this:\n${s.findings}\n` : '')
  + `\nYOU MAY WRITE ONLY: ${s.paths.join(', ')}\n\nCURRENT FILES (as the earlier steps left them):\n${files.map(f => show(f.path, f.content)).join('\n')}`
  + (needs.length ? `\nREAD-ONLY CONTEXT:\n${needs.map(f => show(f.path, f.content)).join('\n')}` : '')
  + `\nReply in exactly this format and nothing else:\n${BLOCK_FORMAT}\n`
  + (s.asked ? '' : 'If you cannot do the step without reading another existing file, reply instead with one JSON object only: {"need":["relative/path"]} (at most two paths, asked once).\n');

export const reviewPrompt = (r, steps, files) => 'You are the independent reviewer of a change other agents wrote. Judge only whether the change is correct and does what the item asks; do not ask for style changes.\n\n'
  + `ITEM ${r.item}: ${r.title}\n${(r.body || '').slice(0, 2000)}\n\nSTEPS:\n${steps.map(s => `${s.n}. ${s.title} -> ${s.paths.join(', ')}`).join('\n')}\n\n`
  + `FILES AFTER THE CHANGE:\n${files.map(f => show(f.path, f.content.length > 7000 ? f.content.slice(0, 7000) : f.content)).join('\n')}\n`
  + 'Answer with one JSON object only: {"ok":boolean,"findings":[{"step":number,"problem":string}]}. "ok" is true when nothing would break and the done check would pass; '
  + 'otherwise name the step that must change and say exactly what is wrong.';

const rowStep = s => ({ ...s, paths: J(s.paths, []), needs: J(s.needs, []), after: J(s.after, []), change: J(s.change, null), asked: J(s.needs, []).length > 0 });
const steps = async (db, id) => (await all(db, 'SELECT * FROM orch_steps WHERE run = ? ORDER BY n', id)).map(rowStep);
// The files as the steps left them, in the order the steps finished. A step sent back by the reviewer keeps its refused answer here, so its author
// corrects that answer instead of starting from the file on main.
export const overlay = ss => { const o = new Map(); for (const s of ss.filter(s => s.change).sort((a, b) => a.seq - b.seq)) for (const f of s.change) o.set(f.path, f); return o; };
// Steps that can be worked now: predecessors done, and no file shared with a step already chosen for this tick.
export function ready(ss, limit = PARALLEL) {
  const done = new Set(ss.filter(s => s.status === 'done').map(s => s.n)), taken = new Set(), out = [];
  for (const s of ss) {
    if (out.length >= limit) break;
    if (s.status !== 'pending' || !s.after.every(a => done.has(a)) || s.paths.some(p => taken.has(p))) continue;
    s.paths.forEach(p => taken.add(p)); out.push(s);
  }
  return out;
}

async function touch(db, r, now, fields) {
  const keys = Object.keys(fields);
  await run(db, `UPDATE orch_runs SET ${keys.map(k => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map(k => fields[k]), iso(now), r.id);
  return Object.assign(r, fields);
}
async function fail(db, r, now, why) {
  why = String(why).slice(0, 300);
  await touch(db, r, now, { phase: 'failed', detail: why });
  await safely(() => settlePlan(db, { run: r.id, ok: false, now }));
  await run(db, "UPDATE items SET blocker = ?, updated_at = datetime('now') WHERE id = ? AND blocker LIKE 'in-orch:%'", `needs-code: orchestrated run ${r.id} failed (${why})`.slice(0, 400), r.item);
  return { ok: false, detail: `${r.item}: orchestrated run failed (${why})` };
}
// A phase that threw is tried again next tick; the second failure of the same phase ends the run with the reason, never a silent loop.
async function retry(db, r, now, why) {
  if (r.attempts + 1 >= MAX_ATTEMPTS) return fail(db, r, now, `${r.phase}: ${why}`);
  await touch(db, r, now, { attempts: r.attempts + 1, detail: `${r.phase} failed once: ${String(why).slice(0, 200)}` });
  return { ok: false, detail: `${r.item}: ${r.phase} failed, retried next tick (${String(why).slice(0, 160)})` };
}

async function start(env, db, now) {
  const own = tenantOf(env);
  const it = await first(db, `SELECT id, title, owner_role, done_check, closing_probe, blocker FROM items WHERE status = 'blocked' AND blocker LIKE ? AND (tenant_id IS NULL OR tenant_id = ?)
    AND (SELECT COUNT(*) FROM orch_runs r WHERE r.item = items.id) < ? ORDER BY priority DESC, updated_at ASC LIMIT 1`, TRIGGER + '%', own, MAX_RUNS_PER_ITEM);
  if (!it) return null;
  const nth = (await first(db, 'SELECT COUNT(*) AS c FROM orch_runs WHERE item = ?', it.id)).c + 1;
  const id = `${slugOf(it.id)}-${iso(now).replace(/[-:T]/g, '').slice(0, 12)}-${nth}`;
  const body = `**Done check:** ${it.done_check || 'none'}\n**Closing probe:** ${it.closing_probe || 'none'}\n**Role:** ${it.owner_role}\n**The single change that failed:** ${String(it.blocker).slice(TRIGGER.length)}`;
  await run(db, 'INSERT INTO orch_runs (id, item, tenant_id, title, body, phase, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', id, it.id, own || null, it.title, body, 'plan', iso(now), iso(now));
  await run(db, "UPDATE items SET blocker = ?, updated_at = datetime('now') WHERE id = ?", `in-orch: ${id}`, it.id);
  return first(db, 'SELECT * FROM orch_runs WHERE id = ?', id);
}

// DECISION-METRIC: orchestrator-plan (the accepted plan is logged with the share of earlier runs that reached a PR as its prediction, and settled when this run ends; src/decisions.js)
async function plan(env, db, gh, r, now, agent) {
  const main = await gh.call('GET', `/repos/${gh.repo}/git/ref/heads/main`);
  const tree = main.ok ? await gh.call('GET', `/repos/${gh.repo}/git/trees/${main.json.object.sha}?recursive=1`) : main;
  if (!tree.ok) return retry(db, r, now, 'cannot list the repository: HTTP ' + tree.status);
  const listing = (tree.json.tree || []).filter(t => t.type === 'blob').map(t => t.path).join('\n');
  let p;
  try { p = validatePlan(await agent(env, planPrompt(r, relevant(listing, `${r.title}\n${r.body}`)))); }
  catch (e) { return retry(db, r, now, String(e && e.message)); }
  for (const s of p) await run(db, 'INSERT OR REPLACE INTO orch_steps (run, n, title, instructions, paths, after) VALUES (?,?,?,?,?,?)', r.id, s.n, s.title, s.instructions, JSON.stringify(s.paths), JSON.stringify(s.after));
  await touch(db, r, now, { phase: 'implement', attempts: 0, detail: `planned ${p.length} steps` });
  await safely(() => recordPlan(db, { run: r.id, steps: p.length, now }));
  return { ok: true, detail: `${r.item}: planned ${p.length} steps (${p.filter(s => !s.after.length).length} independent)` };
}

// One step, one call. Returns what to store; never writes, so steps of one tick can run together and be stored in order.
export async function workStep(env, gh, r, s, ss, over, agent) {
  const read = async p => over.has(p) ? over.get(p).content : ((await gh.file(p)) || {}).content ?? null;
  const files = [], needs = [];
  for (const p of s.paths) files.push({ path: p, content: await read(p) });
  for (const p of s.needs) { const c = await read(p); if (c != null) needs.push({ path: p, content: c }); }
  const out = await agent(env, stepPrompt(r, s, ss, files, needs));
  if (Array.isArray(out.need) && !out.files) {
    if (s.asked) throw new Error('asked for files a second time instead of doing the step');
    const more = out.need.slice(0, 2).map(safe);
    if (!more.length) throw new Error('asked for no file');
    return { needs: more };
  }
  if (!Array.isArray(out.files) || !out.files.length) throw new Error('no files in the answer');
  const change = [];
  for (const f of out.files) {
    const path = safe(f.path), before = (files.find(x => x.path === path) || {}).content;
    if (!s.paths.includes(path)) throw new Error(`wrote ${path}, which is not one of this step's files`);
    let content = f.content;
    if (typeof content !== 'string') {
      if (before == null) throw new Error(`${path}: EDIT blocks need an existing file`);
      content = before;
      for (const ed of f.edits || []) content = applyEdit(content, String(ed.find || ''), String(ed.replace || ''), path);
    }
    if (content === before) throw new Error(`${path}: the answer changes nothing`);
    shrinkGuard(path, before, content);
    change.push({ path, content, fresh: before == null || Boolean((over.get(path) || {}).fresh) });
  }
  guard(change); stubGuard(change, p => change.find(c => c.path === p).fresh);
  return { change, adapter: out.adapter || 'unknown' };
}

async function implement(env, db, gh, r, now, agent) {
  const ss = await steps(db, r.id), over = overlay(ss), batch = ready(ss);
  if (!batch.length) return fail(db, r, now, 'no step can be worked: ' + ss.filter(s => s.status !== 'done').map(s => `${s.n} ${s.status}`).join(', '));
  const results = await Promise.all(batch.map(s => workStep(env, gh, r, s, ss, over, agent).then(v => ({ s, v }), e => ({ s, e: String(e && e.message).slice(0, 300) }))));
  let seq = Math.max(0, ...ss.map(s => s.seq)), note = [];
  for (const { s, v, e } of results) {
    if (e) {
      const dead = s.attempts + 1 >= MAX_ATTEMPTS;
      await run(db, 'UPDATE orch_steps SET attempts = attempts + 1, status = ?, error = ? WHERE run = ? AND n = ?', dead ? 'failed' : 'pending', e, r.id, s.n);
      note.push(`${s.n} ${dead ? 'failed' : 'retry'}`);
      if (dead) return fail(db, r, now, `step ${s.n} (${s.title}): ${e}`);
    } else if (v.needs) {
      await run(db, 'UPDATE orch_steps SET needs = ? WHERE run = ? AND n = ?', JSON.stringify(v.needs), r.id, s.n); note.push(`${s.n} reads ${v.needs.join(', ')}`);
    } else {
      await run(db, "UPDATE orch_steps SET status = 'done', seq = ?, change = ?, adapter = ?, error = NULL WHERE run = ? AND n = ?", ++seq, JSON.stringify(v.change), v.adapter, r.id, s.n); note.push(`${s.n} done`);
    }
  }
  const left = (await steps(db, r.id)).filter(s => s.status !== 'done').length;
  await touch(db, r, now, { phase: left ? 'implement' : 'verify', attempts: 0, detail: `steps ${note.join('; ')}` });
  return { ok: true, detail: `${r.item}: worked ${batch.length} step(s) together (${note.join('; ')}), ${left} left` };
}

// VERIFIED means an independent path: the reviewer is never a model that wrote a step, when another one exists.
export const reviewers = authors => { const other = ADAPTERS.filter(a => !authors.includes(a.id)); return other.length ? other : ADAPTERS; };

async function verify(env, db, r, now, agent) {
  const ss = await steps(db, r.id), files = [...overlay(ss).values()];
  let out;
  try { out = await agent(env, reviewPrompt(r, ss, files), reviewers(ss.map(s => s.adapter))); if (typeof out.ok !== 'boolean') throw new Error('the reviewer gave no verdict'); }
  catch (e) {
    if (r.attempts + 1 < MAX_ATTEMPTS) return retry(db, r, now, String(e && e.message));
    // No reviewer answered twice. The change is not called reviewed: the PR says so and the repository's checks stay the gate.
    await touch(db, r, now, { phase: 'integrate', attempts: 0, review: 'not run: ' + String(e && e.message).slice(0, 160) });
    return { ok: true, detail: `${r.item}: no reviewer answered; integrating with the review recorded as not run` };
  }
  const found = (Array.isArray(out.findings) ? out.findings : []).filter(f => f && ss.some(s => s.n === Number(f.step)) && String(f.problem || '').trim());
  if (out.ok || !found.length) {
    await touch(db, r, now, { phase: 'integrate', attempts: 0, review: `passed by ${out.adapter || 'reviewer'} after ${r.round} fix round(s)` });
    return { ok: true, detail: `${r.item}: review passed after ${r.round} fix round(s)` };
  }
  const text = found.map(f => `step ${Number(f.step)}: ${String(f.problem).slice(0, 300)}`).join('; ');
  if (r.round >= MAX_ROUNDS) return fail(db, r, now, `review findings survived ${MAX_ROUNDS} fix rounds: ${text}`);
  for (const n of new Set(found.map(f => Number(f.step)))) await run(db, "UPDATE orch_steps SET status = 'pending', attempts = 0, findings = ? WHERE run = ? AND n = ?", found.filter(f => Number(f.step) === n).map(f => String(f.problem).slice(0, 600)).join('\n'), r.id, n);
  await touch(db, r, now, { phase: 'implement', attempts: 0, round: r.round + 1, detail: `fix round ${r.round + 1}: ${text}`.slice(0, 400) });
  return { ok: true, detail: `${r.item}: reviewer refused ${found.length} point(s); fix round ${r.round}` };
}

async function integrate(db, gh, r, now) {
  const ss = await steps(db, r.id), files = [...overlay(ss).values()];
  try { substanceGuard(files, p => files.find(f => f.path === p).fresh); } catch (e) { return fail(db, r, now, String(e && e.message)); }
  const authors = [...new Set(ss.map(s => s.adapter).filter(Boolean))].join(', ');
  const deploy = deployFor(files.map(f => f.path));
  const extra = `\n## Orchestrated run\n${ss.map(s => `${s.n}. ${s.title} (${s.paths.join(', ')})`).join('\n')}\nReview: ${r.review || 'not run'}\n\n## Handoff\nitem: ${r.item}\nagent: worker-orchestrator (${authors})\n${deploy ? `deploy: ${deploy}\n` : ''}`;
  const pr = await openPr(gh, { id: r.item, branch: `worker/${slugOf(r.item)}-orch-${iso(now).replace(/[-:T]/g, '').slice(0, 12)}`, title: r.title, extraBody: extra,
    change: { files, summary: `${ss.length} planned steps: ${ss.map(s => s.title).join('; ')}`.slice(0, 300), adapter: `worker-orchestrator (${authors})` } });
  if (!pr.ok) return retry(db, r, now, pr.detail);
  await touch(db, r, now, { phase: 'done', pr_url: pr.url, detail: pr.detail });
  await safely(() => settlePlan(db, { run: r.id, ok: true, now }));
  await run(db, "UPDATE items SET blocker = ?, updated_at = datetime('now') WHERE id = ?", `in-pr: ${pr.url} | agent: worker-orchestrator | model: ${authors}`.slice(0, 400), r.item);
  return { ok: true, detail: `${pr.detail} (${ss.length} steps, ${r.round} fix round(s))`, pr: pr.url };
}

// One tick, one phase of the oldest unfinished run of this tenant; with none, the next item the single-shot lane failed starts a run.
export async function advance(env, { fetchImpl = fetch, agent = runCodeAgent, now = Date.now() } = {}) {
  const db = env.DB;
  if (!db) return { ok: true, idle: true, detail: 'idle: no DB binding' };
  const own = tenantOf(env);
  let r = await first(db, "SELECT * FROM orch_runs WHERE phase NOT IN ('done','failed') AND (tenant_id IS NULL OR tenant_id = ?) ORDER BY created_at LIMIT 1", own || null);
  if (r && now - Date.parse(r.updated_at) > STALE_MS) { await fail(db, r, now, `no phase finished in ${STALE_MS / 3600000} h (stopped at ${r.phase})`); r = null; }
  if (!r) r = await start(env, db, now);
  if (!r) return { ok: true, idle: true, detail: 'idle: no item the single-shot executor failed is waiting for a planned run' };
  const gh = github(env, fetchImpl);
  try {
    if (r.phase === 'plan') return await plan(env, db, gh, r, now, agent);
    if (r.phase === 'implement') return await implement(env, db, gh, r, now, agent);
    if (r.phase === 'verify') return await verify(env, db, r, now, agent);
    if (r.phase === 'integrate') return await integrate(db, gh, r, now);
    return await fail(db, r, now, 'unknown phase ' + r.phase);
  } catch (e) { return retry(db, r, now, String(e && e.message)); }
}

export const orchestrateProvider = {
  id: 'worker-orchestrator',
  available: env => Boolean(env.GITHUB_DISPATCH_TOKEN && env.AI && env.DB),
  async dispatch(env, fetchImpl = fetch) { return advance(env, { fetchImpl }); },
};
