"""BLINDSPOT-1 need dependency-licences: every third-party package, tool and action this repository names, with its licence, checked against how it is used.
Ultrastable is the foundation for any autonomous system.

  python3 -m foundation licences --check    fails on a dependency with no recorded licence, a licence the policy does not allow for its use, or a stale inventory
  python3 -m foundation licences --write    regenerate the inventory in doctrine/dependency-licences.json from the repository

Use decides the rule: `shipped` code is distributed under USL-1.0 (commercial terms), so only licences in policy.shipped are allowed; a `tool` runs in CI or a
build and is never distributed, so policy.tool licences (copyleft included) are allowed too. Consumers: tests/foundation/test_blindspots.py (every change),
foundation/blindspots.py (the ip sweep's evidence and the dependency-licences probe).
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DOC = "doctrine/dependency-licences.json"
SKIP = ("node_modules", ".git/", ".selfhost")
NPM = re.compile(r"(?:npx\s+(?:--yes\s+|-y\s+)?|npm\s+i(?:nstall)?\s[^\n]*?\s)((?:@[\w.-]+/)?[a-z][\w.-]*)@\d")
NPM_MORE = re.compile(r"\s((?:@[\w.-]+/)?[a-z][\w.-]*)@\d[\w.]*")
PIP = re.compile(r"pip3?\s+install\s+([^\n&|;#]+)")
USES = re.compile(r"^\s*-?\s*uses:\s*([\w.-]+/[\w.-]+)(?:/[\w./-]+)?@", re.M)


def _files(root: Path, pats):
    for pat in pats:
        for p in sorted(root.glob(pat)):
            if p.is_file() and not any(s in p.as_posix() for s in SKIP):
                yield p


def collect(root=REPO) -> list[dict]:
    """Every dependency the repository names: [{name, eco, use, where}] sorted, one row per (eco, name)."""
    root, seen = Path(root), {}

    def add(eco, name, use, where):
        k = (eco, name.lower())
        row = seen.setdefault(k, {"name": name.lower(), "eco": eco, "use": use, "where": []})
        if use == "shipped":
            row["use"] = "shipped"
        if where not in row["where"]:
            row["where"].append(where)

    for p in _files(root, ("**/package.json",)):
        j = json.loads(p.read_text(encoding="utf-8"))
        for k, use in (("dependencies", "shipped"), ("optionalDependencies", "shipped"), ("peerDependencies", "shipped"), ("devDependencies", "tool")):
            for n in (j.get(k) or {}):
                add("npm", n, use, p.relative_to(root).as_posix())
    for p in _files(root, ("**/pyproject.toml", "**/requirements*.txt")):
        t = p.read_text(encoding="utf-8")
        names = re.findall(r"^\s*([A-Za-z][\w.-]*)", t, re.M) if p.suffix == ".txt" else re.findall(r"[\"']([A-Za-z][\w.-]*)[^\"']*[\"']", (re.search(r"^dependencies\s*=\s*\[(.*?)\]", t, re.M | re.S) or [0, ""])[1])
        for n in names:
            add("pypi", n, "shipped", p.relative_to(root).as_posix())
    for p in _files(root, (".github/workflows/*.yml", "scripts/*.sh", "scripts/*.py", "scripts/*.mjs", "deploy/*.mjs", "deploy/*.sh")):
        t, rel = p.read_text(encoding="utf-8", errors="replace"), p.relative_to(root).as_posix()
        for line in t.splitlines():
            if NPM.search(line):
                for n in NPM_MORE.findall(" " + line):
                    add("npm", n, "tool", rel)
            m = PIP.search(line)
            if m and p.suffix in (".yml", ".sh"):
                for tok in m.group(1).split():
                    n = re.match(r"[\"']?([A-Za-z][\w.-]*)", tok)
                    if n and not tok.startswith("-"):
                        add("pypi", n.group(1), "tool", rel)
        if p.suffix == ".yml":
            for n in USES.findall(t):
                add("action", n, "tool", rel)
    return sorted(seen.values(), key=lambda r: (r["eco"], r["name"]))


def load(root=REPO) -> dict:
    return json.loads((Path(root) / DOC).read_text(encoding="utf-8"))


def verdicts(root=REPO) -> list[dict]:
    d = load(root)
    pol, lic = d["policy"], d["licences"]
    out = []
    for r in collect(root):
        e = lic.get(f"{r['eco']}:{r['name']}")
        spdx = e and e.get("spdx")
        allowed = set(pol["shipped"]) | (set(pol["tool"]) if r["use"] == "tool" else set())
        parts = [s.strip() for s in re.split(r"\s+OR\s+", spdx.strip("()"))] if spdx else []
        v = "unknown" if not spdx else ("ok" if any(s in allowed for s in parts) else "conflict")
        out.append({"name": r["name"], "eco": r["eco"], "use": r["use"], "spdx": spdx, "verdict": v, "where": r["where"][:3]})
    return out


def check(root=REPO) -> list[str]:
    d, errs = load(root), []
    vs = verdicts(root)
    for v in vs:
        if v["verdict"] != "ok":
            errs.append(f"{v['eco']}:{v['name']} ({v['use']}): licence {v['spdx'] or 'not recorded'} is {v['verdict']}; record it in {DOC} licences with its source")
    for k, e in d["licences"].items():
        if not e.get("source"):
            errs.append(f"{k}: licence recorded without a source")
    if d.get("inventory") != vs:
        errs.append(f"inventory in {DOC} is stale; run python3 -m foundation licences --write")
    return errs


def write(root=REPO) -> int:
    d = load(root)
    d["inventory"] = verdicts(root)
    (Path(root) / DOC).write_text(json.dumps(d, indent=1) + "\n", encoding="utf-8")
    return len(d["inventory"])


def main(argv=None) -> int:
    a = list(argv or [])
    if "--write" in a:
        print(f"licences: {write()} dependencies inventoried")
    errs = check()
    for e in errs:
        print("licences:", e, file=sys.stderr)
    print("licences ok" if not errs else f"licences: {len(errs)} problem(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
