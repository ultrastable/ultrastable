# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""ADOPT-1: wrap loops around a repository that already exists (Q-GAP-adopt-existing-repo). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation adopt --repo DIR                 scan: what the repository is, how it is tested, built and deployed, and the loops that follow
  python3 -m foundation adopt --repo DIR --apply         also add the kernel (additive, never overwrites), write ultrastable/adopted.json and file the gaps
  python3 -m foundation adopt --repo DIR --check         the stored record still matches the repository (drift fails) and every loop has a probe

Engineers and vibe-coders arrive with a repository, not an idea. Nothing is asked: the name and slug come from the folder or the git remote, the
test, build and deploy commands from the files that are there. A loop whose precondition is missing (no test command, no CI, no deploy config) is
not invented: it becomes a queue item in the adopted repository (docs/issues/Q-ADOPT-<loop>.json) with a done check that passes once the file exists.
Consumers: foundation/upstream.py (kernel sync), the adopted repository's own executor (reads docs/issues), tests/foundation/test_adopt.py.
"""
from __future__ import annotations
import argparse, json, re, subprocess, sys
from pathlib import Path

from . import upstream

REPO = Path(__file__).resolve().parents[1]
RECORD = "ultrastable/adopted.json"
SKIP = {".git", "node_modules", "vendor", "dist", "build", "__pycache__", ".venv", "venv", "target", ".next"}
LANGS = {".py": "python", ".js": "javascript", ".mjs": "javascript", ".ts": "typescript", ".tsx": "typescript", ".go": "go", ".rs": "rust", ".rb": "ruby", ".java": "java", ".php": "php"}
DEPLOY = [("wrangler.toml", "cloudflare-workers"), ("wrangler.jsonc", "cloudflare-workers"), ("wrangler.json", "cloudflare-workers"), ("vercel.json", "vercel"),
          ("netlify.toml", "netlify"), ("fly.toml", "fly"), ("app.yaml", "gcp-app-engine"), ("Dockerfile", "container"), ("Procfile", "procfile")]
LOCKS = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "requirements.txt", "poetry.lock", "uv.lock", "go.sum", "Cargo.lock", "Gemfile.lock"]


def _files(root: Path, cap: int = 20000) -> list[Path]:
    out, stack = [], [root]
    while stack and len(out) < cap:
        for p in sorted(stack.pop().iterdir()):
            if p.is_dir():
                if p.name not in SKIP and not p.is_symlink():
                    stack.append(p)
            elif p.is_file():
                out.append(p)
    return out


def slugify(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")[:40] or "system"


def _remote(root: Path) -> str | None:
    r = subprocess.run(["git", "-C", str(root), "config", "--get", "remote.origin.url"], capture_output=True, text=True)
    m = re.search(r"[:/]([^/:]+)/([^/]+?)(?:\.git)?$", r.stdout.strip()) if r.returncode == 0 else None
    return f"{m.group(1)}/{m.group(2)}" if m else None


def _test_command(root: Path, rels: set[str], langs: dict) -> str | None:
    if "package.json" in rels:
        try:
            t = (json.loads((root / "package.json").read_text(encoding="utf-8")).get("scripts") or {}).get("test", "")
        except ValueError:
            t = ""
        if t and "no test specified" not in t:
            return "npm test"
    if any(r in rels for r in ("pytest.ini", "tox.ini", "conftest.py")) or any(re.match(r"tests?/(.*/)?conftest\.py$", r) for r in rels):
        return "python3 -m pytest -q"
    if "pyproject.toml" in rels and "[tool.pytest" in (root / "pyproject.toml").read_text(encoding="utf-8", errors="replace"):
        return "python3 -m pytest -q"
    if any(re.match(r"tests?/(.*/)?test_[^/]+\.py$", r) for r in rels):
        return "python3 -m unittest discover -s " + ("tests" if any(r.startswith("tests/") for r in rels) else "test")
    if "go.mod" in rels and any(r.endswith("_test.go") for r in rels):
        return "go test ./..."
    if "Cargo.toml" in rels:
        return "cargo test"
    if any(re.search(r"\.test\.(m?js|ts)$", r) for r in rels) and "javascript" in langs:
        return "node --test"
    return None


def scan(root) -> dict:
    """What is in the repository, read from its files only. Nothing is guessed: an absent thing is None or an empty list."""
    root = Path(root).resolve()
    files = _files(root)
    rels = {p.relative_to(root).as_posix() for p in files}
    langs: dict[str, int] = {}
    for p in files:
        k = LANGS.get(p.suffix)
        if k:
            langs[k] = langs.get(k, 0) + 1
    remote = _remote(root)
    name = (remote or root.name).split("/")[-1]
    deploy = sorted({kind for f, kind in DEPLOY if f in rels})
    return {"name": name, "slug": slugify(name), "remote": remote, "files": len(files), "languages": dict(sorted(langs.items(), key=lambda kv: -kv[1])),
            "test_command": _test_command(root, rels, langs), "ci": sorted(r for r in rels if re.match(r"\.github/workflows/(?!ultrastable-)[^/]+\.ya?ml$", r)),  # the kernel's own workflows are not the repository's checks
            "deploy": deploy, "lockfiles": sorted(r for r in rels if r in LOCKS), "has_readme": any(r.lower().startswith("readme") for r in rels),
            "has_kernel": upstream.LOCK in rels}


def loops(s: dict) -> list[dict]:
    """The loops that follow from the scan. A loop is `ready` when its probe can run today; otherwise it names the one thing that is missing."""
    t, out = s["test_command"], []
    out.append({"id": "tests", "what": "every change is checked by the repository's own tests", "trigger": "every change", "owner_role": "reviewer",
                "probe": f"cmd:{t}" if t else None, "ready": bool(t), "missing": None if t else "a test command (no test script, test folder or test config was found)",
                "done_check": "grep:ultrastable/adopted.json::\"test_command\": \"[^\"]"})
    out.append({"id": "ci", "what": "checks run on the server for every pull request", "trigger": "pull request", "owner_role": "operations",
                "probe": "file:" + s["ci"][0] if s["ci"] else None, "ready": bool(s["ci"]), "missing": None if s["ci"] else "a server-side check workflow (.github/workflows/)",
                "done_check": "file:.github/workflows/checks.yml"})
    out.append({"id": "deploy", "what": "a merged change is deployed and probed live", "trigger": "merge to the default branch", "owner_role": "operations",
                "probe": "grep:ultrastable/adopted.json::\"deploy\": \\[\\s*\"" if s["deploy"] else None, "ready": bool(s["deploy"]),
                "missing": None if s["deploy"] else "a deploy target (no wrangler, container or host config was found)", "done_check": "grep:ultrastable/adopted.json::\"deploy\": \\[\\s*\""})
    out.append({"id": "dependencies", "what": "pinned dependencies are refreshed and re-tested", "trigger": "weekly", "owner_role": "operations",
                "probe": "file:" + s["lockfiles"][0] if s["lockfiles"] else None, "ready": bool(s["lockfiles"]) and bool(t),
                "missing": None if s["lockfiles"] and t else ("a lockfile" if not s["lockfiles"] else "a test command to re-test with"), "done_check": "file:" + (s["lockfiles"][0] if s["lockfiles"] else "package-lock.json")})
    out.append({"id": "improve", "what": "the managers originate the next improvement from the measures", "trigger": "every tick", "owner_role": "product-manager",
                "probe": "file:" + upstream.LOCK, "ready": True, "missing": None, "done_check": "file:" + upstream.LOCK})
    return out


def _item(loop: dict) -> dict:
    iid = "Q-ADOPT-" + loop["id"]
    body = (f"**Owner:** {loop['owner_role']}\n**Trigger:** every executor run\n**Done check:** {loop['done_check']}\n**Status:** open\n\n"
            f"Adopted repository: the loop `{loop['id']}` ({loop['what']}) cannot run yet. Missing: {loop['missing']}. Add it, then re-run `python3 -m foundation adopt --repo . --apply`.")
    return {"id": iid, "title": f"{iid}: {loop['what']}", "body": body, "labels": [f"role:{loop['owner_role']}", "adopt"], "milestone": "Now", "workstream": "Adoption"}


def adopt(root, core=REPO, apply: bool = False, name: str | None = None) -> dict:
    """Scan, derive the loops and (with apply) add the kernel beside the existing code. Additive and idempotent: an existing file is never overwritten."""
    root = Path(root).resolve()
    if not root.is_dir():
        raise ValueError(f"{root} is not a directory")
    s = scan(root)
    if name:
        s["name"], s["slug"] = name, slugify(name)
    ls = loops(s)
    rec = {"schema": "ultrastable-adopted/1", "scan": s, "loops": ls}
    out = {"record": rec, "applied": apply, "ready": [x["id"] for x in ls if x["ready"]], "gaps": [x["id"] for x in ls if not x["ready"]], "filed": [], "kernel": None}
    if not apply:
        return out
    k = upstream.adopt(Path(core), root, s["name"], s["slug"], goal=f"Keep {s['name']} tested, deployed and improving on its own loops")
    out["kernel"] = {"created": k.get("created", []), "conflicts": k.get("conflicts", [])}
    rec["scan"]["has_kernel"] = True
    for x in ls:
        f = root / "docs/issues" / f"Q-ADOPT-{x['id']}.json"
        if not x["ready"] and not f.exists():
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(_item(x), indent=2) + "\n", encoding="utf-8")
            out["filed"].append(f.stem)
    (root / RECORD).parent.mkdir(parents=True, exist_ok=True)
    (root / RECORD).write_text(json.dumps(rec, indent=1) + "\n", encoding="utf-8")
    return out


def check(root) -> list[str]:
    root, bad = Path(root).resolve(), []
    p = root / RECORD
    if not p.is_file():
        return [f"{RECORD} missing: run adopt --apply"]
    rec, now = json.loads(p.read_text(encoding="utf-8")), scan(root)
    for k in ("test_command", "deploy", "ci", "lockfiles"):
        if rec["scan"].get(k) != now[k]:
            bad.append(f"drift in {k}: recorded {rec['scan'].get(k)!r}, repository now has {now[k]!r} (re-run adopt --apply)")
    for x in rec["loops"]:
        if x["ready"] and not x["probe"]:
            bad.append(f"loop {x['id']}: ready without a probe")
        if not x["ready"] and not (root / "docs/issues" / f"Q-ADOPT-{x['id']}.json").is_file() and x["id"] in [y["id"] for y in loops(now) if not y["ready"]]:
            bad.append(f"loop {x['id']}: not ready and no queue item (a silent drop)")
    if not (root / upstream.LOCK).is_file():
        bad.append(f"{upstream.LOCK} missing: the kernel was not added")
    return bad


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="foundation adopt")
    ap.add_argument("--repo", required=True); ap.add_argument("--name"); ap.add_argument("--apply", action="store_true"); ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    if a.check:
        bad = check(a.repo)
        print("\n".join("adopt: " + b for b in bad) or "adopt ok"); return 1 if bad else 0
    r = adopt(a.repo, apply=a.apply, name=a.name)
    print(json.dumps({k: v for k, v in r.items() if k != "record"} | {"scan": r["record"]["scan"]}, indent=1)); return 0


if __name__ == "__main__":
    sys.exit(main())
