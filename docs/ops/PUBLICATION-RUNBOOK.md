---
consumer: doctrine/publication.json
---

# Publication runbook (PUBLICATION-1)

This file is the hand-off. A session, workflow or Worker asked to "publish the repos" runs this and nothing else. It replaces any prompt kept in a session scratchpad: a scratchpad does not exist for the next session.

Policy: `doctrine/publication.json`. Code: `foundation/publication.py`. Record: `ops/publication/ledger.jsonl`. Dispositions: `ops/publication/reviewed.json`.

## Needs

- A full checkout of this repo (not shallow).
- `gh` signed in with a token that can read every repo in the policy. The flip itself needs `GH_TOKEN` or `ORG_ADMIN_TOKEN` with org admin rights.

## Steps

1. `python3 -m foundation publication --check`: policy well formed, every lesson's probe holds.
2. `python3 -m foundation publication --audit --org [--workdir DIR]`: mirrors every repo (all branches, tags and pull refs) and, per repo, reads full history, issue/PR/comment text, required files, tripwire paths, and live visibility and scanning state. Appends one row to the ledger.
3. Clear each reason it prints, in the repo, by pull request:
   - **History or text hit**: rotate the credential if it was ever real. If it is a fixture, add an exact `history_allow` entry (path, sha256 as printed, reason). Never loosen a pattern or allow a folder.
   - **Missing file**: add the file to that repo; licence text is copied from the `license` repo unchanged.
   - **Tripwire**: record `publish`, `move` or `remove` in `reviewed.json` under `<repo>:<path>` (bare path for this repo).
   - **Public without secret scanning or push protection**: turn it on.
4. `python3 -m foundation publication --plan`: prints the flip command for each clean repo and the reasons for each refused one.
5. `python3 -m foundation publication --flip --apply`: flips each clean repo in `flip_order`, checks it answers without credentials, turns on secret scanning and push protection, and writes the result to the ledger.

## What does not bend

- A repo is flipped only on its own clean audit. Unmeasured is not clean.
- Publishing cannot be undone: forks, caches and clones made after the flip stay out there.
- `unmeasured_surfaces` in the policy lists what the audit does not read yet. Read that list before a flip.
- A refusal is recorded and worked through the steps above, not routed around with a bare `gh repo edit`.
