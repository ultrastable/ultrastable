// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Certification by a party other than the implementer (US-SPEC-00 status). The manifest is produced and checked by the implementation itself, so
// on its own it proves nothing to an outsider. This module is the part that can be built here:
//   attest(...)             what an attester signs: the declaration and the digests of the exact specification and test files it was derived from
//   verifyAttestation(...)  what an outside party runs in its own checkout: it REBUILDS the manifest from the texts it holds and compares; it never
//                           trusts the manifest, the declaration or the digests inside the attestation
// `certified` needs three things: the attester is not the implementation, nothing differs, and a signature port the verifier supplies says the
// attestation was signed. The signing key and the outside party's act are not in this repository: with no signature check the result is never
// certified (a reading with nothing behind it is not a pass).
import { buildManifest, declaration, testFiles } from './index.js';

const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

export async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** JSON with sorted keys, so the same value always gives the same text. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** The claims of a manifest that follow from the specification and test texts alone: requirement, level, status and the files that prove it.
 *  (A deviation's reason may be written by hand and is not part of what a verifier can re-derive.) */
export function claimsOf(manifest) {
  return manifest.requirements.map(r => `${r.id}|${r.level}|${r.status}|${(r.tests || []).map(t => t.file).join(',')}`).sort();
}

/** The text a signer signs: the attestation without its signature. */
export const attestationBody = att => canonical({ ...att, signature: undefined });

/** specs: [{ file, text }]; tests: [{ path, text }] (every test file of the tree). Returns the attestation, unsigned (`signature: null`). */
export async function attest({ manifest, specs, tests, attested_by, now = Date.now() }) {
  if (!attested_by || !String(attested_by).trim()) throw new Error('an attestation names who attests it');
  const named = Object.fromEntries(tests.map(t => [t.path, t.text]));
  const digests = { manifest: await sha256Hex(canonical(manifest)), claims: await sha256Hex(claimsOf(manifest).join('\n')), specs: {}, tests: {} };
  for (const s of specs) digests.specs[s.file] = await sha256Hex(s.text);
  for (const f of testFiles(manifest, 'L3')) if (named[f] !== undefined) digests.tests[f] = await sha256Hex(named[f]);
  return { implementation: manifest.implementation, attested_by: String(attested_by).trim(), at: iso(now), declaration: declaration(manifest), digests, signature: null };
}

/** Verify an attestation against the texts the verifier holds. specs and tests as for attest(). `verifySignature(att)` is a port (sync or async) that answers
 *  whether the attestation was signed by the attester; without it the attestation is never certified. */
export async function verifyAttestation(att, { specs, tests, verifySignature = null }) {
  const problems = [];
  const heldSpecs = Object.fromEntries(specs.map(s => [s.file, s.text])); const heldTests = Object.fromEntries(tests.map(t => [t.path, t.text]));
  // An attestation that leaves a digest out pins nothing there: a signed attestation with the specification and test digests deleted would otherwise
  // be certified over a specification whose MUST was weakened to MAY and over a test file that was gutted. A missing digest is a problem, never a skip.
  const d = att.digests;
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(d)) problems.push('the attestation carries no digests, so it pins neither the specification texts nor the test files');
  else {
    for (const k of ['manifest', 'claims']) if (typeof d[k] !== 'string' || !d[k]) problems.push(`the attestation does not carry the ${k} digest`);
    if (!isObj(d.specs)) problems.push('the attestation does not pin the specification texts (no specs digests)');
    if (!isObj(d.tests)) problems.push('the attestation does not pin the test files (no tests digests)');
  }
  for (const [file, want] of Object.entries(att.digests?.specs || {})) {
    if (heldSpecs[file] === undefined) problems.push(`specification ${file} is not in the verifier checkout`);
    else if (await sha256Hex(heldSpecs[file]) !== want) problems.push(`specification ${file} differs from the attested text`);
  }
  for (const s of specs) if (att.digests?.specs && att.digests.specs[s.file] === undefined) problems.push(`specification ${s.file} is not covered by the attestation`);
  for (const [file, want] of Object.entries(att.digests?.tests || {})) {
    if (heldTests[file] === undefined) problems.push(`test file ${file} is not in the verifier checkout`);
    else if (await sha256Hex(heldTests[file]) !== want) problems.push(`test file ${file} differs from the attested text`);
  }
  // The verifier builds its own manifest: nothing below reads the one the attester published.
  const level = att.declaration?.level;
  const rebuilt = buildManifest({ specs, tests, declared: level, implementation: att.implementation });
  if (isObj(d?.tests)) for (const f of testFiles(rebuilt, 'L3')) if (heldTests[f] !== undefined && d.tests[f] === undefined) problems.push(`test file ${f} proves a requirement and is not covered by the attestation`);
  const redo = declaration(rebuilt);
  const claims = await sha256Hex(claimsOf(rebuilt).join('\n'));
  if (claims !== att.digests?.claims) problems.push('the requirements and the tests that prove them, re-derived here, are not the ones attested');
  if (canonical(redo.spec_versions) !== canonical(att.declaration?.spec_versions)) problems.push('the specification versions declared are not the ones in the specifications held here');
  if (canonical(redo.levels) !== canonical(att.declaration?.levels)) problems.push('the declared counts per level differ from the counts re-derived here');
  if (redo.highest_clean_level !== att.declaration?.highest_clean_level) problems.push('the declared highest clean level differs from the one re-derived here');
  const independent = String(att.attested_by || '').trim().toLowerCase() !== String(att.implementation || '').trim().toLowerCase() && Boolean(String(att.attested_by || '').trim());
  let signed = false;
  if (typeof verifySignature === 'function') { try { signed = (await verifySignature(att)) === true; } catch { signed = false; } }
  return { ok: problems.length === 0, independent, signed, certified: problems.length === 0 && independent && signed, problems, rebuilt: { level: redo.level, levels: redo.levels, requirements: rebuilt.requirements.length } };
}

