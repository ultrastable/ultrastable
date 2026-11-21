// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// PATCH-EDIT-1 (worker side): EDIT blocks are parsed and placed exactly or unambiguously; the prompt shows the files an item names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson, applyEdit } from '../src/codeagent.js';
import { buildPrompt, namedFiles, checkEdits, prExecutor } from '../src/pr-executor.js';

const SRC = 'def a():\n    x = 1\n    return x\n\n\ndef b():\n    y = 1\n    return y\n';

test('reply with EDIT and FILE blocks parses', () => {
  const o = parseJson('SUMMARY: s\n<<<EDIT m.py>>>\n<<<FIND>>>\n    x = 1\n<<<REPLACE>>>\n    x = 2\n<<<END>>>\n<<<FILE n.txt>>>\nnew\n<<<END>>>');
  assert.equal(o.summary, 's'); assert.deepEqual(o.files.map(f => f.path), ['n.txt', 'm.py']);
  assert.deepEqual(o.files[1].edits, [{ find: '    x = 1', replace: '    x = 2' }]);
  assert.equal(parseJson('{"files":[{"path":"a","content":"b"}]}').files[0].path, 'a');
});
test('exact and indentation-loose edits place; missing or ambiguous refuse', () => {
  assert.equal(applyEdit(SRC, '    x = 1\n', '    x = 2\n'), SRC.replace('x = 1', 'x = 2'));
  assert.match(applyEdit(SRC, 'y = 1\nreturn y', 'y = 5\nreturn y + 1'), /    y = 5\n    return y \+ 1/);
  assert.throws(() => applyEdit(SRC, 'z = 9', 'q'), /not in the file/);
  assert.throws(() => applyEdit('a = 1\nb\na = 1\n', 'a = 1', 'a = 2'), /occurs 2 times/);
});
test('prompt carries the named file and asks for edits; checkEdits accepts edits and still guards paths', () => {
  const issue = { number: 'Q-X', title: 'change site/x.js', body: 'see docs/issues/Q-X.json and site/missing.js' };
  assert.deepEqual(namedFiles(issue, 'site/x.js\ndocs/issues/Q-X.json'), ['site/x.js']);
  const p = buildPrompt(issue, 'site/x.js', { 'site/x.js': 'const a = 1;\n' });
  assert.match(p, /<<<EDIT relative\/path>>>/); assert.match(p, /CURRENT FILES/); assert.match(p, /const a = 1;/);
  checkEdits([{ path: 'site/x.js', edits: [{ find: 'a', replace: 'b' }] }]);
  assert.throws(() => checkEdits([{ path: '.github/x.yml', edits: [{ find: '', replace: 'b' }] }]), /deny list/);
});
test('executor applies an edit to the branch file and opens the PR', async () => {
  const written = {}, b64 = s => Buffer.from(s).toString('base64');
  const fetchImpl = async (url, o) => {
    const m = o.method, u = new URL(url).pathname;
    const ok = j => ({ ok: true, status: 200, text: async () => JSON.stringify(j) });
    if (m === 'GET' && u.endsWith('/issues')) return ok([{ number: 7, title: 'change site/x.js', body: '', labels: [] }]);
    if (m === 'GET' && u === '/repos/o/r') return ok({ default_branch: 'main' });
    if (m === 'GET' && u.includes('/git/ref/')) return ok({ object: { sha: 'abc' } });
    if (m === 'GET' && u.includes('/git/trees/')) return ok({ tree: [{ type: 'blob', path: 'site/x.js' }] });
    if (m === 'GET' && u.includes('/contents/site/x.js')) return ok({ sha: 's', content: b64('const a = 1;\nconst k = 2;\n') });
    if (m === 'PUT') { written.body = JSON.parse(o.body); return ok({}); }
    if (m === 'POST' && u.endsWith('/pulls')) return ok({ html_url: 'https://x/pr/1' });
    return ok({});
  };
  const agent = async () => ({ summary: 's', adapter: 'a', files: [{ path: 'site/x.js', edits: [{ find: 'const a = 1;', replace: 'const a = 9;' }] }] });
  const r = await prExecutor.dispatch({ GITHUB_REPO: 'o/r', GITHUB_DISPATCH_TOKEN: 't' }, fetchImpl, { agent });
  assert.equal(r.ok, true);
  assert.equal(Buffer.from(written.body.content, 'base64').toString(), 'const a = 9;\nconst k = 2;\n');
});
