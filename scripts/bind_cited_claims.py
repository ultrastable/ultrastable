#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""COVERAGE-CITED-1: bind every claim-like statement that itself names the code enforcing it.
A rule line such as "... `python3 -m foundation flows --check` (in `checks`), tests `tests/foundation/test_flows.py`" already says what makes it true.
This reads `claims --coverage`'s unbound source lines and, for each line that cites a file that exists or a `python3 -m foundation <module>` whose module
exists, registers a claim in doctrine/claims.json whose probes are those files (and, where the checks workflow runs the module, that step). The claim then
drifts the moment a cited file or check is removed. A line that cites no code is left unbound: it needs a real probe or different words, never a
probe that greps the sentence itself. Idempotent: entries it wrote carry "bound_by": "cited" and are rebuilt on every run.

  python3 scripts/bind_cited_claims.py [--apply]
"""
import hashlib, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from foundation import claims  # noqa: E402

PATH_RE = re.compile(r"`([\w./-]+\.(?:py|js|mjs|json|jsonl|yml|md|sql|sh))`")
MOD_RE = re.compile(r"python3 -m foundation[ .](\w+)")
MAX_PROBES = 6


def probes_for(line: str, root: Path, checks: str) -> list[str]:
    out = []
    for p in PATH_RE.findall(line):
        if (root / p).is_file() and "file:" + p not in out:
            out.append("file:" + p)
    for m in MOD_RE.findall(line):
        if (root / "foundation" / (m + ".py")).is_file():
            if f"file:foundation/{m}.py" not in out:
                out.append(f"file:foundation/{m}.py")
            if re.search(rf"foundation[ .]{m}\b", checks):
                out.append(f"grep:.github/workflows/checks.yml::foundation[ .]{m}\\b")
    return out[:MAX_PROBES]


def quote(line: str) -> str:
    """The longest prefix of the stripped line up to 140 characters, cut at a space: long enough to be unique, short enough to show on /claims."""
    s = line.strip()
    return s if len(s) <= 140 else s[:140].rsplit(" ", 1)[0]


def build(root=REPO) -> tuple[list[dict], int]:
    reg = claims.load(root)
    reg["claims"] = [c for c in reg["claims"] if c.get("bound_by") != "cited"]
    checks = (root / ".github/workflows/checks.yml").read_text(encoding="utf-8")
    kept_texts = [c["text"] for c in reg["claims"]]
    cov = reg.get("coverage", {})
    pats = [re.compile(x, re.I) for x in cov["patterns"]]
    new, seen, left = [], set(), 0
    for g in cov["src_globs"]:
        for f in sorted(root.glob(g)):
            rel = str(f.relative_to(root))
            if not f.is_file() or rel == claims.OUT or any(re.search(x, rel) for x in cov["skip"]):   # the served registry repeats every claim: it is output, not a source
                continue
            for line in f.read_text("utf-8", errors="replace").splitlines():
                if len(line) < 40 or not re.search(r"[A-Za-z]{3,} [A-Za-z]{2,} [A-Za-z]{2,}", line) or re.match(r"\s*(//|\*|#)", line) or not any(p.search(line) for p in pats):
                    continue
                if any(q in line for q in kept_texts) or "<!-- claim:" in line:
                    continue
                q, pr = quote(line), probes_for(line, root, checks)
                if q in seen:
                    continue
                if not pr:
                    left += 1
                    continue
                seen.add(q)
                new.append({"id": "cited-" + hashlib.sha256(q.encode()).hexdigest()[:10], "surface": rel, "text": q, "probe": pr, "bound_by": "cited"})
    return new, left


def main(argv) -> int:
    new, left = build()
    if "--apply" in argv:
        reg = claims.load(REPO)
        reg["claims"] = [c for c in reg["claims"] if c.get("bound_by") != "cited"] + new
        (REPO / claims.REG).write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"cited claims: {len(new)} bound to the code they name; {left} claim-like line(s) cite no code and stay unbound")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
