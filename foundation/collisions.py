# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""COLLISION-1 (Rowan, 2026-11-25): parallel sessions never build the same thing twice. Ultrastable is the foundation for any autonomous system.

Root cause it closes: one platform-wide directive (DATAGRAPH-1) reached several sessions at once and produced competing engine PRs (#2135, #2151,
#2157, #2158, #2166, #2187) that clashed on migration numbers, /api/graph routes and check commands. Nothing told a session that another one already
held the work, and nothing refused a second migration with the same number.

  python3 -m foundation collisions --check          in the tree: no numbered migration directory holds two files with one number (shrink-only
                                                    baseline in doctrine/collisions.json), every migrations/index.json lists exactly its directory
  python3 -m foundation collisions --prs [--pr N]   against the other open PRs (GitHub API, GITHUB_TOKEN): this PR may not add a migration number,
                                                    a new file path, a route literal or a `foundation` subcommand that an older open PR adds too.
                                                    The older PR holds it; the newer one renumbers, renames or is folded into the older (exit 1)
  python3 -m foundation collisions --claim ID       before starting directive ID: list open PRs that name it (exit 1 when one does: extend or
                                                    review that PR instead of opening a competing one; IC-ADOPT-001 "reviewing a claimed change")

Consumers: .github/workflows/checks.yml (--check and --prs on every PR), site/sop.js (step 0 of the code-agent SOP runs --claim),
agents/AGENTS.md. Tests: tests/foundation/test_collisions.py.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/collisions.json"
NUMBERED = re.compile(r"^(\d{4})_[\w.-]+\.sql$")
ROUTE = re.compile(r"""['"`](/(?:api|host|__internal)/[A-Za-z0-9_./-]+)['"`]""")
SUBCMD = re.compile(r"""_av\[:1\] == \["([a-z_]+)"\]""")
DIRECTIVE = re.compile(r"\b([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*-\d+)\b")


def _policy(root=REPO) -> dict:
    p = Path(root) / POLICY
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"baseline_duplicates": {}}


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    base = _policy(root).get("baseline_duplicates", {})
    for d in sorted(root.rglob("migrations")):
        if not d.is_dir() or "node_modules" in d.parts:
            continue
        rel = d.relative_to(root).as_posix()
        nums: dict[str, list[str]] = {}
        for f in sorted(d.iterdir()):
            m = NUMBERED.match(f.name)
            if m:
                nums.setdefault(m.group(1), []).append(f.name)
        for n, files in nums.items():
            if len(files) > 1 and n not in base.get(rel, []):
                bad.append(f"{rel}: migration number {n} is used by {', '.join(files)}; renumber the newer file to the next free number")
        for n in base.get(rel, []):
            if len(nums.get(n, [])) < 2:
                bad.append(f"{rel}: baseline duplicate {n} is gone; drop it from {POLICY} (shrink-only)")
        idx = d / "index.json"
        if idx.exists():
            listed = json.loads(idx.read_text(encoding="utf-8"))
            have = sorted(f.name for f in d.iterdir() if f.suffix == ".sql")
            if sorted(listed) != have:
                miss, extra = sorted(set(have) - set(listed)), sorted(set(listed) - set(have))
                bad.append(f"{rel}/index.json differs from the directory (missing {miss}, extra {extra})")
    return bad


def added(files: list[dict]) -> dict:
    """What a PR adds: migration (dir, number), new file paths, route literals and foundation subcommands on added lines."""
    out = {"migrations": set(), "new_files": set(), "routes": set(), "subcommands": set()}
    for f in files:
        name, status = f.get("filename", ""), f.get("status", "")
        p = Path(name)
        if status == "added":
            out["new_files"].add(name)
            m = NUMBERED.match(p.name)
            if m and p.parent.name == "migrations":
                out["migrations"].add(f"{p.parent.as_posix()}#{m.group(1)}")
        for line in (f.get("patch") or "").splitlines():
            if not line.startswith("+") or line.startswith("+++"):
                continue
            if "pathname" in line or "route" in line.lower() or "p ===" in line:
                out["routes"].update(ROUTE.findall(line))
            if name == "foundation/__main__.py":
                out["subcommands"].update(SUBCMD.findall(line))
    return out


def clashes(mine: dict, theirs: dict) -> list[str]:
    msgs = []
    for k, label in (("migrations", "migration number"), ("new_files", "new file"), ("routes", "route"), ("subcommands", "foundation subcommand")):
        for x in sorted(mine[k] & theirs[k]):
            msgs.append(f"{label} {x}")
    return msgs


def _api(path: str, token: str):
    req = urllib.request.Request("https://api.github.com" + path, headers={"accept": "application/vnd.github+json", "user-agent": "ultrastable-collisions",
                                                                          **({"authorization": "Bearer " + token} if token else {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _files(repo, n, token):
    out, page = [], 1
    while page <= 10:
        got = _api(f"/repos/{repo}/pulls/{n}/files?per_page=100&page={page}", token)
        out += got
        if len(got) < 100:
            break
        page += 1
    return out


def prs(repo: str, pr: int, token: str, api=_api, files=_files) -> list[str]:
    """Clashes between PR `pr` and every open PR opened before it (the older PR holds what it adds)."""
    me = api(f"/repos/{repo}/pulls/{pr}", token)
    mine = added(files(repo, pr, token))
    out = []
    for o in api(f"/repos/{repo}/pulls?state=open&per_page=100", token):
        if o["number"] == pr or o.get("draft") or o["created_at"] >= me["created_at"]:
            continue
        c = clashes(mine, added(files(repo, o["number"], token)))
        if c:
            out.append(f"#{o['number']} ({o['title'][:70]}) already adds {', '.join(c)}")
    return out


def claim(repo: str, ident: str, token: str, api=_api) -> list[str]:
    return [f"#{o['number']} {o['title'][:90]} ({o['head']['ref']})" for o in api(f"/repos/{repo}/pulls?state=open&per_page=100", token)
            if ident in (o.get("title") or "") + "\n" + (o.get("body") or "")]


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    repo, token = os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable"), os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN", "")
    if "--claim" in argv:
        ident = argv[argv.index("--claim") + 1]
        held = claim(repo, ident, token)
        for h in held:
            print(f"collisions: {ident} is already in open PR {h}: extend or review it instead of opening another")
        if not held:
            print(f"collisions: no open PR names {ident}; it is yours")
        return 1 if held else 0
    if "--prs" in argv:
        n = argv[argv.index("--pr") + 1] if "--pr" in argv else os.environ.get("PR_NUMBER", "")
        if not n:
            print("collisions: no PR number (pass --pr N or PR_NUMBER); nothing to compare")
            return 0
        bad = prs(repo, int(n), token)
        for b in bad:
            print(f"collisions: PR #{n} clashes with older open PR {b}")
        if not bad:
            print(f"collisions: PR #{n} adds nothing an older open PR adds")
        return 1 if bad else 0
    bad = check()
    for b in bad:
        print("collisions:", b)
    if not bad:
        print("collisions: ok (migration numbers unique, every migrations/index.json matches its directory)")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
