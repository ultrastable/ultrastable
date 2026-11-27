// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Q-LESSON-PATCH-GATE: a model-authored branch passes the gate only when every changed .js file parses and no file over 60 KB is edited.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsShapeCheck, checkModelEdits, runGate, MAX_MODEL_EDIT_BYTES } from '../src/worker-gate.js';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
function fake(routes) {
  const calls = [];
  const f = async (url, o = {}) => {
    const k = (o.method || 'GET') + ' ' + url.replace('https://api.github.com', '');
    calls.push({ k, body: o.body });
    const hit = Object.entries(routes).find(([p]) => k.startsWith(p));
    const [status, body] = hit ? hit[1] : [404, {}];
    return { ok: status < 300, status, text: async () => JSON.stringify(body) };
  };
  return { f, calls };
}
// The Node-host route: node --check on a temporary copy.
const nodeCheck = (p, src) => {
  const d = mkdtempSync(join(tmpdir(), 'gate-')), file = join(d, p.endsWith('.js') ? 'x.mjs' : 'x' + p.slice(p.lastIndexOf('.')));
  writeFileSync(file, src);
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  return r.status === 0 ? null : (r.stderr.split('\n').find((l) => /Error/.test(l)) || 'node --check failed');
};

test('shape check: valid sources pass, truncated or unbalanced ones fail', () => {
  for (const f of readdirSync(new URL('../src/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    assert.equal(jsShapeCheck(readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')), null, f);
  }
  assert.equal(jsShapeCheck('const r = /[)}]/g; const t = `a ${ {b: 1}.b } c`; const d = a / b / c; // )'), null);
  assert.match(jsShapeCheck('function f() { return 1;'), /unclosed/);
  assert.match(jsShapeCheck('f(a, b]);'), /unbalanced/);
  assert.match(jsShapeCheck("const s = 'open;\n"), /unterminated string/);
  assert.match(jsShapeCheck('const t = `x ${y}'), /unterminated template/);
  assert.match(jsShapeCheck('/* never closed'), /unterminated comment/);
});

test('model edits: a JS syntax error is refused (Worker scanner and node --check)', () => {
  const files = [{ filename: 'src/a.js', status: 'modified' }];
  const broken = { 'src/a.js': { head: 'export function f() {\n  return 1;\n', headSize: 30, baseSize: 30 } };
  assert.match(checkModelEdits(files, broken).bad[0], /src\/a\.js: syntax line \d+: unclosed/);
  const grammar = { 'src/a.js': { head: 'export const x = [1 2];\n', headSize: 24, baseSize: 0 } };
  assert.equal(checkModelEdits(files, grammar).ok, true); // the documented limit of the Worker scanner
  assert.equal(checkModelEdits(files, grammar, { syntax: nodeCheck }).ok, false); // node --check catches it where Node exists
  assert.equal(checkModelEdits(files, { 'src/a.js': { head: 'export const x = [1, 2];\n', headSize: 24 } }, { syntax: nodeCheck }).ok, true);
});

test('model edits: a file over 60 KB before or after the edit is refused, whatever its type', () => {
  const big = MAX_MODEL_EDIT_BYTES + 1;
  assert.match(checkModelEdits([{ filename: 'docs/a.md', status: 'modified' }], { 'docs/a.md': { head: 'x', headSize: 10, baseSize: big } }).bad[0], /over the 61440-byte limit/);
  assert.equal(checkModelEdits([{ filename: 'docs/a.md', status: 'added' }], { 'docs/a.md': { head: 'x', headSize: big } }).ok, false);
  assert.equal(checkModelEdits([{ filename: 'docs/a.md', status: 'modified' }], { 'docs/a.md': { head: 'x', headSize: MAX_MODEL_EDIT_BYTES, baseSize: 10 } }).ok, true);
  assert.equal(checkModelEdits([{ filename: 'big.js', status: 'removed' }], {}).ok, true); // deleting a file is not an edit
});

test('model edits: unreadable content is refused, never assumed green', () => {
  assert.match(checkModelEdits([{ filename: 'a.md', status: 'added' }], {}).bad[0], /unreadable/);
  assert.match(checkModelEdits([{ filename: 'a.js', status: 'added' }], { 'a.js': { head: null, headSize: 5 } }).bad[0], /cannot syntax-check/);
});

test('runGate: model branch with a broken or oversized file gets a failure status; a human branch is not content-checked', async () => {
  const pr = (ref) => [{ number: 1, head: { sha: 's1', ref }, base: { sha: 'b1' }, body: '' }];
  const routes = {
    'GET /repos/o/r/commits/s1/statuses': [200, []],
    'GET /repos/o/r/pulls/1/files': [200, [{ filename: 'src/a.js', status: 'modified', patch: '+x' }, { filename: 'big.md', status: 'modified', patch: '+y' }]],
    'GET /repos/o/r/contents/src/a.js?ref=s1': [200, { size: 20, encoding: 'base64', content: b64('function f() {\n') }],
    'GET /repos/o/r/contents/src/a.js?ref=b1': [200, { size: 20 }],
    'GET /repos/o/r/contents/big.md?ref=s1': [200, { size: 50, encoding: 'base64', content: b64('y') }],
    'GET /repos/o/r/contents/big.md?ref=b1': [200, { size: 70000 }],
    'POST /repos/o/r/statuses/s1': [201, {}],
  };
  let g = fake({ ...routes, 'GET /repos/o/r/pulls?': [200, pr('agent/1')] });
  assert.deepEqual((await runGate({ token: 't', repos: ['o/r'], fetch: g.f })).checked, ['o/r#1 failure']);
  const desc = JSON.parse(g.calls.find((c) => c.k.startsWith('POST /repos/o/r/statuses')).body).description;
  assert.match(desc, /src\/a\.js: syntax/);
  g = fake({ ...routes, 'GET /repos/o/r/pulls?': [200, pr('feature/x')] });
  assert.deepEqual((await runGate({ token: 't', repos: ['o/r'], fetch: g.f })).checked, ['o/r#1 success']);
  assert.ok(!g.calls.some((c) => c.k.includes('/contents/')));
});

test('Q-GATE-403: a 403 on every pull request is one named condition and one gate card', async () => {
  const { gateCard, stubLines, MODEL_BRANCH_RE } = await import('../src/worker-gate.js');
  const pr = (n, ref) => ({ number: n, head: { sha: 's' + n, ref }, base: { sha: 'b' }, body: '' });
  const { f } = fake({ 'GET /repos/o/r/pulls?state=open': [200, [pr(1, 'feature/a'), pr(2, 'feature/b')]], 'GET /repos/o/r/commits/': [200, []], 'GET /repos/o/r/pulls/': [200, [{ filename: 'a.txt', status: 'added', patch: '+x' }]], 'POST /repos/o/r/statuses/': [403, {}] });
  const out = await runGate({ token: 't', repos: ['o/r'], fetch: f });
  assert.equal(out.status, 'forbidden'); assert.equal(out.needs, 'statuses:write'); assert.deepEqual(out.forbidden, ['o/r#1', 'o/r#2']);
  assert.match(out.forbidden_detail, /o\/r#2 status 403: the GitHub App lacks statuses:write/);
  const ran = [];
  const db = { prepare: sql => ({ bind: (...a) => ({ run: async () => { ran.push([sql, a]); } }) }) };
  assert.equal(await gateCard(db, out, { origin: 'https://x.test' }), 'open');
  assert.match(ran[0][0], /INSERT INTO gate_cards/); assert.equal(ran[0][1][0], 'GATE-APP-PERMISSION'); assert.match(ran[0][1][1], /https:\/\/x\.test\/connect\/github/);
  assert.equal(await gateCard(db, { status: 'ok', checked: ['o/r#1 success'], forbidden: [] }), 'closed');
  assert.match(ran[1][0], /UPDATE gate_cards SET status='closed'/);
  assert.equal(await gateCard(db, { status: 'ok', checked: [], forbidden: [] }), null, 'an idle pass neither opens nor closes the card');
  assert.ok(MODEL_BRANCH_RE.test('worker/rm-1-2026') && MODEL_BRANCH_RE.test('agent/x') && !MODEL_BRANCH_RE.test('feature/x'));
  assert.equal(stubLines([{ filename: 'seed/worker/src/worker-gate.js', patch: '@@\n+// ... existing code ...\n+const a = 1;' }]).length, 1);
  assert.equal(stubLines([{ filename: 'a.js', patch: '@@\n-// ... existing code ...\n+const a = 1;' }]).length, 0, 'a removed placeholder is not a finding');
});
test('GATE-STUB-1 (US-07-R22): the gate fails a model branch that adds a placeholder', async () => {
  const pr = { number: 9, head: { sha: 's9', ref: 'worker/rm-1-202611200040' }, base: { sha: 'b' }, body: '' };
  const src = 'class C:\n    def go(self):\n        # implement go logic here\n        pass\n';
  const { f, calls } = fake({ 'GET /repos/o/r/pulls?state=open': [200, [pr]], 'GET /repos/o/r/commits/': [200, []], 'GET /repos/o/r/pulls/9/files': [200, [{ filename: 'c.py', status: 'added', patch: '@@\n+' + src.split('\n').join('\n+') }]],
    'GET /repos/o/r/contents/c.py': [200, { size: src.length, encoding: 'base64', content: b64(src) }], 'POST /repos/o/r/statuses/': [201, {}] });
  const out = await runGate({ token: 't', repos: ['o/r'], fetch: f });
  assert.deepEqual(out.checked, ['o/r#9 failure']);
  assert.match(JSON.parse(calls.find(c => c.k.startsWith('POST /repos/o/r/statuses/')).body).description, /c\.py: placeholder/);
});
