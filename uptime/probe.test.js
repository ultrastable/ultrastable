// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHost } from './probe.js';
const doh = (status, data) => new Response(JSON.stringify({ Status: status, Answer: data ? [{ data }] : [] }), { status: 200 });
test('a host with DNS answers and HTTP 200 is ok', async () => {
  const f = async (u) => String(u).includes('type=NS') ? doh(0, 'grace.ns.cloudflare.com.') : String(u).includes('dns') ? doh(0, '::1') : new Response('x', { status: 200 });
  assert.equal((await checkHost('ultrastable.org', { fetchImpl: f, expectNs: ['grace.ns.cloudflare.com'] })).verdict, 'ok');
});
test('NXDOMAIN on both resolvers is a dns verdict', async () => {
  const f = async (u) => String(u).includes('dns') ? doh(3) : Promise.reject(new Error('getaddrinfo'));
  assert.equal((await checkHost('ultrastable.org', { fetchImpl: f })).verdict, 'dns');
});
test('DNS fine but HTTP 404 is an http verdict', async () => {
  const f = async (u) => String(u).includes('dns') ? doh(0, '::1') : new Response('', { status: 404 });
  assert.equal((await checkHost('www.ultrastable.app', { fetchImpl: f })).verdict, 'http');
});
test('a blip is retried before a host is called dead', async () => {
  const { checkAll } = await import('./probe.js'); let n = 0;
  const f = async (u) => String(u).includes('dns') ? doh(0, '::1') : (++n === 1 ? new Response('', { status: 503 }) : new Response('', { status: 200 }));
  assert.equal((await checkAll(['ultrastable.org'], { fetchImpl: f }))[0].verdict, 'ok');
});
