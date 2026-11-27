// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-18 R15 on the read-back page (US-SPEC-16 R12, R13): the page script asks first and sends the confirm step with every write, so a correction or a
// confirmation is not refused with 428 in session mode. The script is run in a fake DOM, as core/walkthrough/changed-line.test.js does for the console page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReadBack } from './index.js';

const RB = { defaults: 1, statements: [
  { need_id: 'visibility', text: 'We assumed it is public.', assumption: true, value: 'public', options: ['public', 'private'] },
  { need_id: 'name', text: 'Name: Harbour Chess Club', assumption: false, value: 'Harbour Chess Club', options: [] },
] };

function page({ confirmed = true } = {}) {
  const html = renderReadBack(RB, { action: '/api/console/readback' });
  const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  const sent = []; const asked = []; let onClick = null;
  const say = { textContent: '' }; const input = { value: 'Harbour Go Club' };
  const doc = { addEventListener: (k, f) => { if (k === 'click') onClick = f; }, getElementById: id => (id === 'say' ? say : null), querySelector: sel => (/data-for="name"/.test(sel) ? input : null) };
  const win = { confirm: q => { asked.push(q); return confirmed; } };
  const fetchFn = async (url, init) => { sent.push({ url, method: init.method, body: JSON.parse(init.body) }); return { json: async () => ({ message: 'Saved.' }) }; };
  new Function('document', 'window', 'fetch', 'location', script)(doc, win, fetchFn, { reload() {} });
  const button = attrs => ({ id: attrs.id || '', classList: { contains: c => (attrs.cls || '') === c }, getAttribute: k => attrs[k] ?? null });
  const click = async attrs => { onClick({ target: button(attrs) }); for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
  return { html, sent, asked, click, say };
}

test('US-18-R15 and US-16-R13: the read-back page asks, then sends the confirm step with a correction by button, a correction by text and the confirmation', async () => {
  const p = page();
  assert.match(p.html, /data-need="visibility" data-value="private"/);
  await p.click({ cls: 'fix', 'data-need': 'visibility', 'data-value': 'private' });
  await p.click({ cls: 'fix', 'data-need': 'name', 'data-input': '1' });
  await p.click({ id: 'ok' });
  assert.equal(p.asked.length, 3, 'every write is asked first');
  assert.deepEqual(p.sent.map(s => [s.url, s.method]), Array(3).fill(['/api/console/readback', 'POST']));
  assert.deepEqual(p.sent.map(s => s.body), [
    { need_id: 'visibility', value: 'private', confirm: true },
    { need_id: 'name', value: 'Harbour Go Club', confirm: true },
    { confirm_readback: true, confirm: true },
  ]);
  assert.equal(p.say.textContent, 'Saved.');
});

test('US-18-R15: when the person does not confirm, the read-back page sends nothing', async () => {
  const p = page({ confirmed: false });
  await p.click({ cls: 'fix', 'data-need': 'visibility', 'data-value': 'private' });
  await p.click({ id: 'ok' });
  assert.equal(p.asked.length, 2); assert.deepEqual(p.sent, []);
});
