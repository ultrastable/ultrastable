import test from 'node:test';
import assert from 'node:assert/strict';
import { routeEvent, verifySignature } from '../src/events.js';

const table = [
  { id: 'a', event: 'issues', actions: ['opened'], role: 'project-manager' },
  { id: 'b', event: 'pull_request', actions: ['closed'], when: 'merged', role: 'operations' },
  { id: 'c', event: 'workflow_run', actions: ['completed'], when: 'failed', role: 'operations' },
  { id: 'd', event: 'push', when: 'default-branch', role: 'operations' },
];

test('routes by event and action', () => {
  assert.equal(routeEvent('issues', { action: 'opened' }, table).role, 'project-manager');
  assert.equal(routeEvent('issues', { action: 'labeled' }, table), null);
});
test('conditions: merged only, failed only, default branch only', () => {
  assert.equal(routeEvent('pull_request', { action: 'closed', pull_request: { merged: false } }, table), null);
  assert.equal(routeEvent('pull_request', { action: 'closed', pull_request: { merged: true } }, table).id, 'b');
  assert.equal(routeEvent('workflow_run', { action: 'completed', workflow_run: { conclusion: 'success' } }, table), null);
  assert.equal(routeEvent('push', { ref: 'refs/heads/x' }, table), null);
  assert.equal(routeEvent('push', { ref: 'refs/heads/main' }, table).id, 'd');
});
test('signature: valid passes, tampered and missing fail', async () => {
  const body = '{"a":1}', secret = 's3cret';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = 'sha256=' + Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))), b => b.toString(16).padStart(2, '0')).join('');
  assert.equal(await verifySignature(secret, body, sig), true);
  assert.equal(await verifySignature(secret, body + ' ', sig), false);
  assert.equal(await verifySignature(secret, body, undefined), false);
  assert.equal(await verifySignature(undefined, body, sig), false);
});
