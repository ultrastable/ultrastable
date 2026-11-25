# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FLEET-MAP-1 (Rowan, 2026-11-25): one map of every repository of the org, and drift between a source and its copy that cannot be missed.
Ultrastable is the foundation for any autonomous system.

  python3 -m foundation fleetmap --check                 static (in checks): every repository named in doctrine/tenant-repos.json, the seeds of
                                                         doctrine/seed-deploys.json, github/org-settings.json and the map's own session_repos is a
                                                         row and every row is in one of them; every synced_from names a path and a workflow that
                                                         exist; every row says its layer, visibility with a reason and its instruction file
  python3 -m foundation fleetmap --drift [--clones DIR]  compare every copy with its source: a clone in DIR (default: beside this checkout), else the
                                                         public GitHub tree. A copy that cannot be read is `unmeasured`, never ok. Exit 1 unless every
                                                         copy is equal.
  python3 -m foundation fleetmap --drift --apply         the same, recorded in ops/fleet-map.json; files Q-FLEETMAP-<repo> per copy that is not equal
                                                         and closes it when the same reading passes (daily in tenant-sync.yml)
  python3 -m foundation fleetmap --probe REPO            closing probe of Q-FLEETMAP-<REPO>: the drift reading of that one repository
  python3 -m foundation fleetmap --publish DIR [--apply]  copy seed/ into a clone of the template without overwriting work done there: a file is
                                                         replaced only when it is what the last publish wrote or an older version of the source;
                                                         anything else is a conflict to carry up (template-publish.yml)
  python3 -m foundation fleetmap --example [--apply]      the running-example block of seed/README.md, from the map (LIVE-LINKS-1 for the template)
  python3 -m foundation fleetmap --system-readme PATH --id ID   turn a copied template README into the system's own: its name and its Live block
  python3 -m foundation fleetmap --keep REPO             the paths only the copy holds on purpose, one per line (read by template-publish.yml)
  python3 -m foundation fleetmap --instructions REPO     the AGENTS.md a repository with no instruction file gets: a pointer to the platform's rules
  python3 -m foundation fleetmap --list                  one line per repository

Data: doctrine/fleet-map.json. Tests: tests/foundation/test_fleetmap.py."""
from __future__ import annotations
import datetime as dt, hashlib, json, os, re, shutil, subprocess, sys, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MAP = "doctrine/fleet-map.json"
READING = "ops/fleet-map.json"
RULE = "FLEET-MAP-1"
LAYERS = ("platform", "template", "seeded-system", "tenant", "admin", "org-profile")
KINDS = ("tree", "kernel", "vendor", "manifest")
SKIP = {".git", "__pycache__", "node_modules", ".wrangler"}
POINTER = ("ultrastable/ultrastable", "agents/AGENTS.md")
UA = "ultrastable-fleetmap/1"


def _j(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def load(root=REPO) -> dict:
    return _j(root, MAP)


def named_repos(root=REPO) -> dict:
    """{repository: [registries that name it]} from every registry the platform keeps."""
    root, out = Path(root), {}
    m = load(root)
    org = m.get("org", "ultrastable")
    def add(repo, src):
        if repo:
            out.setdefault(repo, []).append(src)
    for slug, t in _j(root, "doctrine/tenant-repos.json").get("tenants", {}).items():
        add(t.get("repo") or f"{org}/{slug}", "doctrine/tenant-repos.json")
    add(_j(root, "doctrine/tenant-repos.json").get("visitor_apps", {}).get("template"), "doctrine/tenant-repos.json")
    fs = _j(root, "doctrine/full-stack.json").get("systems", {})
    for seed in _j(root, "doctrine/seed-deploys.json").get("seeds", []):
        add((fs.get(seed) or {}).get("repo") or f"{org}/{seed}", "doctrine/seed-deploys.json")
    for repo in _j(root, "github/org-settings.json").get("repos", {}):
        add(repo, "github/org-settings.json")
    for repo in m.get("session_repos", {}).get("repos", []):
        add(repo, MAP + " session_repos")
    return out


def check(root=REPO) -> list[str]:
    root = Path(root)
    m, errs = load(root), []
    rows, named = m.get("repos", {}), named_repos(root)
    for repo, srcs in sorted(named.items()):
        if repo not in rows:
            errs.append(f"{repo}: named in {', '.join(sorted(set(srcs)))} and has no row in {MAP}")
    for repo, r in sorted(rows.items()):
        if repo not in named:
            errs.append(f"{repo}: a row in {MAP} that no registry names (tenant-repos, seed-deploys, org-settings, session_repos)")
        if not str(r.get("purpose", "")).strip().endswith("."):
            errs.append(f"{repo}: purpose must be one sentence")
        if r.get("layer") not in LAYERS:
            errs.append(f"{repo}: layer {r.get('layer')!r} is not one of {', '.join(LAYERS)}")
        if r.get("visibility") not in ("public", "private") or not r.get("visibility_reason"):
            errs.append(f"{repo}: visibility must be public or private, with a reason")
        if not isinstance(r.get("actions"), bool) or not isinstance(r.get("deploys"), list):
            errs.append(f"{repo}: actions must be true or false and deploys a list of worker ids")
        ins = r.get("instructions") or {}
        if ins.get("kind") not in ("canonical", "copy", "pointer", "none") or (ins.get("kind") == "none") != (not ins.get("file")):
            errs.append(f"{repo}: instructions must name the file agents read (kind canonical, copy or pointer) or be kind none with a reason")
        if ins.get("kind") == "none" and not ins.get("reason"):
            errs.append(f"{repo}: instructions kind none needs a reason")
        if ins.get("kind") in ("copy", "pointer") and not (root / str(ins.get("source"))).is_file():
            errs.append(f"{repo}: instructions source {ins.get('source')} does not exist")
        if ins.get("kind") == "canonical" and not (root / str(ins.get("file"))).is_file():
            errs.append(f"{repo}: canonical instruction file {ins.get('file')} does not exist")
        if r.get("layer") in ("template", "seeded-system") and not r.get("synced_from"):
            errs.append(f"{repo}: a {r.get('layer')} is a copy and must say what it is synced from")
        for s in r.get("synced_from") or []:
            if s.get("kind") not in KINDS:
                errs.append(f"{repo}: synced_from kind {s.get('kind')!r} is not one of {', '.join(KINDS)}")
            if s.get("direction") not in ("down", "up", "both"):
                errs.append(f"{repo}: synced_from direction must be down, up or both")
            if s.get("source_repo") not in rows:
                errs.append(f"{repo}: synced_from source_repo {s.get('source_repo')} is not a row")
            if not (root / str(s.get("source"))).exists():
                errs.append(f"{repo}: synced_from source {s.get('source')} does not exist")
            if not (root / str(s.get("workflow"))).is_file():
                errs.append(f"{repo}: synced_from workflow {s.get('workflow')} does not exist")
            if s.get("kind") == "vendor" and not isinstance(_vendor_map(root, s), dict):
                errs.append(f"{repo}: synced_from map {s.get('map')} is not in {s.get('source')}")
    from . import fleetcontract, livelinks, upstream
    origins = {x["id"]: x["origin"] for x in fleetcontract.systems(root)}
    for repo, r in sorted(rows.items()):
        sid = "ultrastable" if r.get("layer") == "platform" and r.get("state") == "live" else repo.split("/", 1)[1]
        if "live" not in r or (r["live"] is not None and not str(r["live"]).startswith("https://")):
            errs.append(f"{repo}: live must be the https address it runs at, or null")
        elif sid in origins and r.get("state") != "retired" and r["live"] != origins[sid]:
            errs.append(f"{repo}: live is {r['live']} and the registries say {origins[sid]} (LIVE-LINKS-1)")
        elif r.get("state") == "live" and r.get("deploys") and not r["live"]:
            errs.append(f"{repo}: Workers deploy from it, so it must say where it runs (live)")
    for f in m.get("identity", {}).get("files", []):
        if f not in upstream.OWNED:
            errs.append(f"identity file {f} is not in foundation/upstream.py OWNED: the kernel sync could overwrite it")
        if any(f == k or f.startswith(k.rstrip("/") + "/") for k in __import__("foundation.scaffold", fromlist=["x"]).KERNEL_PATHS):
            errs.append(f"identity file {f} is inside a kernel path: the kernel sync would overwrite it")
    readme = root / "seed/README.md"
    if readme.is_file() and example_block(root) not in readme.read_text(encoding="utf-8"):
        errs.append("seed/README.md does not carry the current running-example block; run python3 -m foundation fleetmap --example --apply")
    tc = m.get("template_contents", {})
    for d in tc.get("belongs", []):
        if d.rstrip("/") not in (".github", ".gitignore") and not (root / "seed" / d).exists():
            errs.append(f"template_contents.belongs names {d}, which seed/ does not hold")
    for d in tc.get("never", []):
        if (root / "seed" / d).exists():
            errs.append(f"seed/{d} is admin or platform material and may not be in the template (TEMPLATE-CODE-ONLY-1)")
    known = set(tc.get("belongs", []))
    for p in sorted((root / "seed").iterdir()) if (root / "seed").is_dir() else []:
        name = p.name + ("/" if p.is_dir() else "")
        if p.name not in SKIP and name not in known:
            errs.append(f"seed/{name} is not listed in template_contents.belongs: decide whether it belongs in the template")
    return errs


def _vendor_map(root, s):
    cur = _j(root, s["source"])
    for part in str(s.get("map", "")).split("."):
        cur = cur.get(part) if isinstance(cur, dict) else None
    return cur


def blob_sha(data: bytes) -> str:
    """The id git gives this content, so a local file compares with a GitHub tree listing without downloading the file."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def local_tree(base: Path) -> dict:
    out = {}
    for f in sorted(Path(base).rglob("*")):
        if f.is_file() and not (set(f.relative_to(base).parts) & SKIP) and f.suffix != ".pyc":
            out[f.relative_to(base).as_posix()] = blob_sha(f.read_bytes())
    return out


def remote_tree(repo: str, fetch=None) -> dict | None:
    """{path: blob id} of a public repository's default branch, or None when it cannot be read (private, missing, refused)."""
    fetch = fetch or _fetch
    j = fetch(f"https://api.github.com/repos/{repo}/git/trees/HEAD?recursive=1")
    if not isinstance(j, dict) or not isinstance(j.get("tree"), list) or j.get("truncated"):
        return None
    return {e["path"]: e["sha"] for e in j["tree"] if e.get("type") == "blob"}


def _fetch(url):
    h = {"user-agent": UA, "accept": "application/vnd.github+json"}
    tok = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if tok:
        h["authorization"] = "Bearer " + tok
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as e:
        return {"error": str(e)[:120]}


def mirror_tree(repo: str, clones: Path | None, fetch=None):
    """(tree, how) for a repository: a clone beside this checkout first, then the public GitHub tree."""
    d = Path(clones) / repo.split("/", 1)[1] if clones else None
    if d and d.is_dir() and any(d.iterdir()):
        return local_tree(d), "clone"
    t = remote_tree(repo, fetch)
    return (t, "github") if t is not None else (None, "unreadable")


def history_blobs(root, rel: str) -> set:
    """Every blob id the file at rel has had in this checkout's git history; the history is completed first when the clone is shallow."""
    root = Path(root)
    def git(*a):
        return subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True)
    if git("rev-parse", "--is-shallow-repository").stdout.strip() == "true" and not os.environ.get("FLEETMAP_NO_FETCH"):
        r = git("fetch", "--unshallow", "--quiet")
        if r.returncode:
            print(f"fleetmap: history is shallow and could not be completed ({r.stderr.strip()[:120]}); older versions outside it read as edits", file=sys.stderr)
    out = set()
    for line in git("log", "--format=", "--raw", "--no-abbrev", "--", rel).stdout.splitlines():
        parts = line.split()
        if line.startswith(":") and len(parts) >= 4:
            out.update(parts[2:4])
    return out - {"0" * 40}


STAMP = ".ultrastable/published.json"


def publish(root, mirror, source="seed", keep=(), apply=False, source_sha="") -> dict:
    """Copy source/ of this checkout into a clone of its mirror without ever overwriting work done in the mirror. A mirror file is replaced only
    when it is what the last publish wrote (the stamp) or an older version of the source file (git history); anything else was edited in the
    mirror and is a conflict to carry up into the source. Files only the mirror holds are reported, never deleted."""
    root, mirror = Path(root), Path(mirror)
    sp = mirror / STAMP
    stamp = json.loads(sp.read_text(encoding="utf-8")).get("digests", {}) if sp.exists() else {}
    src, cur = local_tree(root / source), local_tree(mirror)
    rep = {"added": [], "updated": [], "conflicts": [], "extra": [], "same": 0}
    digests = {}
    for p, sha in src.items():
        if p not in cur:
            rep["added"].append(p)
        elif cur[p] == sha:
            rep["same"] += 1
            digests[p] = sha
            continue
        elif stamp.get(p) == cur[p] or cur[p] in history_blobs(root, f"{source}/{p}"):
            rep["updated"].append(p)
        else:
            rep["conflicts"].append(p)
            if p in stamp:
                digests[p] = stamp[p]
            continue
        digests[p] = sha
        if apply:
            (mirror / p).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / source / p, mirror / p)
    rep["extra"] = sorted(p for p in cur if p not in src and p != STAMP and not _under(p, keep))
    if apply and (rep["added"] or rep["updated"] or not sp.exists()):
        sp.parent.mkdir(parents=True, exist_ok=True)
        sp.write_text(json.dumps({"rule": RULE, "source": f"ultrastable/ultrastable {source}/", "source_sha": source_sha, "digests": dict(sorted(digests.items()))}, indent=1) + "\n", encoding="utf-8")
    return rep


def _under(path: str, prefixes) -> bool:
    return any(path == p or (p.endswith("/") and path.startswith(p)) for p in prefixes)


def drift_one(root, repo: str, row: dict, clones=None, fetch=None, template_keep=()) -> dict:
    """The reading for one repository: equal, drifted or unmeasured, with the files behind each count."""
    root = Path(root)
    out = {"repo": repo, "status": "equal", "how": None, "differ": [], "missing": [], "extra": [], "notes": []}
    if not row.get("synced_from") and (row.get("instructions") or {}).get("kind") in (None, "none", "canonical"):
        return {**out, "status": "not-a-copy"}
    tree, how = mirror_tree(repo, clones, fetch)
    out["how"] = how
    if tree is None:
        return {**out, "status": "unmeasured", "notes": ["the repository could not be read: no clone beside this checkout and no public tree (private, missing or refused)"]}
    for s in row.get("synced_from") or []:
        kind = s.get("kind")
        if kind in ("tree", "kernel"):
            src = local_tree(root / s["source"])
            keep = list(s.get("keep") or []) + (list(template_keep) if s.get("keep_from") else [])
            skip = list(s.get("not_synced") or []) if kind == "kernel" else []
            owned = [STAMP, "IDEA.md", "README.md", "instance.json", "docs/PROJECT-MEMORY.md", "ultrastable.lock.json", ".ultrastable/", "ops/", "org/", "domain/"] if kind == "kernel" else []
            for p, sha in src.items():
                if _under(p, skip) or _under(p, owned):
                    continue
                if p not in tree:
                    out["missing"].append(p)
                elif tree[p] != sha:
                    out["differ"].append(p)
            if kind == "tree":
                out["extra"] += [p for p in tree if p not in src and p != STAMP and not _under(p, keep)]
            if kind == "kernel" and s.get("lock") and s["lock"] not in tree:
                out["notes"].append(f"{s['lock']} is missing: the kernel sync treats every changed file as a local edit and updates nothing")
        elif kind == "vendor":
            for a, b in sorted((_vendor_map(root, s) or {}).items()):
                f = root / a
                if not f.is_file():
                    out["notes"].append(f"vendor source {a} is not in this checkout")
                elif b not in tree:
                    out["missing"].append(b)
                elif tree[b] != blob_sha(f.read_bytes()):
                    out["differ"].append(b)
        elif kind == "manifest":
            for name in s.get("files") or []:
                f = root / s["source"] / name
                if f.is_file() and name in tree and tree[name] != blob_sha(f.read_bytes()):
                    out["differ"].append(name)
        mw = s.get("mirror_workflow")
        if mw and mw not in tree:
            out["notes"].append(f"{mw} is missing: this repository has no workflow of its own that pulls the update")
    ins = row.get("instructions") or {}
    if ins.get("kind") in ("copy", "pointer") and ins.get("file") not in tree:
        out["missing"].append(ins["file"])
        out["notes"].append(f"no instruction file: an agent that opens this repository reads no rules ({ins['file']})")
    elif ins.get("kind") == "pointer" and how == "clone":
        text = (Path(clones) / repo.split("/", 1)[1] / ins["file"]).read_text(encoding="utf-8", errors="replace")
        if not all(p in text for p in POINTER):
            out["notes"].append(f"{ins['file']} does not point at the platform's rules ({' '.join(POINTER)})")
    for k in ("differ", "missing", "extra"):
        out[k] = sorted(set(out[k]))
    if out["differ"] or out["missing"] or out["extra"] or out["notes"]:
        out["status"] = "drifted"
    return out


def drift(root=REPO, clones=None, fetch=None, only=None) -> list[dict]:
    m = load(root)
    keep = m.get("template_contents", {}).get("keep", [])
    return [drift_one(root, repo, row, clones, fetch, keep) for repo, row in m.get("repos", {}).items()
            if row.get("state") != "retired" and (only is None or repo in (only, f"{m.get('org')}/{only}"))]


def _slug(repo: str) -> str:
    return repo.split("/", 1)[1].strip(".").replace(".", "-")


def item(reading: dict) -> dict:
    slug, n = _slug(reading["repo"]), {k: len(reading[k]) for k in ("differ", "missing", "extra")}
    what = "could not be read" if reading["status"] == "unmeasured" else f"{n['differ']} file(s) differ, {n['missing']} missing, {n['extra']} only in the copy"
    lines = [f"- {k}: {', '.join(reading[k][:12])}{' ...' if len(reading[k]) > 12 else ''}" for k in ("differ", "missing", "extra") if reading[k]] + [f"- {x}" for x in reading["notes"]]
    probe = f"python3 -m foundation fleetmap --probe {slug}"
    body = (f"**Owner:** operations\n**Trigger:** fleetmap --drift --apply (daily in tenant-sync.yml)\n**Done check:** cmd:{probe}\n"
            f"**Prediction:** fleet_map_drifted_repos <= 0 within 168 h\n**Status:** open\n\n{reading['repo']} is a copy and is not equal to its source ({RULE}): {what}.\n\n"
            + "\n".join(lines) + f"\n\nFix the sync named in doctrine/fleet-map.json for this repository (never copy by hand), then the same reading closes this item.\n\n**Closing probe:** cmd:{probe}\n")
    return {"id": f"Q-FLEETMAP-{slug}", "title": f"Q-FLEETMAP-{slug}: {reading['repo']} is not equal to its source ({what})", "body": body,
            "labels": ["p1", "agent-ready", "role:operations", "sync"], "milestone": "Now", "workstream": "Executor queue"}


def apply(root, readings: list[dict], now=None) -> dict:
    """Record the reading, file one item per copy that is not equal and close an item whose reading now passes."""
    root, now = Path(root), now or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    filed, closed = [], []
    for r in readings:
        f = root / "docs/issues" / f"Q-FLEETMAP-{_slug(r['repo'])}.json"
        if r["status"] in ("drifted", "unmeasured"):
            new = item(r)
            if not f.exists() or json.loads(f.read_text(encoding="utf-8")).get("title") != new["title"]:
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(json.dumps(new, indent=2) + "\n", encoding="utf-8")
                filed.append(new["id"])
        elif r["status"] == "equal" and f.exists() and "**Status:** open" in f.read_text(encoding="utf-8"):
            j = json.loads(f.read_text(encoding="utf-8"))
            j["body"] = j["body"].replace("**Status:** open", "**Status:** closed") + f"\n**Evidence:** fleetmap --drift read {r['repo']} equal to its source ({r['how']}).\n"
            f.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
            closed.append(j["id"])
    summary = {r["repo"]: {"status": r["status"], "how": r["how"], "differ": len(r["differ"]), "missing": len(r["missing"]), "extra": len(r["extra"]), "notes": r["notes"]} for r in readings}
    p = root / READING
    old = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    if old.get("repos") != summary:  # SUBSTANCE-1: a new timestamp alone is not a change
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"rule": RULE, "at": now, "repos": summary}, indent=1) + "\n", encoding="utf-8")
    return {"filed": filed, "closed": closed}


EX_START, EX_END = "<!-- example:start (generated by python3 -m foundation fleetmap --example from doctrine/fleet-map.json; do not edit) -->", "<!-- example:end -->"
EX_BLOCK = re.compile(r"<!-- example:start[^>]*-->.*?<!-- example:end -->\n?", re.S)


def example_block(root=REPO) -> str:
    """LIVE-LINKS-1 for the template: it runs nowhere itself, so its README names a system that was started from it and where every system is listed."""
    m = load(root)
    t = next((r for r in m["repos"].values() if r.get("layer") == "template"), {})
    ex = m["repos"].get(t.get("example") or "", {})
    plat = next(r["live"] for r in m["repos"].values() if r["layer"] == "platform" and r.get("live"))
    lines = ["## A running example", ""]
    if ex.get("live"):
        lines += [f"This is a template: it runs nowhere itself. A system started from it is running at [{ex['live']}]({ex['live']}/) "
                  f"(repository [{t['example']}](https://github.com/{t['example']}), health report at [{ex['live']}/health]({ex['live']}/health)).", ""]
    lines += [f"Every system running on Ultrastable is listed at [{plat}/directory]({plat}/directory)."]
    return "\n".join([EX_START, *lines, EX_END]) + "\n"


def place_example(text: str, blk: str) -> str:
    if EX_BLOCK.search(text):
        return EX_BLOCK.sub(lambda _m: blk, text, count=1)
    h = re.search(r"^# .*\n", text, re.M)
    return (text[:h.end()] + "\n" + blk + text[h.end():]) if h else blk + "\n" + text


def system_readme(text: str, sid: str, root=REPO) -> str:
    """The README a repository filled from seed/ starts with: the system's own name, where it runs, then the kernel's description. The template's
    title and its running-example block are the template's identity, not the system's."""
    from . import livelinks
    text = EX_BLOCK.sub("", text, count=1)
    intro = ("A system started from the [Ultrastable seed](https://github.com/ultrastable/seed) and run by its own managers. "
             "The text below the Live block is the seed's own description of what every such system carries.\n")
    h = re.search(r"^# .*\n", text, re.M)
    rest = (text[h.end():] if h else text).lstrip("\n")
    rest = livelinks.BLOCK.sub("", rest, count=1).lstrip("\n")
    if rest.startswith(intro):
        rest = rest[len(intro):].lstrip("\n")
    return f"# {sid}\n\n{livelinks.block(sid, root)}\n{intro}\n{rest}"


def instructions_text(root, repo: str) -> str:
    m = load(root)
    row = m["repos"][repo]
    return (f"# Agent instructions: {repo}\n\n> Ultrastable is the foundation for any autonomous system.\n\n{row['purpose']} Layer: {row['layer']} ({m['layers'][row['layer']]}).\n\n"
            "The rules every agent follows are written once, in the platform: `agents/AGENTS.md` in `ultrastable/ultrastable`. At the start of a session fetch\n"
            "https://raw.githubusercontent.com/ultrastable/ultrastable/main/agents/AGENTS.md and follow it; it wins over anything stale here. If the fetch fails,\n"
            "continue with this file and record the failure as an item with a retry probe.\n\n"
            "What this repository is, what it is copied from and what deploys from it is one row of `doctrine/fleet-map.json` in the platform\n"
            "(`python3 -m foundation fleetmap --list`). A file that is a copy is changed at its source, never here: the sync named in that row carries it.\n")


def main(argv=None) -> int:
    av = list(sys.argv[1:] if argv is None else argv)
    clones = Path(av[av.index("--clones") + 1]) if "--clones" in av else Path(os.environ.get("FLEET_CLONES") or REPO.parent)
    m = load(REPO)
    def full(name):
        return name if "/" in name else next((r for r in m["repos"] if _slug(r) == name or r.split("/", 1)[1] == name), name)
    if "--check" in av:
        errs = check(REPO)
        for e in errs:
            print("FAIL", e)
        print(f"fleetmap --check: {len(m['repos'])} repositories, {len(errs)} problem(s)")
        return 1 if errs else 0
    if "--list" in av:
        for repo, r in m["repos"].items():
            src = "; ".join(f"{s['kind']} of {s['source']} ({s['direction']}, {s['workflow'].rsplit('/', 1)[-1]})" for s in r.get("synced_from") or []) or "source of truth" if r["layer"] == "platform" else "; ".join(f"{s['kind']} of {s['source']} ({s['direction']}, {s['workflow'].rsplit('/', 1)[-1]})" for s in r.get("synced_from") or []) or "own content"
            print(f"{repo:34} {r['layer']:14} {r.get('state', ''):8} {r['visibility']:8} deploys={','.join(r['deploys']) or '-'}  from: {src}")
        return 0
    if "--keep" in av:
        row = m["repos"][full(av[av.index("--keep") + 1])]
        for s in row.get("synced_from") or []:
            for k in list(s.get("keep") or []) + (m["template_contents"]["keep"] if s.get("keep_from") else []):
                print(k)
        return 0
    if "--publish" in av:
        mirror = Path(av[av.index("--publish") + 1])
        row = m["repos"][full(av[av.index("--repo") + 1] if "--repo" in av else "seed")]
        s = next(x for x in row["synced_from"] if x["kind"] == "tree")
        keep = list(s.get("keep") or []) + (m["template_contents"]["keep"] if s.get("keep_from") else [])
        sha = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
        rep = publish(REPO, mirror, s["source"], keep, apply="--apply" in av, source_sha=sha)
        print(json.dumps({k: (v if isinstance(v, int) else len(v)) for k, v in rep.items()}))
        for k in ("conflicts", "extra"):
            for p in rep[k]:
                print(f"{k}: {p}")
        return 0
    if "--example" in av:
        p = REPO / "seed/README.md"
        new = place_example(p.read_text(encoding="utf-8"), example_block(REPO))
        if "--apply" in av and new != p.read_text(encoding="utf-8"):
            p.write_text(new, encoding="utf-8")
        sys.stdout.write(example_block(REPO))
        return 0
    if "--system-readme" in av:
        p = Path(av[av.index("--system-readme") + 1])
        p.write_text(system_readme(p.read_text(encoding="utf-8"), av[av.index("--id") + 1], REPO), encoding="utf-8")
        return 0
    if "--instructions" in av:
        sys.stdout.write(instructions_text(REPO, full(av[av.index("--instructions") + 1])))
        return 0
    if "--probe" in av or "--drift" in av:
        only = full(av[av.index("--probe") + 1]) if "--probe" in av else None
        rs = drift(REPO, clones, only=only)
        if only and not rs:
            print(f"fleetmap: {only} is not a live row of {MAP}")
            return 1
        for r in rs:
            print(f"{r['status']:11} {r['repo']:34} via {r['how'] or '-':10} differ={len(r['differ'])} missing={len(r['missing'])} extra={len(r['extra'])}")
            for n in r["notes"]:
                print(f"            - {n}")
            if "--files" in av:
                for k in ("differ", "missing", "extra"):
                    for p in r[k]:
                        print(f"            {k}: {p}")
        if "--apply" in av:
            print("fleetmap:", json.dumps(apply(REPO, rs)))
        bad = [r for r in rs if r["status"] in ("drifted", "unmeasured")]
        print(f"fleetmap --drift: {len(rs)} read, {sum(r['status'] == 'equal' for r in rs)} equal, {sum(r['status'] == 'drifted' for r in rs)} drifted, {sum(r['status'] == 'unmeasured' for r in rs)} unmeasured")
        return 1 if bad else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
