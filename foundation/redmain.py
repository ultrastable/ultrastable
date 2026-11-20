# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REDMAIN-1: a deploy gate that is red on main is repaired by code. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation redmain --run [--apply] [--gate ID]   find the smallest revert that turns a red gate green; --apply leaves it in the working tree
  python3 -m foundation redmain --check                       the gates in doctrine/redmain.json name commands and workflows that exist and agree

How: run the gate at HEAD. When it is red, step back along main (1, 2, 4, ... commits) to a green commit and bisect to the first bad one, then try,
in a scratch worktree at HEAD, to reverse one hunk of that commit at a time, then one file, then all of its files under the gate's paths. The first candidate that turns the gate
green is the repair. Test files are never reverted (a guard is not weakened to pass). No model is involved, so the repair does not depend on a model
being up, in quota or able to read the failure.
Data: doctrine/redmain.json. Consumers: .github/workflows/ciwatch.yml (opens the repair as a pull request the lane merges), tests/foundation/test_redmain.py."""
from __future__ import annotations
import fnmatch, json, re, subprocess, sys, tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / "doctrine/redmain.json").read_text(encoding="utf-8"))


def _git(root, *a, check=True, inp=None) -> str:
    r = subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True, input=inp)
    if check and r.returncode:
        raise RuntimeError(f"git {' '.join(a[:3])}: {r.stderr.strip()[:300]}")
    return r.stdout


def gate_ok(cmd: str, cwd, timeout: int, root=None) -> tuple[bool, str]:
    """Run the gate in `cwd`. With `root`, the gate script is taken from root (today's gate judges an older tree that may not carry the script)."""
    if root is not None:
        cmd = " ".join(str(Path(root) / w) if (Path(root) / w).is_file() else w for w in cmd.split())
    try:
        r = subprocess.run(["bash", "-c", cmd], cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, "timeout"
    return r.returncode == 0, (r.stdout + r.stderr)[-1500:]


class _Tree:
    """A scratch worktree; nothing in the caller's working tree is touched while candidates are tried."""
    def __init__(self, root, rev):
        self.root, self.dir = root, tempfile.mkdtemp(prefix="redmain-")
        _git(root, "worktree", "add", "--detach", "-f", self.dir, rev)

    def __enter__(self):
        return Path(self.dir)

    def __exit__(self, *a):
        _git(self.root, "worktree", "remove", "--force", self.dir, check=False)


def first_bad(root, gate: dict, c: dict) -> tuple[str, str] | None:
    """(last good commit, first bad commit) on the first-parent line: step back 1, 2, 4, ... until the gate is green, then bisect the gap."""
    revs = _git(root, "rev-list", "--first-parent", f"-n{c['max_commits_back'] + 1}", "HEAD").split()

    def green(i):
        with _Tree(root, revs[i]) as t:
            return gate_ok(gate["cmd"], t, c["gate_timeout_s"], root)[0]
    lo, hi, step = 0, None, 1  # revs[lo] is red; revs[hi] is green
    while lo + step < len(revs):
        if green(lo + step):
            hi = lo + step
            break
        lo, step = lo + step, step * 2
    if hi is None:
        if lo == len(revs) - 1 or not green(len(revs) - 1):
            return None
        hi = len(revs) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        lo, hi = (lo, mid) if green(mid) else (mid, hi)
    return revs[hi], revs[lo]


def hunks(root, good: str, bad: str, gate: dict, never: list[str]) -> list[dict]:
    """Every hunk the first bad commit changed under the gate's paths, as a patch that applies on its own."""
    out, head, path = [], [], None
    diff = _git(root, "diff", "-U0", "--no-color", "--no-renames", good, bad, "--", *gate["paths"])
    for block in re.split(r"(?m)^(?=diff --git )", diff):
        if not block.strip():
            continue
        m = re.search(r"(?m)^\+\+\+ b/(.+)$", block) or re.search(r"(?m)^--- a/(.+)$", block)
        if not m:
            continue
        path = m.group(1)
        if any(fnmatch.fnmatch(path, p) or fnmatch.fnmatch(path.rsplit("/", 1)[-1], p) for p in never):
            continue
        parts = re.split(r"(?m)^(?=@@ )", block)
        head = parts[0]
        whole = "/dev/null" in head or "Binary files" in block
        if whole or len(parts) < 2:
            out.append({"kind": "file", "path": path})
            continue
        out += [{"kind": "hunk", "path": path, "patch": head + h, "at": h.split("\n", 1)[0]} for h in parts[1:]]
        out.append({"kind": "file", "path": path})
    return out


def _apply(tree, good: str, cand: dict) -> bool:
    if cand["kind"] == "hunk":
        r = subprocess.run(["git", "-C", str(tree), "apply", "-R", "--unidiff-zero", "-"], input=cand["patch"], capture_output=True, text=True)
        return r.returncode == 0
    for p in cand.get("paths") or [cand["path"]]:
        if subprocess.run(["git", "-C", str(tree), "cat-file", "-e", f"{good}:{p}"], capture_output=True).returncode == 0:
            _git(tree, "checkout", good, "--", p)
        else:
            _git(tree, "rm", "-q", "-f", "--", p, check=False)
    return True


def find_repair(root, gate_id: str) -> dict:
    c = cfg(root); gate = c["gates"][gate_id]; root = Path(root)
    ok, tail = gate_ok(gate["cmd"], root, c["gate_timeout_s"])
    if ok:
        return {"gate": gate_id, "state": "green"}
    fb = first_bad(root, gate, c)
    if not fb:
        return {"gate": gate_id, "state": "red", "repair": None, "why": f"no green commit in the last {c['max_commits_back']} on main", "tail": tail[-300:]}
    good, bad = fb
    cands = hunks(root, good, bad, gate, c["never_revert"])
    files = sorted({x["path"] for x in cands})
    ordered = [x for x in cands if x["kind"] == "hunk"] + [x for x in cands if x["kind"] == "file"]
    ordered = ordered[: c["max_candidates"]] + ([{"kind": "file", "path": "*", "paths": files}] if len(files) > 1 else [])
    tried = 0
    with _Tree(root, "HEAD") as t:
        for cand in ordered:
            _git(t, "reset", "-q", "--hard", "HEAD"); _git(t, "clean", "-qfd")
            if not _apply(t, good, cand):
                continue
            tried += 1
            if gate_ok(gate["cmd"], t, c["gate_timeout_s"], root)[0]:
                return {"gate": gate_id, "state": "red", "good": good, "bad": bad, "tried": tried, "repair": {k: v for k, v in cand.items() if k != "patch"}, "_cand": cand, "tail": tail[-300:]}
    return {"gate": gate_id, "state": "red", "good": good, "bad": bad, "tried": tried, "repair": None, "why": "no single hunk, file or full revert of the gate's paths turns the gate green", "tail": tail[-300:]}


def run(root=REPO, gate_id=None, apply=False) -> list[dict]:
    out = []
    for g in ([gate_id] if gate_id else list(cfg(root)["gates"])):
        r = find_repair(root, g); cand = r.pop("_cand", None)
        if apply and cand:
            _apply(Path(root), r["good"], cand)
            r["applied"] = cfg(root)["gates"][g]["cmd"] and gate_ok(cfg(root)["gates"][g]["cmd"], root, cfg(root)["gate_timeout_s"])[0]
        out.append(r)
        if r.get("applied"):
            break  # one repair per run: the next run sees the repaired tree
    return out


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    c = cfg(root)
    for gid, g in c["gates"].items():
        script = g["cmd"].split()[-1]
        if not (root / script).is_file():
            bad.append(f"gate {gid}: {script} does not exist")
        for w in g["workflows"]:
            if not (root / w).is_file() or g["cmd"] not in (root / w).read_text(encoding="utf-8"):
                bad.append(f"gate {gid}: {w} does not run `{g['cmd']}` (GATE-PARITY-1: the deploy and the pull request check must run the same gate)")
        if not any((root / p).exists() for p in g["paths"]):
            bad.append(f"gate {gid}: none of its paths exist")
    return bad


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--check" in argv:
        bad = check()
        print("\n".join(bad) or "redmain ok")
        return 1 if bad else 0
    gate = argv[argv.index("--gate") + 1] if "--gate" in argv else None
    res = run(REPO, gate, "--apply" in argv)
    print(json.dumps(res, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
