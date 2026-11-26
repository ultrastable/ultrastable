# Instance: Replication Ledger

**Ultrastable is the foundation for any autonomous system.** The Replication Ledger, a record across many fields of which landmark findings held up when replicated and which failed, is a tenant system on it (level 1, parent `ultrastable`). Idea and system test: `IDEA.md`; manifest: `instance.json`.

A system is autonomous if it has self-referential loops and the ability to close them (`python3 -m foundation loops --verify`).

Ultrastable runs on itself (`python3 -m foundation selfhost`).

Its code moves to its own repository, `ultrastable/replication-ledger` (TENANT-REPO-1, `doctrine/tenant-repos.json`); this folder keeps its manifest (IDEA.md, instance.json, lifecycle.json, runway.json).

- Data model and validator: `worker/ledger.js`. Standing rubric: `worker/standing.js` (served at `/api/rubric`). Findings: `worker/data/findings.json`.
- Add a replication: `node worker/cli.mjs add <finding> <doi> --kind K --outcome O [--prereg] --summary "..."` (citation fetched from Crossref by DOI; the standing change is appended to `worker/data/changes.jsonl`).
- Check: `node worker/cli.mjs validate`, `node worker/cli.mjs verify` (every DOI against Crossref).
- Test: `node --test instances/replication-ledger/worker/*.test.mjs`.
