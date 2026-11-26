# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FLEET-CONTRACT-1 (Rowan, 2026-11-25): what a system says is what its code does, and what its front end shows is what its back end serves,
in both directions, for the platform and every tenant. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation fleetcontract --check          every live system carries the shared contract module (or an open Q-CONTRACT-<id> item);
                                                       the surfaces in doctrine/fleet-contract.json equal the module's (in checks)
  python3 -m foundation fleetcontract --live           fetch every surface, every statement's page and endpoint and every /api link of every
                                                       live system; exit 1 when one fails (daily in tenant-repos.yml)
  python3 -m foundation fleetcontract --live --apply   the same, and file Q-CONTRACT-<id> per failing system, close it when the reading passes,
                                                       and record the reading in ops/fleet-contract.json
  python3 -m foundation fleetcontract --live --record  the same reading, recorded in ops/fleet-contract.json with no item filed: the failure-audit
                                                       detector `fleet-contract` runs this, so its Q-AUDIT item is the one item (FAILURE-RESOLVE-1)
  python3 -m foundation fleetcontract --probe ID       closing probe of Q-CONTRACT-<ID>: the live reading of that one system
  python3 -m foundation fleetcontract --list           one line per system

Data: doctrine/fleet-contract.json, doctrine/tenant-repos.json, doctrine/topology.json. Module: seed/worker/src/contract.js (its verify() is
the same reading, run by each system's own tests against its router). Tests: tests/foundation/test_fleetcontract.py."""
from __future__ import annotations
import datetime as dt, json, re, sys, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/fleet-contract.json"
RULE = "FLEET-CONTRACT-1"
RULE_FILES = ["agents/AGENTS.md", "seed/agents/AGENTS.md", "agents/PROJECT-INSTRUCTIONS.md"]
READING = "ops/fleet-contract.json"
LIVE_STATES = ("own-repo", "moving", "moved")


def _j(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def systems(root=REPO) -> list[dict]:
    """Every system with a public front end: the platform and seeds named in the policy, and each tenant with a live Worker route or a frontend."""
    root, pol = Path(root), _j(root, POLICY)
    topo = {w.get("id"): w for w in _j(root, "doctrine/topology.json").get("workers", []) if isinstance(w, dict)}
    out = [{"id": sid, "origin": s.get("origin"), "carries": bool(s.get("module")) and (root / s["module"]).exists() and "contract" in (root / s["module"]).read_text(encoding="utf-8"), "kind": "core"}
           for sid, s in pol.get("systems", {}).items()]
    for slug, t in _j(root, "doctrine/tenant-repos.json").get("tenants", {}).items():
        if t.get("state") not in LIVE_STATES:
            continue
        routes = (topo.get(t.get("worker")) or {}).get("routes") or []
        origin = t.get("frontend") or (("https://" + routes[0]) if routes else None)
        out.append({"id": slug, "origin": origin.rstrip("/") if origin else None, "carries": pol["module"] in (t.get("vendor") or {}), "kind": "tenant"})
    return out


def _open(root, item) -> bool:
    f = Path(root) / "docs/issues" / f"{item}.json"
    return f.exists() and "**Status:** closed" not in f.read_text(encoding="utf-8")


def module_surfaces(root=REPO) -> list[dict]:
    src = (Path(root) / _j(root, POLICY)["module"]).read_text(encoding="utf-8")
    block = re.search(r"export const SURFACES = \[(.*?)\];", src, re.S)
    return [{"id": i, "path": p, "kind": k} for i, p, k in re.findall(r"\{\s*id: '([^']+)', path: '([^']+)', kind: '([^']+)'\s*\}", block.group(1) if block else "")]


def check(root=REPO) -> list[str]:
    root, pol, bad = Path(root), _j(root, POLICY), []
    if not (root / pol["module"]).exists():
        return [f"{pol['module']}: the shared contract module is missing"]
    if module_surfaces(root) != pol.get("surfaces"):
        bad.append(f"{POLICY}: surfaces differ from SURFACES in {pol['module']} (one list, two readers: change both in the same commit)")
    for s in systems(root):
        item = f"Q-CONTRACT-{s['id']}"
        if not s["origin"]:
            bad.append(f"{s['id']}: live and no public origin to read (a topology route or `frontend` in doctrine/tenant-repos.json)")
        if not s["carries"] and not _open(root, item):
            bad.append(f"{s['id']}: does not carry {pol['module']} and {item} is missing or closed ({RULE})")
    for rel in RULE_FILES:
        p = root / rel
        if not p.exists() or RULE not in p.read_text(encoding="utf-8"):
            bad.append(f"{rel}: rule {RULE} missing")
    return bad


def _fetch(url, ua, timeout=25, cap=600000):
    try:
        req = urllib.request.Request(url, headers={"user-agent": ua, "accept": "*/*"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("content-type", ""), r.read(cap).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", ""), e.read(cap).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001  a refused or timed-out fetch is the reading
        return 0, "", str(e)[:200]


def _json(body):
    try:
        return json.loads(body)
    except ValueError:
        return None


def api_links(html: str) -> list[str]:
    """Same-origin /api paths a page links or fetches; template pieces (ending in a slash or '=') are not whole paths and are left out."""
    found = re.findall(r"""(?:href|src|action)\s*=\s*["'](/api/[^"'#\s<>]*)["']|fetch\(\s*["'`](/api/[^"'`#\s<>$]*)["'`]""", html)
    return sorted({p for pair in found for p in pair if p and not p.endswith(("/", "="))})


def page_text(html: str) -> str:
    """A page's readable text: scripts, styles and tags dropped, entities decoded, whitespace collapsed, lower case (pageText in the module)."""
    import html as _h
    t = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html, flags=re.I)
    return re.sub(r"\s+", " ", _h.unescape(re.sub(r"<[^>]+>", " ", t))).strip().lower()


def read_system(s: dict, pol: dict, fetch=_fetch) -> dict:
    """The live reading of one system. Mirrors verify() in the shared module; failures carry a direction."""
    ua, origin, fails, checks = pol.get("user_agent", "ultrastable-fleet-contract/1"), s["origin"], [], 0
    fail = lambda i, d, why: fails.append({"id": i, "direction": d, "why": why})  # noqa: E731
    if not origin:
        return {"id": s["id"], "ok": False, "checks": 0, "failures": [{"id": "origin", "direction": "contract", "why": "no public origin"}]}
    got = {}
    for sf in pol["surfaces"]:
        checks += 1
        st, ct, body = got[sf["id"]] = fetch(origin + sf["path"], ua)
        if sf["kind"] == "html":
            if st != 200 or not ("html" in ct or "<html" in body[:600].lower()):
                fail(sf["id"], "contract", f"{sf['path']} did not answer with a page ({st})")
        elif st not in (200, 503) or _json(body) is None:
            fail(sf["id"], "contract", f"{sf['path']} did not answer with JSON ({st})")
        elif sf["id"] == "health" and st != 200:
            fail(sf["id"], "contract", f"/health says the system is unwell ({st})")
    m, c = _json(got["manifest"][2]) or {}, _json(got["claims"][2]) or {}
    if got["manifest"][0] == 200 and isinstance(m, dict):
        if m.get("ultrastable") != 1:
            fail("manifest", "contract", "the manifest does not say ultrastable: 1")
        if (m.get("url") or "").rstrip("/") != origin:
            fail("manifest", "contract", f"the manifest names {m.get('url')}, the registry reads the system at {origin}")
    if got["home"][0] == 200 and pol.get("platform_link") and pol["platform_link"] not in got["home"][2] and s["id"] != "ultrastable":
        fail("home", "contract", "the home page does not link the platform it runs on")
    sq = _json(got["social"][2])
    if got["social"][0] == 200 and isinstance(sq, dict) and not isinstance(sq.get("posts"), list):
        fail("social", "contract", "/social-queue.json has no posts list")
    sts = c.get("statements") if isinstance(c, dict) else None
    if got["claims"][0] == 200 and not sts:
        fail("claims", "contract", "/claims.json lists no statements")
    pages = {"/": got["home"]}
    for stt in (sts or [])[: pol.get("max_statements", 80)]:
        sid, page, api = stt.get("id"), stt.get("page"), stt.get("api")
        if not (isinstance(api, str) and api.startswith("/")):
            if len(str(stt.get("evidence") or "")) < 8:  # a statement about the page itself names the test or file that backs it
                fail(sid, "front-to-back", "a statement with no endpoint and no evidence that backs it")
        else:
            checks += 1
            st, ct, body = fetch(origin + api, ua)
            if st != 200 or _json(body) is None:
                fail(sid, "front-to-back", f"its endpoint {api} did not answer with JSON ({st})")
        if not (isinstance(page, str) and page.startswith("/")):
            fail(sid, "back-to-front", "a statement no page shows")
        else:
            checks += 1
            if page not in pages:
                pages[page] = fetch(origin + page, ua)
            st, ct, body = pages[page]
            if st != 200 or not ("html" in ct or "<html" in body[:600].lower()):
                fail(sid, "back-to-front", f"its page {page} did not answer ({st})")
            elif page_text(str(stt.get("text") or "")) not in page_text(body):
                fail(sid, "back-to-front", f"{page} does not show the sentence \"{str(stt.get('text'))[:80]}\" (the words in /claims.json and on the page must be the same words)")
    for link in sorted({l for st, _, body in pages.values() if st == 200 for l in api_links(body)}):
        checks += 1
        st, _, _ = fetch(origin + link, ua)
        if st in (0, 404) or st >= 500:
            fail(link, "front-to-back", f"a page links {link} and it answers {st}")
    return {"id": s["id"], "origin": origin, "ok": not fails, "checks": checks, "statements": len(sts or []), "failures": fails}


def live(root=REPO, fetch=_fetch, only=None) -> list[dict]:
    pol = _j(root, POLICY)
    return [read_system(s, pol, fetch) for s in systems(root) if only in (None, s["id"])]


def _item(row: dict) -> dict:
    lines = "\n".join(f"- {f['direction']}: {f['id']}: {f['why']}" for f in row["failures"][:40])
    more = f"\n- and {len(row['failures']) - 40} more (run the probe for the full list)" if len(row["failures"]) > 40 else ""
    return {"id": f"Q-CONTRACT-{row['id']}", "title": f"Q-CONTRACT-{row['id']}: {row['id']} serves the fleet contract and backs every statement both ways",
            "body": f"**Owner:** executor\n**Trigger:** fleetcontract --live --apply (daily in tenant-repos.yml)\n**Done check:** cmd:python3 -m foundation fleetcontract --probe {row['id']}\n**Status:** open\n\n"
                    f"{RULE}: every system serves the contract surfaces, every statement names the page that shows it and the endpoint that backs it, and both answer. Live reading of {row.get('origin')}:\n{lines}{more}\n\n"
                    f"Fix the system (wire seed/worker/src/contract.js as the other tenants do, serve the missing surface, or repair the page or endpoint); never relax the reading. Paths: doctrine/fleet-contract.json, seed/worker/src/contract.js, the system's own repository.\n\nsize: M\n\n"
                    f"**Closing probe:** python3 -m foundation fleetcontract --probe {row['id']} passes",
            "labels": ["fleet-contract"]}


def apply(root, rows, now=None, items=True) -> list[str]:
    """File an item per failing system, close an open one whose reading passes, record the reading. Returns what changed.
    items=False records the reading only: the failure-audit detector `fleet-contract` owns the item then (Q-AUDIT-fleet-contract)."""
    root, did = Path(root), []
    now = now or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    for r in rows if items else []:
        f = root / "docs/issues" / f"Q-CONTRACT-{r['id']}.json"
        if not r["ok"]:
            if f.exists() and "**Status:** open" in f.read_text(encoding="utf-8"):
                cur = json.loads(f.read_text(encoding="utf-8"))
                new = _item(r)
                if cur.get("body") != new["body"]:
                    f.write_text(json.dumps({**cur, "body": new["body"]}, indent=2) + "\n", encoding="utf-8")
                    did.append(f"updated {f.name}")
            else:
                f.write_text(json.dumps(_item(r), indent=2) + "\n", encoding="utf-8")
                did.append(f"filed {f.name}")
        elif f.exists() and "**Status:** open" in f.read_text(encoding="utf-8"):
            cur = json.loads(f.read_text(encoding="utf-8"))
            cur["body"] = cur["body"].replace("**Status:** open", "**Status:** closed") + f"\n\n**Disposition:** fixed ({now})\n\n**Evidence:** fleetcontract --live: {r['checks']} checks on {r['origin']}, 0 failures"
            f.write_text(json.dumps(cur, indent=2) + "\n", encoding="utf-8")
            did.append(f"closed {f.name}")
    summary = [{"id": r["id"], "origin": r.get("origin"), "ok": r["ok"], "checks": r["checks"], "statements": r.get("statements", 0),
                "front_to_back": sum(f["direction"] == "front-to-back" for f in r["failures"]), "back_to_front": sum(f["direction"] == "back-to-front" for f in r["failures"]),
                "contract": sum(f["direction"] == "contract" for f in r["failures"])} for r in rows]
    p = root / READING
    old = json.loads(p.read_text(encoding="utf-8")).get("systems") if p.exists() else None
    if old != summary:  # SUBSTANCE-1: the file changes only when a reading changes, never for the timestamp alone
        p.write_text(json.dumps({"_note": "GENERATED by python3 -m foundation fleetcontract --live --apply. Do not edit.", "at": now, "systems": summary}, indent=1) + "\n", encoding="utf-8")
        did.append(f"recorded {READING}")
    return did


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--list" in argv:
        for s in systems():
            print(f"{s['id']}: {s['origin'] or 'NO ORIGIN'} ({s['kind']}, {'carries the module' if s['carries'] else 'does not carry the module'})")
        return 0
    if "--probe" in argv or "--live" in argv:
        only = argv[argv.index("--probe") + 1] if "--probe" in argv else None
        rows = live(only=only)
        if not rows:
            print(f"{only}: not a live system in the registries")
            return 1
        for r in rows:
            print(("ok   " if r["ok"] else "FAIL ") + f"{r['id']}: {r['checks']} checks, {r.get('statements', 0)} statements, {len(r['failures'])} failures")
            for f in r["failures"]:
                print(f"       {f['direction']}: {f['id']}: {f['why']}")
        if ("--apply" in argv or "--record" in argv) and not only:
            for d in apply(REPO, rows, items="--apply" in argv):
                print(d)
        print(json.dumps({"systems": len(rows), "holding": sum(r["ok"] for r in rows)}))
        return 0 if all(r["ok"] for r in rows) else 1
    bad = check()
    for b in bad:
        print("FAIL " + b)
    print("fleetcontract ok: every live system carries the contract module or has an open item, and the surface list is one list" if not bad else f"fleetcontract: {len(bad)} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
