# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OPEN-STANDARDS-1 releases: SemVer 2.0 version from Conventional Commits 1.0, written as a Keep a Changelog 1.1 file. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation semrel --next            print the next version and the changelog section for the commits since the last v* tag
  python3 -m foundation semrel --apply           write CHANGELOG.md and VERSION (the release workflow commits them and tags v<version>)

A commit `feat:` raises the minor version, `fix:` and `perf:` the patch, `!` after the type or a `BREAKING CHANGE` footer the major. Any other subject is
a patch-level change under Changed, because most history predates the convention; bot commits marked [skip ci] are left out. Tests: tests/foundation/test_semrel.py.
"""
from __future__ import annotations
import re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CC = re.compile(r"^(?P<type>[a-z]+)(?:\([^)]*\))?(?P<bang>!)?: (?P<desc>.+)$")
SECTIONS = {"feat": "Added", "fix": "Fixed", "perf": "Changed", "deprecate": "Deprecated", "remove": "Removed", "security": "Security"}


def git(root, *a) -> str:
    return subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True, check=True).stdout


def last_tag(root) -> str | None:
    t = subprocess.run(["git", "-C", str(root), "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"], capture_output=True, text=True)
    return t.stdout.strip() or None


def classify(subject: str, body: str = "") -> tuple[str, str, str] | None:
    """(bump, section, text) or None for a commit that is left out."""
    if "[skip ci]" in subject:
        return None
    m = CC.match(subject)
    if not m:
        return ("patch", "Changed", subject)
    t, major = m["type"], bool(m["bang"]) or "BREAKING CHANGE" in body
    bump = "major" if major else "minor" if t == "feat" else "patch"
    return (bump, SECTIONS.get(t, "Changed"), m["desc"])


def bump(version: str, kind: str) -> str:
    a, b, c = (int(x) for x in version.split("."))
    return {"major": f"{a + 1}.0.0", "minor": f"{a}.{b + 1}.0", "patch": f"{a}.{b}.{c + 1}"}[kind]


def plan(root=REPO, today: str | None = None) -> dict:
    tag = last_tag(root)
    rng = f"{tag}..HEAD" if tag else "HEAD"
    raw = git(root, "log", rng, "--format=%s%x1f%b%x1e", *([] if tag else ["-n", "100"]))
    items = []
    for rec in raw.split("\x1e"):
        if not rec.strip():
            continue
        subj, _, body = rec.strip().partition("\x1f")
        c = classify(subj.strip(), body)
        if c:
            items.append(c)
    base = tag[1:] if tag else "0.0.0"
    order = {"patch": 0, "minor": 1, "major": 2}
    top = max((i[0] for i in items), key=order.get, default=None)
    version = bump(base, top) if top else base
    if not tag and top:
        version = "0.1.0"
    secs: dict[str, list[str]] = {}
    for _, s, t in items:
        secs.setdefault(s, []).append(t)
    return {"previous": tag, "version": version, "bump": top, "sections": secs, "date": today or subprocess.run(["date", "-u", "+%F"], capture_output=True, text=True).stdout.strip()}


def render(p: dict) -> str:
    out = [f"## [{p['version']}] - {p['date']}", ""]
    for s in ("Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"):
        if s in p["sections"]:
            out += [f"### {s}", ""] + [f"- {t}" for t in p["sections"][s]] + [""]
    return "\n".join(out)


HEAD = "# Changelog\n\ngenerated-by: python3 -m foundation semrel --apply\n\nAll notable changes, in the Keep a Changelog 1.1 format; versions follow Semantic Versioning 2.0.\n\n"


def apply(root=REPO) -> dict:
    p = plan(root)
    if not p["bump"]:
        return p
    f = Path(root) / "CHANGELOG.md"
    old = f.read_text(encoding="utf-8") if f.exists() else HEAD
    body = old.split("\n## [", 1)
    new = (body[0] if len(body) > 1 else old).rstrip("\n") + "\n\n" + render(p) + ("\n## [" + body[1] if len(body) > 1 else "")
    f.write_text(new.rstrip("\n") + "\n", encoding="utf-8")
    (Path(root) / "VERSION").write_text(p["version"] + "\n", encoding="utf-8")
    return p


def main(argv: list[str]) -> int:
    if "--apply" in argv:
        p = apply()
    else:
        p = plan()
    print(p["version"], "(no change)" if not p["bump"] else render(p)[:2000])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
