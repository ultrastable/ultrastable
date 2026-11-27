// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DEPLOY-BUTTON-1: the kit root carries one committed, placeholder-free wrangler.jsonc and a package.json, so the Deploy to Cloudflare button,
// Workers Builds and `npm run deploy` build the system from a fresh copy: the build writes worker/src/config.js even while IDEA.md is still the
// template's example (nobody staffed), and the deploy script deploys first, which creates the database, then applies the migrations by binding.
// The bootstrap route renders worker/wrangler.template.jsonc instead; the two are held to the same settings here. The root files ship with the
// template and the copies made from it; a system the platform hosts receives worker/ by platform-sync but not the root files, so these tests skip
// there. MIGRATE-FIRST-1: when the tick's config carries the migrations (the core tick's config does), a database that is still empty gets its
// schema from the tick before the heartbeat row, so the first tick completes and /health's condition holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdtempSync, cpSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeDb } from './d1shim.js';
import { runTick, lastTickForHealth, STEP_ORDER } from '../src/tick.js';

const kit = new URL('../../', import.meta.url);
const kitDir = fileURLToPath(kit);
const has = (p) => existsSync(new URL(p, kit));
const text = (p) => readFileSync(new URL(p, kit), 'utf8');
const json = (p) => JSON.parse(text(p));

// JSONC as wrangler reads it: // and /* */ comments and trailing commas outside strings are dropped (a regex would cut the https:// in a string).
function parseJsonc(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') { let j = i + 1; while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1; out += src.slice(i, j + 1); i = j + 1; }
    else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
    else if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; }
    else { out += c; i++; }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const PLACEHOLDER = /\{[a-z_]+\}/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const manifest = has('ultrastable.json') ? json('ultrastable.json') : {};
const layer = (manifest.identity || {}).layer;
const hasRoot = has('wrangler.jsonc') && has('package.json');
// The template must carry the root files (it fails below when it does not); a seeded system without them deploys through the bootstrap route.
const button = { skip: !hasRoot && layer !== 'template' && 'no root wrangler.jsonc: this system deploys through the bootstrap route; the root config ships with the template and its copies' };
const rootConfig = () => {
  assert.ok(hasRoot, 'the template carries wrangler.jsonc and package.json at its root, or the Deploy to Cloudflare button has nothing to build');
  const src = text('wrangler.jsonc');
  return { src, root: parseJsonc(src) };
};

test('DEPLOY-BUTTON-1: the root wrangler.jsonc parses, holds no placeholder and needs nothing a person fills in', button, () => {
  const { src, root } = rootConfig();
  assert.ok(!PLACEHOLDER.test(src), 'no {placeholder} token: the button and wrangler read this file as it is committed');
  assert.equal(root.$schema, './node_modules/wrangler/config-schema.json');
  for (const k of ['name', 'main', 'compatibility_date']) assert.equal(typeof root[k], 'string', k);
  assert.match(root.name, /^[a-z0-9][a-z0-9-]{0,62}$/, 'a Worker name Cloudflare accepts');
  assert.ok(has(root.main), `main ${root.main} exists`);
  assert.match(root.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(root.workers_dev, true, 'BOOT-4: the public surfaces answer from the first deploy');
  for (const cron of root.triggers.crons) assert.equal(cron.trim().split(/\s+/).length, 5, `cron "${cron}" has five fields`);
  assert.deepEqual(root.ai, { binding: 'AI' }, 'the account\'s own models: no model key is asked of anyone');
  assert.equal(root.secrets, undefined, 'no secrets.required: a missing secret would fail the deploy and the button would ask the person for it');
  assert.equal(root.d1_databases.length, 1);
  const d1 = root.d1_databases[0];
  assert.equal(d1.binding, 'DB');
  assert.ok(d1.database_id === undefined || UUID.test(d1.database_id), 'no database_id (created on the first deploy) or a real one the button wrote back');
  const dir = new URL(d1.migrations_dir + '/', kit);
  const sql = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  assert.ok(sql.length > 0, 'migrations_dir holds the .sql files wrangler applies');
  assert.deepEqual([...json(d1.migrations_dir + '/index.json')].sort(), sql, 'the files wrangler applies are the files the tick applies');
  if (layer === 'template') {  // a copy keeps the names its deploy gave it (the button lets the person rename both)
    const slug = manifest.identity.slug;
    assert.equal(root.name, manifest.runtime.worker_name.replace('{slug}', slug), 'the template\'s default comes from its own identity');
    assert.equal(d1.database_name, manifest.runtime.d1_database.replace('{slug}', slug));
    assert.equal(d1.database_name, root.name, 'TENANT-SANDBOX-1: the database is named after its own Worker, so two systems in one account never share one');
  }
});

test('DEPLOY-BUTTON-1: the root config and the bootstrap route\'s template keep one set of settings', button, () => {
  const { root } = rootConfig();
  const values = { slug: manifest.identity.slug, worker_name: 'w', d1_database: 'd', d1_database_id: '00000000-0000-4000-8000-000000000000',
    tick_cron: manifest.runtime.tick_cron, workers_dev: 'true', public_health_only: '0' };
  const tpl = parseJsonc(text('worker/wrangler.template.jsonc').replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m)));
  const fromWorker = (p) => new URL(p, new URL('worker/', kit)).href, fromRoot = (p) => new URL(p, kit).href;
  assert.equal(fromRoot(root.main), fromWorker(tpl.main), 'the same entry module');
  assert.equal(fromRoot(root.d1_databases[0].migrations_dir + '/'), fromWorker(tpl.d1_databases[0].migrations_dir + '/'), 'the same migrations');
  assert.equal(root.compatibility_date, tpl.compatibility_date);
  assert.deepEqual(root.triggers.crons, [manifest.runtime.tick_cron], 'the tick cron of ultrastable.json');
  assert.deepEqual(root.triggers.crons, tpl.triggers.crons);
  assert.equal(root.d1_databases[0].binding, tpl.d1_databases[0].binding);
  assert.deepEqual(root.ai, tpl.ai);
  assert.deepEqual(root.observability, tpl.observability);
  assert.deepEqual(Object.keys(root.vars).sort(), Object.keys(tpl.vars).sort(), 'the same variables');
  if (layer === 'template') assert.equal(root.vars.PUBLIC_HEALTH_ONLY, '0', 'a copy deployed by the button serves its whole public surface');
});

test('DEPLOY-BUTTON-1: the root package.json pins wrangler, deploys before it migrates by binding, and describes every binding', button, () => {
  const { root } = rootConfig();
  const pkg = json('package.json');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.deepEqual(Object.keys(pkg.dependencies || {}), [], 'nothing ships with the Worker but its own code');
  assert.deepEqual(Object.keys(pkg.devDependencies), ['wrangler'], 'one tool, the one the button and Workers Builds run');
  const v = pkg.devDependencies.wrangler;
  assert.match(v, /^\d+\.\d+\.\d+$/, 'an exact version, so every build runs the same wrangler');
  const [maj, min] = v.split('.').map(Number);
  assert.ok(maj > 4 || (maj === 4 && min >= 45), `wrangler ${v} creates a binding's database on deploy (4.45.0 or later)`);
  // `wrangler d1 migrations apply` looks the database up by name and fails on a copy that was never deployed; `wrangler deploy` creates it (or
  // links the one of that name), so the deploy comes first and the migrations follow by binding on every route.
  assert.equal(pkg.scripts.deploy, 'wrangler deploy && wrangler d1 migrations apply DB --remote', 'deploy first, then migrate by binding name');
  const build = pkg.scripts.build.split(/\s+/);
  assert.ok(has(build[1]), `the build step ${build[1]} exists`);
  assert.ok(build.includes('--real'), 'CLONE-PATH-1: a build never staffs the template\'s example idea');
  assert.ok(!build.includes('--apply'), 'the build only writes files; the deploy command deploys');
  for (const part of pkg.scripts.test.split('&&').map(s => s.trim().split(/\s+/))) {
    if (part[0] === 'node') assert.ok(has(part[1]), `${part[1]} exists`);
  }
  const names = ['DB', ...(root.ai ? [root.ai.binding] : []), ...Object.keys(root.vars || {})].sort();
  assert.deepEqual(Object.keys(pkg.cloudflare.bindings).sort(), names, 'one plain description per binding and variable in wrangler.jsonc');
  for (const [k, b] of Object.entries(pkg.cloudflare.bindings)) assert.ok(typeof b.description === 'string' && b.description.length >= 20, `${k} is described`);
});

// What a fresh copy is before its first build: no generated config, no org/ and nothing installed.
const NOT_COPIED = new Set(['.git', 'node_modules', 'org', '__pycache__', '.wrangler', 'worker/src/config.js', 'worker/wrangler.jsonc']);
function freshCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-button-'));
  cpSync(kitDir, dir, { recursive: true, filter: (src) => {
    const rel = relative(kitDir, src).split(sep).join('/');
    return !rel || !(NOT_COPIED.has(rel) || rel.split('/').some(p => NOT_COPIED.has(p)));
  } });
  copyFileSync(join(dir, 'tests/fixtures/IDEA.example.md'), join(dir, 'IDEA.md'));  // the template's own IDEA.md, as the button copies it
  return dir;
}
function build(dir) {
  const env = { ...process.env, GITHUB_REPOSITORY: 'ada/my-system' };
  for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'ORG_ADMIN_TOKEN', 'GH_ORG_TOKEN']) delete env[k];
  const r = spawnSync('sh', ['-c', JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts.build], { cwd: dir, env, encoding: 'utf8', timeout: 180e3 });
  assert.equal(r.status, 0, `the build exits 0\n${r.stdout}\n${r.stderr}`);
  return r;
}

test('DEPLOY-BUTTON-1: a fresh copy builds as it stands, runs with nobody staffed, and staffs only the owner\'s own idea', button, async () => {
  rootConfig();
  const dir = freshCopy();
  try {
    build(dir);
    const cfgPath = join(dir, 'worker/src/config.js');
    assert.ok(existsSync(cfgPath), 'the build writes worker/src/config.js while IDEA.md is still the example: worker/src/index.js imports it, so without it the deploy cannot bundle');
    const cfg = (await import(pathToFileURL(cfgPath).href + '?waiting')).default;
    assert.equal(cfg.managers ?? null, null, 'nobody is staffed for the template\'s example (CLONE-PATH-1)');
    assert.ok(!existsSync(join(dir, 'org/roles.json')) && !existsSync(join(dir, 'org/seed.sql')), 'no roles, no seed rows');
    await import(pathToFileURL(join(dir, 'worker/src/index.js')).href);  // every module the bundle needs resolves, ./config.js included
    // The deploy script applies the migrations right after the deploy (makeDb applies the same files); the first tick then completes.
    const db = makeDb();
    const now = Date.parse('2026-11-27T00:00:00Z');
    const r = await runTick(db, { config: cfg, now });
    // With nobody hired nothing is dispatched, and the criticality step says so (CRITICALITY-1 files its IDLE repair); nothing else may fail.
    assert.deepEqual(r.errors.filter(e => !e.startsWith('idle_tick:')), [], r.errors.join(' | '));
    assert.equal(r.completed, r.total, 'the waiting system\'s first tick completes, so /health answers 200');
    assert.equal((await lastTickForHealth(db, now + 60e3)).steps_completed, r.total);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM roles').get().n, 0, 'and still nobody is hired');
    // The owner's idea arrives (the form writes IDEA.md): only now is the org planned and staffed.
    const idea = text('tests/fixtures/IDEA.example.md').replace(/Example Co/g, 'Ada Atlas');
    assert.notEqual(idea, text('tests/fixtures/IDEA.example.md'), 'the fixture names the example org this test replaces');
    writeFileSync(join(dir, 'IDEA.md'), idea);
    build(dir);
    assert.ok(existsSync(join(dir, 'org/roles.json')), 'the owner\'s own idea is planned and staffed');
    const staffed = (await import(pathToFileURL(cfgPath).href + '?staffed')).default;
    assert.ok(staffed.managers, 'the planned system\'s config carries its managers');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MIGRATE-FIRST-1: an empty database reaches a complete first tick, and the second tick applies nothing again', async () => {
  const db = makeDb();
  db.raw.exec('PRAGMA foreign_keys = OFF');
  const objs = db.raw.prepare(`SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('view', 'trigger', 'table')`).all();
  for (const o of objs.filter(o => o.type !== 'table')) db.raw.exec(`DROP ${o.type.toUpperCase()} IF EXISTS "${o.name}"`);
  for (const o of objs.filter(o => o.type === 'table')) db.raw.exec(`DROP TABLE IF EXISTS "${o.name}"`);
  db.raw.exec('PRAGMA foreign_keys = ON');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'`).get().n, 0, 'the database starts empty, as a freshly created D1 does');
  // A tick config that carries config.migrations, in the shape the core tick's config uses (handoff.js tickConfigSource); a seed's own
  // bootstrap does not emit it yet, and its deploy script applies the same files by binding instead.
  const pol = json('autonomy/policy.json');
  const files = json('worker/migrations/index.json');
  const config = { org_slug: 'fresh', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2,
    policy: { trust: pol.trust, ladder: pol.ladder, surfaces: pol.surfaces }, criticality: json('autonomy/criticality.json'),
    failure_modes: json('autonomy/failure-modes.json'), managers: json('autonomy/managers.json'),
    migrations: files.map(file => ({ file, sql: text('worker/migrations/' + file) })) };
  const now = Date.parse('2026-11-27T00:00:00Z');
  const r = await runTick(db, { config, now });
  assert.deepEqual(r.errors, [], r.errors.join(' | '));
  assert.equal(r.total, STEP_ORDER.length);
  assert.equal(r.completed, r.total, 'every step completed on the first tick');
  assert.match(r.report, /migrate: applied /);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM _migrations`).get().n, files.length, 'every migration recorded once');
  assert.equal(db.raw.prepare(`SELECT value FROM org WHERE key = 'migrations_pending'`).get().value, '0');
  const last = await lastTickForHealth(db, now + 60e3);
  assert.equal(last.id, r.tickId);
  assert.equal(last.steps_completed, last.steps_total, '/health answers 200 on this row');
  const r2 = await runTick(db, { config, now: now + 600e3 });
  assert.deepEqual(r2.errors, [], r2.errors.join(' | '));
  assert.equal(r2.completed, r2.total);
  assert.doesNotMatch(r2.report, /migrate: applied /, 'an applied file is never run again');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM tick_runs`).get().n, 2, 'one heartbeat row per tick');
});
