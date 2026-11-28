# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""ADMIT-1 (Rowan, 2026-11-25): "all surfaces, all files, all code, all instructions, everything has to work together automatically and seamlessly
from the beginning ... it has to all bootstrap autonomously." Ultrastable is the foundation for any autonomous system.

One row in doctrine/tenant-repos.json is the whole act of admitting a tenant. Everything else that makes a tenant run with the fleet (visible
progress, stickiness, promotion, its social queue, repository settings, its showcase on ultrastable.io, its beat clock, its cost budget) is
derived from that row, its instance.json and its doctrine/topology.json worker by this module, so no agent hand-edits a dozen registries and
none is forgotten.

Root cause it removes (found 2026-11-25): the checks that guard a tenant (progress, tenantpromo, fullstack, stickiness) each enumerate tenants
from instances/ultrastable/progress.json, while the registry of tenants is doctrine/tenant-repos.json. The Replication Ledger was live, with a
worker, a beat clock and a showcase, but had no progress row, so every one of those checks passed without ever looking at it: it published no
social queue, had no stall detector and was not in the org settings. This check makes the registries agree with the tenant registry, so the
other checks see every tenant.

  python3 -m foundation admit --check            every live tenant (state own-repo, moving, moved) has a row in every admission registry
  python3 -m foundation admit --apply [--slug S] write each missing row from the tenant's own record; idempotent (run by regen_generated on
                                                 every merge, so a new tenant row bootstraps the rest by itself)
  python3 -m foundation admit --list             one line per tenant and registry

Contract: doctrine/admission.json (registries, which tenants each applies to). Tests: tests/foundation/test_admit.py.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = "doctrine/admission.json"
LIVE = ("own-repo", "moving", "moved")
CORE = "ultrastable/ultrastable"


def _read(root: Path, rel: str):
    return json.loads((root / rel).read_text(encoding="utf-8"))


def _indent(text: str, data) -> int | None:
    for ind in (1, 2):
        if json.dumps(data, indent=ind, ensure_ascii=False) + "\n" == text:
            return ind
    return None


class Doc:
    """A JSON registry loaded once, written back in its own layout (indent 1 or 2; any other layout is written at indent 2)."""

    def __init__(self, root: Path, rel: str):
        self.root, self.rel = root, rel
        self.text = (root / rel).read_text(encoding="utf-8")
        self.data = json.loads(self.text)
        self.ind = _indent(self.text, self.data) or 2
        self.dirty = False

    def save(self):
        if self.dirty:
            (self.root / self.rel).write_text(json.dumps(self.data, indent=self.ind, ensure_ascii=False) + "\n", encoding="utf-8")


def tenants(root: Path = ROOT) -> dict:
    """Live tenants with everything the generators need: slug, name, repo, home (public URL), worker, d1 id, cron, source, description."""
    reg = _read(root, "doctrine/tenant-repos.json")["tenants"]
    topo = {w["id"]: w for w in _read(root, "doctrine/topology.json").get("workers", [])}
    shows = {c["id"]: c for c in _read(root, "doctrine/stakeholders.json").get("showcases", [])}
    out = {}
    for slug, t in reg.items():
        if t.get("state") not in LIVE:
            continue
        inst = root / f"instances/{slug}/instance.json"
        name = (json.loads(inst.read_text()).get("name") if inst.exists() else None) or (shows.get(slug) or {}).get("name") or slug.replace("-", " ").title()
        w = topo.get(t.get("worker") or "")
        home = ""
        if w and w.get("routes"):
            home = "https://" + str(w["routes"][0]).split("/")[0].rstrip("*")
        home = home or ((shows.get(slug) or {}).get("home") or t.get("frontend") or "").rstrip("/")
        d1 = ""
        wr = root / f"instances/ultrastable/system/{t.get('worker')}.wrangler.jsonc"
        if t.get("worker") and wr.exists():
            m = re.search(r'"database_id"\s*:\s*"([0-9a-f-]{36})"', wr.read_text())
            d1 = m.group(1) if m else ""
        out[slug] = {"slug": slug, "name": name, "repo": t["repo"], "state": t["state"], "home": home.rstrip("/"), "worker": t.get("worker"),
                     "topo": w, "d1": d1, "source": t.get("source"), "description": t.get("description") or f"{name}: a tenant system running on Ultrastable."}
    return out


# --- one finder and one generator per registry -------------------------------------------------------------------------------------------

def _progress_row(t):
    in_core = t["state"] == "moving" and t.get("source")
    return {"id": t["slug"], "name": t["name"], "repo": CORE if in_core else t["repo"], "url": t["home"] + "/", "feed": t["home"] + "/feed.json",
            "expect_hours": 168, "heal": ["deploy-ultrastable.yml"] if in_core else ["ci.yml"],
            "stickiness": {"content_feed": t["home"] + "/feed.json", "domains": [], "expect_days": 7, "min_depth": 0, "reveal": f"{t['name']} runs on Ultrastable."}}


def r_progress(docs, t, fix):
    d = docs("instances/ultrastable/progress.json")
    rows = d.data.setdefault("systems", [])
    have = next((s for s in rows if s.get("id") == t["slug"]), None)
    want = _progress_row(t)
    if have is None:
        if fix:
            rows.append(want); d.dirty = True
        return "missing"
    if have.get("repo") != want["repo"]:  # a move finished (moving -> moved): progress follows the code to its own repository
        if fix:
            have["repo"], have["heal"] = want["repo"], want["heal"]; d.dirty = True
        return f"repo {have.get('repo')} is not where the code lives ({want['repo']})"
    return None


def r_promotion(docs, t, fix):
    d = docs("doctrine/tenant-promotion.json")
    rows = d.data.setdefault("tenants", {})
    if t["slug"] in rows:
        return None
    if fix:
        row = {"queue": t["home"] + "/social-queue.json", "showcase": t["slug"]}
        if t["state"] == "moving" and t.get("source"):
            row["worker_dir"] = t["source"] + "/worker"
        rows[t["slug"]] = row; d.dirty = True
    return "missing"


def r_gate(docs, t, fix):
    q = docs("doctrine/tenant-promotion.json").data.get("tenants", {}).get(t["slug"], {}).get("queue") or t["home"] + "/social-queue.json"
    d = docs("social/gate.json")
    qs = d.data.setdefault("tenant_queues", [])
    if q in qs:
        return None
    if fix:
        qs.append(q); d.dirty = True
    return f"queue {q} not drained"


def r_org(docs, t, fix):
    d = docs("github/org-settings.json")
    repos = d.data.setdefault("repos", {})
    if t["repo"] in repos:
        return None
    if fix:
        tmpl = next((json.loads(json.dumps(v)) for k, v in repos.items() if k != CORE and (v.get("settings") or {}).get("private") is False), None)
        if tmpl:
            tmpl["description"] = t["description"][:350]
            tmpl["homepage"] = t["home"] + "/" if t["home"] else None
            repos[t["repo"]] = tmpl; d.dirty = True
    return "missing"


def r_showcase(docs, t, fix):
    d = docs("doctrine/stakeholders.json")
    rows = d.data.setdefault("showcases", [])
    have = next((c for c in rows if c.get("id") == t["slug"]), None)
    if have and have.get("status") == "live" and have.get("home"):
        return None
    if fix and have is None and t["home"]:
        rows.append({"id": t["slug"], "name": t["name"], "tag": "Tenant system, live", "status": "live", "summary": t["description"],
                     "domain": "org", "home": t["home"] + "/", "homeLabel": f"Open {t['name']}",
                     # the page renders every one of these; a skeleton row without them crashed /showcase/<id> (found 2026-11-28), so a row is complete and says what is still unwritten
                     "problem": "Not written yet: the case for this system is still to be written from its IDEA.md.", "loop": "Not written yet: see its repository for the loop it runs.",
                     "results": [f"Live at {t['home']}; its health report is at {t['home']}/health."], "learned": "Not written yet.",
                     "links": [{"label": "Operations dashboard", "href": "/ops"}, {"label": "Get in touch", "href": "/contact"}]})
        d.dirty = True
    return "missing" if have is None else "not live, or no home"


def r_clock(docs, t, fix):
    if not t["worker"]:
        return None
    d = docs("doctrine/clocks.json")
    rows = d.data.setdefault("clocks", [])
    if any(t["worker"] in json.dumps(c.get("health_urls") or []) or c.get("d1_id") == t["d1"] and t["d1"] for c in rows):
        return None
    if fix and t["d1"]:
        cron = ((t["topo"] or {}).get("crons") or ["hourly"])[0]
        acct = _read(d.root, "doctrine/topology.json").get("account_id", "")
        rows.append({"id": f"{t['slug']}-beat", "what": f"{t['name']} tenant beat (cron {cron} on {t['worker']})", "source": "d1", "d1_id": t["d1"],
                     "table": "beats", "column": "started_at", "expected_interval_s": 3600, "periodic": True,
                     "replicas": [{"account_id": acct, "d1_id": t["d1"], "why": "ultrastable account, the only copy"}],
                     "health_urls": [f"https://{t['worker']}.ultrastable.workers.dev/health"] + ([t["home"] + "/health"] if t["home"] else [])})
        d.dirty = True
    return "missing"


def r_budget(docs, t, fix):
    if not t["worker"]:
        return None
    d = docs("instances/ultrastable/cost-budgets.json")
    rows = d.data.setdefault("budgets", [])
    if any(b.get("id") == t["worker"] for b in rows):
        return None
    if fix and t["d1"]:
        rows.append({"id": t["worker"], "account_id": _read(d.root, "doctrine/topology.json").get("account_id", ""), "database_id": t["d1"],
                     "database_name": t["worker"], "max_rows_read_per_hour": 20000, "gates_tick": False,
                     "note": "TENANT-SANDBOX-1: this tenant's own budget (doctrine/tenant-repos.json sandbox), sampled hourly apart from the core. Written by ADMIT-1."})
        d.dirty = True
    return "missing"


REGISTRIES = {"progress": r_progress, "promotion": r_promotion, "gate": r_gate, "org-settings": r_org, "showcase": r_showcase,
              "clock": r_clock, "budget": r_budget}


def run(root: Path = ROOT, fix: bool = False, only: str | None = None) -> list[str]:
    contract = _read(root, CONTRACT)
    cache: dict[str, Doc] = {}

    def docs(rel):
        if rel not in cache:
            cache[rel] = Doc(root, rel)
        return cache[rel]

    gaps = []
    for slug, t in tenants(root).items():
        if only and slug != only:
            continue
        for reg in contract["registries"]:
            fn = REGISTRIES.get(reg["id"])
            if fn is None:
                gaps.append(f"{CONTRACT}: registry {reg['id']} has no generator in foundation/admit.py")
                continue
            why = fn(docs, t, fix)
            if why:
                gaps.append(f"{slug}: {reg['id']} ({reg['file']}): {why}")
    for d in cache.values():
        d.save()
    if cache.get("github/org-settings.json") and cache["github/org-settings.json"].dirty and (root / "brand/tools/sync_settings.py").exists():
        import subprocess  # the brand sync owns the order and wording of github/org-settings.json; a new row is re-rendered through it
        subprocess.run([sys.executable, str(root / "brand/tools/sync_settings.py")], cwd=root, check=True, capture_output=True)
    return gaps


def check(root: Path = ROOT) -> list[str]:
    bad = run(root, fix=False)
    contract = _read(root, CONTRACT)
    for rel in contract.get("rule_files", []):
        p = root / rel
        if not p.exists() or "ADMIT-1" not in p.read_text(encoding="utf-8"):
            bad.append(f"{rel}: rule ADMIT-1 missing")
    return bad


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    only = argv[argv.index("--slug") + 1] if "--slug" in argv else None
    if "--apply" in argv:
        gaps = run(ROOT, fix=True, only=only)
        left = run(ROOT, fix=False, only=only)
        for g in gaps:
            print("admit: wrote" if g not in left else "admit: still open", g)
        print(f"admit: {len(gaps) - len(left)} row(s) written, {len(left)} still open (admit --check in checks fails on these)")
        return 0
    if "--list" in argv:
        for slug, t in tenants(ROOT).items():
            print(f"{slug}: state {t['state']} repo {t['repo']} home {t['home'] or '-'} worker {t['worker'] or '-'}")
        return 0
    bad = check(ROOT)
    for b in bad:
        print("admit:", b)
    print(f"admit: {'FAIL' if bad else 'ok'} ({len(bad)} gap(s)); fix: python3 -m foundation admit --apply")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
