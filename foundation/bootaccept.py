# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Bootstrap acceptance: one command proves a system goes from nothing to every surface working together (BOOT-ACCEPT-1, Rowan 2026-11-25).

"All surfaces, all files, all code, all instructions, everything has to work together automatically and seamlessly from the beginning ...
Bootstrap, it has to all bootstrap autonomously, fully autonomous bootstrapping, everything."

Each surface was proved on its own, so the parts never checked one another. A gate added for one rule (LIVE-1, health-only seeds) hid the routes
two later rules needed (DISCOVER-1's manifest, DATAGRAPH-1's graph) on every seed and visitor app, and no test noticed. Seeds never named their
public URL or repository, so their manifest was empty and the directory could not list them. This module reads every layer of a launched
system live, from outside, as a visitor and the directory would:

  repo       the repository exists and is public (GitHub API, no credential needed)
  backend    /health answers JSON that names the org (the Worker runs its own code)
  health     /health says ok: the last tick finished every step
  ui         / is an HTML page with the "Built on Ultrastable" footer
  graph      /api/graph is public and the knowledge graph has been built with nodes
  discovery  /.well-known/ultrastable.json names this URL and this repository, and the ultrastable.io directory lists it

  python3 -m foundation bootaccept --run        launch a seed from the kernel (seedlaunch --e2e-oidc, no stored key), then read every layer of
                                                every standing seed; one row per system in ops/boot-accept.jsonl. Needs GitHub Actions OIDC.
  python3 -m foundation bootaccept --probe      read every layer of every standing seed, without launching
  python3 -m foundation bootaccept --url U --repo O/R    read one system
  python3 -m foundation bootaccept --check      the latest acceptance passed and is fresh (detector `boot-accept`)

Owner-only steps that remain on the path are the gates named in OWNER_GATES, each with its default in effect in doctrine/open-loops.json.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = "ops/boot-accept.jsonl"
LAYERS = ("repo", "backend", "health", "ui", "graph", "discovery")
MAX_AGE_DAYS = 8
DIRECTORY = "https://ultrastable.io"
UA = "ultrastable-boot-accept/1"
# The steps on the bootstrap path no code can take, each an identity-bound gate in doctrine/open-loops.json with its default in effect.
OWNER_GATES = ("gap-fresh-account-bootstrap", "visitor-app-repos")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http_get(url: str, timeout=20) -> tuple[int, dict, str]:
    """GET -> (status, headers, body). A network error is status 0 with the reason as body; never raised."""
    headers = {"user-agent": UA, "accept": "*/*"}
    tok = os.environ.get("GH_TOKEN", "")
    if tok and url.startswith("https://api.github.com/"):
        headers["authorization"] = "Bearer " + tok
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read(200_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, e.read(20_000).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - the reason is recorded as the layer's detail
        return 0, {}, f"{type(e).__name__}: {e}"[:200]


def http_post_json(url: str, payload: dict, timeout=30) -> tuple[int, str]:
    """POST JSON -> (status, body). A network error is status 0 with the reason; never raised."""
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"user-agent": UA, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(20_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(20_000).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - the reason is recorded as the layer's detail
        return 0, f"{type(e).__name__}: {e}"[:200]


def _json(body: str):
    try:
        return json.loads(body)
    except ValueError:
        return None


def probe(base: str, repo: str | None, get=http_get, post=None) -> dict:
    """Read every layer of one system. Returns {layer: {ok, detail}}; every layer is always present."""
    base = base.rstrip("/")
    out: dict[str, dict] = {}

    if not repo:
        out["repo"] = {"ok": False, "detail": "no repository declared (doctrine/full-stack.json `repo`)"}
    else:
        st, _, body = get(f"https://api.github.com/repos/{repo}")
        j = _json(body) or {}
        out["repo"] = {"ok": st == 200 and j.get("private") is False,
                       "detail": f"{repo}: " + ("public" if st == 200 and j.get("private") is False else "private" if st == 200 else f"HTTP {st}")}

    st, _, body = get(base + "/health")
    h = _json(body)
    named = isinstance(h, dict) and bool(h.get("org"))
    out["backend"] = {"ok": named, "detail": f"/health HTTP {st}" + (f", org {h.get('org')}" if named else ", no org in the answer")}
    stage = ((h or {}).get("ignition") or {}).get("stage") if isinstance(h, dict) else None
    out["health"] = {"ok": named and h.get("ok") is True,
                     "detail": ("last tick complete" if named and h.get("ok") is True else "last tick not complete") + (f"; stage {stage}" if stage else "")}

    st, hd, body = get(base + "/")
    html = "html" in hd.get("content-type", "")
    footer = "Built on" in body and "ultrastable.io" in body and "/.well-known/ultrastable.json" in body
    out["ui"] = {"ok": st == 200 and html and footer,
                 "detail": f"/ HTTP {st}" + ("" if html else ", not HTML") + ("" if footer else ", no Built on Ultrastable footer")}

    st, _, body = get(base + "/api/graph")
    g = _json(body)
    nodes = ((g or {}).get("last") or {}).get("nodes") if isinstance(g, dict) else None
    out["graph"] = {"ok": st == 200 and isinstance(g, dict) and g.get("built") is True and bool(nodes),
                    "detail": f"/api/graph HTTP {st}" + (f", {nodes} nodes" if nodes else ", not built yet" if st == 200 else "")}

    st, _, body = get(base + "/.well-known/ultrastable.json")
    m = _json(body)
    why = []
    if st != 200 or not isinstance(m, dict) or m.get("ultrastable") != 1:
        why.append(f"manifest HTTP {st}")
    else:
        if (m.get("url") or "").rstrip("/") != base:
            why.append(f"manifest url is {m.get('url')!r}, not {base}")
        if repo and m.get("repo") != f"https://github.com/{repo}":
            why.append(f"manifest repo is {m.get('repo')!r}")
        if m.get("discoverable") is not True:
            why.append("manifest says not discoverable")
    if not why:
        st2, _, body2 = get(DIRECTORY + "/directory.json")
        listing = json.dumps(_json(body2) or {})
        if base not in listing and post is None:
            why.append(f"not in {DIRECTORY}/directory.json (HTTP {st2})")
        elif base not in listing:
            # Second route (No single route): register it the way the seed's own heartbeat does, keep the directory's
            # reason, and read the listing again, so a refusal names its cause instead of only "not listed".
            st3, body3 = post(DIRECTORY + "/api/directory/register", {"url": base})
            r3 = _json(body3) or {}
            st2, _, body2 = get(DIRECTORY + "/directory.json")
            if base not in json.dumps(_json(body2) or {}):
                why.append(f"not in {DIRECTORY}/directory.json (HTTP {st2}); register answered HTTP {st3}"
                           + (f": {r3.get('why') or r3.get('error')}" if (r3.get('why') or r3.get('error')) else ""))
    out["discovery"] = {"ok": not why, "detail": "; ".join(why) or "manifest names this URL and repository; listed in the directory"}
    return out


def verdict(layers: dict) -> dict:
    failed = [k for k in LAYERS if not (layers.get(k) or {}).get("ok")]
    return {"passed": not failed, "failed_layers": failed}


def standing_systems(root=ROOT) -> list[dict]:
    """Every standing seed (doctrine/seed-deploys.json), at the URL deploy/deploy-seed.mjs gives it, with the repository full-stack.json declares."""
    seeds = json.loads((Path(root) / "doctrine" / "seed-deploys.json").read_text())["seeds"]
    declared = json.loads((Path(root) / "doctrine" / "full-stack.json").read_text()).get("systems", {})
    return [{"system": s, "base": f"https://ultrastable-seed-{s}.ultrastable.workers.dev", "repo": (declared.get(s) or {}).get("repo")} for s in seeds]


def accept(systems: list[dict], get=http_get, launch: dict | None = None, retries=1, wait_s=0, sleep=time.sleep, post=None) -> list[dict]:
    """Probe each system; a layer that fails is read again after wait_s (a fresh system ticks and registers within one cron interval)."""
    recs = []
    for s in systems:
        layers = probe(s["base"], s.get("repo"), get, post)
        for _ in range(retries if not verdict(layers)["passed"] else 0):
            sleep(wait_s)
            layers = probe(s["base"], s.get("repo"), get, post)
        rec = {"at": _now(), "system": s["system"], "base": s["base"], "repo": s.get("repo"), "layers": layers, **verdict(layers),
               "owner_gates": list(OWNER_GATES)}
        if launch is not None:
            rec["launch"] = {k: launch.get(k) for k in ("passed", "failed_stages", "slug", "route")}
            if not launch.get("passed"):
                rec["passed"] = False
                rec["failed_layers"] = ["launch"] + rec["failed_layers"]
        recs.append(rec)
    return recs


def append(recs, root=ROOT):
    p = Path(root) / LEDGER
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, sort_keys=True) + "\n")


def check(root=ROOT, now=None, max_age_days=MAX_AGE_DAYS) -> list[str]:
    """The latest row per standing system passed and is fresh. No row is a failure, never a pass."""
    p = Path(root) / LEDGER
    rows = [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
    errs = []
    now = now or dt.datetime.now(dt.timezone.utc)
    for s in standing_systems(root):
        mine = [r for r in rows if r.get("system") == s["system"]]
        if not mine:
            errs.append(f"{s['system']}: no bootstrap acceptance recorded (seed-launch.yml runs `bootaccept --run`)")
            continue
        last = mine[-1]
        if not last.get("passed"):
            errs.append(f"{s['system']}: failed layers {last.get('failed_layers')}: "
                        + "; ".join(f"{k}: {v.get('detail')}" for k, v in (last.get("layers") or {}).items() if not v.get("ok")))
        age = (now - dt.datetime.strptime(last["at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)).days
        if age > max_age_days:
            errs.append(f"{s['system']}: latest acceptance is {age} days old (> {max_age_days})")
    return errs


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        e = check()
        print("bootaccept ok" if not e else "\n".join(e))
        return 1 if e else 0
    if "--url" in a:
        base = a[a.index("--url") + 1]
        repo = a[a.index("--repo") + 1] if "--repo" in a else None
        systems = [{"system": base.split("//")[-1].split(".")[0], "base": base, "repo": repo}]
    else:
        systems = standing_systems()
    launch = None
    if "--run" in a:
        from foundation import seedlaunch
        launch = seedlaunch.e2e_oidc()
        seedlaunch.append([launch])
    recs = accept(systems, launch=launch, post=http_post_json, retries=1, wait_s=int(os.environ.get("BOOT_ACCEPT_WAIT_S", "660")) if "--run" in a else 60)
    if "--url" not in a:
        append(recs)
    for r in recs:
        print(("PASS " if r["passed"] else "FAIL ") + r["system"] + " " + r["base"])
        for k in LAYERS:
            v = r["layers"][k]
            print(f"  {'ok ' if v['ok'] else 'NO '} {k:9} {v['detail']}")
        if r.get("launch"):
            print(f"  {'ok ' if r['launch'].get('passed') else 'NO '} launch    {r['launch'].get('failed_stages') or 'kernel to live Worker, no stored key'}")
    print("owner-only gates on this path (default in effect, doctrine/open-loops.json): " + ", ".join(OWNER_GATES))
    return 0 if all(r["passed"] for r in recs) else 1


if __name__ == "__main__":
    sys.exit(main())
