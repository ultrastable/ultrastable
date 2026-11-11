#!/usr/bin/env python3
"""Plan, check and build the repository split described in repo-split.json (REPO-SPLIT-1).

  python3 scripts/split_repos.py check            every tracked file lands in exactly one target
  python3 scripts/split_repos.py plan             file counts per target
  python3 scripts/split_repos.py build --out DIR  copy tracked files into DIR/<target>/ and add the license files

Longest path prefix wins, so `platform/core` goes to `portable` while the rest of `platform` stays in `ops`.
Nothing here creates a GitHub repository; that is an owner or org-token step (docs/ops/ORG-TOKEN.md).
"""
from __future__ import annotations
import argparse, json, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = "repo-split.json"


def load(root=ROOT):
    return json.loads((Path(root) / MANIFEST).read_text(encoding="utf-8"))


def tracked(root=ROOT):
    r = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], capture_output=True, text=True, check=True)
    return [p for p in r.stdout.split("\0") if p]


def resolver(manifest):
    pairs = sorted(((p, t) for t, spec in manifest["targets"].items() for p in spec["paths"]), key=lambda x: -len(x[0]))

    def which(path: str):
        for prefix, target in pairs:
            if path == prefix or path.startswith(prefix + "/"):
                return target
        return None
    return which


def check(root=ROOT, files=None):
    m, bad = load(root), []
    which = resolver(m)
    shared = set(m["shared_files"])
    for rel in m["shared_files"]:
        if not (Path(root) / rel).exists():
            bad.append(f"shared file missing: {rel}")
    names = set()
    for t, spec in m["targets"].items():
        if spec["repo"] in names:
            bad.append(f"two targets use repo {spec['repo']}")
        names.add(spec["repo"])
    for f in (files if files is not None else tracked(root)):
        if f in shared:
            continue
        if which(f) is None:
            bad.append(f"unassigned: {f}")
    return bad


def plan(root=ROOT, files=None):
    which, counts = resolver(load(root)), {}
    for f in (files if files is not None else tracked(root)):
        t = which(f)
        counts[t] = counts.get(t, 0) + 1
    return counts


def build(out, root=ROOT, files=None):
    m, root, out = load(root), Path(root), Path(out)
    which = resolver(m)
    written = {t: 0 for t in m["targets"]}
    for f in (files if files is not None else tracked(root)):
        t = which(f)
        if t is None or not (root / f).is_file():
            continue
        dst = out / t / f
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / f, dst)
        written[t] += 1
    for t, spec in m["targets"].items():
        for rel in m["shared_files"]:
            dst = out / t / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / rel, dst)
        readme = out / t / "README.md"
        if not readme.exists():
            readme.write_text(
                f"# {spec['repo']}\n\n**Ultrastable is the foundation for any autonomous system.**\n\n{spec['summary']}\n\n"
                f"Licensed under the Ultrastable Hybrid License (see [LICENSE](LICENSE) and [LICENSING.md](LICENSING.md)): "
                f"free for non-commercial use, a Commercial License for anything that makes or saves money. "
                f"Visibility: {spec['after_review']}. Source monorepo: ultrastable/ultrastable.\n", encoding="utf-8")
    return written


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["check", "plan", "build"])
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    if a.cmd == "check":
        bad = check()
        for b in bad:
            print("FAIL:", b)
        print("OK: every tracked file is assigned to one target" if not bad else f"{len(bad)} problems")
        return 1 if bad else 0
    if a.cmd == "plan":
        print(json.dumps(plan(), indent=2))
        return 0
    if not a.out:
        print("--out is required for build", file=sys.stderr)
        return 2
    print(json.dumps(build(a.out), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
