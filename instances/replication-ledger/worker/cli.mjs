#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The ledger's command line, the write path for new replications until the beat files them itself.
//   node worker/cli.mjs validate                 check the ledger against the data model (exit 1 on any error)
//   node worker/cli.mjs list [field]             each finding with its computed standing
//   node worker/cli.mjs verify [--record]        resolve every DOI at Crossref and compare title and year (needs network);
//                                                --record writes data/verified.json, the evidence Q-RLEDGER-VERIFY greps
//   node worker/cli.mjs add <finding> <doi> --kind K --outcome O [--prereg] --summary "..."
//       fetches the citation from Crossref by DOI (nothing typed by hand), appends the attempt, recomputes the standing, and appends
//       the change to data/changes.jsonl, so every move of a standing is logged with the paper that moved it.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate, withStandings, addReplication } from "./ledger.js";
import { STANDINGS } from "./standing.js";
import { lookup, fromCrossref, check } from "./crossref.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, "data", "findings.json");
const CHANGES = join(here, "data", "changes.jsonl");
const load = () => JSON.parse(readFileSync(DATA, "utf8"));

function flags(args) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--prereg") o.prereg = true;
    else if (a.startsWith("--")) o[a.slice(2)] = args[++i];
    else o._.push(a);
  }
  return o;
}

export async function main(argv, io = { log: console.log, err: console.error, fetch }) {
  const [cmd, ...rest] = argv;
  const ledger = load();
  if (cmd === "validate") {
    const errs = validate(ledger);
    errs.forEach(e => io.err(e));
    io.log(errs.length ? `${errs.length} errors` : `ok: ${ledger.findings.length} findings, ${ledger.findings.reduce((n, f) => n + f.replications.length, 0)} replication attempts`);
    return errs.length ? 1 : 0;
  }
  if (cmd === "list") {
    for (const f of withStandings(ledger).filter(f => !rest[0] || f.field === rest[0]))
      io.log(`${STANDINGS[f.standing.standing].name.padEnd(22)} ${f.field.padEnd(11)} ${f.name}`);
    return 0;
  }
  if (cmd === "verify") {
    const cites = [];
    for (const f of ledger.findings) {
      cites.push([`${f.id} original`, f.original]);
      f.replications.forEach((r, i) => cites.push([`${f.id} replication ${i + 1}`, r.cite]));
    }
    for (const p of ledger.projects || []) cites.push([`project ${p.id}`, p.cite]);
    let bad = 0;
    for (const [where, c] of cites) {
      if (!c.doi) { io.log(`skip ${where}: no DOI (${c.note})`); continue; }
      try {
        const m = await lookup(c.doi, io.fetch);
        const issues = m ? check(c, m) : ["DOI not found at Crossref"];
        if (issues.length) { bad++; io.err(`FAIL ${where} ${c.doi}: ${issues.join("; ")}`); } else io.log(`ok   ${where} ${c.doi}`);
      } catch (e) { bad++; io.err(`FAIL ${where} ${c.doi}: ${e.message}`); }
    }
    io.log(bad ? `${bad} citations failed` : "every DOI resolves and matches");
    if (rest.includes("--record")) {
      const checked = cites.filter(([, c]) => c.doi).length;
      writeFileSync(join(here, "data", "verified.json"), JSON.stringify({ at: new Date().toISOString(), checked, failed: bad, source: "api.crossref.org" }, null, 1) + "\n");
    }
    return bad ? 1 : 0;
  }
  if (cmd === "add") {
    const o = flags(rest);
    const [finding, doi] = o._;
    if (!finding || !doi || !o.kind || !o.outcome || !o.summary) { io.err("usage: add <finding> <doi> --kind K --outcome O [--prereg] --summary \"...\""); return 2; }
    const m = await lookup(doi, io.fetch);
    if (!m) { io.err(`DOI ${doi} not found at Crossref`); return 1; }
    const attempt = { kind: o.kind, preregistered: !!o.prereg, outcome: o.outcome, added: (o.date || new Date().toISOString().slice(0, 10)),
      cite: fromCrossref(m), summary: o.summary };
    const { ledger: next, change } = addReplication(ledger, finding, attempt);
    writeFileSync(DATA, JSON.stringify(next, null, 1) + "\n");
    appendFileSync(CHANGES, JSON.stringify(change) + "\n");
    io.log(`${finding}: ${change.from} -> ${change.to}${change.moved ? " (moved)" : ""}`);
    return 0;
  }
  io.err("commands: validate | list [field] | verify | add <finding> <doi> --kind K --outcome O [--prereg] --summary \"...\"");
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
