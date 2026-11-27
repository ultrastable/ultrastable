// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main, parseArgs } from './install.mjs';
import { manifest, signManifest } from './release_bundle.mjs';
import { verifySignature } from '../core/install/index.js';

const sha = s => createHash('sha256').update(s).digest('hex');
/** A temporary root with an idea, an org config and a released bundle directory; the bootstrapper is a recorded fake. */
function fixture({ sign = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'inst-')), bundleDir = path.join(root, 'release'), out = path.join(root, 'org');
  mkdirSync(path.join(root, 'bootstrap')); mkdirSync(bundleDir);
  writeFileSync(path.join(root, 'bootstrap', 'bootstrap.py'), '# stand-in; the test injects spawn\n');
  writeFileSync(path.join(root, 'IDEA.md'), '# Idea\nShare tools.\n');
  writeFileSync(path.join(root, 'ultrastable.json'), JSON.stringify({ connectors: { host: { env: 'CODE_HOST_TOKEN' }, extra: { env: 'EXTRA_TOKEN', optional: true } } }));
  const bundle = 'export default {};', migrations = 'CREATE TABLE IF NOT EXISTS t (a);';
  const text = JSON.stringify(manifest(bundle, migrations, '1.2.0'), null, 2) + '\n';
  writeFileSync(path.join(bundleDir, 'bundle.js'), bundle); writeFileSync(path.join(bundleDir, 'migrations.sql'), migrations); writeFileSync(path.join(bundleDir, 'manifest.json'), text);
  let pub = null;
  if (sign) {
    const k = generateKeyPairSync('ed25519');
    writeFileSync(path.join(bundleDir, 'manifest.sig'), signManifest(text, k.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')) + '\n');
    pub = k.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  }
  const spawned = [];
  const spawn = (cmd, args) => { spawned.push(args); const o = args[args.indexOf('--out') + 1]; mkdirSync(o, { recursive: true }); writeFileSync(path.join(o, 'boot-log.json'), '{}'); writeFileSync(path.join(o, 'charter.md'), '# c'); return { status: 0, stdout: '', stderr: '' }; };
  const logs = [];
  const run = (extra = [], env = {}) => main(['--slug', 'tool-share', '--root', root, '--bundle-dir', bundleDir, '--json', ...extra], { env, spawn, log: t => logs.push(JSON.parse(t)), sleep: async () => {} });
  return { root, bundleDir, out, spawned, logs, run, pub, bundle };
}

test('US-10-R14 the install command exits 3 on a digest mismatch and runs no bootstrapper', async () => {
  const f = fixture();
  writeFileSync(path.join(f.bundleDir, 'bundle.js'), 'export default { tampered: true };');
  assert.equal(await f.run(), 3);
  assert.equal(f.spawned.length, 0);
  assert.equal(existsSync(f.out), false, 'nothing was written');
  assert.equal(f.logs[0].steps.at(-1).name, 'bundle');
});

test('US-10-R14 a signed release verifies with the public key; a wrong key or a missing signature exits 3', async () => {
  const f = fixture({ sign: true });
  assert.equal(await verifySignature(readFileSync(path.join(f.bundleDir, 'manifest.json'), 'utf8'), readFileSync(path.join(f.bundleDir, 'manifest.sig'), 'utf8'), f.pub), true, 'release_bundle signs what core/install verifies');
  assert.equal(await f.run(['--public-key', f.pub]), 0);
  assert.equal(f.logs.at(-1).bundle.signed, true);
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  assert.equal(await f.run(['--public-key', other]), 3);
  const unsigned = fixture();
  assert.equal(await unsigned.run(['--public-key', f.pub]), 3);
  assert.equal(await unsigned.run(['--require-signature']), 3);
});

test('US-SPEC-10 s7 a dry run verifies the bundle, runs the bootstrapper once, writes a gate card for the absent connector and exits 0; the re-run skips the bootstrapper', async () => {
  const f = fixture();
  assert.equal(await f.run(), 0);
  const r = f.logs[0], st = Object.fromEntries(r.steps.map(s => [s.name, s.status]));
  assert.deepEqual(st, { preconditions: 'ok', bundle: 'ok', bootstrap: 'ran', provision: 'degraded', connectors: 'degraded', deploy: 'degraded', first_tick: 'degraded', register: 'degraded' });
  assert.equal(r.bundle.sha256, sha(f.bundle));
  assert.deepEqual(f.spawned[0].slice(1, 2), ['--dry-run']);
  const cards = JSON.parse(readFileSync(path.join(f.out, 'gate-cards.json'), 'utf8'));
  assert.deepEqual(cards.map(c => [c.id, c.closing_probe]), [['GATE-CODE_HOST_TOKEN', 'env:CODE_HOST_TOKEN']], 'the optional connector gets no card');
  assert.equal(await f.run(), 0);
  assert.equal(f.spawned.length, 1, 'the bootstrapper is not run again');
  assert.equal(f.logs[1].steps.find(s => s.name === 'bootstrap').status, 'skipped');
  assert.equal(JSON.parse(readFileSync(path.join(f.out, 'gate-cards.json'), 'utf8')).length, 1, 'the card is not duplicated');
  assert.equal(existsSync(path.join(f.out, 'tenant.json')), false, 'a dry run registers no tenant');
});

test('US-10-R06 / US-10-R15 the installer asks once per binding: the bootstrapper\'s card is kept, and a card it adds is a seed row in plain words', async () => {
  const f = fixture();
  const seed = "INSERT OR IGNORE INTO org (key, value) VALUES ('name', 'Tool Share');\n";
  const boot = (cards) => (cmd, args) => {
    const o = args[args.indexOf('--out') + 1]; mkdirSync(o, { recursive: true });
    writeFileSync(path.join(o, 'boot-log.json'), '{}'); writeFileSync(path.join(o, 'charter.md'), '# c');
    writeFileSync(path.join(o, 'gate-cards.json'), JSON.stringify(cards)); writeFileSync(path.join(o, 'seed.sql'), seed);
    return { status: 0, stdout: '', stderr: '' };
  };
  const run = (spawn) => { const logs = []; return main(['--slug', 'tool-share', '--root', f.root, '--bundle-dir', f.bundleDir, '--json'], { env: {}, spawn, log: x => logs.push(JSON.parse(x)), sleep: async () => {} }).then(code => ({ code, r: logs[0] })); };
  const theirs = { id: 'GATE-SECRET-CODE_HOST_TOKEN', what: 'Set the CODE_HOST_TOKEN secret', why_gated: 'w', default_in_effect: 'repo stay in dry-run', prepared_by_fleet: 'p', closing_probe: 'env:CODE_HOST_TOKEN', say: 'Connect your code host', say_default: 'the system waits' };
  let { code, r } = await run(boot([theirs]));
  assert.equal(code, 0);
  assert.deepEqual(r.gate_cards.map(c => c.id), ['GATE-SECRET-CODE_HOST_TOKEN']);
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.out, 'gate-cards.json'), 'utf8')).map(c => c.id), ['GATE-SECRET-CODE_HOST_TOKEN'], 'no second card for the same binding');
  assert.equal(readFileSync(path.join(f.out, 'seed.sql'), 'utf8'), seed, 'nothing to add to the seed');
  assert.match(r.steps.find(s => s.name === 'provision').detail, /seed SQL planned/, 'the dry run plans the seed with the migrations');
  rmSync(f.out, { recursive: true, force: true });
  ({ code, r } = await run(boot([])));
  assert.equal(code, 0);
  const cards = JSON.parse(readFileSync(path.join(f.out, 'gate-cards.json'), 'utf8')), sql = readFileSync(path.join(f.out, 'seed.sql'), 'utf8');
  assert.deepEqual(cards.map(c => c.id), ['GATE-CODE_HOST_TOKEN']);
  const rows = sql.split('\n').filter(l => l.startsWith('INSERT OR IGNORE INTO gate_cards'));
  assert.equal(rows.length, 1, 'every card in the card file is a row of the seed SQL');
  assert.ok(rows[0].includes(`'${cards[0].say}'`) && rows[0].includes(`'${cards[0].say_default}'`), rows[0]);
  assert.doesNotMatch(rows[0].replace("'env:CODE_HOST_TOKEN'", '').replace("'GATE-CODE_HOST_TOKEN'", ''), /CODE_HOST_TOKEN|dry[- ]?run/, 'the console columns hold the plain lines; the binding stays in the probe');
});

test('preconditions: a missing idea file, a missing bundle source, --apply without its inputs and a bad flag all exit 2 before anything runs', async () => {
  const f = fixture();
  assert.equal(await f.run(['--idea', path.join(f.root, 'nope.md')]), 2);
  assert.equal(await f.run(['--apply']), 2);
  assert.match(f.logs.at(-1).steps[0].detail, /--account-id.*--health-url.*CLOUDFLARE_API_TOKEN is not set/);
  assert.equal(await main(['--slug', 'x', '--root', f.root, '--json'], { env: {}, spawn: () => ({ status: 0 }), log: () => {} }), 2);
  assert.equal(await main(['stray'], { env: {}, log: () => {} }), 2);
  assert.equal(f.spawned.length, 0);
  assert.deepEqual(parseArgs(['--slug', 'a', '--apply']), { slug: 'a', apply: true });
  assert.throws(() => parseArgs(['--slug']), /needs a value/);
});

test('a bootstrapper that fails stops the install with exit 2 and keeps the end of its error output', async () => {
  const f = fixture();
  const code = await main(['--slug', 'tool-share', '--root', f.root, '--bundle-dir', f.bundleDir, '--json'], { env: {}, log: t => f.logs.push(JSON.parse(t)), spawn: () => ({ status: 2, stdout: '', stderr: 'policy invalid: surfaces missing' }) });
  assert.equal(code, 2);
  assert.match(f.logs[0].steps.at(-1).detail, /policy invalid/);
});
