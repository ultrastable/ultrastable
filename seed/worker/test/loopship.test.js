// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textOf, replyProblem } from '../src/airouter.js';
import { codeNeuronCap } from '../src/codeagent.js';

test('AIROUTER-EMPTY-1: an empty response field falls through to choices', () => {
  const res = { response: '', choices: [{ message: { content: '{"files":[]}' } }] };
  assert.equal(textOf(res), '{"files":[]}');
  assert.equal(replyProblem(res, textOf(res)), null);
  assert.equal(textOf({ response: 'hi' }), 'hi');
  assert.equal(textOf({}), '');
});

test('LOOP-SHIP-1: the code agent is not held to the free-tier neuron cap', () => {
  assert.equal(codeNeuronCap({}), 150000);
  assert.equal(codeNeuronCap({ AI_CODE_NEURONS_DAY: '50000' }), 50000);
  assert.ok(codeNeuronCap({}) > 8000);
});
