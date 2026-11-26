<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/conformance: levels, manifest, checker

US-SPEC-00. `manifest.json` maps every requirement of every specification to its level and to the tests that cite it, or lists it as a deviation with the reason. It is generated, then checked on every test run. Do not edit it by hand.

```
node core/conformance/cli.js --spec-dir ../specs --write --check        # regenerate and verify (--out FILE writes elsewhere, --manifest FILE reads another)
node core/conformance/cli.js --declare                                  # level, versions, deviation list (US-00-T01)
node core/conformance/cli.js --run L1                                   # run the tests that prove a level, JavaScript and Python (US-00-T02)
node core/conformance/cli.js --running --ledger FILE                    # every RUNNING label against a production ledger of JSON lines (US-00-T03)
node core/conformance/cli.js --attest OUT --by NAME                     # an attestation of this tree, refused if the manifest does not match the tree
node core/conformance/cli.js --verify FILE                              # an outside party re-derives the manifest from its own checkout
```

The specifications are found at `US_SPEC_DIR`, `../specs` (the monorepo) or `../spec/specs` (the extracted repository), in that order, or at `--spec-dir`. With none the tool says that the manifest's coverage of the specifications was NOT checked.

| Requirement | Status |
|---|---|
| US-00-R01 declared level and specification versions | BUILT (`declaration`, `manifest.json`) |
| US-00-R02 published deviation list | BUILT: every requirement no test cites is a deviation with a reason |
| US-00-R03 no overstated label | BUILT (`check`: a met entry whose test file is gone or no longer cites the requirement fails `conformance.test.js`; a proof under a root that is not present is reported as unverified, never as checked) |
| US-00-R06 tests in every language | BUILT: JavaScript titles, Python method names and docstrings (`scan-python.test.js`), and the seed and foundation test roots (`EXTRA_ROOTS` in `cli.js`) |
| US-00-T03 RUNNING labels backed by a production ledger row | BUILT as a checker over a ledger port (`running.js`, `running.test.js`); every label reads unmeasured until a production export is supplied |
| L1 tests of US-SPEC-01 and US-SPEC-14 with ids cited | BUILT (`l1.test.js`) |
| US-00-R04, R08, R09, US-00-T04, US-01-R10 | BUILT (`spec-kernel.test.js`); the pack named in the decline of US-00-T04 is a todo test |
| L2 record mapping of US-SPEC-01 section 4.2 | BUILT (`l2-records.json`, checked in `l1.test.js`, including the seed's own tables) |
| Certification by a party other than the implementer | The attestation and the independent verifier are BUILT (`attest.js`, `attest.test.js`); an outside party's own signed attestation is PLANNED |

What "met" means here: a test in this repository (or in a root listed in `EXTRA_ROOTS`) names the requirement and the test file exists. It is the test author's claim that the test proves the requirement; the checker proves the claim is still attached to a real test, not that the test is sufficient. Requirements in US-SPEC-16 and 18 carry no level tag and are counted at L2.

Owner role: reviewer. Trigger: any change to a test or a specification. Closing probe: `node --test core/conformance/*.test.js`.
