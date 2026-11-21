// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// RESEARCH-1: propose further links between a study's findings and the standing rules, with the core connection engine (CONNECT-1).
// Input on stdin: {"findings": [{id, text, mapped: [rule ids]}], "rules": [{id, text}]}. Output on stdout: {"route", "leads": [{finding, rule, score}]}.
// The lexical route needs no network and no credential, so the research pass always completes. A lead is a proposal, never a fact: the paper
// lists it as one, and a finding's mapped mechanisms change only when a person or agent adds them to the study file.
import { lexicalEmbedder, embedAll, nearest } from "../workers/core/connect/index.js";

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
const findings = input.findings || [], rules = input.rules || [];
const items = [...findings.map(f => ({ id: "f:" + f.id, text: f.text })), ...rules.map(r => ({ id: "r:" + r.id, text: r.text }))];
if (!findings.length || !rules.length) { process.stdout.write(JSON.stringify({ route: null, leads: [] })); process.exit(0); }
const { route, vectors } = await embedAll(items, { embedders: [lexicalEmbedder(items.map(i => i.text))] });
// The cutoff is the run's own background (mean + 2 sd over every finding-rule pair), as core/connect does, so it holds for any embedding route.
const all = findings.flatMap(f => nearest(vectors, vectors.get("f:" + f.id), { k: rules.length, filter: id => id.startsWith("r:") }).map(n => n.score));
const mean = all.reduce((a, b) => a + b, 0) / all.length, sd = Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length), cutoff = mean + 2 * sd;
const leads = [];
for (const f of findings) {
  const mapped = new Set((f.mapped || []).map(m => "r:" + m));
  for (const n of nearest(vectors, vectors.get("f:" + f.id), { k: 2, filter: id => id.startsWith("r:"), exclude: mapped }))
    if (n.score > cutoff) leads.push({ finding: f.id, rule: n.id.slice(2), score: Number(n.score.toFixed(3)) });
}
process.stdout.write(JSON.stringify({ route, cutoff: Number(cutoff.toFixed(3)), leads }));
