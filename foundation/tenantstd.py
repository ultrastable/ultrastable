#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TENANT-STANDARD-1 (Rowan, 2026-11-25: "even the repos aren't being created correctly ... the system needs the capability and the settings
and all the optimizations to fully run itself ... that needs to be standardized and consistent"): one standard for what a tenant repository
contains, one scaffold that writes it, one check that reads it. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation tenantstd --check                    the core side: every tenant's vendor map carries the standard's base files, every
                                                             scaffold template exists, and a repository scaffolded now passes the standard (in checks)
  python3 -m foundation tenantstd --check --tenant PATH      read one repository against the standard; exit 1 with one line per missing part
  python3 -m foundation tenantstd --measure PATH             the same reading, reported and never failed (an exempt repository)
  python3 -m foundation tenantstd --scaffold PATH --slug S   write every standard file into PATH from scaffold/tenant (repository creation calls this)
  python3 -m foundation tenantstd --table PATH [PATH ...]    one row per standard part, one column per repository
  python3 -m foundation tenantstd --live                     clone each registered tenant's main and read it; exit 1 when one fails

This file is also the tool a tenant runs on itself: it is vendored as vendor/ultrastable/tools/tenantstd.py beside
vendor/ultrastable/tenant-standard.json (python3 vendor/ultrastable/tools/tenantstd.py --check --tenant .), so it imports nothing from the core.
Data: doctrine/tenant-standard.json. Tests: tests/foundation/test_tenantstd.py."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve()
STD_CORE = "doctrine/tenant-standard.json"
REG = "doctrine/tenant-repos.json"
BLOCKS = {n: re.compile(r"<!-- ultrastable:" + n + r"[^>]*-->.*?<!-- /ultrastable:" + n + r" -->", re.S) for n in ("standard", "live")}
PLATFORM = "https://ultrastable.io"
PLACE = re.compile(r"\{\{(json:)?([a-z0-9_]+)\}\}")
SKIP_DIRS = {".git", "node_modules", "__pycache__"}


def locate() -> tuple[dict, Path | None]:
    """The standard and, when this file runs inside the core, the core's root. In a tenant the standard sits beside the tool's directory."""
    core = HERE.parents[1]
    if (core / STD_CORE).is_file():
        return json.loads((core / STD_CORE).read_text(encoding="utf-8")), core
    return json.loads((HERE.parents[1] / "tenant-standard.json").read_text(encoding="utf-8")), None


def _json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _dig(d, dotted):
    for k in dotted.split("."):
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def slug_of(tenant: Path) -> str:
    return str((_json(tenant / "instance.json") or {}).get("slug") or tenant.resolve().name)


def vendored_from(tenant: Path, std: dict) -> tuple[str, dict]:
    """VENDORED_FROM: first line `<core repo>@<commit>`, then `<core path> -> <tenant path> sha256:<hex>` per file. Returns (head, {dst: (src, sha)})."""
    p = tenant / std["vendor"]["dir"] / "VENDORED_FROM"
    if not p.is_file():
        return "", {}
    lines = p.read_text(encoding="utf-8").splitlines()
    out = {}
    for ln in lines[1:]:
        m = re.match(r"^(\S+) -> (\S+)(?: sha256:([0-9a-f]{64}))?$", ln.strip())
        if m:
            out[m.group(2)] = (m.group(1), m.group(3) or "")
    return (lines[0].strip() if lines else ""), out


def _json_rule(val, want) -> bool:
    if want == "*":
        return val not in (None, "", [], {})
    if want == "+":
        return isinstance(val, list) and len(val) > 0
    if isinstance(want, str) and want.startswith(">="):
        return isinstance(val, (int, float)) and val >= float(want[2:])
    if isinstance(want, str) and want.startswith("~"):
        return isinstance(val, str) and want[1:] in val
    return val == want


def lint_workflow(text: str, std: dict) -> list[str]:
    w, bad = std["workflows"], []
    head = "\n".join(ln for ln in text.splitlines() if ln.lstrip().startswith("#"))
    bad += [f"no `{h}` header comment" for h in w["header"] if h not in head]
    bad += [f"no `{n}`" for n in w["needs"] if n not in text]
    for m in re.finditer(r"^\s*-?\s*uses:\s*(\S+)", text, re.M):
        if not m.group(1).startswith("./") and not re.search(r"@[0-9a-f]{40}$", m.group(1)):
            bad.append(f"`uses: {m.group(1)}` is not pinned to a full commit sha")
    jobs = len(re.findall(r"^  [A-Za-z0-9_-]+:\s*$", text.split("\njobs:", 1)[1], re.M)) if "\njobs:" in text else 0
    if jobs and text.count("timeout-minutes:") < jobs:
        bad.append("a job has no timeout-minutes")
    if jobs and text.count("vars.HALT != '1'") < jobs:
        bad.append("a job does not honour the halt (HALT-1)")
    if re.search(r"^\s*matrix:", text, re.M):
        bad.append("uses a matrix")
    return bad


def _tests_text(tenant: Path) -> str:
    return "\n".join(p.read_text(encoding="utf-8", errors="replace") for p in sorted((tenant / "worker").glob("*.test.mjs"))) if (tenant / "worker").is_dir() else ""


def deployment(slug: str, root: Path) -> tuple[bool, str]:
    """Where a tenant runs, from the registries: (deployed, public URL). Deployed is a `frontend`, or a live topology Worker with a route."""
    row = (_json(root / REG) or {}).get("tenants", {}).get(slug, {})
    if row.get("state") in ("planned", "retired", None):
        return False, ""
    if str(row.get("frontend", "")).startswith("https://"):
        return True, row["frontend"].rstrip("/")
    w = next((w for w in (_json(root / "doctrine/topology.json") or {}).get("workers", []) if w.get("id") == row.get("worker")), {})
    return (True, "https://" + w["routes"][0]) if w.get("state") == "live" and w.get("routes") else (False, "")


def live_block(ctx: dict) -> str:
    """The README's Live block (LIVE-LINK-1, Rowan 2026-11-25: "If somebody sees the code, then show them where it's running, show them the URL").
    Rendered from the registries, never typed: a deployed system links its URL, its health and its statements; a planned one says so and links nothing dead."""
    core = f"[`{ctx['core_repo']}`](https://github.com/{ctx['core_repo']})"
    runs = f"- Runs on [Ultrastable]({PLATFORM}) · [more systems built on it]({PLATFORM}/directory)"
    head = "<!-- ultrastable:live (rendered from the platform's registries by the scaffold; never typed by hand) -->\n## Live\n\n"
    if ctx["deployed"]:
        u = ctx["live_url"]
        body = (f"- **Running at: <{u}/>**\n- Worker: `{ctx['worker']}` on Cloudflare Workers\n"
                f"- Deployed from: this repository's `main`, built by {core} (workflow `deploy-ultrastable`)\n"
                f"- Health: <{u}/health> · What the site states and what backs it: <{u}/claims.json>\n")
    else:
        body = (f"- **Not deployed yet.** {ctx['name']} is registered on the platform as planned and nothing is running.\n"
                f"- When it is deployed it runs as the Worker `{ctx['worker']}`, built from this repository's `main` by {core} (workflow `deploy-ultrastable`), and this block is rewritten with its public URL.\n")
    return head + body + runs + "\n<!-- /ultrastable:live -->"


def live_problems(tenant: Path, slug: str, std: dict, root: Path | None) -> list[str]:
    p = tenant / "README.md"
    m = BLOCKS["live"].search(p.read_text(encoding="utf-8", errors="replace")) if p.is_file() else None
    if not m:
        return ["live: README.md has no Live block (where the code runs, rendered by the scaffold between the ultrastable:live markers)"]
    block, bad = m.group(0), []
    urls = [u.rstrip("/") for u in re.findall(r"https://[^\s<>()\]]+", block) if not u.startswith((PLATFORM, "https://github.com/"))]
    undeployed = "Not deployed yet" in block
    bad += [f"live: README.md Live block does not link {u}" for u in (PLATFORM, PLATFORM + "/directory") if u not in block]
    if undeployed and urls:
        bad.append(f"live: README.md says Not deployed yet and links {urls[0]} (a dead link)")
    if not undeployed:
        if not urls:
            bad.append("live: README.md Live block has no public URL")
        else:
            bad += [f"live: README.md Live block does not link {urls[0]}{x}" for x in ("/health", "/claims.json") if urls[0] + x not in block]
    if root is not None and slug in (_json(root / REG) or {}).get("tenants", {}):
        dep, url = deployment(slug, root)
        if dep and (undeployed or not urls or urls[0] != url):
            bad.append(f"live: README.md Live URL is {urls[0] if urls and not undeployed else 'missing'}; the registry says {slug} runs at {url}")
        if not dep and not undeployed:
            bad.append(f"live: README.md shows a live URL and the registry has {slug} not deployed")
    return bad


def check_tenant(tenant: Path, std: dict | None = None, root: Path | None = None) -> list[str]:
    """One repository against the standard. Each line names the part and what is missing; an empty list is a repository that runs itself.
    With the core's root the README's Live URL is also compared with the registries."""
    std = std or locate()[0]
    tenant, slug = Path(tenant), slug_of(Path(tenant))
    sub = {"slug": slug, "worker": f"ultrastable-{slug}", "bootstrap_url": std["bootstrap_url"]}
    fill = lambda s: re.sub(r"\{(slug|worker|bootstrap_url)\}", lambda m: sub[m.group(1)], s)  # noqa: E731
    bad = []
    for f in std["files"]:
        p = tenant / f["path"]
        if not p.is_file():
            bad.append(f"{f['id']}: {f['path']} is missing ({f['why']})")
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        bad += [f"{f['id']}: {f['path']} does not contain `{fill(n)}`" for n in f.get("contains", []) if fill(n) not in text]
        if "json" in f:
            data = _json(p)
            if data is None:
                bad.append(f"{f['id']}: {f['path']} is not JSON")
                continue
            for key, want in f["json"].items():
                want = fill(want) if isinstance(want, str) else want
                if not _json_rule(_dig(data, key), want):
                    bad.append(f"{f['id']}: {f['path']} `{key}` should be {want!r}, is {json.dumps(_dig(data, key))[:60]}")
    bad += live_problems(tenant, slug, std, root)
    lc, rw, pkg = _json(tenant / "lifecycle.json") or {}, _json(tenant / "runway.json") or {}, _json(tenant / "package.json") or {}
    if lc:
        unanswered = [c for c in std["survival"] if not ((lc.get("survival") or {}).get(c) or {}).keys() & {"inherit", "status"}]
        if unanswered:
            bad.append(f"lifecycle: no answer for survival class {', '.join(unanswered)} (SEED-LIFECYCLE-1)")
        bad += [f"lifecycle: build names {p}, which is not in the repository" for p in ((lc.get("build") or {}).get("paths") or []) + ((lc.get("build") or {}).get("tests") or []) if not (tenant / p).exists()]
    tests = _tests_text(tenant)
    for r in rw.get("risks") or []:
        if not all(str(r.get(k, "")).strip() for k in ("id", "what", "safeguard", "probe")):
            bad.append(f"runway: risk {r.get('id', '?')} needs id, what, safeguard and probe")
            continue
        kind, _, rest = r["probe"].partition(":")
        if kind == "test" and f"test('{rest}'" not in tests and f'test("{rest}"' not in tests:
            bad.append(f"runway: risk {r['id']} names a test that is not in worker/*.test.mjs: {rest[:70]}")
        elif kind == "file" and rest.startswith(("worker/", "vendor/", "scripts/", ".github/")) and not (tenant / rest).exists():
            bad.append(f"runway: risk {r['id']} names {rest}, which is not in the repository")
        elif kind not in ("test", "file", "grep", "cmd"):
            bad.append(f"runway: risk {r['id']} has an unknown probe kind `{kind}`")
    for k in ("dependencies", "devDependencies"):
        if pkg.get(k):
            bad.append(f"package: package.json has {k} ({std['package']['why']})")
    wf = tenant / ".github/workflows"
    for y in sorted(wf.glob("*.y*ml")) if wf.is_dir() else []:
        bad += [f"workflow {y.name}: {b}" for b in lint_workflow(y.read_text(encoding="utf-8"), std)]
    bad += _vendor_problems(tenant, std)
    for p in sorted(tenant.rglob("*")):
        if p.is_file() and not (set(p.relative_to(tenant).parts) & SKIP_DIRS) and p.suffix in (".md", ".js", ".mjs", ".json", ".jsonc", ".yml", ".py", ".txt", "") and p.stat().st_size < 2_000_000:
            if re.search(r"^(<<<<<<< |>>>>>>> )", p.read_text(encoding="utf-8", errors="replace"), re.M):
                bad.append(f"merge: {p.relative_to(tenant).as_posix()} carries an unresolved merge marker")
    return bad


def _vendor_problems(tenant: Path, std: dict) -> list[str]:
    vdir, bad = std["vendor"]["dir"], []
    head, listed = vendored_from(tenant, std)
    if (tenant / vdir / "VENDORED_FROM").is_file():
        if not re.match(r"^[\w.-]+/[\w.-]+@\S+$", head):
            bad.append(f"vendor: {vdir}VENDORED_FROM does not start with `<core repo>@<commit>`")
        for src, dst in std["vendor"]["base"].items():
            if dst not in listed:
                bad.append(f"vendor: {dst} (core {src}) is not vendored; every tenant carries it")
        for dst, (src, sha) in sorted(listed.items()):
            if not dst.startswith(vdir):
                bad.append(f"vendor: {dst} is vendored outside {vdir}")
            elif not (tenant / dst).is_file():
                bad.append(f"vendor: VENDORED_FROM lists {dst}, which is missing")
            elif not sha:
                bad.append(f"vendor: {dst} has no sha256 in VENDORED_FROM")
            elif _sha(tenant / dst) != sha:
                bad.append(f"vendor: {dst} was edited by hand: it no longer matches the hash of core {src}")
        for p in sorted((tenant / vdir).rglob("*")):
            rel = p.relative_to(tenant).as_posix()
            if p.is_file() and p.name != "VENDORED_FROM" and "__pycache__" not in p.parts and rel not in listed:
                bad.append(f"vendor: {rel} is in {vdir} and not in VENDORED_FROM (a core file with no recorded source)")
    for p in sorted(tenant.rglob("vendor")):
        rel = p.relative_to(tenant).as_posix()
        if p.is_dir() and not (set(p.relative_to(tenant).parts) & SKIP_DIRS) and rel != "vendor" and not rel.startswith(vdir):
            bad.append(f"vendor: {rel}/ is a second vendor directory; core files live only under {vdir}")
    return bad


# ---- the scaffold: every standard file from one place ---------------------------------------------------------------------------------

def render(text: str, ctx: dict) -> str:
    def one(m):
        if m.group(2) not in ctx:
            raise KeyError(f"scaffold template names {{{{{m.group(2)}}}}}, which the tenant's context does not carry")
        return json.dumps(ctx[m.group(2)], ensure_ascii=False) if m.group(1) else str(ctx[m.group(2)])
    return PLACE.sub(one, text)


def _cron(slug: str, hours: int) -> str:
    h = zlib.crc32(slug.encode())  # a stable minute per tenant, so the fleet's beats do not all fire together
    minute, hour = h % 60, (h // 60) % 24
    return f"{minute} * * * *" if hours <= 1 else (f"{minute} {hour} * * *" if hours < 168 else f"{minute} {hour} * * 1")


def context(slug: str, tenant: Path, std: dict, root: Path | None) -> dict:
    """The values every template is rendered with: the registry row, the tenant's own manifest and, when it has one, its topology row."""
    row = ((_json(root / REG) or {}).get("tenants", {}).get(slug, {}) if root else {}) or {}
    inst = _json(tenant / "instance.json") or (_json(root / "instances" / slug / "instance.json") if root else None) or {}
    topo = next((w for w in ((_json(root / "doctrine/topology.json") or {}).get("workers", []) if root else []) if w.get("id") == row.get("worker")), {})
    sysd = (_json(root / "doctrine/system.json") or {}) if root else {}
    d, opt = std["scaffold"]["defaults"], row.get("scaffold") or {}
    name = inst.get("name") or slug.replace("-", " ").title()
    tagline = str((inst.get("brand") or {}).get("tagline") or row.get("description") or name)
    summary = re.sub(r"\s*Run on Ultrastable, the foundation for any autonomous system\.?\s*$", "", tagline).strip()
    worker = row.get("worker") or f"ultrastable-{slug}"
    dep, live = deployment(slug, root) if root else (False, "")
    host = (topo.get("routes") or [d["host"].replace("{slug}", slug)])[0]
    hours = int(opt.get("beat_hours", d["beat_hours"]))
    return {
        "slug": slug, "name": name, "summary": summary, "repo": row.get("repo") or f"{std['core_repo'].split('/')[0]}/{slug}",
        "worker": worker, "host": host, "url": (row.get("frontend") or f"https://{host}").rstrip("/"), "d1": f"ultrastable-{slug}",
        "d1_id": ((sysd.get("resources") or {}).get("d1") or {}).get(slug, {}).get("id", ""),
        "beat_hours": hours, "cron": (topo.get("crons") or [_cron(slug, hours)])[0], "noun": opt.get("noun", d["noun"]),
        "ai": bool(row.get("ai")), "compatibility_date": topo.get("compatibility_date") or d["compatibility_date"],
        "core_repo": std["core_repo"], "bootstrap_url": std["bootstrap_url"], "vendor": dict(row.get("vendor") or {}),
        "description": row.get("description") or f"{name}: a tenant system running on Ultrastable.",
        "deployed": dep, "live_url": live,
        "sync_cron": f"{zlib.crc32(slug.encode()) % 50 + 5} 5 * * *", "cleanup_cron": f"{zlib.crc32(slug.encode()) % 50 + 5} 4 * * *",
    }


def wrangler(ctx: dict) -> str:
    c = {"name": ctx["worker"], "main": "worker/index.js", "compatibility_date": ctx["compatibility_date"], "workers_dev": False,
         "observability": {"enabled": True}, "triggers": {"crons": [ctx["cron"]]},
         "d1_databases": [{"binding": "DB", "database_name": ctx["d1"], "database_id": ctx["d1_id"] or "assigned by the platform when the Worker is first deployed"}]}
    if ctx["ai"]:
        c["ai"] = {"binding": "AI"}
    return ("// Reference copy of the config the platform deploys (doctrine/system.json in " + ctx["core_repo"] + ", rendered by python3 -m foundation system --render).\n"
            "// The platform deploys this Worker from main; nothing reads this file at deploy time.\n" + json.dumps(c, indent=2) + "\n")


def _core_commit(root: Path) -> str:
    r = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else "local"


def scaffold(tenant: Path, slug: str, root: Path | None = None, std: dict | None = None) -> list[str]:
    """Write every standard file into `tenant`. Idempotent: a second run changes nothing. The tenant's own code and words are never overwritten."""
    if std is None or root is None:
        std, root = locate()
    if root is None:
        raise SystemExit("tenantstd: the scaffold runs from the core repository (its templates live in scaffold/tenant)")
    tenant, done = Path(tenant), []
    sc, ctx = std["scaffold"], context(slug, Path(tenant), std, root)
    ctx["live_block"] = live_block(ctx)
    tdir, fresh = root / sc["dir"], not (tenant / "worker/index.js").exists()

    def put(rel: str, body: str, what: str):
        p = tenant / rel
        if p.is_file() and p.read_text(encoding="utf-8") == body:
            return
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
        done.append(f"{what} {rel}")

    for name in ("IDEA.md", "instance.json", "lifecycle.json", "runway.json"):  # the manifest travels with the code it describes
        src = root / "instances" / slug / name
        if src.is_file() and not (tenant / name).exists():
            put(name, src.read_text(encoding="utf-8"), "manifest")
    for f in sc["files"]:
        rel, mode = f["path"], f["mode"]
        body, p = render((tdir / (rel + ".tmpl")).read_text(encoding="utf-8"), ctx), tenant / rel
        if mode == "managed" or (mode == "create" and not p.exists()) or (mode == "starter" and fresh and not p.exists()):
            put(rel, body, "wrote")
        elif mode == "block":
            rx = BLOCKS[f["block"]]
            block = rx.search(body).group(0)
            if not p.exists():
                put(rel, body, "wrote")
                continue
            cur = p.read_text(encoding="utf-8")
            if rx.search(cur):
                new = rx.sub(lambda _m: block, cur)
            elif f.get("at") == "after-title" and re.search(r"^# .*$", cur, re.M):  # right under the title: the first thing a visitor reads
                new = re.sub(r"^(# .*)$", lambda m: m.group(1) + "\n\n" + block, cur, count=1, flags=re.M)
            else:
                new = cur.rstrip("\n") + "\n\n" + block + "\n"
            put(rel, new, f"{f['block']} block in")
        elif mode == "json":
            cur, want = (_json(p) or {}) if p.exists() else {}, json.loads(body)
            new = {**want, **cur} if cur else want  # the tenant's own keys and order win; the standard's keys are then set
            new.update({k: v for k, v in want.items() if k in ("type", "private")})
            new["scripts"] = {**(cur.get("scripts") or {}), "test": want["scripts"]["test"]}
            put(rel, json.dumps(new, indent=2, ensure_ascii=False) + "\n", "set keys in")
    for src, dst in sc["copy"].items():
        put(dst, (root / src).read_text(encoding="utf-8"), "copied")
    if not (tenant / "wrangler.jsonc").exists():
        put("wrangler.jsonc", wrangler(ctx), "wrote")
    lc = _json(tenant / "lifecycle.json")
    if lc is not None:
        b = lc.setdefault("build", {})
        b["repo"] = ctx["repo"]
        for k in ("paths", "tests"):  # written when the code sat in the core: the same files, at this repository's own paths
            b[k] = [x[len(f"instances/{slug}/"):] if x.startswith(f"instances/{slug}/") else x for x in b.get(k) or []]
        if not b.get("paths"):
            b["paths"] = ["worker/index.js", "worker/site.js", "worker/contract.js", "worker/entries.js"]
        if not b.get("tests"):
            b["tests"] = ["worker/worker.test.mjs", "worker/contract.test.mjs"]
        put("lifecycle.json", json.dumps(lc, indent=1, ensure_ascii=False) + "\n", "build answers in")
    vmap, lines = {**ctx["vendor"], **std["vendor"]["base"]}, []
    for src, dst in sorted(vmap.items(), key=lambda kv: kv[1]):
        if not (root / src).is_file():
            raise SystemExit(f"tenantstd: the vendor map names {src}, which is not in the core")
        (tenant / dst).parent.mkdir(parents=True, exist_ok=True)
        if not (tenant / dst).is_file() or (tenant / dst).read_bytes() != (root / src).read_bytes():
            (tenant / dst).write_bytes((root / src).read_bytes())
            done.append(f"vendored {src} -> {dst}")
        lines.append(f"{src} -> {dst} sha256:{_sha(tenant / dst)}")
    vf = tenant / std["vendor"]["dir"] / "VENDORED_FROM"
    had = vf.read_text(encoding="utf-8").splitlines()[1:] if vf.is_file() else None
    if had != lines:  # the commit line moves only when a vendored file did, so a second run is a no-op
        put(std["vendor"]["dir"] + "VENDORED_FROM", f"{std['core_repo']}@{_core_commit(root)}\n" + "\n".join(lines) + "\n", "wrote")
    return done


# ---- the core side ----------------------------------------------------------------------------------------------------------------------

def tenants(root: Path, std: dict) -> dict:
    """Registered tenants the standard applies to: every state with a repository of its own shape. Retired and exempt ones are named, not read."""
    return {s: t for s, t in (_json(root / REG) or {}).get("tenants", {}).items() if t.get("state") != "retired" and s not in std.get("exempt", {})}


def check_core(root: Path | None = None, std: dict | None = None) -> list[str]:
    if std is None or root is None:
        std, root = locate()
    bad, sc = [], std["scaffold"]
    for f in sc["files"]:
        if not (root / sc["dir"] / (f["path"] + ".tmpl")).is_file():
            bad.append(f"{sc['dir']}/{f['path']}.tmpl: the scaffold has no template for this standard file")
    scaffolded = {f["path"] for f in sc["files"]} | set(sc["copy"].values()) | set(sc["generated"]) | {"IDEA.md", "instance.json"}
    bad += [f"{STD_CORE}: standard file {f['path']} is written by no part of the scaffold" for f in std["files"] if f["path"] not in scaffolded]
    for src in list(std["vendor"]["base"]) + list(sc["copy"]):
        if not (root / src).is_file():
            bad.append(f"{STD_CORE}: names {src}, which is not in the core")
    for slug, t in tenants(root, std).items():
        v = t.get("vendor") or {}
        for src, dst in std["vendor"]["base"].items():
            if v.get(src) != dst:
                bad.append(f"{slug}: vendor map in {REG} does not carry {src} -> {dst} (every tenant vendors the standard's base files)")
        bad += [f"{slug}: vendors {src} to {dst}, outside {std['vendor']['dir']}" for src, dst in v.items() if not dst.startswith(std["vendor"]["dir"])]
        bad += [f"{slug}: vendor map names {src}, which is not in the core" for src in v if not (root / src).is_file()]
        if t.get("write"):
            bad.append(f"{slug}: hand-typed `write` files in {REG}; a repository's files come from the one scaffold ({sc['dir']})")
    for slug, e in std.get("exempt", {}).items():
        if len(str(e.get("why", ""))) < 40:
            bad.append(f"{STD_CORE}: exempt {slug} needs a reason")
    return bad


def table(paths: list[Path], std: dict) -> str:
    cols = [Path(p) for p in paths]
    rows = [("part", [slug_of(c) for c in cols])]
    for f in std["files"]:
        rows.append((f["path"], ["yes" if (c / f["path"]).is_file() else "-" for c in cols]))
    probs = [check_tenant(c, std) for c in cols]
    rows.append(("README Live block", ["yes" if (c / "README.md").is_file() and BLOCKS["live"].search((c / "README.md").read_text(encoding="utf-8")) else "-" for c in cols]))
    for key, label in (("live", "live block problems"), ("workflow", "workflow lint failures"), ("vendor", "vendor problems"), ("runway", "runway problems"), ("lifecycle", "lifecycle problems"), ("merge", "merge markers")):
        rows.append((label, [str(sum(1 for b in p if b.startswith(key))) for p in probs]))
    rows.append(("other workflows", [",".join(sorted(y.name for y in (c / ".github/workflows").glob("*.y*ml") if y.name not in ("ci.yml", "vendor-sync.yml", "branch-cleanup.yml"))) or "-" if (c / ".github/workflows").is_dir() else "-" for c in cols]))
    rows.append(("problems in all", [str(len(p)) for p in probs]))
    w = max(len(r[0]) for r in rows)
    return "\n".join(r[0].ljust(w) + " | " + " | ".join(str(x).ljust(18) for x in r[1]) for r in rows)


def live(root: Path, std: dict, clone=None) -> dict:
    """Each registered tenant's main, cloned and read. clone(repo, dest) -> bool; an unreadable repository is a failure, never a pass."""
    import tempfile
    def _clone(repo, dest):
        r = subprocess.run(["git", "clone", "-q", "--depth", "1", f"https://github.com/{repo}.git", str(dest)], capture_output=True, text=True, timeout=180)
        if r.returncode:
            print(f"tenantstd: cannot clone {repo}: {r.stderr.strip()[:200]}", file=sys.stderr)
        return r.returncode == 0
    out = {}
    for slug, t in sorted(tenants(root, std).items()):
        with tempfile.TemporaryDirectory(prefix="tenantstd-") as d:
            ok = (clone or _clone)(t["repo"], Path(d) / slug)
            out[slug] = check_tenant(Path(d) / slug, std, root) if ok else [f"repository {t['repo']} could not be read"]
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="tenantstd")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--tenant")
    ap.add_argument("--measure")
    ap.add_argument("--scaffold")
    ap.add_argument("--slug")
    ap.add_argument("--table", nargs="+")
    ap.add_argument("--live", action="store_true")
    a = ap.parse_args(argv)
    std, root = locate()
    if a.scaffold:
        for line in scaffold(Path(a.scaffold), a.slug or slug_of(Path(a.scaffold)), root, std):
            print(line)
        return 0
    if a.table:
        print(table([Path(p) for p in a.table], std))
        return 0
    if a.live:
        res = live(root, std)
        for slug, bad in res.items():
            print(f"{slug}: {'meets the standard' if not bad else str(len(bad)) + ' problem(s)'}")
            for b in bad:
                print(f"  {b}")
        return 1 if any(res.values()) else 0
    target = a.measure or a.tenant
    if target:
        bad = check_tenant(Path(target), std, root)
        for b in bad:
            print("tenantstd:", b)
        print(f"tenantstd: {slug_of(Path(target))} meets the standard" if not bad else f"tenantstd: {len(bad)} problem(s) in {slug_of(Path(target))}")
        return 0 if (a.measure or not bad) else 1
    if root is None:
        print("tenantstd: in a tenant repository run --check --tenant .", file=sys.stderr)
        return 2
    bad = check_core(root, std)
    for b in bad:
        print("tenantstd:", b)
    print("tenantstd ok" if not bad else f"tenantstd: {len(bad)} problem(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
