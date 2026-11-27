# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""US-25-R18 (US-SPEC-25 TS-8): the deployed copy under tenants/ equals the reference modules in workers/, modulo declared lines.

ultrastable-tenants is deployed from tenants/ (doctrine/topology.json); workers/core/tenantstore and workers/adapters/cloudflare/src are the
reference. A reference module changed without the copy being refreshed leaves production running older code than the tests prove. Each
file is either equal after its declared substitutions, or listed in PENDING_REFRESH with the reason: a pending file must still differ, so
the list can only shrink, and once the copy is refreshed the test fails until the entry is removed.
"""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REF_STORE = ROOT / "workers/core/tenantstore"
REF_CF = ROOT / "workers/adapters/cloudflare/src"
DEPLOYED = ROOT / "tenants"

# (deployed path, reference path, substitutions applied to the reference to get the deployed text, each with its reason)
PAIRS = [
    ("tenantstore/budget.js", REF_STORE / "budget.js", []),
    ("tenantstore/rollup.js", REF_STORE / "rollup.js", []),
    ("tenantstore/store.js", REF_STORE / "store.js", [
        ("// workers/core/tenantstore/", "// core/tenantstore/", "the header names the path inside the deployed tree"),
    ]),
    ("tenantstore/vector.js", REF_STORE / "vector.js", []),
    ("src/tenant-do.js", REF_CF / "tenant-do.js", [
        ("'../../../core/tenantstore/store.js'", "'../tenantstore/store.js'", "the store sits beside src/ in the deployed tree"),
    ]),
    ("src/index.js", REF_CF / "tenants-worker.js", [
        ("import { DurableObject } from 'cloudflare:workers';\n",
         "import { DurableObject } from 'cloudflare:workers';\nimport { userError } from '../../seed/worker/src/errors.js';\n", "USER-BACKEND-1: plain errors from the shared module"),
        ("catch (e) { return json({ code: 'internal', message: String(e && e.message || e).slice(0, 300) }, 500); }",
         "catch (e) { const r = userError(e, 'tenants'); return json({ code: r.code, message: r.error }, r.status); }  // USER-BACKEND-1", "USER-BACKEND-1"),
    ]),
]
# Modules the reference store imports that the deployed tree must also carry once it is refreshed.
NEW_IN_REFERENCE = [("tenantstore/vectorport.js", REF_STORE / "vectorport.js")]

# Files whose reference moved ahead (US-25-R12 pin and halt, R13, R14 vector counter, R15 caps and storage ceiling, R09 promotion) and whose
# deployed copy has not been refreshed yet. Integration request: copy the reference files (and vectorport.js) into tenants/ with the
# substitutions above, add the halt and resume routes to src/index.js, then empty this set.
PENDING_REFRESH = {"tenantstore/budget.js", "tenantstore/rollup.js", "tenantstore/store.js", "tenantstore/vector.js", "src/tenant-do.js"}
PENDING_NEW = {"tenantstore/vectorport.js"}


def expected(ref: Path, subs):
    text = ref.read_text()
    for old, new, _why in subs:
        if old not in text:
            raise AssertionError(f"declared substitution not found in {ref.name}: {old[:50]!r}")
        text = text.replace(old, new)
    return text


class TenantCopyParity(unittest.TestCase):
    def test_us_25_r18_every_deployed_module_matches_the_reference_or_is_pending(self):
        stale = []
        for rel, ref, subs in PAIRS:
            dep = (DEPLOYED / rel).read_text()
            same = dep == expected(ref, subs)
            if rel in PENDING_REFRESH:
                self.assertFalse(same, f"{rel} now matches the reference: remove it from PENDING_REFRESH")
            elif not same:
                stale.append(rel)
        self.assertEqual(stale, [], f"deployed copy drifted from the reference (refresh tenants/): {stale}")

    def test_us_25_r18_a_module_the_reference_adds_is_pending_until_the_copy_carries_it(self):
        for rel, ref in NEW_IN_REFERENCE:
            self.assertTrue(ref.exists(), f"{ref} is the reference for {rel}")
            exists = (DEPLOYED / rel).exists()
            if rel in PENDING_NEW:
                self.assertFalse(exists, f"{rel} is now in tenants/: remove it from PENDING_NEW")
            else:
                self.assertTrue(exists, f"{rel} is imported by the reference store and missing from tenants/")

    def test_us_25_r18_pending_entries_name_real_files(self):
        known = {rel for rel, _r, _s in PAIRS} | {rel for rel, _r in NEW_IN_REFERENCE}
        self.assertTrue(PENDING_REFRESH <= known and PENDING_NEW <= known)

    def test_us_25_r18_the_worker_routes_are_not_ahead_of_the_deployed_index(self):
        """tenants-worker.js was not changed in this round, so the reference and the deployed index agree: the halt and resume routes are an integration request."""
        ref = (REF_CF / "tenants-worker.js").read_text()
        self.assertNotIn("/halt", ref)


if __name__ == "__main__":
    unittest.main()
