// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Verify a published release (US-19-R16, T19-5): fetch bundle.js, migrations.sql, manifest.json (and manifest.sig) from a base address or a
// directory, recompute every hash, check the manifest names a version, products and permissions, optionally verify the Ed25519 signature,
// and optionally that a running launcher shows the same bundle hash on /health. This is the check a CI-published release must pass.
// Usage: node tools/verify_release.mjs --base <url-or-directory> [--public-key <base64 raw key>] [--require-signature] [--launcher <url>]
// Exit 0 verified; 3 a hash, signature or fingerprint does not match; 2 a file is missing, cannot be read (a network or disk error) or the arguments are wrong.
// The report says whether a signature was checked: `signature` is 'verified' (a key was given and the signature matched), 'unchecked' (a manifest.sig is
// published but was not checked, or did not verify) or 'absent' (no manifest.sig was read). --require-signature turns anything but 'verified' into
// exit 3, a missing manifest.sig included; without it, a key with no manifest.sig published is a missing file (exit 2).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyBundle } from '../core/install/index.js';

export const EXIT = { ok: 0, usage: 2, mismatch: 3 };
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** A reader for `base`: an http(s) address (through `fetchImpl`) or a directory. Returns text, or null when the file is not there. */
export function reader(base, fetchImpl = fetch) {
  if (/^https?:\/\//i.test(base)) {
    return async name => {
      const r = await fetchImpl(`${base.replace(/\/+$/, '')}/${name}`, { redirect: 'follow' });
      return r.ok ? r.text() : null;
    };
  }
  return async name => readFile(path.join(base, name), 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
}

/**
 * @param {{ read: (name:string)=>Promise<string|null>, publicKey?: string, launcher?: string, fetchImpl?: Function }} p
 * @returns {Promise<{ ok: boolean, exit: number, problems: string[], manifest?: object }>}
 */
export async function verifyRelease({ read, publicKey = null, requireSignature = false, launcher = null, fetchImpl = fetch }) {
  const problems = [];
  const files = {};
  const get = async n => { try { return await read(n); } catch (e) { problems.push(`${n} could not be read: ${String(e?.message || e).slice(0, 200)}`); return null; } };
  for (const n of ['bundle.js', 'migrations.sql', 'manifest.json']) { files[n] = await get(n); if (files[n] === null && !problems.some(p => p.startsWith(`${n} `))) problems.push(`${n} is missing`); }
  files['manifest.sig'] = await get('manifest.sig');
  const noSig = files['manifest.sig'] === null, sigUnread = problems.some(p => p.startsWith('manifest.sig '));
  const unverified = noSig ? 'absent' : 'unchecked'; // what the report says whenever the signature did not get checked and matched
  if (publicKey && noSig && !sigUnread && !requireSignature) problems.push('manifest.sig is missing');
  if (problems.length) return { ok: false, exit: EXIT.usage, problems, signature: unverified };
  if (requireSignature && noSig) return { ok: false, exit: EXIT.mismatch, problems: ['signature_missing'], signature: 'absent' };
  const v = await verifyBundle({ bundle: files['bundle.js'], migrations: files['migrations.sql'], manifestText: files['manifest.json'], signature: files['manifest.sig']?.trim() }, { publicKey, requireSignature });
  // verifyBundle reads the manifest, then checks the signature, then the digests: only a failure after the signature check leaves it verified.
  const checked = v.ok || ['manifest_has_no_digest', 'digest_mismatch'].includes(v.reason);
  const signature = publicKey && checked ? 'verified' : unverified;
  if (!v.ok) return { ok: false, exit: EXIT.mismatch, problems: [`${v.reason}${v.part ? ` (${v.part})` : ''}`], signature };
  const m = v.manifest;
  if (!SEMVER.test(String(m.version))) problems.push(`manifest version "${m.version}" is not a semantic version`);
  for (const k of ['products', 'permissions']) if (!Array.isArray(m[k]) || !m[k].length) problems.push(`manifest names no ${k}`);
  if (launcher) {
    let release = null;
    try { release = (await (await fetchImpl(`${launcher.replace(/\/+$/, '')}/health`)).json()).release; } catch { problems.push('the launcher did not answer /health'); }
    if (release !== null && release !== m.bundle_sha256) problems.push(`the launcher shows bundle ${String(release).slice(0, 12)} but the release is ${m.bundle_sha256.slice(0, 12)}`);
  }
  return { ok: problems.length === 0, exit: problems.length ? EXIT.mismatch : EXIT.ok, problems, signature, manifest: m };
}

export async function main(argv, { fetchImpl = fetch, log = console.log } = {}) {
  const get = k => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const base = get('--base');
  if (!base) { log('usage: node tools/verify_release.mjs --base <url-or-directory> [--public-key <base64>] [--require-signature] [--launcher <url>]'); return EXIT.usage; }
  const r = await verifyRelease({ read: reader(base, fetchImpl), publicKey: get('--public-key') || null, requireSignature: argv.includes('--require-signature'), launcher: get('--launcher') || null, fetchImpl });
  log(JSON.stringify({ ok: r.ok, signature: r.signature, problems: r.problems, version: r.manifest?.version, bundle_sha256: r.manifest?.bundle_sha256 }));
  return r.exit;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
