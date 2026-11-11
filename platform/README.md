# ultrastable/platform

**Ultrastable is the foundation for any autonomous system.**

A system is autonomous if it has self-referential loops and the ability to close them. Knowing without being able to act is useless, so the system is privileged to close its own loops (`python3 -m foundation loops --verify`).

Ultrastable runs on itself: its roadmap, issues, managers, trust ledger, plussing budget and specs are run by the same code it gives everyone else, from this repository alone, with any tools (`python3 -m foundation selfhost`).

The core Ultrastable platform: the tick, the virtual-staff roles, the trust ledger, the prediction scorer and the plussing queue, generalized from the QNFO fleet so any organization can run it.

Status: the working system runs today inside QNFO on Cloudflare. Extracting and packaging it into this repo is a later step. See [docs/architecture.md](docs/architecture.md) for the target shape.

The boot path (idea to running org) lives in the `seed` repo; this repo is where the tick and roles are generalized for multiple tenants. The seed's `worker/src/tick.js` and `worker/migrations/0001_init.sql` are the first working slice.


## Adapters
The portable core runs on Cloudflare (running for QNFO) and on Google Cloud (Cloud Run skeleton, tested, undeployed). See [adapters/](adapters/README.md) and [docs/architecture.md](docs/architecture.md).

## Reference runtime: `core/` (Python, runnable today)
A portable, stdlib-only implementation of the full control loop: 11 guarded tick steps, doer/reviewer separation, interrupt gates, trust ladder with an owner-gated cap, prediction scoring, plussing, self-amending rules, `ultrastable` CLI, live dashboard and JSON API, Dockerfile and Cloud Run + Scheduler deploy. 12 tests. Agents bundled are simulated; the Command (any CLI agent) and Anthropic adapters are implemented but unproven in production. See [core/README.md](core/README.md). The JS tick in `../seed/worker` remains the Cloudflare/D1 embodiment.
