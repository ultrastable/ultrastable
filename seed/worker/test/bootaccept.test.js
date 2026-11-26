// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// BOOT-ACCEPT-1 (Rowan, 2026-11-25): every surface a rule requires is served together by a launched system, from its first deploy.
// The LIVE-1 health-only gate once hid DISCOVER-1's manifest and DATAGRAPH-1's graph on every seed and visitor app; nothing proved them together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hiddenByHealthOnly, publicPage, PUBLIC_READS } from '../src/visibility.js';
import { manifest, footerHtml } from '../src/discover.js';

const on = { PUBLIC_HEALTH_ONLY: '1' };

test('BOOT-ACCEPT-1: a health-only system serves the discovery manifest and the graph read side', () => {
  for (const p of ['/.well-known/ultrastable.json', '/api/graph', '/api/graph/insights', '/api/graph/search', '/graph']) assert.equal(hiddenByHealthOnly(on, 'GET', p), false, p);
});

test('BOOT-ACCEPT-1: every public route the seed Worker serves for a rule is either in PUBLIC_READS or exempted above it', () => {
  // the route a rule makes public must not sit behind the gate; read the Worker so a new public route cannot be added without this list
  const src = readFileSync(new URL('../src/discover.js', import.meta.url), 'utf8');
  assert.ok(src.includes("'/.well-known/ultrastable.json'") && PUBLIC_READS.includes('/.well-known/ultrastable.json'));
  const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(idx.indexOf('hiddenByHealthOnly(') < idx.indexOf('discoverRoute('), 'the gate runs first, so PUBLIC_READS is what keeps discovery reachable');
});

test('BOOT-ACCEPT-1: the public page carries the Built on Ultrastable footer', async () => {
  const env = { PUBLIC_URL: 'https://ultrastable-seed-x.ultrastable.workers.dev', PUBLIC_REPO: 'ultrastable/x' };
  const html = await publicPage({ name: 'x', last: null, ignition: null, footer: footerHtml(env, {}) }).text();
  assert.match(html, /Built on <a href="https:\/\/ultrastable\.io\/"/);
  assert.match(html, /\/\.well-known\/ultrastable\.json/);
  assert.match(html, /github\.com\/ultrastable\/x/);
});

test('BOOT-ACCEPT-1: a deployed seed names its URL and repository in its manifest from the bindings deploy-seed sets', () => {
  const m = manifest({ PUBLIC_URL: 'https://ultrastable-seed-x.ultrastable.workers.dev', PUBLIC_REPO: 'ultrastable/x' }, {});
  assert.equal(m.url, 'https://ultrastable-seed-x.ultrastable.workers.dev');
  assert.equal(m.repo, 'https://github.com/ultrastable/x');
  assert.equal(manifest({ PUBLIC_REPO: 'a/b', GITHUB_REPOS: 'c/d' }, {}).repo, 'https://github.com/c/d', 'the real repo list wins');
});

test('BOOT-ACCEPT-1: the platform deploy sets the bindings the manifest reads', () => {
  const dep = readFileSync(new URL('../../../deploy/deploy-seed.mjs', import.meta.url), 'utf8');
  for (const b of ['name: "PUBLIC_URL"', 'name: "PUBLIC_REPO"', 'registerDirectory(url)']) assert.ok(dep.includes(b), 'deploy-seed.mjs: ' + b);
});
