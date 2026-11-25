// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The OpenAlex egress that is not Cloudflare. Run daily on a GitHub runner by .github/workflows/ledger-openalex.yml:
//   node instances/replication-ledger/worker/openalex-mirror.mjs [out]
// For every finding the live ledger lists (/api/findings; the seed when the site does not answer) it asks OpenAlex the beat's own question
// (openalexCandidates in discover.js) and runs the beat's own discovery search (discoverFindings), then writes data/openalex.json, which
// the Worker bundles and reads when OpenAlex refuses it (mirror.js). It reads nothing secret and needs no key. The file is rewritten only
// when its content changed (SUBSTANCE-1: no rewrite for a timestamp alone). Exit 1 when OpenAlex answered no finding at all, so a run that
// learned nothing is a red run, not a quiet one; the previous file is kept.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openalexCandidates, discoverFindings, abstractText, SEARCHES } from "./discover.js";
import { compact, MIRROR_VERSION } from "./mirror.js";
import { doiKey } from "./ledger.js";

export const SITE = "https://replication-ledger.ultrastable.org";
export const MAX_FINDINGS = 200;
const here = p => fileURLToPath(new URL(p, import.meta.url));

export async function findingsToMirror(fetchImpl = fetch, seedPath = here("./data/findings.json")) {
  try {
    const r = await fetchImpl(`${SITE}/api/findings`, { headers: { accept: "application/json", "user-agent": "replication-ledger-mirror/1 (+https://github.com/ultrastable/ultrastable)" } });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j?.findings) && j.findings.length) return { from: "live", findings: j.findings }; }
    console.log(`live ledger answered ${r.status}; using the seed`);
  } catch (e) { console.log(`live ledger unreachable (${e?.message || e}); using the seed`); }
  return { from: "seed", findings: JSON.parse(readFileSync(seedPath, "utf8")).findings };
}

const pause = ms => new Promise(r => setTimeout(r, ms));

export async function buildMirror(findings, { fetchImpl = fetch, now = new Date().toISOString(), gap = 150, searches = SEARCHES.length } = {}) {
  const out = { version: MIRROR_VERSION, generated_at: now, route: "github-actions", findings: {}, discovered: [], errors: [] };
  let answered = 0;
  for (const f of findings.filter(x => x?.id && x.original?.doi).slice(0, MAX_FINDINGS)) {
    try {
      const r = await openalexCandidates(f, fetchImpl);
      answered++;
      if (!r) { out.findings[f.id] = { doi: f.original.doi, openalex: null, works: [] }; continue; }
      out.findings[f.id] = { doi: f.original.doi, openalex: r.orig.id, is_retracted: !!r.orig.is_retracted, cited_by_count: r.orig.cited_by_count ?? null,
        works: r.works.map(w => compact(w, abstractText(w.abstract_inverted_index))) };
    } catch (e) { out.errors.push(`${f.id}: ${String(e?.message || e).slice(0, 160)}`); }
    if (gap) await pause(gap);
  }
  // Discovery: every rotating search once a day, so the Worker gets the beat's candidates without asking OpenAlex itself.
  const knownDois = new Set(findings.map(f => doiKey(f.original?.doi)).filter(Boolean)), knownIds = new Set(findings.map(f => f.id));
  for (let i = 0; i < searches; i++) {
    try { out.discovered.push(...(await discoverFindings(i, { fetchImpl, knownDois, knownIds })).found); }
    catch (e) { out.errors.push(`discover ${SEARCHES[i % SEARCHES.length]}: ${String(e?.message || e).slice(0, 160)}`); }
  }
  out.errors.sort();
  return { mirror: out, answered };
}

// Same content apart from when it was written?
export const sameContent = (a, b) => JSON.stringify({ ...a, generated_at: null, _doc: null }) === JSON.stringify({ ...b, generated_at: null, _doc: null });

export async function main(outPath = here("./data/openalex.json"), fetchImpl = fetch) {
  const { from, findings } = await findingsToMirror(fetchImpl);
  const { mirror, answered } = await buildMirror(findings, { fetchImpl });
  console.log(`findings from ${from}: ${findings.length}; OpenAlex answered ${answered}; discovered ${mirror.discovered.length}; errors ${mirror.errors.length}`);
  for (const e of mirror.errors.slice(0, 20)) console.log("  error:", e);
  if (mirror.errors.length > 20) console.log(`  (${mirror.errors.length - 20} more errors not shown)`);
  if (!answered) { console.error("OpenAlex answered no finding; the previous mirror is kept"); return 1; }
  let prev = null;
  try { prev = JSON.parse(readFileSync(outPath, "utf8")); } catch (e) { console.log(`no previous mirror (${e.code || e.message})`); }
  mirror._doc = prev?._doc || "Written by openalex-mirror.mjs on a GitHub runner (workflow ledger-openalex.yml), read by the Worker's beat when OpenAlex refuses it (mirror.js). Do not edit by hand.";
  if (prev && sameContent(prev, mirror)) { console.log("mirror unchanged; not rewritten"); return 0; }
  const { _doc, ...rest } = mirror;
  writeFileSync(outPath, JSON.stringify({ _doc, ...rest }, null, 1) + "\n");
  console.log(`wrote ${outPath}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main(process.argv[2] || undefined);
