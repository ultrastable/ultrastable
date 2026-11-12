# Demos

**Ultrastable is the foundation for any autonomous system.**

A system is autonomous if it has self-referential loops and the ability to close them. Knowing without being able to act is useless, so the system is privileged to close its own loops (`python3 -m foundation loops --verify`).

Ultrastable runs on itself: its roadmap, issues, managers, trust ledger, plussing budget and specs are run by the same code it gives everyone else, from this repository alone, with any tools (`python3 -m foundation selfhost`).

Self-contained, no accounts, no secrets, no network calls.

| Demo | Run | Public | Status |
|---|---|---|---|
| Bootstrap simulator | open `demos/public/bootstrap-simulator.html` through any static server, e.g. `cd demos/public && python3 -m http.server` | yes (generic) | MODEL of the BUILT loop |
| Blocker cases | `demos/public/bootstrap-cases.html` | yes | OBSERVED cases, names removed |
| Repo live | `node demos/repo-live.mjs` or `--html out.html` | no (reads internal records) | BUILT |

Engine: `demos/public/engine.js`, deterministic, shared by browser and tests. Tests: `node --test demos/test/*.test.mjs` (16 tests: determinism, no questions asked, every owner card has a default and probe, fallbacks, bundle under 100 KB, banned terms absent, worker routing). The banned-term list is `demos/publish.json`.

Public deploy: `node deploy/deploy-demos.mjs` (route `ultrastable.io/demos*`). There is deliberately no workflow for it: Actions minutes on private repos are capped, so deploys of this kind run from a cloud-hosted session that holds the credential. Needs the two Cloudflare credentials (BG-35).
