#!/usr/bin/env python3
"""COVERAGE-CITED-1: bind every claim-like statement that itself names the code enforcing it.
A rule line such as "... `python3 -m foundation flows --check` (in `checks`), tests `tests/foundation/test_flows.py`" already says what makes it true.
This reads `claims --coverage`'s unbound source lines and, for each line that cites a file that exists or a `python3 -m foundation <module>` whose module
exists, registers a claim in doctrine/claims.json whose probes are those files (and, where the checks workflow runs the module, that step). The claim then
drifts the moment a cited file or check is removed. A line that cites no code is left unbound: it needs a real probe or different words, never a
probe that greps the sentence itself. Idempotent: entries it wrote carry "bound_by": "cited" and are rebuilt on every run.

A sentence repeated on a second surface gets a mirror entry there (COVERAGE-MIRROR-1, `mirrors`).

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
    kept_texts = [c["text"] for c in reg["claims"] if not c.get("bound_by")]   # only sentences registered by id: a curated binding never unbinds a cited one
    other_texts = [c["text"] for c in reg["claims"] if c.get("bound_by")] + [c["quote"] for c in json.loads((root / "doctrine/claim-code.json").read_text(encoding="utf-8")).get("claims", [])]
    mods = {m["surface"] for m in reg.get("modules", [])}   # a generated module is bound as a whole (claims.module_ok): it is output, not a source
    new, seen, left = [], set(), 0
    for rel, _n, line in claims.claim_lines(root, reg):
        if rel in mods or any(q in line for q in kept_texts) or "<!-- claim:" in line:
            continue
        q, pr = quote(line), probes_for(line, root, checks)
        if q in seen:
            continue
        if not pr:
            left += 0 if any(t in line for t in other_texts) else 1   # a line bound by hand to code elsewhere is not left over
            continue
        seen.add(q)
        new.append({"id": "cited-" + hashlib.sha256(q.encode()).hexdigest()[:10], "surface": rel, "text": q, "probe": pr, "bound_by": "cited"})
    return new, left


def mirrors(root, all_claims) -> list[dict]:
    """COVERAGE-MIRROR-1: a sentence repeated on a second surface (the seed copy of an agent file) is checked there too, with the probes of the claim
    that binds it. Rebuilt on every run; entries carry "bound_by": "mirror" and "of": the source claim."""
    reg = claims.load(root)
    mods = {m["surface"] for m in reg.get("modules", [])}
    base = [c for c in all_claims if c.get("bound_by") != "mirror"]
    out, ids = [], set()
    for rel, _n, line in claims.claim_lines(root, reg):
        if rel in mods or "<!-- claim:" in line or any(c["surface"] == rel and c["text"] in line for c in base):
            continue
        src = next((c for c in base if c["text"] in line), None)
        if not src:
            continue
        pr = [p for p in src["probe"] if p.split(":", 1)[1].split("::")[0] != rel]
        e = {"id": "mirror-" + hashlib.sha256((rel + src["text"]).encode()).hexdigest()[:10], "surface": rel, "text": src["text"], "probe": pr, "bound_by": "mirror", "of": src["id"]}
        if pr and e["id"] not in ids:
            ids.add(e["id"]); out.append(e)
    return out


def main(argv) -> int:
    new, left = build()
    reg = claims.load(REPO)
    kept = [c for c in reg["claims"] if c.get("bound_by") not in ("cited", "mirror")] + new
    mir = mirrors(REPO, kept)
    if "--apply" in argv:
        reg["claims"] = kept + mir
        (REPO / claims.REG).write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"cited claims: {len(new)} bound to the code they name; {len(mir)} repeated on a second surface and checked there; {left} claim-like line(s) cite no code and stay unbound")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
