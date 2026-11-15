"""PUBLICATION-1: every repo public under USL-1.0, published by a procedure the code runs. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation publication --check          policy well formed; lessons' probes hold; this repo has the required files and no secret in its tree
  python3 -m foundation publication --audit          tree and full-history secret scan, tripwire paths; a shallow history is `unmeasured`, never clean
  python3 -m foundation publication --audit --org    the same over a full mirror of EVERY repo in the policy, plus required files, issue/PR text and live settings
  python3 -m foundation publication --plan           print, per repo, the flip command or the reasons it is refused (no change)
  python3 -m foundation publication --flip [--apply] each repo is flipped only on its own clean audit; --apply needs GH_TOKEN (ORG_ADMIN_TOKEN); every result goes to the ledger

Runbook for a session or route asked to run this: docs/ops/PUBLICATION-RUNBOOK.md.
"""
from __future__ import annotations
import argparse, datetime as dt, hashlib, json, os, re, shutil, subprocess, sys, tempfile, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/publication.json"
LEDGER = "ops/publication/ledger.jsonl"
REVIEWED = "ops/publication/reviewed.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _probe(root, spec):
    kind, _, arg = spec.partition(":")
    path, _, rx = arg.partition("::")
    p = Path(root) / path
    hit = p.is_file() and re.search(rx, p.read_text(encoding="utf-8", errors="replace")) is not None
    return hit if kind == "grep" else (not hit if kind == "nogrep" else (Path(root) / arg).exists())


def _git(root, *a):
    return subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True)


def tree_hits(root, d) -> list[str]:
    rx = re.compile("|".join(d["secret_patterns"]))
    out = _git(root, "ls-files")
    hits = []
    for rel in out.stdout.split("\n") if out.returncode == 0 else []:
        if not rel or rel in d["secret_allow_paths"]:
            continue
        p = Path(root) / rel
        try:
            if p.is_file() and p.stat().st_size < 2_000_000 and rx.search(p.read_text(encoding="utf-8", errors="ignore")):
                hits.append(rel)
        except OSError as e:
            hits.append(f"{rel}: unreadable ({e})")
    return hits


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _allowed(d, path: str, match: str) -> bool:
    """An allow is exact: a whole file named in secret_allow_paths, or one match (by sha256) at one path with a reason."""
    return path in d["secret_allow_paths"] or any(a["path"] == path and a["sha256"] == _sha(match) for a in d.get("history_allow", []))


def history(root, d, repo: str = "") -> dict:
    """Secret scan over every commit on every ref (works on a bare mirror). A shallow or unreadable history is `unmeasured`.
    Hits are reported by commit, path and sha256 of the match, never by value."""
    if _git(root, "rev-parse", "--git-dir").returncode != 0:
        return {"state": "unmeasured", "why": "not a git checkout"}
    if _git(root, "rev-parse", "--is-shallow-repository").stdout.strip() == "true":
        return {"state": "unmeasured", "why": "shallow clone: history is incomplete"}
    p = subprocess.run(["git", "-C", str(root), "log", "--all", "-p", "--no-color", "--format=@@commit %H"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        return {"state": "unmeasured", "why": "git log failed"}
    rx = re.compile("|".join(d["secret_patterns"]))
    key = (lambda path: f"{repo}:{path}") if repo else (lambda path: path)
    commit = path = ""
    seen, found = set(), []
    for l in p.stdout.split("\n"):
        if l.startswith("@@commit "):
            commit = l[9:21]
        elif l.startswith("+++ b/"):
            path = l[6:].strip()
        elif l.startswith("+") and not l.startswith("+++"):
            for m in rx.finditer(l):
                k = (key(path), _sha(m.group(0)))
                if k in seen or _allowed(d, key(path), m.group(0)):
                    continue
                seen.add(k)
                found.append({"commit": commit, "path": key(path), "sha256": k[1]})
    return {"state": "dirty" if found else "clean", "hits": len(found), "found": found[:50]}


def tripwires(root, d) -> list[str]:
    rev = Path(root) / REVIEWED
    done = set(json.loads(rev.read_text(encoding="utf-8")).get("reviewed", {})) if rev.is_file() else set()
    out = _git(root, "ls-files")
    paths = [x for x in out.stdout.split("\n") if x]
    return sorted({t for t in d["private_data_tripwires"] if t not in done and any(x == t or x.startswith(t) for x in paths)})


def check(root=REPO) -> list[str]:
    root, errs = Path(root), []
    d = load(root)
    for k in ("org", "visibility", "license_id", "repos", "flip_order", "required_files", "secret_patterns", "procedure", "credential", "lessons"):
        if k not in d:
            errs.append(f"missing {k}")
    if errs:
        return errs
    if d["visibility"] != "public":
        errs.append("visibility must be public")
    if sorted(d["repos"]) != sorted(d["flip_order"]):
        errs.append("flip_order must list every repo once")
    if not d["credential"].get("default_in_effect") or not d["credential"].get("routes"):
        errs.append("credential needs routes and a default in effect")
    for a in d.get("history_allow", []):
        if not (a.get("path") and re.fullmatch(r"[0-9a-f]{64}", a.get("sha256", "")) and a.get("reason")):
            errs.append(f"history_allow entry needs path, sha256 and reason: {a.get('path')}")
    if not d.get("runbook") or not (root / d["runbook"]).is_file():
        errs.append("runbook missing: the hand-off lives in the repo (docs/ops/PUBLICATION-RUNBOOK.md)")
    for k in ("text_surfaces", "unmeasured_surfaces"):
        if not isinstance(d.get(k), list):
            errs.append(f"missing {k}")
    for l in d["lessons"]:
        if not _probe(root, l["probe"]):
            errs.append(f"lesson {l['id']}: probe fails {l['probe']}")
    for f in d["required_files"]:
        if not (root / f).is_file():
            errs.append(f"required file missing: {f}")
    lic = root / "LICENSE"
    if lic.is_file() and d["license_id"] not in lic.read_text(encoding="utf-8", errors="replace"):
        errs.append(f"LICENSE lacks {d['license_id']}")
    errs += [f"secret pattern in {h}" for h in tree_hits(root, d)]
    return errs


def audit(root=REPO) -> dict:
    d = load(root)
    return {"tree": tree_hits(root, d), "history": history(root, d), "tripwires": tripwires(root, d)}


def clean(a) -> bool:
    return not a["tree"] and a["history"]["state"] == "clean" and not a["tripwires"]


def _log(root, rec):
    p = Path(root) / LEDGER
    p.parent.mkdir(parents=True, exist_ok=True)
    rec["at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")


def _reviewed(root) -> set:
    rev = Path(root) / REVIEWED
    return set(json.loads(rev.read_text(encoding="utf-8")).get("reviewed", {})) if rev.is_file() else set()


def _gh_json(run, *args):
    p = run(["gh", "api", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        return None
    try:
        return json.loads(p.stdout)
    except ValueError:
        return None


def settings(d, repo, run=subprocess.run) -> dict:
    """Live visibility and scanning state, read from the API and never assumed. A public repo must have secret
    scanning and secret_scanning_push_protection on."""
    j = _gh_json(run, f"repos/{d['org']}/{repo}")
    if not isinstance(j, dict) or "visibility" not in j:
        return {"state": "unmeasured", "why": "repository settings unreadable"}
    sa = j.get("security_and_analysis") or {}
    off = [k for k in ("secret_scanning", "secret_scanning_push_protection") if (sa.get(k) or {}).get("status") != "enabled"]
    return {"state": "read", "visibility": j["visibility"], "unprotected": off if j["visibility"] == "public" else []}


def text_surfaces(d, repo, run=subprocess.run) -> dict:
    """Issues, pull request bodies and comments become public with the repo; scan them like history."""
    rx = re.compile("|".join(d["secret_patterns"]))
    n, found = 0, []
    for ep in d.get("text_surfaces", []):
        pages = _gh_json(run, "--paginate", "--slurp", f"repos/{d['org']}/{repo}/{ep}{'&' if '?' in ep else '?'}per_page=100")
        if not isinstance(pages, list):
            return {"state": "unmeasured", "why": f"{ep} unreadable"}
        for o in (x for page in pages for x in page):
            n += 1
            text = f"{o.get('title') or ''}\n{o.get('body') or ''}"
            for m in rx.finditer(text):
                if not _allowed(d, f"{repo}:{o.get('html_url', '')}", m.group(0)):
                    found.append({"url": o.get("html_url", ""), "sha256": _sha(m.group(0))})
    return {"state": "dirty" if found else "clean", "objects": n, "hits": len(found), "found": found[:50]}


def repo_clean(a) -> bool:
    return ("text" in a and a["history"]["state"] == "clean" and a["text"]["state"] == "clean" and a["settings"]["state"] == "read"
            and not a["settings"]["unprotected"] and not a["required_missing"] and not a["tripwires"])


def repo_audit(root, d, repo, gitdir, run=subprocess.run) -> dict:
    """One repo, measured on its own full mirror: history, required files, tripwire paths, text surfaces, settings."""
    ls = _git(gitdir, "ls-tree", "-r", "--name-only", "HEAD")
    files = [x for x in ls.stdout.split("\n") if x] if ls.returncode == 0 else None
    done = _reviewed(root)
    a = {"history": history(gitdir, d, repo), "text": text_surfaces(d, repo, run), "settings": settings(d, repo, run)}
    if files is None:
        a["required_missing"], a["tripwires"] = ["unmeasured: no HEAD"], []
    else:
        a["required_missing"] = [f for f in d["required_files"] if f not in files]
        a["tripwires"] = sorted({t for t in d["private_data_tripwires"]
                                 if f"{repo}:{t}" not in done and any(x == t or x.startswith(t) for x in files)})
    a["clean"] = repo_clean(a)
    return a


def mirror(d, repo, dest, run=subprocess.run) -> bool:
    return run(["gh", "repo", "clone", f"{d['org']}/{repo}", str(dest), "--", "--mirror", "-q"], capture_output=True, text=True).returncode == 0


def org_audit(root=REPO, workdir=None, run=subprocess.run, mirror=mirror) -> dict:
    """Audit EVERY repo in the policy on a full mirror. The repo this runs in proves nothing about the others;
    a repo that cannot be mirrored or read is `unmeasured`, never clean."""
    d, root = load(root), Path(root)
    tmp = Path(workdir) if workdir else Path(tempfile.mkdtemp(prefix="publication-"))
    out = {}
    try:
        for r in d["repos"]:
            g = tmp / f"{r}.git"
            if not g.is_dir() and not mirror(d, r, g, run):
                out[r] = {"history": {"state": "unmeasured", "why": "mirror clone failed"}, "clean": False}
                continue
            out[r] = repo_audit(root, d, r, g, run)
    finally:
        if not workdir:
            shutil.rmtree(tmp, ignore_errors=True)
    return out


def reasons(a) -> list[str]:
    if "text" not in a:
        return [f"history {a['history']['state']}: {a['history'].get('why', '')}"]
    out = [f"history {a['history']['state']} ({a['history'].get('hits', a['history'].get('why'))})"] if a["history"]["state"] != "clean" else []
    out += [f"issue/PR text {a['text']['state']}"] if a["text"]["state"] != "clean" else []
    out += [f"settings {a['settings'].get('why')}"] if a["settings"]["state"] != "read" else [f"public without {x}" for x in a["settings"]["unprotected"]]
    return out + [f"missing {f}" for f in a["required_missing"]] + [f"tripwire {t} has no disposition" for t in a["tripwires"]]


def verify_public(d, repo, opener=urllib.request.urlopen) -> bool:
    """After a flip: the repo answers an unauthenticated request. A flip that was not verified is not done."""
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{d['org']}/{repo}", headers={"User-Agent": "ultrastable-publication"})
        return opener(req, timeout=20).status == 200
    except (urllib.error.URLError, OSError):
        return False


def protect(d, repo, run, env) -> bool:
    return run(["gh", "api", "-X", "PATCH", f"repos/{d['org']}/{repo}", "-f", "security_and_analysis[secret_scanning][status]=enabled",
                "-f", "security_and_analysis[secret_scanning_push_protection][status]=enabled"], capture_output=True, text=True, env=env).returncode == 0


def flip(root=REPO, apply=False, run=subprocess.run, workdir=None, verify=verify_public) -> int:
    """Per repo, in flip_order: flipped only on that repo's own clean audit. A refused repo never blocks a clean one
    and a clean one never vouches for a refused one."""
    d, root = load(root), Path(root)
    org = org_audit(root, workdir, run)
    tok = os.environ.get("GH_TOKEN") or os.environ.get("ORG_ADMIN_TOKEN")
    rc = 0
    for r in d["flip_order"]:
        a = org[r]
        cmd = ["gh", "repo", "edit", f"{d['org']}/{r}", "--visibility", "public", "--accept-visibility-change-consequences"]
        if not a["clean"]:
            _log(root, {"step": "flip", "repo": r, "result": "refused: audit", "reasons": reasons(a)})
            print(f"flip refused: audit not clean for {r}: " + "; ".join(reasons(a)), file=sys.stderr)
            rc = 2
            continue
        if a["settings"]["visibility"] == "public":
            print(f"# {r}: already public, audit clean")
            continue
        if not apply:
            print(" ".join(cmd))
            continue
        if not tok:
            _log(root, {"step": "flip", "repo": r, "result": "no credential: default in effect"})
            print("flip: no ORG_ADMIN_TOKEN; default in effect, nothing changed", file=sys.stderr)
            return 3
        env = {**os.environ, "GH_TOKEN": tok}
        p = run(cmd, capture_output=True, text=True, env=env)
        ok = p.returncode == 0
        rec = {"step": "flip", "repo": r, "result": "ok" if ok else "failed", "rc": p.returncode}
        if ok:
            rec["verified_public"], rec["protected"] = verify(d, r), protect(d, r, run, env)
            ok = rec["verified_public"] and rec["protected"]
            rec["result"] = "ok" if ok else "flipped: not verified or not protected"
        _log(root, rec)
        if not ok:
            print(f"flip {r}: {rec['result']} rc={p.returncode}", file=sys.stderr)
            return 1
    return rc


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="publication")
    for f in ("--check", "--audit", "--org", "--plan", "--flip", "--apply"):
        ap.add_argument(f, action="store_true")
    ap.add_argument("--root", default=str(REPO))
    ap.add_argument("--workdir", default=None, help="keep and reuse the mirrors here instead of a temp dir")
    a = ap.parse_args(argv)
    if a.audit and a.org:
        r = org_audit(a.root, a.workdir)
        _log(a.root, {"step": "audit-org", "result": {k: ("clean" if v["clean"] else reasons(v)) for k, v in r.items()},
                      "unmeasured_surfaces": load(a.root).get("unmeasured_surfaces", [])})
        print(json.dumps(r, indent=1))
        return 0 if all(v["clean"] for v in r.values()) else 1
    if a.audit:
        r = audit(a.root); print(json.dumps(r, indent=1)); return 0 if clean(r) else 1
    if a.plan:
        a.flip = True
    if a.flip:
        return flip(a.root, a.apply, workdir=a.workdir)
    errs = check(a.root)
    for e in errs:
        print("publication:", e, file=sys.stderr)
    if not errs:
        print("publication ok")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
