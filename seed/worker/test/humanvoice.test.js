// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { lintVoice, withVoice, VOICE, PHRASES, rewriteMessages } from '../src/humanvoice.js';
import { lintPost } from '../src/postquality.js';

test('AI-sounding text fails, plain text passes', () => {
  assert.deepEqual(lintVoice('The tick ran 144 times yesterday and merged 9 PRs.'), []);
  assert.ok(lintVoice('We leverage a seamless, robust platform.').length);
  assert.ok(lintVoice("It's not just a tool, but a partner.").some(r => r.includes('not just')));
  assert.ok(lintVoice('In today\'s world, things move.').includes('stock opener'));
  assert.ok(lintVoice('It works. In conclusion, it works.').includes('summary closer'));
  assert.ok(lintVoice('a — b — c').includes('em-dash chain'));
  assert.ok(lintVoice('fast, cheap, and simple. Bold, clear, and kind.').includes('tidy three-item lists'));
  assert.deepEqual(lintVoice('see `leverage()` at https://x.io/unlock'), []);
});
test('voice goes into the system message once', () => {
  const a = withVoice([{ role: 'user', content: 'hi' }]);
  assert.equal(a[0].content, VOICE);
  assert.equal(withVoice(a).length, 2);
  assert.ok(withVoice([{ role: 'system', content: 'S' }])[0].content.startsWith(VOICE));
  assert.equal(rewriteMessages([{ role: 'user', content: 'x' }], 'd', ['r']).at(-1).role, 'user');
});
test('the social publisher blocks AI-sounding posts', () => {
  assert.ok(lintPost('Our seamless platform is a testament to progress. https://ultrastable.io').some(r => r.includes('stock AI')));
});
test('JS list matches doctrine/human-voice.json', () => {
  const p = new URL('../../../doctrine/human-voice.json', import.meta.url);
  if (!existsSync(p)) return;
  const d = JSON.parse(readFileSync(p, 'utf8'));
  assert.deepEqual(PHRASES, d.phrases); assert.equal(VOICE, d.prompt);
});
