// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { MIGRATIONS_DIR as KERNEL_DIR } from '../kernel/index.js';
import { MIGRATIONS_DIR, registerPersona, parseNever, checkRoleInstruction, checkRoleFiles, NEVER_REQUIRED } from './index.js';

const GOOD = `# Role: reviewer

## Never
- Act on an item under another agent's live claim.
- Handle secret values: refer to a secret by its binding name.
- Review your own work.

> CLOSED-LOOP-AXIOM: a blockquote ends the section.
`;
const base = { id: 'p', role: 'program-manager', program_id: 'OPS', scope: 's', authority: ['score'] };

test('US-02-R12, US-02-T09: a role instruction file with a never list naming live claims, secret values and own-work review passes', () => {
  const r = checkRoleInstruction(GOOD);
  assert.deepEqual([r.ok, r.has_section, r.missing, r.bullets], [true, true, [], 3]);
  assert.equal(NEVER_REQUIRED.length, 3);
});

test('US-02-R12, US-02-T09: a file with no Never section, or one missing any of the three, is refused and the missing item is named', () => {
  assert.deepEqual(checkRoleInstruction('# Role\n\nDo the work.\n').missing, ['live-claim', 'secrets', 'own-work']);
  assert.equal(checkRoleInstruction('# Role\n\nDo the work.\n').has_section, false);
  const noSecrets = GOOD.replace(/- Handle secret values.*\n/, '');
  assert.deepEqual(checkRoleInstruction(noSecrets).missing, ['secrets']);
  const onlyClaim = '## Never\n- Duplicate work under another agent\'s live claim.\n';
  assert.deepEqual(checkRoleInstruction(onlyClaim).missing, ['secrets', 'own-work']);
});

test('US-02-R12, US-02-T09: bullets outside the Never section do not satisfy the check, and a wrapped bullet is read as one', () => {
  const elsewhere = '## Rules\n- Never handle secret values.\n- Never review your own work.\n- Never act under another agent\'s live claim.\n\n## Never\n- Ship without a metric.\n';
  assert.equal(checkRoleInstruction(elsewhere).ok, false);
  const wrapped = '## Never\n- Act on an item under another\n  agent\'s live claim.\n- Handle secret values.\n- Review one\'s own work.\n';
  assert.equal(checkRoleInstruction(wrapped).ok, true);
  assert.equal(parseNever('# x\n## Never\n- a\n## Next\n- b\n').bullets.length, 1);
});

test('US-02-R12, US-02-T09: registerPersona refuses a persona whose instruction file fails the check when the check is on, and never reads a prompt reference', async () => {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR]);
  const files = { 'agents/roles/good.md': GOOD, 'agents/roles/bad.md': '# Role\n## Never\n- Ship without a metric.\n' };
  const readInstruction = async (p) => { if (!(p in files)) throw new Error('no such file'); return files[p]; };
  await assert.rejects(registerPersona(db, { ...base, id: 'bad', instruction_source: 'agents/roles/bad.md' }, { requireNeverList: true, readInstruction }), /no complete never list.*missing live-claim, secrets, own-work/);
  await assert.rejects(registerPersona(db, { ...base, id: 'gone', instruction_source: 'agents/roles/gone.md' }, { requireNeverList: true, readInstruction }), /cannot read/);
  await assert.rejects(registerPersona(db, { ...base, id: 'noreader', instruction_source: 'agents/roles/good.md' }, { requireNeverList: true }), /readInstruction/);
  await registerPersona(db, { ...base, id: 'good', instruction_source: 'agents/roles/good.md' }, { requireNeverList: true, readInstruction });
  await registerPersona(db, { ...base, id: 'prompt', instruction_source: 'inline prompt' }, { requireNeverList: true, readInstruction });   // not a file: nothing to read
  await registerPersona(db, { ...base, id: 'off', instruction_source: 'agents/roles/bad.md' });                                            // the check is off by default
  assert.deepEqual(db.raw.prepare(`SELECT id FROM staff_personas ORDER BY id`).all().map(r => r.id), ['good', 'off', 'prompt']);
});

test('US-02-R12, US-02-T09: checkRoleFiles reports every file, and an unreadable file is a failure, never a pass', async () => {
  const files = { 'a.md': GOOD, 'b.md': '# no never list' };
  const out = await checkRoleFiles({ list: async () => ['a.md', 'b.md', 'c.md'], readFile: async (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; } });
  assert.deepEqual(out.map(r => [r.path, r.ok]), [['a.md', true], ['b.md', false], ['c.md', false]]);
  assert.match(out[2].error, /cannot read: ENOENT/);
  await assert.rejects(checkRoleFiles({}), /list and readFile/);
});

// The instruction files of the six seed roles are protected paths (agents/**): they change by a reviewed change, not by this module.
// Until they carry the three items this test is a todo: it runs, reports the gap, and turns green by itself when the files comply.
test('US-02-T09 (role files): every role instruction file in agents/roles carries the three never items', { todo: 'agents/roles/*.md are protected paths; integration request IR-5 adds the lines' }, async () => {
  const dir = fileURLToPath(new URL('../../agents/roles/', import.meta.url));
  const out = await checkRoleFiles({ list: async () => readdirSync(dir).filter(n => n.endsWith('.md')), readFile: async (n) => readFileSync(dir + n, 'utf8') });
  assert.ok(out.length >= 6);
  assert.deepEqual(out.filter(r => !r.ok).map(r => `${r.path}: ${r.missing.join(', ')}`), []);
});
