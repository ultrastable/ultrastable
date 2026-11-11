# Handoff: Ultrastable runs on itself (2026-11-11)

Built: `foundation/selfhost.py` (boot, verify, gaps), `platform/selfhost/tick.mjs`, `instances/ultrastable/{selfhost,gaps}.json`, `platform/adapters/registry.json`, `docs/runbooks/any-tools/`, doctrine block `runs_on_itself`, tests in `tests/foundation/test_selfhost.py`. No new workflow; the existing `checks` job already runs the doctrine check and the foundation tests.

Next (driver order): SG-1 forge adapter (`seed/worker/src/forge.js`), SG-2 executor, SG-3 report sink. Each closes when its probe passes; the verifier fails if a probe passes while the gap is still marked open.
