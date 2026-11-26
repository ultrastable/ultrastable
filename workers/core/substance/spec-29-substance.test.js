// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-29 (visible progress, content stickiness and substantive change): the requirements of the change classifier, proved through the public API of core/substance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CONFIG, TRIVIAL, fileClass, classifyFile, verdict, splitPatch, classifyPrFiles } from './index.js';

const root = new URL('../../../', import.meta.url);
const mono = existsSync(new URL('doctrine/substance.json', root));
const read = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const kind = (path, removed, added, status = 'modified') => classifyFile(path, status, removed, added);

test('US-29-R01: a path is generated, record, config or code, in that order of precedence, and * crosses slashes', () => {
  assert.equal(fileClass('site/dashboard-data.js'), 'generated');
  assert.equal(fileClass('seed/self/anything.js'), 'generated', 'a generated glob wins over the code extension');
  assert.equal(fileClass('README.md'), 'generated', 'generated is checked before record, and README.md matches both');
  assert.equal(fileClass('doctrine/triggers.json'), 'generated', 'generated is checked before config');
  assert.equal(fileClass('docs/guide.md'), 'record');
  assert.equal(fileClass('docs/a/b/c.txt'), 'record', '* matches slashes');
  assert.equal(fileClass('a/b/c.jsonl'), 'record');
  assert.equal(fileClass('doctrine/selfcode.json'), 'config');
  assert.equal(fileClass('doctrine/a/b.json'), 'config', '* matches slashes in a config glob too');
  assert.equal(fileClass('actions-budget.json'), 'config');
  assert.equal(fileClass('foundation/x.py'), 'code');
  assert.equal(fileClass('.github/workflows/x.yml'), 'code');
  assert.equal(fileClass('tools/x.mjs'), 'code');
  assert.equal(fileClass('x.bin'), 'record', 'an extension that is not a code extension is a record');
  assert.equal(fileClass('package.json'), 'record', 'a .json file outside the config globs is a record');
});

test('US-29-R02: a modified file is behaviour unless its tokens differ only in comments, whitespace, numbers or volatile strings, or only in import lines', () => {
  assert.equal(kind('foundation/x.py', ['LIMIT = 70'], ['LIMIT = 71']), 'literal', 'a number bump');
  assert.equal(kind('seed/worker/src/a.js', ['const ASOF = "5e4a1aab";'], ['const ASOF = "d02d20a";']), 'literal', 'a hash is a volatile string');
  assert.equal(kind('seed/worker/src/a.js', ["  at: '2026-11-21T07:35:20Z',"], ["  at: '2026-11-21T08:51:14Z',"]), 'literal', 'a timestamp is a volatile string');
  assert.equal(kind('seed/worker/src/a.js', ['var VERSION = "1.7.1-codeagent";'], ['var VERSION = "1.7.2-codeagent";']), 'literal', 'a version is a volatile string');
  assert.equal(kind('foundation/x.py', ['x = f(y)  # old note'], ['x = f(y)  # new note']), 'comment');
  assert.equal(kind('site/a.js', ['/* a */ f();'], ['/* b */ f();']), 'comment', 'a block comment is a comment');
  assert.equal(kind('site/a.js', ['if(a){b()}'], ['if (a) { b() }']), 'format', 'same tokens, same comments');
  assert.equal(kind('foundation/x.py', [''], ['']), 'format');
  assert.equal(kind('scripts/smoke_probe.py', ['import json, os'], ['import os']), 'import');
  assert.equal(kind('site/a.js', ["import { a, b } from './x.js';"], ["import { b, a } from './x.js';"]), 'import');
  assert.equal(kind('foundation/x.py', ['    if n > 3:'], ['    if n > 3 and not paused:']), 'behaviour');
  assert.equal(kind('seed/worker/src/a.js', ["x = 'hello'"], ["x = 'world'"]), 'behaviour', 'a string that is not volatile is behaviour');
  assert.equal(kind('foundation/x.py', ['count = len(items)'], ['count = 795']), 'behaviour', 'hard-coding a computed value is behaviour');
  assert.equal(kind('foundation/x.py', ['import json, os'], ['import os', 'main()']), 'behaviour', 'an import line beside a code line is not import-only');
  assert.equal(kind('site/dashboard-data.js', ['"headline": "794"'], ['"headline": "795"']), 'generated', 'the path class decides before the lines are read');
  assert.equal(kind('ops/deploys.jsonl', [], ['{"x":1}']), 'record');
});

test('US-29-R03: an added or removed code file is behaviour when it holds any token and a comment otherwise; generated and record files stay so', () => {
  assert.equal(kind('foundation/new.py', [], ['def f(x):', '    return x + 1'], 'added'), 'behaviour');
  assert.equal(kind('foundation/old.py', ['def f(x):', '    return x + 1'], [], 'removed'), 'behaviour');
  assert.equal(kind('foundation/new.py', [], ['# only a note'], 'added'), 'comment');
  assert.equal(kind('foundation/old.py', [], [], 'removed'), 'comment', 'a file with no tokens at all has no behaviour to add or remove');
  assert.equal(kind('docs/x.md', [], ['hello'], 'added'), 'record');
  assert.equal(kind('site/x-data.js', [], ['export const A = 1;'], 'added'), 'generated');
});

test('US-29-R04: in a config file a documentation key is a comment, a number is a literal and any other value is behaviour', () => {
  for (const k of CONFIG.doc_keys) assert.equal(kind('doctrine/selfcode.json', [`  "${k}": "old words",`], [`  "${k}": "new words",`]), 'comment', k);
  assert.equal(kind('doctrine/selfcode.json', ['    "max_open": 3,'], ['    "max_open": 4,']), 'literal');
  assert.equal(kind('doctrine/selfcode.json', ['      "enabled": true,'], ['      "enabled": false,']), 'behaviour', 'a switch flipped');
  assert.equal(kind('doctrine/selfcode.json', ['  "mode": "a",'], ['  "mode": "b",']), 'behaviour', 'a key that is not a documentation key');
});

test('US-29-R05: a change is substantive when any file is behaviour, else trivial when any file is literal, comment, format or import, else record', () => {
  assert.deepEqual(TRIVIAL, ['literal', 'comment', 'format', 'import']);
  assert.equal(verdict(['literal', 'record', 'behaviour']), 'substantive');
  assert.equal(verdict(['import', 'record', 'generated']), 'trivial');
  assert.equal(verdict(['record', 'generated']), 'record');
  assert.equal(verdict([]), 'record', 'nothing is a record, never substantive');
});

test('US-29-R06: splitPatch turns GitHub\'s per-file patch into removed and added lines and ignores hunk headers, context and no-newline markers', () => {
  assert.deepEqual(splitPatch('@@ -1,2 +1,3 @@\n context\n-a\n+b\n\\ No newline at end of file\n+c'), { removed: ['a'], added: ['b', 'c'] });
  assert.deepEqual(splitPatch(null), { removed: [], added: [] });
  assert.deepEqual(splitPatch(undefined), { removed: [], added: [] });
});

test('US-29-R07: classifyPrFiles gives a verdict over a pull request\'s files, and a code or config file with no patch is behaviour, never trivial', () => {
  assert.deepEqual(classifyPrFiles([]), { verdict: 'record', files: [] });
  const trivial = classifyPrFiles([
    { filename: 'scripts/smoke_probe.py', status: 'modified', patch: '@@ -1 +1 @@\n-import json, os\n+import os' },
    { filename: 'site/dashboard-data.js', status: 'modified', patch: '@@ -2 +2 @@\n- "asof": "5e4a1aab",\n+ "asof": "d02d20a",' },
    { filename: 'ops/deploys.jsonl', status: 'modified', patch: '@@ -1 +1,2 @@\n+{}' }]);
  assert.equal(trivial.verdict, 'trivial');
  assert.deepEqual(trivial.files.map(f => f.kind), ['import', 'generated', 'record']);
  assert.equal(classifyPrFiles([{ filename: 'seed/worker/src/big.js', status: 'modified' }]).verdict, 'substantive', 'a code file with no patch');
  assert.equal(classifyPrFiles([{ filename: 'doctrine/a.json', status: 'modified' }]).verdict, 'substantive', 'a config file with no patch');
  assert.equal(classifyPrFiles([{ filename: 'docs/a.md', status: 'modified' }, { filename: 'site/x-data.js', status: 'added' }]).verdict, 'record', 'a record or generated file with no patch is judged by its path');
  assert.equal(classifyPrFiles([{ filename: 'foundation/a.py', status: 'added', patch: '@@ -0,0 +1 @@\n+def f(): pass' }]).files[0].kind, 'behaviour', 'status added');
  assert.equal(classifyPrFiles([{ filename: 'foundation/a.py', status: 'removed', patch: '@@ -1 +0,0 @@\n-x = 1' }]).files[0].kind, 'behaviour', 'status removed');
  assert.equal(classifyPrFiles([{ filename: 'foundation/a.py', status: 'renamed', patch: '' }]).files[0].kind, 'format', 'any other status is read as modified');
});

test('US-29-R08: the JavaScript classifier carries the rules of doctrine/substance.json and returns every expectation of the shared vectors', { skip: mono ? false : 'doctrine/ is not beside this checkout (the extracted repository)' }, () => {
  const d = read('doctrine/substance.json');
  for (const k of ['code_ext', 'config_globs', 'generated_globs', 'record_globs', 'doc_keys']) assert.deepEqual(CONFIG[k], d[k], k);
  const v = read('doctrine/substance-vectors.json');
  assert.ok(v.cases.length >= 20 && v.verdicts.length >= 4);
  for (const c of v.cases) assert.equal(classifyFile(c.path, c.status, c.removed, c.added), c.expect, c.name);
  for (const c of v.verdicts) assert.equal(verdict(c.kinds), c.expect, c.name);
});
