// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-10 conformance for the bootstrapper. The Python tests in tests/ prove the same behaviour but the conformance manifest only
// reads JavaScript test titles, so this suite drives bootstrap/bootstrap.py as a subprocess in a throwaway copy of the tree, with
// every credential removed from its environment, and cites each requirement and test id in its titles.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../adapters/sqlite/d1-sqlite.js';
import { runTick } from '../src/tick.js';
import { buildConsole } from '../src/console.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = join(REPO, 'adapters', 'cloudflare', 'migrations');
const CREDENTIAL_ENV = /^(CLOUDFLARE_|GITHUB_|GH_|ANTHROPIC_|ORG_ADMIN_TOKEN|ULTRASTABLE_|CLAUDE_CODE_REMOTE|CHAT_WEBHOOK_URL|MODEL_API_KEY|VCS_TOKEN)/;
const IGNORE = new Set(['.stubs', '.git', 'node_modules', 'org', '__pycache__', 'wrangler.jsonc', 'config.js']);

let root, stubs;
before(() => {
  root = mkdtempSync(join(tmpdir(), 'us-spec10-'));
  // Apply mode asks `npx wrangler whoami`. A stub npx answers as a machine with no hosting sign-in, so no test downloads or contacts anything.
  stubs = join(root, '.stubs');
  mkdirSync(stubs);
  writeFileSync(join(stubs, 'npx'), '#!/bin/sh\necho "You are not authenticated. Please run wrangler login."\nexit 0\n');
  chmodSync(join(stubs, 'npx'), 0o755);
  cpSync(REPO, root, { recursive: true, filter: src => !IGNORE.has(src.split(/[\\/]/).pop()) });
});
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

const TOOL_SHARE = ({ outcomes = ['A landing page that explains the idea', 'A booking prototype that ten neighbours try'], budget = 50, constraints = [], name = 'Tool Share' } = {}) => `---
org_name: ${name}
slug: ${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
owner: Test Owner
owner_contact: set-in-secret-store
---

# Idea

A neighbourhood tool library where people borrow tools instead of buying them, booked from a phone.

# Who it is for

- Renters and new homeowners who need a tool once or twice a year

# First outcomes

${outcomes.map(o => `- ${o}`).join('\n')}

# Constraints

- Budget per month: ${budget} USD
${constraints.map(c => `- ${c}`).join('\n')}
`;

function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!CREDENTIAL_ENV.test(k)) env[k] = v;
  return { ...env, PATH: `${stubs}${delimiter}${env.PATH || ''}`, ...extra };
}

/** Run bootstrap/bootstrap.py in the throwaway tree. idea=null removes IDEA.md; undefined keeps the stock one. */
function boot({ idea, args = ['--dry-run'], env = {} } = {}) {
  rmSync(join(root, 'org'), { recursive: true, force: true });
  if (idea === null) rmSync(join(root, 'IDEA.md'), { force: true });
  else if (idea !== undefined) writeFileSync(join(root, 'IDEA.md'), idea);
  else cpSync(join(REPO, 'IDEA.md'), join(root, 'IDEA.md'));
  const p = spawnSync(process.env.PYTHON || 'python3', ['bootstrap/bootstrap.py', '--root', root, ...args], { cwd: root, env: cleanEnv(env), encoding: 'utf8' });
  const org = name => readFileSync(join(root, 'org', name), 'utf8');
  return { status: p.status, stdout: p.stdout, stderr: p.stderr, org, json: name => JSON.parse(org(name)) };
}

function snapshot(dir) {
  const out = {};
  const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out[p.slice(dir.length)] = readFileSync(p, 'utf8'); } };
  walk(dir);
  return out;
}
const maskTime = s => s.replace(/\d{4}-\d{2}-\d{2}(?:[T ][\d:.+Z-]+)?/g, 'TIME');
// The measured free disk space (surfaces.disk_free_gb in the boot log) moves whenever anything else writes to disk between the two runs; it is
// a reading, not something the run wrote, so it is masked like a timestamp and every other byte of every written file is still compared.
const maskMeasured = s => s.replace(/("disk_free_gb"\s*:\s*)-?\d+(?:\.\d+)?/g, '$1MEASURED');

const COUNTED = ['org', 'roles', 'items', 'gate_cards', 'trust_ledger', 'predictions', 'doctrine_lineage'];
function seeded(sql) {
  const db = openDb(':memory:', MIGRATIONS);
  db.raw.exec(sql);
  return db;
}
const counts = db => Object.fromEntries(COUNTED.map(t => [t, db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));

test('US-10-T01 / US-10-R04: two dry runs write the same files and the seed applied twice changes nothing', () => {
  const idea = TOOL_SHARE();
  const a = boot({ idea });
  assert.equal(a.status, 0, a.stderr);
  const first = snapshot(join(root, 'org'));
  const config = readFileSync(join(root, 'adapters/cloudflare/src/config.js'), 'utf8');
  const b = boot({ idea });
  assert.equal(b.status, 0, b.stderr);
  const second = snapshot(join(root, 'org'));
  assert.deepEqual(Object.keys(second).sort(), Object.keys(first).sort());
  for (const f of Object.keys(first)) assert.equal(maskMeasured(maskTime(second[f])), maskMeasured(maskTime(first[f])), `${f} differs between runs`);
  assert.equal(readFileSync(join(root, 'adapters/cloudflare/src/config.js'), 'utf8'), config);
  const sql = b.org('seed.sql');
  for (const line of sql.split('\n').filter(l => l.trim() && !l.startsWith('--'))) assert.match(line, /^INSERT OR IGNORE INTO /, 'the seed holds inserts only');
  const db = seeded(sql);
  const once = counts(db);
  db.raw.exec(sql);
  assert.deepEqual(counts(db), once, 'a second application leaves identical row counts');
  assert.ok(once.trust_ledger > 0 && once.roles > 0 && once.items > 0 && once.gate_cards > 0);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM trust_ledger WHERE reliability != 0.5 OR outcomes != 0`).get().n, 0, 'trust rows start at the baseline with no outcomes');
  db.close();
});

test('US-10-T02 / US-10-R05 / US-10-R02: apply without credentials is a blocked backlog item, a dry run needs none', () => {
  const dry = boot({ idea: TOOL_SHARE() });
  assert.equal(dry.status, 0, dry.stderr);
  for (const f of ['charter.md', 'roles.json', 'backlog.json', 'gate-cards.json', 'seed.sql', 'boot-log.json']) assert.ok(existsSync(join(root, 'org', f)), f);
  const apply = boot({ idea: TOOL_SHARE(), args: ['--apply'] });
  assert.equal(apply.status, 2, apply.stderr);
  const item = apply.json('backlog.json').find(i => i.id === 'BOOT-PROVISION');
  assert.ok(item, 'the blocked stage became a backlog item');
  assert.equal(item.owner_role, 'operations');
  assert.equal(item.priority, 0);
  assert.ok(item.closing_probe);
  const stages = apply.json('boot-log.json').stages.map(s => s.stage);
  assert.ok(stages.includes('start'), 'the boot continued after the blocked stage');
  assert.match(apply.org('seed.sql'), /BOOT-PROVISION/);
});

test('US-10-T03 / US-10-R03: a planted secret value never reaches a file the bootstrapper writes', () => {
  const secret = `SECRET-VALUE-${Math.random().toString(36).slice(2)}`;
  const env = { CLOUDFLARE_API_TOKEN: secret, ANTHROPIC_API_KEY: secret, GITHUB_TOKEN: secret };
  const r = boot({ idea: TOOL_SHARE(), env });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret));
  const all = { ...snapshot(join(root, 'org')), config: readFileSync(join(root, 'adapters/cloudflare/src/config.js'), 'utf8'), wrangler: readFileSync(join(root, 'adapters/cloudflare/wrangler.jsonc'), 'utf8') };
  for (const [f, text] of Object.entries(all)) assert.ok(!text.includes(secret), `${f} holds the secret value`);
  assert.equal(r.json('boot-log.json').surfaces.cloudflare_token, true, 'the boot log records presence only');
});

test('US-10-T04 / US-10-R07: a missing idea file degrades the boot into an empty charter and one card', () => {
  const r = boot({ idea: null });
  assert.equal(r.status, 0, r.stderr);
  const read = r.json('boot-log.json').stages.find(s => s.stage === 'read');
  assert.equal(read.status, 'degraded');
  assert.ok(r.json('gate-cards.json').some(c => c.id === 'GATE-IDEA'));
  assert.match(r.org('charter.md'), /\(not written yet\)/);
});

test('US-10-T05: budget picks the model tier and the role-instance count follows the outcomes', () => {
  const ladder = JSON.parse(readFileSync(join(REPO, 'ultrastable.json'), 'utf8')).model_ladder;
  const tiers = [...ladder.tiers].sort((x, y) => x.budget_usd_per_month_min - y.budget_usd_per_month_min);
  for (const budget of [0, 50, 500]) {
    const tier = tiers.filter(t => budget >= t.budget_usd_per_month_min).pop();
    const r = boot({ idea: TOOL_SHARE({ budget }) });
    assert.equal(r.status, 0, r.stderr);
    const charter = r.org('charter.md');
    for (const k of ['doer', 'manager']) assert.ok(charter.includes(`- ${k}: ${ladder.aliases[tier[k]]}`), `budget ${budget}: ${k} should be ${ladder.aliases[tier[k]]}`);
  }
  for (const k of [1, 2, 3]) {
    const outcomes = Array.from({ length: k }, (_, i) => `Outcome number ${i + 1}`);
    for (const [budget, extra] of [[50, 6], [0, 4]]) {
      const roles = boot({ idea: TOOL_SHARE({ outcomes, budget }) }).json('roles.json');
      assert.equal(roles.length, 2 * k + extra, `${k} outcome(s) at budget ${budget}`);
    }
  }
});

test('US-10-T06 / US-10-R34: the nothing-public constraint adds KIT-6 at priority 5 and no id repeats in the backlog', () => {
  const plain = boot({ idea: TOOL_SHARE() }).json('backlog.json');
  assert.ok(!plain.some(i => i.id === 'KIT-6'));
  const held = boot({ idea: TOOL_SHARE({ constraints: ['Nothing public until the owner says so'] }) });
  const items = held.json('backlog.json');
  assert.equal(items.find(i => i.id === 'KIT-6').priority, 5);
  assert.match(held.org('seed.sql'), /rule_no_public/);
  for (const list of [plain, items]) {
    const ids = list.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate backlog id in ${ids.join(',')}`);
  }
});

test('US-10-R01: the stock tree with only IDEA.md replaced boots with no other edit', () => {
  const r = boot({ idea: TOOL_SHARE() });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.org('charter.md'), /Tool Share/);
});

test('US-10-R06: every gate card carries a default in effect and a closing probe, in a dry run and in apply', () => {
  for (const args of [['--dry-run'], ['--apply']]) {
    const r = boot({ idea: TOOL_SHARE(), args });
    const cards = r.json('gate-cards.json');
    assert.ok(cards.length > 0);
    for (const c of cards) {
      assert.ok(c.default_in_effect && c.closing_probe, `${args[0]}: ${c.id}`);
      assert.ok(c.what && c.why_gated && c.prepared_by_fleet, `${args[0]}: ${c.id} is complete`);
    }
    const seeded_ids = new Set([...r.org('seed.sql').matchAll(/INSERT OR IGNORE INTO gate_cards \(.*?\) VALUES \('([^']+)'/g)].map(m => m[1]));
    assert.deepEqual([...seeded_ids].sort(), cards.map(c => c.id).sort(), 'every card is also seeded');
  }
});

test('US-10-R08: the seed predicts six complete ticks in an hour and the thirteenth tick scores it a hit with six observed', async () => {
  const r = boot({ idea: TOOL_SHARE() });
  const db = seeded(r.org('seed.sql'));
  const p = db.raw.prepare(`SELECT metric, op, target, verdict FROM predictions WHERE id = 'P-KIT-3'`).get();
  assert.deepEqual({ ...p }, { metric: 'tick_runs_completed_1h', op: '>=', target: 6, verdict: null });
  const policy = JSON.parse(readFileSync(join(REPO, 'autonomy', 'policy.json'), 'utf8'));
  const config = { policy: { trust: policy.trust, ladder: policy.ladder, surfaces: policy.surfaces } };
  const start = Date.now(); // after the seed, so its due_at (two hours after seeding, to the second) is not later than the thirteenth tick
  for (let k = 0; k < 13; k++) {
    const t = await runTick(db, { config, now: start + k * 10 * 60 * 1000 });
    assert.equal(t.completed, t.total, `tick ${k + 1} completed every step: ${t.errors.join(' | ')}`);
    const row = db.raw.prepare(`SELECT verdict, observed FROM predictions WHERE id = 'P-KIT-3'`).get();
    if (k < 12) assert.equal(row.verdict, null, `not due at tick ${k + 1}`);
    else assert.deepEqual({ ...row }, { verdict: 'hit', observed: 6 });
  }
  db.close();
});

test('US-10-R09: the committed templates hold no tenant value and a second org shows nothing of the first', () => {
  const first = boot({ idea: TOOL_SHARE({ name: 'Tool Share' }) });
  assert.equal(first.status, 0, first.stderr);
  const second = boot({ idea: TOOL_SHARE({ name: 'Acme Drills' }) });
  assert.equal(second.status, 0, second.stderr);
  const written = { ...snapshot(join(root, 'org')), 'wrangler.jsonc': readFileSync(join(root, 'adapters/cloudflare/wrangler.jsonc'), 'utf8'), 'config.js': readFileSync(join(root, 'adapters/cloudflare/src/config.js'), 'utf8') };
  for (const [f, text] of Object.entries(written)) assert.ok(!/tool[ -]share/i.test(text), `${f} still names the first org`);
  assert.match(written['/charter.md'], /Acme Drills/);
  const template = readFileSync(join(REPO, 'adapters/cloudflare/wrangler.template.jsonc'), 'utf8');
  assert.ok(!/tool[ -]share|acme|example-co/i.test(template), 'the template carries placeholders only');
});

test('US-10-R10: the reviewer is designated from a different family than the doer when the budget allows two', () => {
  const roles = boot({ idea: TOOL_SHARE({ budget: 50 }) }).json('roles.json');
  const fam = role => new Set(roles.filter(r => r.role === role).map(r => r.family));
  const doer = fam('staff'), reviewer = fam('reviewer');
  assert.ok(doer.size && reviewer.size);
  for (const f of reviewer) assert.ok(!doer.has(f), `reviewer family ${f} is also a doer family`);
  const none = boot({ idea: TOOL_SHARE({ budget: 0 }) });
  assert.match(none.org('charter.md'), /known limit/, 'at a budget of 0 the shared family is stated, not hidden');
});

test('US-10-R15: every card has plain words, no card names a variable, and the owner README shows those words', () => {
  const r = boot({ idea: TOOL_SHARE() });
  const cards = r.json('gate-cards.json');
  const readme = r.org('README.md');
  for (const c of cards) {
    assert.ok(c.say, `${c.id} has no plain-words line`);
    assert.ok(!/[A-Z][A-Z0-9]+_[A-Z0-9_]+/.test(c.say) && !/token|secret|wrangler|command/i.test(c.say), c.say);
    assert.ok(readme.includes(c.say), `${c.id} is missing from the owner README`);
  }
});

test('US-10-R15: the console shows each gate card in the plain-words lines, from the seeded database, with no variable name and no capability jargon', async () => {
  const r = boot({ idea: TOOL_SHARE() });
  assert.equal(r.status, 0, r.stderr);
  const cards = r.json('gate-cards.json');
  const db = seeded(r.org('seed.sql'));
  const screens = await buildConsole(db, { org: 'Tool Share' });
  const shown = screens.needs_you.cards;
  assert.ok(shown.some(c => c.id === 'GATE-BUDGET'), 'the console shows the cards the owner-ask guard leaves open (a credential ask is closed on insert and routed to staff)');
  for (const shownCard of shown) {
    const card = cards.find(c => c.id === shownCard.id);
    assert.ok(card?.say && card.say_default, `${shownCard.id} carries both plain-words lines`);
    assert.equal(shownCard.what, card.say, `${shownCard.id}: the console reads the plain-words line`);
    assert.equal(shownCard.default_in_effect, card.say_default, `${shownCard.id}: the console reads the plain-words default`);
    for (const text of [shownCard.what, shownCard.default_in_effect]) {
      assert.ok(!/[A-Z][A-Z0-9]+_[A-Z0-9_]+/.test(text) && !/dry[- ]run|wrangler|\btoken\b|\bsecret\b/i.test(text), `${shownCard.id}: "${text}"`);
    }
    assert.equal(shownCard.closing_probe, card.closing_probe, 'the machine probe is untouched');
  }
  // every seeded row, shown or closed by the guard, holds the plain-words lines in the columns the console and the tick read
  for (const row of db.raw.prepare('SELECT id, what, default_in_effect FROM gate_cards').all()) {
    const card = cards.find(c => c.id === row.id);
    assert.equal(row.what, card.say, `${row.id}: the seeded row holds the plain-words line`);
    assert.equal(row.default_in_effect, card.say_default, `${row.id}: the seeded row holds the plain-words default`);
  }
  // the machine text is kept for agents in gate-cards.json, where the binding name still shows
  assert.ok(cards.some(c => /ANTHROPIC_API_KEY|CLOUDFLARE_API_TOKEN/.test(c.what)));
});

test('US-10-R15: the owner README lists the plain-words default for every card, never the capability names', () => {
  const r = boot({ idea: TOOL_SHARE() });
  const readme = r.org('README.md');
  const own = readme.slice(0, readme.indexOf('## What this is'));
  for (const c of r.json('gate-cards.json')) assert.ok(own.includes(c.say_default), `${c.id} default is missing from the README`);
  assert.ok(!/dry[- ]run|stay in dry|runtime, dns|\brepo stay/i.test(own), 'no capability class or mode name in the owner part');
  assert.ok(!/paste it|Paste a key|private code from another service/i.test(readme), 'the help sections no longer tell a person to paste a key');
});

test('US-10-R02: an invalid policy blocks the read stage, seeds no trust row above the lowest rung and is never applied', () => {
  const policyPath = join(root, 'autonomy', 'policy.json');
  const original = readFileSync(policyPath, 'utf8');
  try {
    const bad = JSON.parse(original);
    bad.surfaces.money.start_rung = 'autonomous';
    bad.surfaces.repo.start_rung = 'delegated';  // valid on its own, still not seeded while the policy as a whole is invalid
    writeFileSync(policyPath, JSON.stringify(bad));
    const dry = boot({ idea: TOOL_SHARE() });
    assert.equal(dry.status, 2);
    const stages = Object.fromEntries(dry.json('boot-log.json').stages.map(s => [s.stage, s]));
    assert.equal(stages.read.status, 'blocked');
    assert.match(stages.read.detail, /policy invalid/);
    const lowest = bad.ladder.rungs[0];
    const db = seeded(dry.org('seed.sql'));
    const above = db.raw.prepare(`SELECT surface, action_class, rung FROM trust_ledger WHERE rung != ?`).all(lowest);
    assert.deepEqual(above, [], 'no trust row starts above the lowest rung when the policy is invalid');
    assert.ok(db.raw.prepare(`SELECT COUNT(*) AS n FROM trust_ledger`).get().n > 0, 'the rows are still seeded, at the lowest rung');
    const applied = boot({ idea: TOOL_SHARE(), args: ['--apply'] });
    assert.equal(applied.status, 2);
    const ap = Object.fromEntries(applied.json('boot-log.json').stages.map(s => [s.stage, s]));
    for (const stage of ['provision', 'start']) {
      assert.equal(ap[stage].status, 'blocked', `${stage} must not run against an invalid policy`);
      assert.match(ap[stage].detail, /policy invalid, not applied/);
    }
  } finally {
    writeFileSync(policyPath, original);
  }
});

test('T19-6 / US-19-R17: the bootstrapped organization has an owner README with its five parts in order, in plain words', () => {
  const r = boot({ idea: TOOL_SHARE({ budget: 50 }) });
  const readme = r.org('README.md');
  const heads = ['## The idea', '## What is running', '## What it costs and what stops it', '## What only you can do', '## How to stop and delete it'].map(h => readme.indexOf(h));
  assert.ok(heads.every(i => i >= 0), `a part is missing: ${heads}`);
  assert.deepEqual(heads, [...heads].sort((a, b) => a - b));
  const own = readme.slice(0, readme.indexOf('## What this is'));
  assert.ok(!/[A-Z][A-Z0-9]+_[A-Z0-9_]+|wrangler|\.json|`/.test(own), 'no variable, command or file name outside the help sections');
  assert.match(readme, /up to 50 USD a month/);
  const free = boot({ idea: TOOL_SHARE({ budget: 0 }) }).org('README.md');
  assert.match(free, /limit of zero/);
});
