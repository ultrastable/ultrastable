// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-32 (open standards and agent-consumable surfaces), the formats the Worker writes: the CloudEvents 1.0 envelope shared by every loop, RFC 9457 problem
// details on the shared error path and schema.org JSON-LD built from the page's own spec. Each test is named by the requirement it proves; nothing uses the
// network or the real clock for an assertion (a generated id or time is only checked for shape).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { envelope, conforms, unwrap, isCloudEvent, eventType, newId, SPECVERSION, TYPE_PREFIX, cloudEvent, cloudEventErrors, toHttp, CONTENT_TYPE } from '../src/cloudevents.js';
import { userError, userJson, say, plain, classify, problem, PROBLEM_TYPE, PROBLEM_CONTENT_TYPE, backendRecord } from '../src/errors.js';
import { linkedData, jsonLd } from '../src/contract.js';

const VEC = JSON.parse(readFileSync(new URL('../../standards/cloudevents-vectors.json', import.meta.url), 'utf8'));
const OK = { specversion: '1.0', id: '1', source: '/s', type: 'io.ultrastable.a.b' };

// ---- CloudEvents ------------------------------------------------------------------------------------------------------------------

test('US-32-R59: the envelope builder yields a CloudEvents 1.0 event of type io.ultrastable.<area>.<event> and refuses to build one that does not conform', () => {
  assert.equal(SPECVERSION, '1.0'); assert.equal(TYPE_PREFIX, 'io.ultrastable.');
  const e = envelope({ area: 'item', event: 'done', source: '/tenants/t/loops/tick', subject: 'Q-1', data: { ok: true }, time: Date.UTC(2026, 10, 25), id: 'abc' });
  assert.deepEqual(e, { specversion: '1.0', id: 'abc', source: '/tenants/t/loops/tick', type: 'io.ultrastable.item.done', subject: 'Q-1', time: '2026-11-25T00:00:00.000Z', datacontenttype: 'application/json', data: { ok: true } });
  const bare = envelope({ area: 'a', event: 'b', source: '/s', time: '2026-11-25T00:00:00Z' });
  assert.deepEqual(Object.keys(bare), ['specversion', 'id', 'source', 'type', 'time'], 'no data means no datacontenttype; an empty subject is left out');
  assert.match(bare.id, /^[0-9a-f]{32}$/); assert.match(newId(), /^[0-9a-f]{32}$/); assert.notEqual(newId(), newId());
  assert.match(envelope({ area: 'a', event: 'b', source: '/s' }).time, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/, 'time defaults to now, in RFC 3339');
  assert.equal(envelope({ area: 'a', event: 'b', source: '/s', subject: '' }).subject, undefined);
  assert.equal(envelope({ type: 'com.example.thing', source: '/s' }).type, 'com.example.thing', 'an explicit type is kept');
  assert.equal(eventType('Hand Off', 'Verify Failed.Now'), 'io.ultrastable.hand-off.verify-failed.now', 'parts are lower-cased and cleaned, the dot between event parts stays');
  assert.throws(() => eventType('', 'b'), /needs an area and an event/); assert.throws(() => eventType('a', ''), /needs an area and an event/);
  assert.throws(() => envelope({ area: 'a', event: 'b' }), /not a CloudEvent: source must be a non-empty string/);
  assert.throws(() => envelope({ area: 'a', event: 'b', source: '/s', extensions: { origin: { class: 'loop' } } }), /extension attribute origin must be a string, number or boolean/);
  assert.throws(() => envelope({ area: 'a', event: 'b', source: '/s', extensions: { Bad_Name: 1 } }), /attribute name Bad_Name/);
  assert.equal(envelope({ area: 'a', event: 'b', source: '/s', extensions: { tenant: 'x', n: 2, ok: true } }).tenant, 'x', 'an extension attribute may be a string, a number or a boolean');
});

test('US-32-R60: conformance names every way an event breaks the specification, and the shared vectors are the contract the JavaScript and Python twins both pass', () => {
  assert.deepEqual(conforms(OK), []);
  assert.deepEqual(conforms(null), ['an event is a JSON object']); assert.deepEqual(conforms([]), ['an event is a JSON object']);
  const bad = (patch, re) => assert.ok(conforms({ ...OK, ...patch }).some(m => re.test(m)), JSON.stringify(patch));
  bad({ specversion: '0.3' }, /specversion must be "1\.0"/); bad({ id: '' }, /id must be a non-empty string/); bad({ source: 'a b' }, /source must be a URI-reference/);
  bad({ type: 7 }, /type must be a non-empty string/); bad({ subject: '' }, /subject must be a non-empty string when present/); bad({ datacontenttype: 1 }, /datacontenttype must be a non-empty string/);
  bad({ time: '2026-11-25' }, /time must be an RFC 3339 timestamp/); bad({ data: 1, data_base64: 'eA==' }, /data and data_base64 are exclusive/);
  bad({ 'bad-name': 1 }, /attribute name bad-name must be lower-case letters and digits/); bad({ ext: [1] }, /extension attribute ext must be a string, number or boolean/);
  assert.deepEqual(conforms({ ...OK, time: '2026-11-25T00:00:00+02:00' }), [], 'an RFC 3339 offset is accepted');
  assert.deepEqual(conforms({ ...OK, data_base64: 'eA==' }), [], 'data_base64 is a core attribute');
  assert.ok(VEC.valid.length > 0 && VEC.invalid.length > 0);
  for (const e of VEC.valid) assert.deepEqual(conforms(e), [], JSON.stringify(e));
  for (const v of VEC.invalid) assert.ok(conforms(v.event).length > 0, v.why);
});

test('US-32-R61: a reader unwraps an io.ultrastable envelope to its payload and takes an older row or a foreign event as it is', () => {
  const old = { state: 'merged' };
  assert.equal(unwrap(old), old); assert.equal(unwrap(null), null);
  const mine = envelope({ area: 'handoff', event: 'merged', source: '/s', data: old });
  assert.deepEqual(unwrap(mine), old);
  const foreign = { specversion: '1.0', id: '1', source: '/x', type: 'com.example.thing', data: { a: 1 } };
  assert.equal(isCloudEvent(foreign), true); assert.equal(unwrap(foreign), foreign);
  const scalar = envelope({ area: 'a', event: 'b', source: '/s', data: 'text' }); assert.equal(unwrap(scalar), scalar, 'a payload that is not an object leaves the envelope in place');
  assert.equal(isCloudEvent({ specversion: '1.0', type: 't' }), false); assert.equal(isCloudEvent('x'), false);
});

test('US-32-R62: the kit forms build an event whose id is stable for its content, send it in structured mode and report errors by name', async () => {
  const args = { type: 'io.ultrastable.tick.done', source: '/ultrastable/tick', data: { ok: 1 }, time: '2026-11-25T21:00:00Z' };
  const a = await cloudEvent(args), b = await cloudEvent(args), c = await cloudEvent({ ...args, data: { ok: 2 } });
  assert.equal(a.id, b.id); assert.notEqual(a.id, c.id); assert.match(a.id, /^[0-9a-f]{24}$/);
  assert.equal(a.datacontenttype, 'application/json'); assert.equal((await cloudEvent({ type: 't', source: '/s', subject: 'q', dataschema: 'https://x.example/s.json', tenant: 'x' })).subject, 'q');
  assert.equal((await cloudEvent({ type: 't', source: '/s', id: 'mine' })).id, 'mine'); assert.equal('data' in (await cloudEvent({ type: 't', source: '/s' })), false);
  await assert.rejects(cloudEvent({ type: 't', source: '/s', BadExt: 1 }), /lower-case alphanumerics/);
  await assert.rejects(cloudEvent({ type: 't', source: '/s', toolongextensionnamethatexceeds: 1 }), /lower-case alphanumerics/);
  const http = toHttp(a); assert.equal(CONTENT_TYPE, 'application/cloudevents+json'); assert.equal(http.headers['content-type'], CONTENT_TYPE); assert.deepEqual(JSON.parse(http.body), a);
  assert.deepEqual(cloudEventErrors(a), []);
  assert.deepEqual(cloudEventErrors({ specversion: '1.0', id: 'x', source: '/s' }), ['missing type']);
  assert.ok(cloudEventErrors({ specversion: '2.0', id: 'x', source: '/s', type: 't' }).includes('specversion must be 1.0'));
  assert.ok(cloudEventErrors({ ...OK, time: 'yesterday' }).includes('time must be RFC 3339'));
  assert.ok(cloudEventErrors({ ...OK, Bad_Name: 1 }).some(m => m.includes('Bad_Name')));
});

// ---- Problem details and structured data ------------------------------------------------------------------------------------------------

test('US-32-R70: an error on the shared path is an RFC 9457 problem with a stable type and title, a detail written for people and an instance that names this occurrence', async () => {
  const seen = [];
  const r = userJson(new Error('D1_ERROR: exceeded row read limit 7500 on table tick_runs'), 'tick', { audit: rec => seen.push(rec) });
  assert.equal(PROBLEM_CONTENT_TYPE, 'application/problem+json; charset=utf-8'); assert.equal(r.headers.get('content-type'), PROBLEM_CONTENT_TYPE); assert.equal(r.headers.get('cache-control'), 'no-store');
  const b = await r.json();
  assert.equal(r.status, 503); assert.equal(b.status, 503); assert.equal(b.ok, false); assert.equal(b.code, 'limit');
  assert.equal(b.type, PROBLEM_TYPE + 'limit'); assert.equal(PROBLEM_TYPE, 'tag:ultrastable.io,2026:problem:'); assert.equal(b.title, 'Daily allowance reached');
  assert.equal(b.detail, b.error); assert.match(b.instance, /^urn:ultrastable:occurrence:[0-9a-f]{16}$/);
  await new Promise(res => setTimeout(res, 0));
  assert.equal(seen[0].instance, b.instance, 'the owner-only record carries the occurrence the person was shown'); assert.equal(seen[0].where, 'tick');
  const t = userError(new Error('x'), 'w'), t2 = userError(new Error('y'), 'w'); assert.equal(t.title, 'Internal error'); assert.equal(t.title, t2.title); assert.notEqual(t.instance, t2.instance);
  assert.equal(userError(new Error('x'), 'w', { instance: 'urn:x:1' }).instance, 'urn:x:1');
  assert.deepEqual(Object.keys(problem({ code: 'x', status: 404, message: 'm' }, 'urn:i')).sort(), ['detail', 'instance', 'status', 'title', 'type']);
  assert.equal(problem({ code: 'a b/c', status: 404 }, 'i').type, PROBLEM_TYPE + 'a-b-c'); assert.equal(problem({ code: 'unlisted', status: 409 }, 'i').title, 'Conflict');
});

test('US-32-R71: raw backend text never reaches a person: unknown errors are classified into plain words, and only a deliberate message passes as it is', async () => {
  for (const [msg, code, status] of [['D1 free tier row read limit 7500', 'limit', 503], ['The operation timed out', 'timeout', 504], ['fetch failed ECONNRESET', 'network', 502], ['401 unauthorized', 'auth', 401], ['no such table: items', 'internal', 500]]) {
    const p = plain(new Error(msg)); assert.equal(classify(new Error(msg)), code, msg); assert.equal(p.code, code); assert.equal(p.status, status);
    assert.ok(!p.message.includes(msg), 'the backend text is not the message: ' + msg); assert.match(p.message, /^[A-Z].*\.$/);
  }
  const s = say('This idea is a one-off, not a system.', 422, 'not_a_fit');
  assert.deepEqual(plain(s), { code: 'not_a_fit', status: 422, message: 'This idea is a one-off, not a system.' });
  assert.equal(plain(say('x'.repeat(500))).message.length, 240, 'a deliberate message is cut to 240 characters');
  assert.deepEqual(plain(say('plain')), { code: 'bad_request', status: 400, message: 'plain' });
  const fb = { code: 'sign_in_failed', status: 400, message: 'That sign-in did not work.' };
  assert.deepEqual(plain(new Error('anything unexpected'), { fallback: fb }), fb, 'a surface whose unexpected errors are the caller input failing says so in its own words');
  assert.equal(plain(new Error('timeout reached'), { fallback: fb }).code, 'timeout', 'the fallback replaces only an internal error');
  const lines = []; const orig = console.error; console.error = (...a) => lines.push(a.join(' '));
  try { backendRecord(new Error('detail ' + 'x'.repeat(800)), 'where'); const failing = userError(new Error('boom'), 'w', { audit: () => { throw new Error('audit down'); } }); assert.equal(failing.ok, false); await new Promise(res => setTimeout(res, 5)); } finally { console.error = orig; }
  assert.ok(lines[0].startsWith('backend_error ') && JSON.parse(lines[0].slice(14)).detail.length === 600, 'the owner-only record keeps 600 characters of detail');
  assert.ok(lines.some(l => l.startsWith('backend_error audit failed')), 'an audit hook that fails is reported and does not fail the request');
});

test('US-32-R72: a page states what it is as schema.org JSON-LD built from the spec the page renders, and the markup cannot break out of its script element', () => {
  const ld = linkedData({ name: 'Club', summary: '  A  club\nsite ', url: 'https://club.example/?x=1#y', repo: 'org/club' });
  assert.equal(ld['@context'], 'https://schema.org'); assert.equal(ld['@type'], 'WebSite'); assert.equal(ld.name, 'Club'); assert.equal(ld.url, 'https://club.example');
  assert.equal(ld.description, 'A  club site'); assert.deepEqual(ld.isPartOf, { '@type': 'WebSite', name: 'Ultrastable', url: 'https://ultrastable.io' });
  assert.deepEqual(ld.mainEntity, { '@type': 'SoftwareApplication', name: 'Club', applicationCategory: 'WebApplication', operatingSystem: 'Any', description: 'A  club site', url: 'https://club.example',
    isBasedOn: { '@type': 'SoftwareSourceCode', codeRepository: 'https://github.com/org/club', license: 'https://github.com/org/club/blob/main/LICENSE' } });
  const minimal = linkedData({ name: 'N' }); assert.equal('url' in minimal, false); assert.equal('description' in minimal.mainEntity, false); assert.equal('isBasedOn' in minimal.mainEntity, false);
  const tag = jsonLd({ name: '</script><b>' });
  assert.match(tag, /^<script type="application\/ld\+json">.*<\/script>$/); assert.ok(!tag.slice(0, -9).includes('</script'), 'a "<" inside a value is escaped');
  assert.equal(JSON.parse(tag.slice('<script type="application/ld+json">'.length, -9)).name, '</script><b>');
  assert.equal(jsonLd({}), '', 'a page with no name carries no markup');
});

test('US-32-T09: a loop emits an envelope and a person-facing error from the same two modules, and each reads back without the other', async () => {
  const ev = envelope({ area: 'handoff', event: 'verify_failed', source: '/tenants/t/loops/handoff', subject: 'o/r#1', data: { state: 'verify_failed' } });
  assert.deepEqual(conforms(ev), []); assert.equal(ev.type, 'io.ultrastable.handoff.verify_failed');
  const body = await userJson(new Error('socket hang up'), 'handoff').json();
  assert.equal(body.type, PROBLEM_TYPE + 'network'); assert.equal(body.status, 502);
});
