# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""PUBLICATION-GUARD-1: a public repository keeps its license, its notice files and a clean tree, checked by code.

Every repository of the organization is public under USL-1.0 (decision 2026-11-15). What the publication found by hand is a check here:
  - required files exist (LICENSE, NOTICE, COMMERCIAL-TERMS.md, CITATION.cff, SECURITY.md) and LICENSE is the canonical blob;
  - no two tracked paths differ only by case: a case-insensitive checkout drops one of them without an error
    (how `LICENSE` vanished from ultrastable/spec next to a `license/` folder);
  - a new source file carries the SPDX header; files that predate the rule are a baseline that only shrinks;
  - nothing in the tree or its history looks like a personal address, an account id or a local path outside the allowed list.
Data: doctrine/publication.json. Across repositories the same invariants run in `python3 -m foundation fleet` (doctrine/fleet.json `copies`).

  python3 -m foundation publication --check            fail on any violation in this repository
  python3 -m foundation publication --baseline         rewrite the SPDX baseline (it may only shrink; --check refuses growth)
  python3 -m foundation publication --history [DIR]    private-data scan of every commit on every ref of a clone (pre-publication audit)
"""
from __future__ import annotations
import collections, hashlib, json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/publication.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def tracked(root) -> list[str]:
    r = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], capture_output=True)
    return [p for p in r.stdout.decode("utf-8", "replace").split("\0") if p]


def blob_sha(data: bytes) -> str:
    """The git blob id of `data`: the same number `git rev-parse main:LICENSE` prints, so the check needs no clone of the license repository."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def case_collisions(paths: list[str]) -> list[list[str]]:
    seen = collections.defaultdict(set)
    for p in paths:
        parts = p.split("/")
        for i in range(1, len(parts) + 1):
            seen["/".join(parts[:i]).lower()].add("/".join(parts[:i]))
    return sorted(sorted(v) for v in seen.values() if len(v) > 1)


def missing_headers(root, paths: list[str], pol: dict) -> list[str]:
    out = []
    for p in paths:
        if not p.endswith(tuple(pol["source_suffixes"])):
            continue
        try:
            head = (Path(root) / p).read_bytes()[:600]
        except OSError:
            continue
        if pol["spdx"].encode() not in head:
            out.append(p)
    return sorted(out)


def private_hits(text: str, pol: dict) -> list[tuple[str, str]]:
    allow = re.compile(pol["private_data"]["allow"], re.I)
    out = []
    for name, rx in pol["private_data"]["patterns"].items():
        for m in re.finditer(rx, text, re.I):
            if not allow.search(m.group(0)):
                out.append((name, m.group(0)))
    return out


def check(root=REPO) -> list[str]:
    root, pol, bad = Path(root), load(root), []
    paths = tracked(root)
    for f in pol["required_files"]:
        if not (root / f).is_file():
            bad.append(f"{f}: missing (every public repository carries it)")
    lic = root / "LICENSE"
    if lic.is_file() and blob_sha(lic.read_bytes().replace(b"\r\n", b"\n")) != pol["license_blob"]:
        bad.append(f"LICENSE: is not the canonical text (blob {pol['license_blob'][:8]}); the license is immutable, a change is a new version in ultrastable/license")
    for group in case_collisions(paths):
        bad.append(f"paths differ only by case: {', '.join(group)} (a case-insensitive checkout silently drops one; rename one of them)")
    base = set(pol["spdx_baseline"])
    lacking = set(missing_headers(root, paths, pol))
    for p in sorted(lacking - base):
        bad.append(f"{p}: new source file without the SPDX header ({pol['spdx']})")
    for p in paths:
        if p.endswith(tuple(pol["private_data"]["scan_suffixes"])) and not re.search(pol["private_data"]["skip_paths"], p):
            try:
                text = (root / p).read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for name, val in private_hits(text, pol)[:3]:
                bad.append(f"{p}: {name} {val[:4]}... is not in the allowed list (doctrine/publication.json private_data.allow)")
    return bad


def baseline(root=REPO) -> tuple[int, int]:
    """Shrink-only: a file that gained its header leaves the baseline; a file that lacks one never enters it here."""
    root = Path(root)
    path, pol = root / POLICY, load(root)
    old = set(pol["spdx_baseline"])
    new = sorted(old & set(missing_headers(root, tracked(root), pol)))
    pol["spdx_baseline"] = new
    path.write_text(json.dumps(pol, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return len(old), len(new)


def history(clone, pol: dict) -> dict:
    """Counts of private-data patterns in every added line of every commit on every ref. Values are never printed, only counted per file."""
    p = subprocess.Popen(["git", "-C", str(clone), "log", "--all", "-p", "--no-color", "--format=commit %H"], stdout=subprocess.PIPE, text=True, errors="replace")
    files, cur = collections.Counter(), ""
    for line in p.stdout:
        if line.startswith("+++ b/"):
            cur = line[6:].strip()
        elif line.startswith("+") and not line.startswith("+++"):
            for name, _ in private_hits(line, pol):
                files[(name, cur)] += 1
    p.wait()
    return {"hits": sum(files.values()), "by_file": [{"kind": k, "file": f, "n": n} for (k, f), n in files.most_common(40)]}


def fix_headers(root=REPO) -> list[str]:
    """SPDX-AUTOFIX-1: prepend the header to every new source file the check flags (a comment line in the file's own syntax). Run by the executor's generators,
    so a change any agent opens carries its headers; files were landing on main without them several times a day."""
    root, done = Path(root), []
    for msg in check(root):
        if "new source file without the SPDX header" not in msg:
            continue
        p = root / msg.split(":", 1)[0]
        c = "#" if p.suffix in (".py", ".sh", ".toml", ".yml", ".yaml") else "//"
        t = p.read_text(encoding="utf-8")
        ident = load(root)['spdx'].split(': ', 1)[-1]
        head = f"{c} SPDX-License-Identifier: {ident}\n{c} Copyright (c) Ultrastable\n"
        # SPDX-AUTOFIX-2: a header that names another identifier is rewritten in place, never stacked under a second header
        lines = t.split("\n")
        wrong = next((i for i, ln in enumerate(lines[:5]) if "SPDX-License-Identifier:" in ln), None)
        if wrong is not None:
            lines[wrong] = f"{c} SPDX-License-Identifier: {ident}"
            if not any("Copyright (c) Ultrastable" in ln for ln in lines[:6]):
                lines.insert(wrong + 1, f"{c} Copyright (c) Ultrastable")
            p.write_text("\n".join(lines), encoding="utf-8"); done.append(str(p.relative_to(root)))
            continue
        if t.startswith("#!"):
            first, rest = t.split("\n", 1)
            t = first + "\n" + head + rest
        else:
            t = head + t
        p.write_text(t, encoding="utf-8"); done.append(str(p.relative_to(root)))
    return done


def main(argv=None) -> int:
    argv = list(argv or [])
    if "--fix" in argv:
        print("\n".join(fix_headers()) or "no header to add"); return 0
    if "--baseline" in argv:
        a, b = baseline()
        print(f"publication: SPDX baseline {a} -> {b}")
        return 0
    if "--history" in argv:
        i = argv.index("--history")
        rep = history(argv[i + 1] if len(argv) > i + 1 else REPO, load())
        print(json.dumps(rep, indent=1))
        return 1 if rep["hits"] else 0
    bad = check()
    for b in bad:
        print(b)
    if not bad:
        pol = load()
        print(f"publication ok: {len(pol['required_files'])} required files, license {pol['license_blob'][:8]}, no case collisions, SPDX baseline {len(pol['spdx_baseline'])}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
