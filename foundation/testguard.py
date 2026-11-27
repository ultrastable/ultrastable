# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""TESTS-PROTECTED-1 (ZHC-R11, #2676): an agent cannot quietly weaken the tests that judge its own change.

  python3 -m foundation testguard --range BASE...HEAD

Fails a change that, across all test files it touches, removes more test cases or assertions than it adds, deletes a test file whose cases do
not reappear elsewhere in the same change, or adds a skip marker (unittest.skip, pytest.mark.skip, test.skip, it.skip, describe.skip, .only).
Moving a test is fine: the counts are summed over the whole change. Nobody overrides it by label or comment; a test that must go is replaced
in the same change. Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TEST_FILE = re.compile(r"(^|/)(test_[^/]*\.py|[^/]*\.test\.(m?js|ts)|[^/]*_test\.py)$")
CASE = re.compile(r"^\s*(def test_\w+|(test|it)\(\s*['\"`])", re.M)
ASSERT = re.compile(r"\b(self\.assert\w+|assert\.\w+|assert\s|expect\()")
SKIP = re.compile(r"(unittest\.skip|pytest\.mark\.skip|\b(test|it|describe)\.(skip|only)\b|\bxit\(|\bxdescribe\()")


def counts(text: str) -> tuple[int, int, int]:
    return len(CASE.findall(text)), len(ASSERT.findall(text)), len(SKIP.findall(text))


def _show(root, ref, path) -> str:
    r = subprocess.run(["git", "-C", str(root), "show", f"{ref}:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def check(rng: str, root=REPO) -> list[str]:
    base, head = rng.split("...") if "..." in rng else rng.split("..")
    mb = subprocess.run(["git", "-C", str(root), "merge-base", base, head], capture_output=True, text=True)
    if mb.returncode != 0:
        return [f"testguard: cannot find the merge base of {rng}"]
    base = mb.stdout.strip()
    names = subprocess.run(["git", "-C", str(root), "diff", "--name-only", f"{base}...{head}"], capture_output=True, text=True).stdout.split()
    tests = [n for n in names if TEST_FILE.search(n)]
    b = [0, 0, 0]; h = [0, 0, 0]
    for n in tests:
        for acc, ref in ((b, base), (h, head)):
            for i, v in enumerate(counts(_show(root, ref, n))):
                acc[i] += v
    bad = []
    if h[0] < b[0]:
        bad.append(f"test cases fell from {b[0]} to {h[0]} across the touched test files; replace a removed test in the same change")
    if h[1] < b[1]:
        bad.append(f"assertions fell from {b[1]} to {h[1]} across the touched test files")
    if h[2] > b[2]:
        bad.append(f"skip or only markers rose from {b[2]} to {h[2]}")
    return bad


def main(argv) -> int:
    if "--range" not in argv:
        print(__doc__); return 2
    bad = check(argv[argv.index("--range") + 1])
    for x in bad:
        print("FAIL testguard:", x)
    print("testguard ok: no test case, assertion or skip change weakens the suite" if not bad else f"testguard: {len(bad)} finding(s) (TESTS-PROTECTED-1)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
