"""WORDS-MATCH-CODE-1 (Rowan, 2026-11-17): a published statement is true only if code makes it true, and that is checked by code on every change.

  python3 -m foundation claimcode --check      fails on a registered claim whose quote left its source or whose probe is missing, and on any new
                                               unbound claim line on a public surface (the shrink-only baseline lists the old ones)
  python3 -m foundation claimcode --baseline   rewrites the baseline to the current unbound lines (it may only shrink in review of the diff)
  python3 -m foundation claimcode --list       the unbound claim lines, so the executor can bind them one by one (each bind removes a baseline row)

A claim line is a line on a public surface that states a number, a cadence, a guarantee or an automatic behaviour (patterns in
doctrine/claim-code.json). It is bound when a registered claim quotes it (`quote`, an exact substring of the line) and names a probe that
runs the behaviour: a test file and a string that must appear in it. Tenant pages use core/statements (statements are rendered from config
and probed at runtime); this check is the platform-wide net under every other surface and ratchets toward zero.
"""
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/claim-code.json"


_LAYOUT = re.compile(r"""\b(?:max-|min-)?(?:width|height)\s*[:=]\s*\\?["']?\d+(?:\.\d+)?%""")


def _pol(root): return json.loads((Path(root) / PATH).read_text("utf-8"))
def _key(rel, line): return rel + "::" + hashlib.sha1(re.sub(r"\s+", " ", line).strip().encode()).hexdigest()[:12]


def scan(root=REPO, extra_globs=()) -> list[tuple[str, int, str, str]]:
    root = Path(root); pol = _pol(root)
    pats = [re.compile(p, re.I) for p in pol["claim_patterns"]]
    ign = subprocess.run(["git", "-C", str(root), "ls-files", "-oi", "--exclude-standard"], capture_output=True, text=True)
    ignored = set(ign.stdout.split("\n")) if ign.returncode == 0 else set()
    out = []
    for g in list(pol["scan_globs"]) + list(extra_globs):
        for f in sorted(root.glob(g)):
            rel = f.relative_to(root).as_posix()
            if not f.is_file() or rel in ignored or any(re.search(x, rel) for x in pol["skip"]):
                continue
            for n, line in enumerate(f.read_text("utf-8", errors="replace").splitlines(), 1):
                if len(line) < pol["min_len"] or not re.search(r"[A-Za-z]{3,} [A-Za-z]{2,} [A-Za-z]{2,}", line) or re.match(r"\s*(//|\*|#)", line):
                    continue
                if any(p.search(_LAYOUT.sub("", line)) for p in pats):   # `width="100%"` is layout, not a stated number
                    out.append((rel, n, line.strip(), _key(rel, line)))
    return out


def _claims1_bound(root) -> list[str]:
    """CLAIMS-1 (doctrine/claims.json) binds a line when its registered sentence is on it (the claims check runs the probes) or a generated claim marker is."""
    p = Path(root) / "doctrine/claims.json"
    try:
        reg = json.loads(p.read_text("utf-8")) if p.is_file() else {"claims": []}
    except ValueError:
        return []
    texts = [c["text"] for c in reg["claims"]]
    # the served registry (site/claims-data.js) repeats each claim as a JSON string, where a quotation mark inside the sentence is escaped
    return texts + [e for e in (json.dumps(t)[1:-1] for t in texts) if e not in texts] + ["<!-- claim:"]


def check(root=REPO) -> list[str]:
    root = Path(root); pol = _pol(root); errs = []
    bound = []
    for c in pol["claims"]:
        src = root / c["source"]
        if not src.is_file() or c["quote"] not in src.read_text("utf-8", errors="replace"):
            errs.append(f"{c['id']}: quote no longer in {c['source']}; the words changed, so the claim must be re-bound to a probe (WORDS-MATCH-CODE-1)"); continue
        pf = root / c["probe"]["file"]
        if not pf.is_file() or c["probe"]["contains"] not in pf.read_text("utf-8", errors="replace"):
            errs.append(f"{c['id']}: probe {c['probe']['file']} does not contain {c['probe']['contains']!r}"); continue
        bound.append(c["quote"])
    bound += _claims1_bound(root)
    base = set(pol["baseline"])
    for rel, n, line, key in scan(root):
        if any(q in line for q in bound) or key in base:
            continue
        errs.append(f"{rel}:{n}: states a number, cadence or guarantee with no registered claim and probe: {line[:110]} (WORDS-MATCH-CODE-1)")
    return errs


def main(argv):
    root = REPO
    if argv[:1] == ["--baseline"]:
        p = root / PATH; pol = _pol(root)
        bound = [c["quote"] for c in pol["claims"]]
        pol["baseline"] = sorted({k for _, _, l, k in scan(root) if not any(q in l for q in bound)})
        p.write_text(json.dumps(pol, indent=2) + "\n", "utf-8"); print(f"claimcode: baseline {len(pol['baseline'])}"); return 0
    if argv[:1] == ["--list"]:
        pol = _pol(root); base = set(pol["baseline"])
        for rel, n, line, key in scan(root):
            if key in base: print(f"{rel}:{n}: {line[:140]}")
        return 0
    errs = check(root)
    from . import liveclaims  # LIVE-CLAIMS-1: copy promises nothing that is not live; runs wherever claimcode --check runs
    errs += liveclaims.scan(root)
    for e in errs: print("FAIL", e)
    print("claimcode ok" if not errs else f"claimcode: {len(errs)} problems")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
