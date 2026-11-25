# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""One repository standard for every repository of the org, present and future (REPO-STANDARD-1).

Ultrastable is the foundation for any autonomous system. Rowan, 2026-11-25: "even the repos aren't being created correctly. They don't have
the right merge rules ... I'm seeing extra branches ... some are public, some are private ... anything that needs to run an action for code
deploys has to be public, or I'll get charged for actions ... standardized and consistent." and "all repos need full data, full metadata,
full description, full documentation, everything, all of them." and "If somebody sees the code, then show them where it's running."

Root cause this replaces: settings were per-repository rows typed by hand in github/org-settings.json (five live repositories had no row),
applied only by a token nobody holds (org-settings.yml never ran green), with a fallback that set two settings on the typed rows only.

The standard is github/repo-standard.json. Repositories are DISCOVERED (GET /orgs/<org>/repos) and joined with the registries; description,
homepage (the live public URL) and topics are COMPUTED from doctrine/tenant-repos.json, doctrine/topology.json and doctrine/full-stack.json;
a row in github/org-settings.json is only an override.

  python3 -m foundation repostd --check         offline: the standard is whole, every registered repository computes full metadata, the Worker
                                                 carries the same standard, the kit carries the branch-cleanup workflow (in `checks`)
  python3 -m foundation repostd --plan          the computed standard per registered repository, as JSON
  python3 -m foundation repostd --live          reads GitHub: one line per repository with what is missing; a repository or field that cannot
                                                 be read is `unmeasured`, never ok. Exit 1 on a finding, 2 when something was unmeasured
  python3 -m foundation repostd --apply         puts every discovered repository on the standard: with a token that may (GH_TOKEN), else through
                                                 the tick Worker's administration app over this job's OIDC token (deploy/repo-settings.mjs).
                                                 A refused call is printed and the run exits 1; nothing is skipped quietly
  python3 -m foundation repostd --branches      every branch with no open pull request, classified (merged, closed, superseded, unmerged work)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STD = "github/repo-standard.json"
OVERRIDES = "github/org-settings.json"
WORKER_JS = "seed/worker/src/repostandard.js"
API = "https://api.github.com"
UA = "ultrastable-repostd"


def _json(root: Path, rel: str, default=None):
    p = root / rel
    if not p.exists():
        return default
    return json.loads(p.read_text())


def standard(root: Path = ROOT) -> dict:
    return json.loads((root / STD).read_text())


# ---------------------------------------------------------------- computed metadata

def _title(name: str) -> str:
    return " ".join(w.capitalize() for w in name.strip(".").replace("_", "-").split("-") if w) or name


def registries(root: Path = ROOT) -> dict:
    """Everything the core's data knows about each repository, keyed by short name."""
    std = standard(root)
    org = std["org"]
    out: dict[str, dict] = {}

    def row(full: str) -> dict | None:
        if not isinstance(full, str) or not full.startswith(org + "/"):
            return None
        return out.setdefault(full.split("/", 1)[1], {"sources": []})

    for name in std.get("platform", []):
        r = row(f"{org}/{name}")
        r["kind"] = "platform"
        r["sources"].append(STD)
    tr = _json(root, "doctrine/tenant-repos.json", {}) or {}
    for slug, t in (tr.get("tenants") or {}).items():
        if t.get("state") == "retired":
            continue
        r = row(t.get("repo", ""))
        if r is None:
            continue
        r.setdefault("kind", "system")
        r["sources"].append("doctrine/tenant-repos.json")
        for k in ("description", "frontend", "worker", "state"):
            if t.get(k):
                r[k] = t[k]
    topo = _json(root, "doctrine/topology.json", {}) or {}
    by_worker = {t.get("worker"): t.get("repo") for t in (_json(root, "doctrine/tenant-repos.json", {}) or {}).get("tenants", {}).values() if t.get("worker")}
    for w in topo.get("workers", []):
        # a tenant still deployed from the core copy (state moving) has no `source` yet: its registry row names its Worker
        src = (w.get("source") or {}).get("repo") or by_worker.get(w.get("id"))
        r = row(src) if src else None
        if r is None or w.get("state") != "live":
            continue
        r.setdefault("kind", "system")
        r["sources"].append("doctrine/topology.json")
        if w.get("routes"):
            r.setdefault("route", "https://" + str(w["routes"][0]).split("/")[0] + "/")
    fs = _json(root, "doctrine/full-stack.json", {}) or {}
    for sid, s in (fs.get("systems") or {}).items():
        r = row(s.get("repo", ""))
        if r is None:
            continue
        r.setdefault("kind", "system")
        r["sources"].append("doctrine/full-stack.json")
        if s.get("frontend"):
            r.setdefault("fs_frontend", s["frontend"])
    for full, o in ((_json(root, OVERRIDES, {}) or {}).get("repos") or {}).items():
        r = row(full)
        if r is not None:
            r["override"] = o
            r["sources"].append(OVERRIDES)
    return out


def repo_metadata(name: str, reg: dict | None = None, root: Path = ROOT, std: dict | None = None) -> dict:
    """{description, homepage, topics, private, private_reason} for one repository.

    THE ONE PLACE THE SOURCE OF A REPOSITORY'S IDENTITY IS CHOSEN. Today it is computed from the registries (an override row in
    github/org-settings.json, else doctrine/tenant-repos.json description/frontend, else the public route of the doctrine/topology.json Worker
    built from the repository, else doctrine/full-stack.json, else the defaults of github/repo-standard.json). When the per-repository system
    manifest lands (`ultrastable.json` -> `identity`, aggregate doctrine/fleet-map.json), read it HERE and nowhere else; no caller changes.
    """
    std = std or standard(root)
    reg = registries(root) if reg is None else reg
    r = reg.get(name, {})
    o = r.get("override") or {}
    md = std["metadata"]
    fm = ((_json(root, "doctrine/fleet-map.json", {}) or {}).get("systems") or {}).get(name) or {}
    ident = fm.get("identity") or {}  # the manifest wins as soon as it exists; absent today
    private_why = std["visibility"]["private"].get(name) or ""
    return {
        "description": (ident.get("description") or o.get("description") or r.get("description") or md["description"]["system"].format(title=_title(name)))[:350],
        "homepage": ident.get("homepage") or o.get("homepage") or r.get("frontend") or r.get("route") or r.get("fs_frontend") or md["homepage_default"],
        "topics": sorted(set(ident.get("topics") or o.get("topics") or md["topics"]["platform" if r.get("kind") == "platform" else "system"])),
        "private": bool(private_why), "private_reason": private_why,
    }


def desired(name: str, reg: dict | None = None, root: Path = ROOT, std: dict | None = None) -> dict:
    """The standard for one repository. A repository no registry names yet (just created) still gets the whole default."""
    std = std or standard(root)
    reg = registries(root) if reg is None else reg
    r = reg.get(name, {})
    o = r.get("override") or {}
    m = repo_metadata(name, reg, root, std)
    settings = dict(std["worker"]["settings"])
    for k, v in (o.get("settings") or {}).items():
        if k != "private":
            settings[k] = v
    return {
        "repo": f"{std['org']}/{name}", "kind": r.get("kind") or "system", "registered": bool(r), "sources": r.get("sources", []),
        "visibility": "private" if m["private"] else "public", "private_reason": m["private_reason"],
        "make_public": name in std["visibility"].get("make_public", {}),
        "description": m["description"], "homepage": m["homepage"], "topics": m["topics"],
        "settings": settings, "security": dict(std["worker"]["security"]), "ruleset": std["worker"]["ruleset"],
        "files": list(std["files"]), "workflows": [] if name in std.get("workflow_exempt", {}) else list(std["workflows"]),
    }


def plan(root: Path = ROOT) -> dict:
    reg = registries(root)
    std = standard(root)
    return {n: desired(n, reg, root, std) for n in sorted(reg)}


# ---------------------------------------------------------------- offline check

def worker_block(root: Path = ROOT):
    text = (root / WORKER_JS).read_text()
    m = re.search(r"/\*repo-standard:begin\*/(.*?)/\*repo-standard:end\*/", text, re.S)
    return json.loads(m.group(1)) if m else None


def check(root: Path = ROOT) -> list[str]:
    errs: list[str] = []
    std = standard(root)
    w = std.get("worker", {})
    s = w.get("settings", {})
    for k, v in (("allow_squash_merge", True), ("allow_merge_commit", False), ("allow_rebase_merge", False), ("allow_auto_merge", True),
                 ("delete_branch_on_merge", True)):
        if s.get(k) is not v:
            errs.append(f"{STD}: worker.settings.{k} must be {v}")
    if {r.get("type") for r in (w.get("ruleset") or {}).get("rules", [])} < {"deletion", "non_fast_forward"}:
        errs.append(f"{STD}: the main ruleset must refuse deletion and force pushes")
    if worker_block(root) != w:
        errs.append(f"{WORKER_JS}: the standard the Worker applies differs from the `worker` block of {STD}")
    for name, why in std["visibility"]["private"].items():
        if len(str(why).strip()) < 20:
            errs.append(f"{STD}: private repository {name} needs a written reason")
        if name in std["visibility"].get("make_public", {}):
            errs.append(f"{STD}: {name} is both private and make_public")
    reg = registries(root)
    for name in sorted(reg):
        d = desired(name, reg, root, std)
        if len(d["description"].strip()) < 20:
            errs.append(f"{name}: no description can be computed")
        if not re.match(r"^https://[a-z0-9.-]+(/\S*)?$", d["homepage"]):
            errs.append(f"{name}: no https homepage can be computed")
        if not d["topics"]:
            errs.append(f"{name}: no topics")
        o = (reg[name].get("override") or {}).get("settings") or {}
        if o.get("private") is True and d["visibility"] != "private":
            errs.append(f"{name}: {OVERRIDES} says private but {STD} gives no reason (visibility.private)")
        if o.get("private") is False and d["visibility"] == "private":
            errs.append(f"{name}: {OVERRIDES} says public but {STD} lists it private")
        for k in ("allow_merge_commit", "allow_rebase_merge"):
            if o.get(k) is True:
                errs.append(f"{name}: an override may not turn {k} on")
        for k in ("delete_branch_on_merge", "allow_auto_merge", "allow_squash_merge"):
            if o.get(k) is False:
                errs.append(f"{name}: an override may not turn {k} off")
    # a new system is born with the cleanup: the kit carries the workflow and the same script as the core
    kit_wf = root / "seed" / ".github" / "workflows" / "branch-cleanup.yml"
    kit_py = root / "seed" / "scripts" / "branch_cleanup.py"
    core_py = root / "scripts" / "branch_cleanup.py"
    if not kit_wf.exists():
        errs.append("seed/.github/workflows/branch-cleanup.yml is missing: a repository made from the seed would keep its branches")
    if not kit_py.exists() or kit_py.read_bytes() != core_py.read_bytes():
        errs.append("seed/scripts/branch_cleanup.py must be the same file as scripts/branch_cleanup.py")
    wf = (root / ".github" / "workflows" / "org-settings.yml")
    if wf.exists() and "foundation repostd --apply" not in wf.read_text():
        errs.append(".github/workflows/org-settings.yml does not run `python3 -m foundation repostd --apply`: the standard has no apply path")
    return errs


# ---------------------------------------------------------------- live reads

class Api:
    """GitHub REST with urllib. Returns (status, json). Never raises on an HTTP status; a network failure is status 0."""

    def __init__(self, token: str | None = None, fetch=None):
        self.token = token if token is not None else (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "")
        self._fetch = fetch

    def __call__(self, method: str, path: str, body=None):
        if self._fetch:
            return self._fetch(method, path, body)
        req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None)
        req.add_header("accept", "application/vnd.github+json")
        req.add_header("user-agent", UA)
        if body is not None:
            req.add_header("content-type", "application/json")
        if self.token:
            req.add_header("authorization", "Bearer " + self.token)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw) if raw else None
            except ValueError:
                return e.code, {"message": raw[:200].decode("utf-8", "replace")}
        except (urllib.error.URLError, OSError) as e:
            return 0, {"message": str(e)}


def discover(api, org: str):
    """Every repository of the org as GitHub lists it, or None when the listing cannot be read (unmeasured)."""
    out, page = [], 1
    while True:
        st, js = api("GET", f"/orgs/{org}/repos?per_page=100&type=all&page={page}")
        if st != 200 or not isinstance(js, list):
            return None
        out += js
        if len(js) < 100:
            return out
        page += 1


def measure(api, name: str, want: dict, std: dict) -> dict:
    """Compare one live repository with its standard. findings: what is wrong; unmeasured: what could not be read; gated: plan-withheld."""
    full = want["repo"]
    res = {"repo": full, "findings": [], "unmeasured": [], "gated": [], "status": "measured"}
    st, live = api("GET", f"/repos/{full}")
    if st != 200 or not isinstance(live, dict):
        res["status"] = "unmeasured"
        why = " (absent, or private and not visible to this credential)" if st == 404 else ""
        res["unmeasured"].append(f"repository: HTTP {st}{why} {(live or {}).get('message', '') if isinstance(live, dict) else ''}".strip())
        return res
    res["live"] = live
    if live.get("archived"):
        res["status"] = "archived"
        return res
    private = bool(live.get("private"))
    st_wf, wfs = api("GET", f"/repos/{full}/actions/workflows?per_page=100")
    n_wf = None
    if st_wf == 200 and isinstance(wfs, dict):
        n_wf = len([w for w in wfs.get("workflows", []) if str(w.get("path", "")).startswith(".github/workflows/")])
    else:
        res["unmeasured"].append(f"workflows: HTTP {st_wf}")
    res["workflows"] = n_wf
    # visibility: computed, and the billing rule
    if private and n_wf:
        res["findings"].append(f"private with {n_wf} workflow(s): Actions minutes are billed; it must be public or hold no workflow")
    if private and want["visibility"] == "public":
        res["findings"].append("private, and the standard gives no reason for it")
    if not private and want["visibility"] == "private":
        res["findings"].append(f"public, and the standard keeps it private: {want['private_reason']}")
    # metadata
    if (live.get("description") or "").strip() != want["description"].strip():
        res["findings"].append("description " + ("is empty" if not (live.get("description") or "").strip() else "differs from the computed one"))
    if (live.get("homepage") or "").rstrip("/") != want["homepage"].rstrip("/"):
        res["findings"].append(f"homepage (the About website) {'is empty' if not live.get('homepage') else 'is ' + live['homepage']}; where it runs: {want['homepage']}")
    if sorted(live.get("topics") or []) != want["topics"]:
        res["findings"].append("topics " + ("are empty" if not live.get("topics") else "differ"))
    # settings (only shown to a credential with push or admin access)
    gated = set(std["worker"]["private_plan_gated"]) if private else set()
    for k, v in want["settings"].items():
        if k in gated:
            res["gated"].append(k)
        elif k not in live or live[k] is None:
            res["unmeasured"].append(f"setting {k}")
        elif live[k] != v:
            res["findings"].append(f"setting {k} is {json.dumps(live[k])}, standard {json.dumps(v)}")
    if "security" in gated:
        res["gated"].append("security")
    else:
        sa = live.get("security_and_analysis")
        if not isinstance(sa, dict):
            res["unmeasured"].append("security_and_analysis")
        else:
            for k in ("secret_scanning", "secret_scanning_push_protection"):
                if (sa.get(k) or {}).get("status") != want["security"][k]:
                    res["findings"].append(f"{k} is {(sa.get(k) or {}).get('status')}")
    # main is protected: the standard ruleset, or classic protection
    if "ruleset" in gated:
        res["gated"].append("ruleset")
    else:
        st_r, rs = api("GET", f"/repos/{full}/rulesets")
        st_b, br = api("GET", f"/repos/{full}/branches/{urllib.parse.quote(live.get('default_branch') or 'main')}")
        has_rs = st_r == 200 and isinstance(rs, list) and any(r.get("enforcement") == "active" for r in rs)
        prot = st_b == 200 and isinstance(br, dict) and br.get("protected") is True
        if st_r != 200 and st_b != 200:
            res["unmeasured"].append(f"main protection: rulesets HTTP {st_r}, branch HTTP {st_b}")
        elif not has_rs and not prot:
            res["findings"].append("main is not protected (no active ruleset, no branch protection)")
    # files and the cleanup workflow
    for f in want["files"] + want["workflows"]:
        st_f, _ = api("GET", f"/repos/{full}/contents/{f}")
        if st_f == 404:
            res["findings"].append(f"{f} is missing")
        elif st_f != 200:
            res["unmeasured"].append(f"{f}: HTTP {st_f}")
    if res["unmeasured"] and not res["findings"]:
        res["status"] = "partly-unmeasured"
    return res


def names_live(api, root: Path = ROOT):
    """(names, discovered): registry names joined with what GitHub lists. discovered is False when the listing could not be read."""
    std = standard(root)
    reg = registries(root)
    listed = discover(api, std["org"])
    names = set(reg)
    if listed is not None:
        names |= {r["name"] for r in listed}
    return sorted(names), listed is not None, reg, std


def live(api=None, root: Path = ROOT, out=print) -> int:
    api = api or Api()
    names, discovered, reg, std = names_live(api, root)
    findings = unmeasured = 0
    if not discovered:
        unmeasured += 1
        out(f"unmeasured  the org's repository list could not be read; only the {len(names)} registered repositories are judged, a repository outside the registries is not seen")
    for n in names:
        r = measure(api, n, desired(n, reg, root, std), std)
        tag = {"measured": "ok" if not r["findings"] else "DRIFT", "partly-unmeasured": "unmeasured"}.get(r["status"], r["status"])
        if r["findings"]:
            tag = "DRIFT"
        findings += len(r["findings"])
        unmeasured += len(r["unmeasured"])
        out(f"{tag:<11} {r['repo']}" + (f"  [{'private' if r.get('live', {}).get('private') else 'public'}, {r.get('workflows')} workflows]" if r.get("live") and r["status"] != "archived" else ""))
        for f in r["findings"]:
            out(f"    - {f}")
        for u in r["unmeasured"]:
            out(f"    ? unmeasured: {u}")
        if r["gated"]:
            out(f"    ~ gated (private repository, Free plan): {', '.join(sorted(set(r['gated'])))}")
    out(json.dumps({"repositories": len(names), "findings": findings, "unmeasured": unmeasured, "discovered": discovered}))
    return 1 if findings else 2 if unmeasured else 0


# ---------------------------------------------------------------- apply

def _direct(api, full: str, want: dict, livemeta: dict, std: dict) -> list[str]:
    """Apply with a token that may. Returns the refusals (empty when every call was accepted)."""
    refused: list[str] = []
    private = bool(livemeta.get("private"))
    going_public = private and want["make_public"]
    gated = set(std["worker"]["private_plan_gated"]) if private and not going_public else set()

    def call(label, method, path, body=None, ok=(200, 201, 204)):
        st, js = api(method, path, body)
        if st not in ok:
            refused.append(f"{label}: HTTP {st} {(js or {}).get('message', '') if isinstance(js, dict) else ''}".strip())
            return False
        return True

    body = {k: v for k, v in want["settings"].items() if k not in gated and livemeta.get(k) != v}
    for k in ("description", "homepage"):
        if (livemeta.get(k) or "") != want[k]:
            body[k] = want[k]
    if going_public:
        body["private"] = False
    if body:
        call("settings " + ",".join(sorted(body)), "PATCH", f"/repos/{full}", body)
    if sorted(livemeta.get("topics") or []) != want["topics"]:
        call("topics", "PUT", f"/repos/{full}/topics", {"names": want["topics"]})
    if "security" not in gated:
        call("vulnerability alerts", "PUT", f"/repos/{full}/vulnerability-alerts")
        sa = livemeta.get("security_and_analysis") or {}
        sec = {k: {"status": want["security"][k]} for k in ("secret_scanning", "secret_scanning_push_protection") if (sa.get(k) or {}).get("status") != want["security"][k]}
        if sec:
            call("secret scanning", "PATCH", f"/repos/{full}", {"security_and_analysis": sec})
    if "ruleset" not in gated:
        st, rs = api("GET", f"/repos/{full}/rulesets")
        if st != 200 or not isinstance(rs, list):
            refused.append(f"read rulesets: HTTP {st}")
        elif not any(r.get("name") == want["ruleset"]["name"] and r.get("enforcement") == "active" for r in rs):
            old = next((r for r in rs if r.get("name") == want["ruleset"]["name"]), None)
            if old:
                call("ruleset", "PUT", f"/repos/{full}/rulesets/{old['id']}", want["ruleset"])
            else:
                call("ruleset", "POST", f"/repos/{full}/rulesets", want["ruleset"])
    return refused


def _via_app(full: str, want: dict, root: Path = ROOT, run=subprocess.run):
    """The route with no stored credential: the tick Worker's administration app over this job's OIDC token. (ok, text)."""
    if not os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"):
        return False, "no OIDC token in this run (the job needs permissions id-token: write), so the administration app cannot be reached"
    extra = {"description": want["description"], "homepage": want["homepage"], "topics": want["topics"]}
    if want["make_public"]:
        extra["visibility"] = "public"
    p = run(["node", str(root / "deploy" / "repo-settings.mjs"), full, json.dumps(extra)], capture_output=True, text=True)
    return p.returncode == 0, (p.stdout if p.returncode == 0 else p.stderr).strip()[:600]


def apply(api=None, root: Path = ROOT, out=print, via_app=None) -> int:
    api = api or Api()
    via_app = via_app or (lambda full, want: _via_app(full, want, root))
    names, discovered, reg, std = names_live(api, root)
    failed = 0
    if not discovered:
        out(f"::warning::the org's repository list could not be read with this credential; applying to the {len(names)} registered repositories")
    for n in names:
        want = desired(n, reg, root, std)
        full = want["repo"]
        st, meta = api("GET", f"/repos/{full}")
        if st == 200 and isinstance(meta, dict) and meta.get("archived"):
            out(f"skip  {full}: archived (read-only on GitHub)")
            continue
        refused = None
        # the merge settings are only shown to a credential that may change them; without them a direct apply cannot know the drift
        if st == 200 and isinstance(meta, dict) and "allow_squash_merge" in meta and (meta.get("permissions") or {}).get("admin"):
            refused = _direct(api, full, want, meta, std)
            if not refused:
                out(f"ok    {full}: standard applied with this run's token")
                continue
        ok, text = via_app(full, want)
        if ok:
            out(f"ok    {full}: through the platform's administration app: {text}")
            continue
        failed += 1
        out(f"::error::REFUSED {full}: " + ("; ".join(refused) + " | " if refused else "") + f"administration app route: {text}")
    out(json.dumps({"repositories": len(names), "refused": failed, "discovered": discovered}))
    return 1 if failed else 0


# ---------------------------------------------------------------- branches with no open pull request

def classify(tip: str, prs: list[dict]) -> str:
    """merged: every PR merged and the branch tip is a PR head (nothing new since). closed: its PRs were closed unmerged (the commits stay
    under refs/pull/<n>/head). unmerged-work: no PR at all, or commits pushed after its last PR closed; archived to refs/archive/ before deletion."""
    if any(p.get("state") == "open" for p in prs):
        return "open"
    if not prs:
        return "unmerged-work"
    if tip not in {(p.get("head") or {}).get("sha") for p in prs}:
        return "unmerged-work"
    return "merged" if all(p.get("merged_at") for p in prs) else "closed"


def branches(api=None, root: Path = ROOT, out=print) -> int:
    api = api or Api()
    names, discovered, reg, std = names_live(api, root)
    keep = std["keep_branches"]
    total = unmeasured = 0
    for n in names:
        full = f"{std['org']}/{n}"
        st, bs = api("GET", f"/repos/{full}/branches?per_page=100")
        if st != 200 or not isinstance(bs, list):
            unmeasured += 1
            out(f"unmeasured  {full}: branches HTTP {st}")
            continue
        for b in bs:
            name = b["name"]
            if name in keep["exact"] or any(name.endswith(s) for s in keep["suffixes"]) or b.get("protected"):
                continue
            st_p, prs = api("GET", f"/repos/{full}/pulls?state=all&per_page=100&head={std['org']}:{urllib.parse.quote(name)}")
            if st_p != 200 or not isinstance(prs, list):
                unmeasured += 1
                out(f"unmeasured  {full}: {name}: pulls HTTP {st_p}")
                continue
            c = classify(b["commit"]["sha"], prs)
            if c == "open":
                continue
            total += 1
            out(f"{c:<14} {full}: {name}" + (" (" + ",".join(f"#{p['number']}" for p in prs) + ")" if prs else " (no pull request)"))
    out(json.dumps({"branches_without_open_pr": total, "unmeasured": unmeasured}))
    return 1 if total else 2 if unmeasured else 0


def main(argv=None) -> int:
    a = argparse.ArgumentParser(prog="foundation repostd", description=__doc__.split("\n\n")[0])
    a.add_argument("--check", action="store_true")
    a.add_argument("--plan", action="store_true")
    a.add_argument("--live", action="store_true")
    a.add_argument("--apply", action="store_true")
    a.add_argument("--branches", action="store_true")
    o = a.parse_args(argv)
    if o.plan:
        print(json.dumps(plan(), indent=2))
        return 0
    if o.apply:
        return apply()
    if o.live:
        return live()
    if o.branches:
        return branches()
    errs = check()
    for e in errs:
        print("FAIL", e)
    print(f"repostd: {len(registries())} registered repositories, one standard ({STD}); {len(errs)} problem(s). Live state: --live (unmeasured without a readable API)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
