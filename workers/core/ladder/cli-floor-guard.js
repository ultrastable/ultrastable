// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// node core/ladder/cli-floor-guard.js [input.json]   (or JSON on stdin)
// Input: { banned: [{pattern, reason}], workers: [{name, role?, source: [{path, text}], bundle?}], exemptions?: [...] }.
// Prints one line per finding. Exit 0 when nothing is found, 1 when anything is found or a worker is unreadable.
import { readFileSync } from 'node:fs';
import { scan } from './floorguard.js';

const arg = process.argv[2];
let input;
try { input = JSON.parse(readFileSync(arg || 0, 'utf8')); } catch (e) { console.error(`floor guard: cannot read input: ${e.message}`); process.exit(2); }
const r = scan({ workers: input.workers || [], banned: input.banned || [], exemptions: input.exemptions || [] });
for (const f of r.findings) console.log(`${f.worker} ${f.where} ${f.path}:${f.line} ${f.match} (${f.reason})${f.note ? ' ' + f.note : ''}`);
for (const u of r.unmeasured) console.log(`${u} unreadable: unmeasured, not clean`);
console.log(`floor guard: ${r.findings.length} finding(s), ${r.unmeasured.length} unreadable, ${r.exempt.length} exempt`);
process.exit(r.findings.length || r.unmeasured.length ? 1 : 0);
