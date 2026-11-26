# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import io, json, sys, tempfile, unittest
from contextlib import redirect_stdout
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import actions_budget as ab  # noqa: E402

BUDGET = {"linux_minute_rate_usd": 0.006, "monthly_minutes_total": 1000, "default_per_repo": 100,
          "per_repo": {"workers": 500}, "thresholds": [0.5, 0.8], "non_essential_workflows": ["pages.yml"]}


def item(repo, minutes, price=0.006, date="2026-11-01T00:00:00Z", unit="Minutes", product="actions"):
    return {"date": date, "product": product, "sku": "Actions Linux", "quantity": minutes, "unitType": unit,
            "pricePerUnit": price, "organizationName": "o", "repositoryName": repo}


def run(items, *extra):
    with tempfile.TemporaryDirectory() as d:
        rp, bp = Path(d) / "u.json", Path(d) / "b.json"
        rp.write_text(json.dumps({"usageItems": items})); bp.write_text(json.dumps(BUDGET))
        out = io.StringIO()
        with redirect_stdout(out):
            code = ab.main(["--from-file", str(rp), "--budget", str(bp), *extra])
        return code, json.loads(out.getvalue())


class BudgetTests(unittest.TestCase):
    def test_ok(self):
        code, d = run([item("workers", 100)])
        self.assertEqual((code, d["decision"]), (0, "ok"))

    def test_warn50_per_repo(self):
        code, d = run([item("workers", 250)])
        self.assertEqual((code, d["decision"], d["threshold_pct"]), (1, "warn50", 50))

    def test_warn80_per_repo(self):
        code, d = run([item("workers", 400)])
        self.assertEqual((code, d["decision"], d["threshold_pct"]), (1, "warn80", 80))

    def test_over_repo_lists_workflows(self):
        code, d = run([item("spec", 100)])
        self.assertEqual((code, d["decision"], d["disable_workflows"], d["over_repos"]), (2, "over", ["pages.yml"], ["spec"]))

    def test_over_total(self):
        code, d = run([item("workers", 400)] + [item(c, 90) for c in "abcdefg"])
        self.assertEqual((code, d["decision"]), (2, "over"))

    def test_macos_minutes_count_at_price_ratio(self):
        code, d = run([item("workers", 30, price=0.062)])
        self.assertEqual(d["repos"][-1]["used"], 310.0)

    def test_storage_rows_other_months_and_products_ignored(self):
        code, d = run([item("workers", 9999, unit="GigabyteHours"), item("workers", 9999, date="2026-10-01T00:00:00Z"),
                       item("workers", 9999, product="copilot"), item("workers", 10)], "--month", "2026-11")
        self.assertEqual((code, d["total_used"]), (0, 10.0))

    def test_default_month_is_latest_in_file(self):
        code, d = run([item("workers", 10, date="2026-10-01T00:00:00Z"), item("workers", 20)])
        self.assertEqual((d["month"], d["total_used"]), ("2026-11", 20.0))

    def test_decision_card_shape(self):
        with tempfile.TemporaryDirectory() as d:
            rp, bp = Path(d) / "u.json", Path(d) / "b.json"
            rp.write_text(json.dumps({"usageItems": [item("spec", 150)]})); bp.write_text(json.dumps(BUDGET))
            out = io.StringIO()
            with redirect_stdout(out):
                code = ab.main(["--from-file", str(rp), "--budget", str(bp), "--emit-decision-card"])
        card = json.loads(out.getvalue())
        self.assertEqual(set(card), {"id", "what", "why_gated", "default_in_effect", "closing_probe"})
        self.assertIn("pages.yml", card["default_in_effect"])
        self.assertEqual(code, 2)

    def test_us_24_r24_essential_workflow_listed_as_non_essential_is_kept_by_the_python_tool(self):
        b = {**BUDGET, "non_essential_workflows": ["pages.yml", "ci.yml:test"], "essential_workflows": ["ci.yml:test"]}
        d = ab.decide({"workers": 600}, ab.load_budget(self._write(b)))
        self.assertEqual((d["decision"], d["disable_workflows"]), ("over", ["pages.yml"]))

    def test_us_24_r21_every_repository_row_carries_a_decision(self):
        code, d = run([item("workers", 250), item("spec", 10)])
        self.assertEqual({r["repo"]: r["decision"] for r in d["repos"]}, {"spec": "ok", "workers": "warn50"})
        self.assertEqual(d["total_decision"], "ok")

    def test_us_24_r21_the_platform_budget_schema_loads(self):
        platform = json.loads((ROOT.parent / "actions-budget.json").read_text(encoding="utf8"))
        for k in ("monthly_free_minutes", "warn_at_pct", "pause_at_pct", "essential", "paused_workflows", "paused"):
            self.assertIn(k, platform)  # the exact keys the platform file uses
        b = ab.load_budget(ROOT.parent / "actions-budget.json")
        self.assertEqual((b["monthly_minutes_total"], b["thresholds"], b["paused"]), (2000, [0.6, 0.85], True))
        self.assertEqual(b["essential_workflows"], platform["essential"])
        d = ab.decide({"x": 1300}, b)
        self.assertEqual((d["decision"], d["exit_code"]), ("warn50", 1))  # 65 percent of 2000 is past the 60 percent warning

    def test_us_24_r21_the_shipped_roster_names_every_workers_workflow(self):
        b = ab.load_budget(ROOT / "ops/actions-budget.json")
        rostered = {w.split(":")[0] for w in b["essential_workflows"] + b["non_essential_workflows"]}
        shipped = {p.name for p in (ROOT / ".github/workflows").glob("*.yml")}
        self.assertEqual(shipped - rostered, set())

    @staticmethod
    def _write(budget):
        d = tempfile.mkdtemp()
        p = Path(d) / "b.json"
        p.write_text(json.dumps(budget))
        return p

    def test_shipped_budget_file_is_valid(self):
        b = ab.load_budget(ROOT / "ops/actions-budget.json")
        self.assertEqual(b["thresholds"], [0.5, 0.8])
        self.assertGreater(b["monthly_minutes_total"], 0)


if __name__ == "__main__":
    unittest.main()
