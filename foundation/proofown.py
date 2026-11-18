"""PROOF-OWN-1: Ultrastable's proof surfaces show only Ultrastable's own records.

QNFO was the prototype; its metrics must never be presented as Ultrastable's.
`python3 -m foundation proofown --check` fails when site code fetches QNFO data,
serves /proof as a page, or lists /proof in nav, sitemap or registered paths.
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = [f for f in glob.glob(os.path.join(ROOT, "site", "*.js")) + glob.glob(os.path.join(ROOT, "dashboard", "*.js"))]
DOCTRINE = glob.glob(os.path.join(ROOT, "doctrine", "*.json"))
FETCH = re.compile(r"""fetch\([^)]*qnfo\.(org|io)|CLAIMS_URL|https://qnfo\.(org|io)/api""")
PROOF_PATH = re.compile(r"""["'=]/proof["'/]""")
SKIP_DOCTRINE = {"decision-ledger.json", "publication.json"}  # history ledgers and file lists, not live paths


def _lines(f):
    with open(f, encoding="utf-8") as fh:
        return fh.read().splitlines()


def scan():
    bad = []
    for f in SOURCES:
        for n, line in enumerate(_lines(f), 1):
            rel = os.path.relpath(f, ROOT)
            if FETCH.search(line):
                bad.append(f"{rel}:{n}: fetches QNFO data on an Ultrastable surface")
            if PROOF_PATH.search(line) and "PROOF-OWN-1" not in line:
                bad.append(f"{rel}:{n}: /proof is deprecated (301 to /live); link /live")
    for f in DOCTRINE:
        if os.path.basename(f) in SKIP_DOCTRINE:
            continue
        for n, line in enumerate(_lines(f), 1):
            if re.search(r'''["']/proof["']|ultrastable\.io/proof["']''', line):
                bad.append(f"{os.path.relpath(f, ROOT)}:{n}: /proof registered; use /live")
    return bad


def main(argv):
    bad = scan()
    for b in bad:
        print("FAIL " + b)
    print("proofown: " + ("ok" if not bad else f"{len(bad)} violation(s)"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
