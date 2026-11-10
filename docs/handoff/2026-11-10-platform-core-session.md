# Session record 2026-11-10: platform core, investor pack, real-model proof

## Done (all in this repo)
- `platform/core/`: Python reference runtime (11-step loop, CLI, dashboard/API, Docker, Cloud Run deploy script, CI `platform-core.yml`, 13 tests). PRs #84, #86, #88.
- `platform/core/docs/proof-real-agent.md`: Workers AI model fixed a bug; verified by separate `unittest`.
- `business/investor/`: detailed Google for Startups answers, marketing strategy, one-pager, deck outline, demo script, data-room index.
- Org: seven separate repos (platform, seed, docs, ip, .github, site, business) created then ARCHIVED as superseded duplicates; this monorepo is the system of record.

## Open items, each filed with owner and closing probe
| Issue | Item | Owner |
|---|---|---|
| #90 | Deploy core to Cloud Run, verify live | founder (GCP account) then fleet |
| #91 | Real-agent proof with Claude Code | founder (agent credential) |
| #92 | Postgres store adapter | fleet |
| #93 | GitHub connector | fleet |
| #94 | Vertex/Gemini adapter, model pairing | fleet |
| #95 | Reconcile overlapping business docs | fleet |
| #96 | Founder submissions: entity, IP assignment, billing, applications, filing | founder |
| #97 | Scratch cleanup, archived duplicate repos | fleet / founder |
Existing: #1, #14 (entity/IP), #17 (Google application), #30 (file provisional).

## Facts that must not be lost
- Demo agents are simulated; one real-model toy proof only; no outside audit.
- deploy.sh and the Dockerfile run path unverified live (image builds in CI).
- Nested `claude -p` fails 401 in this environment; not worked around.
- Main investor risk: QNFO/qnfo-workers public with no licence; no entity; IP not assigned [LAWYER].
