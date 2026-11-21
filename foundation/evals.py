# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""EVAL-1 (Rowan, 2026-11-21: "Research and implement. Give credit where due."): golden-set regression evals for the code executor.
A change that lowers the pass rate below the floor fails `python3 -m foundation.evals` (in tests: tests/foundation/test_evals.py).
Sources: OpenAI Evals (2023); Chen et al., HumanEval (2021). See CREDITS.md."""
import json, sys
from pathlib import Path
from foundation.agents import apply_edit

ROOT = Path(__file__).resolve().parent.parent
FLOOR = 1.0


def run(path=ROOT / "evals/executor/apply_edit.json"):
    results = []
    for c in json.loads(Path(path).read_text())["cases"]:
        try:
            got = apply_edit(c["text"], c["find"], c["replace"], c["id"])
            ok = "error" not in c and got == c["want"]
        except ValueError as e:
            ok = "error" in c and c["error"] in str(e)
        results.append({"id": c["id"], "ok": ok})
    rate = sum(r["ok"] for r in results) / max(len(results), 1)
    return {"cases": len(results), "pass_rate": rate, "failed": [r["id"] for r in results if not r["ok"]]}


def main(argv=None):
    r = run(); print(json.dumps(r))
    return 0 if r["pass_rate"] >= FLOOR else 1


if __name__ == "__main__":
    sys.exit(main())
