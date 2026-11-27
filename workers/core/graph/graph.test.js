// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { extractEdges, normalize, normalizePy, dstSpellings, ingest, declare, blastRadius } from './index.js';

const mig = fileURLToPath(new URL('./migrations/', import.meta.url));
const files = [
  { path: 'core/a.js', text: "import { x } from './b.js';\nconst c = require('../lib/c.js');\nimport 'pkg';" },
  { path: 'core/b.js', text: "export * from './d.js';" },
  { path: 'core/d.js', text: '' }, { path: 'lib/c.js', text: '' },
];
const mk = sources => ({ db: makeDb([mig]), now: () => 0, sources });

test('edges: relative imports only, resolved against the importing file', () => {
  assert.deepEqual(extractEdges('core/a.js', files[0].text).sort(), ['core/b.js', 'lib/c.js']);
  assert.equal(normalize('a/b/c.js', '../../x.js'), 'x.js');
});
test('US-12-R16: blast radius is transitive and cycle safe', async () => {
  const ctx = mk([{ name: 's1', list: async () => files }]);
  await ingest(ctx); await declare(ctx, 'core/d.js', 'core/a.js');   // cycle a -> b -> d -> a
  const r = await blastRadius(ctx, ['core/d.js']);
  assert.deepEqual(r.affected, ['core/a.js', 'core/b.js']);
});
test('US-12-R15: no single route: a failing source is reported, the other still builds the graph', async () => {
  const ctx = mk([{ name: 'broken', list: async () => { throw new Error('tree api down'); } }, { name: 'local', list: async () => files }]);
  const rep = await ingest(ctx);
  assert.deepEqual(rep.map(r => r.ok), [false, true]);
  assert.deepEqual((await blastRadius(ctx, ['lib/c.js'])).affected, ['core/a.js']);
});

// ---- round 1 additions ---------------------------------------------------------------------------

test('US-12-R16: the bound stops the walk, the result says it truncated, and a node already visited is not counted twice', async () => {
  const chain = Array.from({ length: 6 }, (_, i) => ({ path: `m/f${i}.js`, text: i ? `import './f${i - 1}.js';` : '' })); // f5 -> f4 -> ... -> f0
  const ctx = mk([{ name: 's', list: async () => chain }]);
  await ingest(ctx);
  const all = await blastRadius(ctx, ['m/f0.js']);
  assert.deepEqual([all.affected.length, all.truncated], [5, false]);
  const cut = await blastRadius(ctx, ['m/f0.js'], { maxNodes: 2 });
  assert.deepEqual([cut.affected, cut.truncated], [['m/f1.js', 'm/f2.js'], true]);
  assert.deepEqual((await blastRadius(ctx, ['m/f0.js', 'm/f1.js'])).affected, ['m/f2.js', 'm/f3.js', 'm/f4.js', 'm/f5.js']); // several changed paths: the changed ones are not their own radius
});

test('US-12-R15: re-ingesting a file replaces only its own source\'s edges and keeps declared edges', async () => {
  let text = "import './b.js';";
  const ctx = mk([{ name: 'local', list: async () => [{ path: 'a.js', text }, { path: 'b.js', text: '' }, { path: 'c.js', text: '' }] }]);
  await ingest(ctx); await declare(ctx, 'a.js', 'c.js');
  assert.deepEqual((await blastRadius(ctx, ['b.js'])).affected, ['a.js']);
  text = "import './c.js';";                                            // the import changed from b to c
  await ingest(ctx); await ingest(ctx);                                // twice: no duplicates
  assert.deepEqual((await blastRadius(ctx, ['b.js'])).affected, []);
  assert.deepEqual((await blastRadius(ctx, ['c.js'])).affected, ['a.js']);
  assert.equal((await ctx.db.prepare(`SELECT COUNT(*) AS n FROM graph_edges WHERE src = 'a.js'`).first()).n, 2);   // the import edge and the declared edge
  assert.equal((await ctx.db.prepare(`SELECT COUNT(*) AS n FROM graph_edges WHERE source = 'declared'`).first()).n, 1);
});

test('US-12-R15: Python relative imports, TypeScript type imports and dynamic import() are topology edges', () => {
  assert.deepEqual(extractEdges('a/b.py', 'from .util import x\nimport os\nfrom ..core import y\nfrom . import peer, other as o'), ['a/util', 'core', 'a/peer', 'a/other']);
  assert.equal(normalizePy('a/b/c.py', '...x'), 'x');                       // three dots from a/b/c.py: up to the repository root
  assert.equal(normalizePy('a/b.py', '...x'), null);                       // climbs above the root: not an edge
  const known = new Set(['core', 'a']);
  assert.deepEqual(extractEdges('a/b.py', 'import core.thing as t, os\nfrom a.sib import z\nfrom requests import get', { known }).sort(), ['a/sib', 'core/thing']); // absolute: only in-repo top-level directories
  assert.deepEqual(extractEdges('src/a.ts', "import type { T } from './types';\nexport type { U } from './u.js';\nconst m = await import('./lazy.js');\nimport 'pkg';").sort(), ['src/lazy.js', 'src/types', 'src/u.js']);
  assert.deepEqual(extractEdges('a.js', "const x = require( '../lib/y.js' );"), ['lib/y.js']);
  // a Python line inside a JS file is not an import
  assert.deepEqual(extractEdges('a.js', 'from .x import y'), []);
});

test('US-12-R16: blast radius follows Python, TypeScript and extensionless importers back to the changed file', async () => {
  const files = [
    { path: 'pkg/__init__.py', text: '' }, { path: 'pkg/util.py', text: '' }, { path: 'pkg/main.py', text: 'from .util import f' },
    { path: 'app/run.py', text: 'from pkg import util\nimport pkg.main' }, { path: 'web/types.ts', text: '' }, { path: 'web/use.ts', text: "import type { T } from './types.js';" },
    { path: 'web/lazy.mjs', text: '' }, { path: 'web/page.mjs', text: "const l = await import('./lazy');" },
  ];
  const ctx = mk([{ name: 's', list: async () => files }]);
  await ingest(ctx);
  assert.deepEqual((await blastRadius(ctx, ['pkg/util.py'])).affected, ['app/run.py', 'pkg/main.py']);   // main via a relative import; run via `pkg.main`
  assert.deepEqual((await blastRadius(ctx, ['web/types.ts'])).affected, ['web/use.ts']);                 // imported under its compiled .js name
  assert.deepEqual((await blastRadius(ctx, ['web/lazy.mjs'])).affected, ['web/page.mjs']);                // imported without an extension
  assert.ok(dstSpellings('pkg/__init__.py').includes('pkg'));                                            // a package is its __init__ file
});

// ---- round 2 additions: findings of the verification of US-SPEC-12 --------------------------------

test('US-12-R16: one hub with many dependents never returns more than maxNodes, and says it truncated', async () => {
  const hub = [{ path: 'm/hub.js', text: '' }, ...Array.from({ length: 10 }, (_, i) => ({ path: `m/u${String(i).padStart(2, '0')}.js`, text: "import './hub.js';" }))];
  const ctx = mk([{ name: 's', list: async () => hub }]);
  await ingest(ctx);
  const cut = await blastRadius(ctx, ['m/hub.js'], { maxNodes: 2 });
  assert.deepEqual([cut.affected, cut.truncated], [['m/u00.js', 'm/u01.js'], true]);            // the first two by path, not all ten
  const exact = await blastRadius(ctx, ['m/hub.js'], { maxNodes: 10 });
  assert.deepEqual([exact.affected.length, exact.truncated], [10, false]);                       // the bound met exactly drops nothing
  const under = await blastRadius(ctx, ['m/hub.js'], { maxNodes: 9 });
  assert.deepEqual([under.affected.length, under.truncated], [9, true]);
  assert.deepEqual([(await blastRadius(ctx, ['m/hub.js'])).affected.length, (await blastRadius(ctx, ['m/hub.js'])).truncated], [10, false]);
});

test('US-12-R15: a file the source no longer lists loses its edges and node; other sources, declared edges and a failed listing keep theirs', async () => {
  let listing = [{ path: 'lib.js', text: '' }, { path: 'a.js', text: "import './lib.js';" }, { path: 'old.js', text: "import './lib.js';" }];
  let other = [{ path: 'z.js', text: "import './lib.js';" }];
  let fail = false;
  const ctx = mk([{ name: 'one', list: async () => listing }, { name: 'two', list: async () => { if (fail) throw new Error('down'); return other; } }]);
  await ingest(ctx); await declare(ctx, 'decl.js', 'lib.js');
  assert.deepEqual((await blastRadius(ctx, ['lib.js'])).affected, ['a.js', 'decl.js', 'old.js', 'z.js']);
  listing = [{ path: 'lib.js', text: '' }, { path: 'a.js', text: "import './lib.js';" }];            // old.js was deleted from the tree
  fail = true;                                                                                      // and source two fails this time
  const rep = await ingest(ctx);
  assert.deepEqual(rep, [{ source: 'one', ok: true, files: 2, pruned: ['old.js'] }, { source: 'two', ok: false, error: 'down' }]);
  assert.deepEqual((await blastRadius(ctx, ['lib.js'])).affected, ['a.js', 'decl.js', 'z.js']);   // old.js is gone; z.js survives its source failing
  assert.equal(await ctx.db.prepare(`SELECT id FROM graph_nodes WHERE id = 'old.js'`).first(), null);
  assert.ok(await ctx.db.prepare(`SELECT id FROM graph_nodes WHERE id = 'a.js'`).first());
  fail = false; other = [];                                                                         // source two now lists nothing: its edges go
  await ingest(ctx);
  assert.deepEqual((await blastRadius(ctx, ['lib.js'])).affected, ['a.js', 'decl.js']);
});
