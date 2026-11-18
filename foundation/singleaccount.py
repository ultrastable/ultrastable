"""Single Cloudflare account, as code (SINGLE-ACCOUNT-1, Rowan 2026-11-18). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation singleaccount --check    no file names the quniverse account or one of its Ultrastable assets
  python3 -m foundation singleaccount --scan     one line per match

Rule and patterns: doctrine/single-account.json. Consumers: .github/workflows/checks.yml, doctrine/rules.json (single-account),
tests/foundation/test_singleaccount.py. The move records (deploy/transfer, the retired-account list) are the only allowed mentions.
"""
from __future__ import annotations
import fnmatch, json, os, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/single-account.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def scan(root=REPO, d: dict | None = None) -> list[str]:
    root = Path(root); d = d or load(root)
    rules = [(f["id"], re.compile(f["pattern"])) for f in d["forbidden"]]
    allow = [a["path"] for a in d["allow"]]
    out = []
    for base, dirs, names in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in d["skip_dirs"])
        for n in sorted(names):
            rel = (Path(base) / n).relative_to(root).as_posix()
            if any(fnmatch.fnmatch(rel, a) for a in allow):
                continue
            try:
                text = (Path(base) / n).read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue  # binary or unreadable: not text a rule could cite
            for i, ln in enumerate(text.splitlines(), 1):
                for rid, rx in rules:
                    if rx.search(ln):
                        out.append(f"{rel}:{i}: {rid}")
    return out


def check(root=REPO) -> list[str]:
    d = load(root); problems = scan(root, d)
    acc = json.loads((Path(root) / "deploy/cloudflare-accounts.json").read_text(encoding="utf-8"))
    if acc["target"]["id"] != d["required_account"]["id"]:
        problems.append("deploy/cloudflare-accounts.json target is not the ultrastable account")
    return problems


def main(argv) -> int:
    if argv[:1] == ["--scan"]:
        print("\n".join(scan()) or "no matches"); return 0
    problems = check()
    for p in problems:
        print("FAIL " + p)
    print("single-account: " + ("ok" if not problems else f"{len(problems)} reference(s) to the retired quniverse account"))
    return 1 if problems else 0
