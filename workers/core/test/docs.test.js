// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Documentation tests (issue #23, T19-6): relative links resolve, and requirement ids look like requirement ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const docs = ['README.md', ...readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => 'docs/' + f)];

// US-19-R19: every markdown file of this repository, except the copies other repositories own or that are generated (their links resolve in their own
// layout) and the two trees that hold material extracted from elsewhere. A file added anywhere else is scanned without being listed here.
const SKIP_DIRS = new Set(['node_modules', '.git', 'org', 'runtimes', 'extraction']);
const SKIP_FILES = new Set(['SCOPE.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
function allMarkdown(dir = '') {
  const out = [];
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? dir + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...allMarkdown(rel)); }
    else if (e.name.endsWith('.md') && !(dir === '' && SKIP_FILES.has(e.name))) out.push(rel);
  }
  return out;
}

test('US-19-R19 relative markdown links in every markdown file of this repository resolve to files', () => {
  const broken = [];
  const every = allMarkdown();
  assert.ok(every.length > docs.length, 'the scan reaches beyond README and docs');
  for (const d of every) {
    const text = readFileSync(join(root, d), 'utf8');
    for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const href = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/')) continue;
      if (!existsSync(resolve(root, dirname(d), href))) broken.push(d + ' -> ' + href);
    }
  }
  assert.deepEqual(broken, []);
});

test('requirement ids use the US-NN-RNN or US-SPEC-NN shape', () => {
  const bad = [];
  for (const d of docs) {
    const text = readFileSync(join(root, d), 'utf8');
    for (const m of text.matchAll(/US-[A-Z0-9-]+/g)) {
      if (!/^US-(\d{2}-R\d{2}|SPEC-\d{2}|\d{2})$/.test(m[0]) && !/^US-(\d{2}-R\d{2})-/.test(m[0])) bad.push(d + ': ' + m[0]);
    }
  }
  assert.deepEqual([...new Set(bad)], []);
});

test('US-19-R21 the platform statement is made in the scope page and the skill, links docs/why-cloudflare.md, and that document has its limits and its not-the-right-choice sections', () => {
  const read = p => readFileSync(join(root, p), 'utf8');
  for (const f of ['SCOPE.md', 'agent-setup/SKILL.md']) {
    assert.match(read(f), /Cloudflare Workers/, f);
    assert.match(read(f), /docs\/why-cloudflare\.md/, `${f} links the document`);
  }
  assert.match(read('SCOPE.md'), /only supported platform/);
  assert.ok(existsSync(join(root, 'docs/why-cloudflare.md')), 'the linked document exists');
  const why = read('docs/why-cloudflare.md');
  for (const h of ['## Limits of Workers that shape the design', '## When this will not be the right choice', '## What we proved, and what we did not'])
    assert.ok(why.includes(h), `docs/why-cloudflare.md needs: ${h}`);
  assert.match(why, /only supported platform/);
  assert.doesNotMatch(why, /alarm-driven tick is planned/, 'a built mechanism is not described as planned');
});
