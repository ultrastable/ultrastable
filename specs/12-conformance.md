# 12 Conformance and traceability

A system conforms to level N if it passes the listed checks. Run them with the commands shown; a PR that lowers a level is rejected.

| Level | Meaning | Checks |
|---|---|---|
| L1 Core | tick, items, claims, predictions, trust | `cd seed/worker && npm test`; `python3 -m unittest discover -s seed/tests` |
| L2 Governed | policy validator, doctrine, memory rule | `python3 -m foundation doctrine --check`; `python3 scripts/check_memory.py`; gaplint |
| L3 Portable | a second adapter passes L1 | `node --test platform/adapters/gcp/test/*.js`; `cd platform/core && python3 -m unittest` |
| L4 Bootstrappable | idea file to running org with failures recorded | `python3 -m unittest discover -s tests/foundation`; `python3 seed/bootstrap/bootstrap.py --dry-run` |
| L5 Licensed | license, split and specs consistent | `python3 scripts/check_license.py` |

## Traceability
| Spec | Code | Tests |
|---|---|---|
| 01 | `seed/worker/`, `platform/adapters/`, `platform/core/` | adapter and worker tests |
| 02 | `seed/agents/roles/`, `platform/core/ultrastable/orgchart.py` | `platform/core/tests/test_orgchart.py` |
| 03 | `seed/worker/src/tick.js` | `seed/worker/test/tick.test.js` |
| 04 | `seed/autonomy/policy.json`, `tick.js` | `seed/tests/test_seed.py` |
| 05 | `tick.js` `check_plus_share`, `engine.py` | `tick.test.js`, `test_engine.py` |
| 06 | `foundation/doctrine.py`, `products/gaplint/` | `tests/foundation`, gaplint tests |
| 07 | `.github/workflows/checks.yml`, `scripts/` | `scripts/test_*.py` |
| 08 | `seed/bootstrap/`, `foundation/` | `seed/tests/test_cases.py`, `tests/foundation` |
| 09 | `dashboard/` | `dashboard/test/` |
| 10 | `seed/agents/roles/`, `docs/concepts/` | review |
| 11 | `platform/core/ultrastable/agents.py` | `test_vertex.py` |

Earlier claim-to-code detail for the QNFO implementation is archived in [ip/CLAIM-TO-CODE.md](../ip/CLAIM-TO-CODE.md); it is no longer maintained.
