# Demos

Self-contained, no accounts, no secrets, no network calls.

| Demo | Run | Public | Status |
|---|---|---|---|
| Bootstrap simulator | open `demos/public/bootstrap-simulator.html` through any static server, e.g. `cd demos/public && python3 -m http.server` | yes (generic) | MODEL of the BUILT loop |
| Blocker cases | `demos/public/bootstrap-cases.html` | yes | OBSERVED cases, names removed |
| Repo live | `node demos/repo-live.mjs` or `--html out.html` | no (reads internal records) | BUILT |

Engine: `demos/public/engine.js`, deterministic, shared by browser and tests. Tests: `node --test demos/test/*.test.mjs` (16 tests: determinism, no questions asked, every owner card has a default and probe, fallbacks, bundle under 100 KB, banned terms absent, worker routing). The banned-term list is `demos/publish.json`.

Public deploy: `node deploy/deploy-demos.mjs` (route `ultrastable.io/demos*`). There is deliberately no workflow for it: Actions minutes on private repos are capped, so deploys of this kind are manual or run from a machine that holds the credential. Needs the two Cloudflare credentials (BG-35).
