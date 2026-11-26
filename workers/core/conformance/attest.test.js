// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-00-R03: certification by a party other than the implementer. The attestation and the independent verifier are built here; the outside
// party's own act (running the verifier in their checkout and signing) is the one thing that is not. The signature check is a port, faked below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, declaration } from './index.js';
import { attest, verifyAttestation, attestationBody, sha256Hex, canonical } from './attest.js';

const SPEC = { file: 'US-SPEC-90-example.md', text: `# US-SPEC-90: Example
| Field | Value |
|---|---|
| Version | 0.3.0 (draft) |

- **US-90-R01 [L1]** An implementation MUST do the first thing.
- **US-90-R02 [L2]** An implementation SHOULD do the second thing.
- **US-90-R03 [L2]** An implementation SHOULD do the third thing.
` };
const TESTS = [
  { path: 'core/a/a.test.js', text: `test('US-90-R01: does the first thing', () => {});` },
  { path: 'core/b/b.test.js', text: `test('US-90-R02: does the second thing', () => {});` },
];
const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
// A fake signer: the signature is a digest of the attestation body, so tampering with anything signed breaks it. A real signer is outside this repository.
const sign = async att => ({ ...att, signature: `fake:${await sha256Hex(attestationBody(att))}` });
const verifySignature = async att => att.signature === `fake:${await sha256Hex(attestationBody(att))}`;
const make = async (by = 'outside-auditor', over = {}) => {
  const manifest = buildManifest({ specs: [SPEC], tests: TESTS, declared: 'L2', implementation: 'ultrastable/workers', ...over });
  return { manifest, att: await sign(await attest({ manifest, specs: [SPEC], tests: TESTS, attested_by: by, now: NOW })) };
};

test('US-00-R03: an attestation by another party, over untouched files and signed, verifies and is certified; the verifier rebuilt the counts itself', async () => {
  const { manifest, att } = await make();
  assert.equal(att.attested_by, 'outside-auditor'); assert.equal(att.at, '2026-11-26 12:00:00');
  assert.deepEqual(att.declaration, declaration(manifest));
  const r = await verifyAttestation(att, { specs: [SPEC], tests: TESTS, verifySignature });
  assert.deepEqual([r.ok, r.independent, r.signed, r.certified, r.problems], [true, true, true, true, []]);
  assert.deepEqual(r.rebuilt, { level: 'L2', levels: att.declaration.levels, requirements: 3 });
});

test('US-00-R03: tampering with a specification, a test file or the declaration fails verification', async () => {
  const { att } = await make();
  const spec = await verifyAttestation(att, { specs: [{ ...SPEC, text: SPEC.text.replace('SHOULD do the third', 'MAY do the third') }], tests: TESTS, verifySignature });
  assert.equal(spec.ok, false); assert.ok(spec.problems.some(p => /specification US-SPEC-90-example\.md differs from the attested text/.test(p)));
  const test_ = await verifyAttestation(att, { specs: [SPEC], tests: [TESTS[0], { ...TESTS[1], text: `test('renamed', () => {});` }], verifySignature });
  assert.ok(test_.problems.some(p => /test file core\/b\/b\.test\.js differs/.test(p)));
  assert.ok(test_.problems.some(p => /not the ones attested/.test(p)), 'the claims re-derived without the citation differ too');
  const lied = structuredClone(att); lied.declaration.levels.L2.met = 3; lied.declaration.levels.L2.deviations = 0;
  const decl = await verifyAttestation(lied, { specs: [SPEC], tests: TESTS, verifySignature });
  assert.ok(decl.problems.some(p => /declared counts per level differ/.test(p)));
  assert.equal(decl.signed, false, 'the signature no longer matches the body');
  assert.equal(decl.certified, false);
  const missing = await verifyAttestation(att, { specs: [SPEC], tests: [TESTS[0]], verifySignature });
  assert.ok(missing.problems.some(p => /test file core\/b\/b\.test\.js is not in the verifier checkout/.test(p)));
  const extra = await verifyAttestation(att, { specs: [SPEC, { file: 'US-SPEC-91-new.md', text: '| Version | 0.1.0 |\n' }], tests: TESTS, verifySignature });
  assert.ok(extra.problems.some(p => /US-SPEC-91-new\.md is not covered by the attestation/.test(p)));
});

test('US-00-R03: an attestation by the implementer is never reported certified, even over untouched files with a valid signature', async () => {
  const { att } = await make('ultrastable/workers');
  const r = await verifyAttestation(att, { specs: [SPEC], tests: TESTS, verifySignature });
  assert.equal(r.ok, true); assert.equal(r.signed, true); assert.equal(r.independent, false); assert.equal(r.certified, false);
  const same = await verifyAttestation((await make('  Ultrastable/Workers ')).att, { specs: [SPEC], tests: TESTS, verifySignature });
  assert.equal(same.independent, false, 'the comparison ignores case and padding');
  const { manifest } = await make();
  await assert.rejects(() => attest({ manifest, specs: [SPEC], tests: TESTS, attested_by: '  ' }), /names who attests/);
});

test('US-00-R03: with no signature check, or a failing one, the attestation is never certified', async () => {
  const { att } = await make();
  assert.equal((await verifyAttestation(att, { specs: [SPEC], tests: TESTS })).certified, false);
  assert.equal((await verifyAttestation(att, { specs: [SPEC], tests: TESTS, verifySignature: async () => false })).certified, false);
  assert.equal((await verifyAttestation(att, { specs: [SPEC], tests: TESTS, verifySignature: async () => { throw new Error('no key'); } })).signed, false);
  assert.equal((await verifyAttestation(att, { specs: [SPEC], tests: TESTS, verifySignature: () => 'yes' })).signed, false, 'only true counts');
});

test('US-00-R03: the verifier rebuilds the manifest itself and does not trust the one in the attestation: a forged claim of a test that does not cite it is caught', async () => {
  const manifest = buildManifest({ specs: [SPEC], tests: TESTS, declared: 'L2' });
  const r3 = manifest.requirements.find(r => r.id === 'US-90-R03');
  Object.assign(r3, { status: 'met', proof: 'named test', tests: [{ file: 'core/a/a.test.js', name: 'US-90-R03: does the first thing' }] }); delete r3.reason;   // claim a proof nobody wrote
  const forged = await sign(await attest({ manifest, specs: [SPEC], tests: TESTS, attested_by: 'outside-auditor', now: NOW }));
  const r = await verifyAttestation(forged, { specs: [SPEC], tests: TESTS, verifySignature });
  assert.equal(r.signed, true, 'the forgery is signed and its files are untouched');
  assert.equal(r.ok, false); assert.equal(r.certified, false);
  assert.ok(r.problems.some(p => /not the ones attested/.test(p)));
  assert.ok(r.problems.some(p => /declared counts per level differ/.test(p)));
});

test('US-00-R03: canonical JSON does not depend on key order, and an undefined value is dropped', async () => {
  assert.equal(canonical({ b: 1, a: [2, { d: undefined, c: 3 }] }), '{"a":[2,{"c":3}],"b":1}');
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
