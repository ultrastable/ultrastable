# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""RUNWAY-1: how many days the system can keep running with nobody there. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation runway --check             offline: doctrine/runway.json is well formed (every deadline has a probe, a consequence and a remedy)
  python3 -m foundation runway --probe [ID]        measure every deadline (or one) from its live source and print the reading; exit 1 when the runway is short
  python3 -m foundation runway --run [--apply]     measure, append one `runway` row to the ledger and file Q-RUNWAY-<id> for every deadline nearer than the target

A ticking clock (RESILIENCE-1) says the system is alive today. This module says when it stops: a domain lapses, a token expires, a runner image is
retired, a database fills. Each deadline in doctrine/runway.json is measured from a live source, never from memory:

  domain            RDAP (the registry's own record), with a declared date only where the registry publishes none
  github_token      the `github-authentication-token-expiration` header GitHub returns for the token in the named environment variable
  cloudflare_token  Cloudflare's token verify endpoint (`expires_on`), user route first and the account route second
  eol               endoflife.date for a runtime or runner image
  d1_size           the database's size against its plan limit; days to full come from the growth between this reading and the oldest one in the ledger

Statuses: ok (further than the target), short (nearer than the target), lapsed (already past), unbounded (the source says it never expires),
unmeasured (the source could not be read: never counted as passed, filed after `file_unmeasured_after_runs` consecutive runs).
`runway_days` is the nearest hard deadline. The watchdog runs this once a day through foundation/resilience.py, so it costs no extra workflow.
Consumers: foundation/resilience.py (main), foundation/__main__.py, tests/foundation/test_runway.py.
"""
from __future__ import annotations
import json, os, re, sys, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

from . import ledger

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/runway.json"
KINDS = {"domain": ("name",), "github_token": ("env",), "cloudflare_token": ("env", "account_id"), "eol": ("product", "cycle"),
         "d1_size": ("env", "account_id", "d1_id", "limit_bytes")}
DAY = 86400.0


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def http(url: str, headers: dict | None = None, timeout=30) -> tuple[int, dict, str]:
    """(status, headers, body). An HTTP error status is an answer, not an exception; a network failure is status 0."""
    req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-runway", "Accept": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read().decode("utf-8", "replace")
    except (OSError, ValueError) as e:
        return 0, {}, str(e)


def parse_date(s: str) -> float | None:
    """Epoch seconds of an ISO date or of GitHub's `2027-01-31 00:00:00 UTC` / `... +0000` form; None when it is not a date."""
    s = str(s or "").strip()
    m = re.match(r"^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2}))?", s)
    if not m:
        return None
    try:
        return datetime.fromisoformat(m.group(1) + "T" + (m.group(2) or "00:00:00") + "+00:00").timestamp()
    except ValueError:
        return None


def _unmeasured(why: str) -> dict:
    return {"status": "unmeasured", "detail": why}


def _dated(expires: float | None, source: str) -> dict:
    return {"expires": expires, "source": source}


def probe_domain(d, cfg, fetch, env) -> dict:
    st, _, body = fetch(cfg["sources"]["rdap"].format(name=d["name"]))
    if st == 200:
        try:
            ev = [e for e in json.loads(body).get("events", []) if e.get("eventAction") == "expiration"]
        except ValueError:
            ev = []
        if ev and parse_date(ev[0].get("eventDate")):
            return _dated(parse_date(ev[0]["eventDate"]), "rdap")
    if d.get("declared_expires") and parse_date(d["declared_expires"]):
        return _dated(parse_date(d["declared_expires"]), "declared: " + d.get("declared_source", "doctrine/runway.json"))
    return _unmeasured(f"RDAP answered {st} with no expiration event and no date is declared")


def probe_github_token(d, cfg, fetch, env) -> dict:
    tok = env.get(d["env"])
    if not tok:
        return _unmeasured(f"environment variable {d['env']} is not set on this host")
    st, hdr, _ = fetch(cfg["sources"]["github"], {"Authorization": "Bearer " + tok})
    if st == 401:
        return {"expires": 0.0, "source": "github answered 401: the token is no longer valid"}
    if st != 200:
        return _unmeasured(f"github answered {st}")
    exp = hdr.get("github-authentication-token-expiration")
    if not exp:
        return {"status": "unbounded", "detail": "github reports no expiration for this token (a per-run token, an App token or a token minted without one)"}
    t = parse_date(exp)
    return _dated(t, "github-authentication-token-expiration") if t else _unmeasured(f"unreadable expiration header: {exp[:40]}")


def probe_cloudflare_token(d, cfg, fetch, env) -> dict:
    tok = env.get(d["env"])
    if not tok:
        return _unmeasured(f"environment variable {d['env']} is not set on this host")
    last = 0
    for url in (cfg["sources"]["cloudflare_user"], cfg["sources"]["cloudflare_account"].format(account_id=d["account_id"])):
        st, _, body = fetch(url, {"Authorization": "Bearer " + tok})
        last = st
        try:
            j = json.loads(body)
        except ValueError:
            continue
        if st == 200 and j.get("success"):
            res = j.get("result") or {}
            if res.get("status") and res["status"] != "active":
                return {"expires": 0.0, "source": f"cloudflare reports the token status as {res['status']}"}
            if not res.get("expires_on"):
                return {"status": "unbounded", "detail": "cloudflare reports no expires_on for this token"}
            t = parse_date(res["expires_on"])
            return _dated(t, "cloudflare token verify") if t else _unmeasured("unreadable expires_on")
    return _unmeasured(f"neither verify route accepted the token (last status {last})")


def probe_eol(d, cfg, fetch, env) -> dict:
    st, _, body = fetch(cfg["sources"]["endoflife"].format(product=d["product"], cycle=d["cycle"]))
    if st != 200:
        return _unmeasured(f"endoflife.date answered {st}")
    try:
        eol = json.loads(body).get("eol")
    except ValueError:
        return _unmeasured("endoflife.date answered with something that is not JSON")
    if eol is False:
        return {"status": "unbounded", "detail": "endoflife.date lists no end-of-life date yet"}
    t = parse_date(eol) if isinstance(eol, str) else None
    return _dated(t, "endoflife.date") if t else _unmeasured(f"unreadable eol value: {eol!r}")


def probe_d1_size(d, cfg, fetch, env, history=(), now=0.0) -> dict:
    tok = env.get(d["env"])
    if not tok:
        return _unmeasured(f"environment variable {d['env']} is not set on this host")
    st, _, body = fetch(cfg["sources"]["d1"].format(account_id=d["account_id"], d1_id=d["d1_id"]), {"Authorization": "Bearer " + tok})
    try:
        size = (json.loads(body).get("result") or {}).get("file_size")
    except ValueError:
        size = None
    if st != 200 or not isinstance(size, (int, float)):
        return _unmeasured(f"cloudflare answered {st} with no file_size")
    out = {"bytes": int(size), "limit_bytes": d["limit_bytes"], "used_pct": round(100.0 * size / d["limit_bytes"], 2)}
    if size >= d["limit_bytes"]:
        return {**out, "expires": now, "source": "the database is at its plan limit"}
    old = next((h for h in history if isinstance(h.get("bytes"), (int, float)) and h.get("t") and now - h["t"] >= DAY), None)
    if not old:
        return {**out, "status": "unmeasured", "detail": "first reading: growth needs a second reading at least a day apart"}
    rate = (size - old["bytes"]) / ((now - old["t"]) / DAY)  # bytes per day since the oldest reading
    if rate <= 0:
        return {**out, "status": "unbounded", "detail": "the database has not grown since the oldest reading"}
    return {**out, "expires": now + (d["limit_bytes"] - size) / rate * DAY, "source": f"growth of {int(rate)} bytes a day since {_iso(old['t'])[:10]}"}


PROBES = {"domain": probe_domain, "github_token": probe_github_token, "cloudflare_token": probe_cloudflare_token, "eol": probe_eol, "d1_size": probe_d1_size}


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def measure(d: dict, cfg: dict, now: float, fetch=http, env=None, history=()) -> dict:
    """One deadline's verdict. A probe that raises is unmeasured with its error: a broken source never reads as healthy."""
    env = os.environ if env is None else env
    try:
        r = probe_d1_size(d, cfg, fetch, env, history, now) if d["kind"] == "d1_size" else PROBES[d["kind"]](d, cfg, fetch, env)
    except Exception as e:  # noqa: BLE001 - any probe failure is recorded as unmeasured, never swallowed and never fatal to the other deadlines
        r = _unmeasured(f"{type(e).__name__}: {e}"[:200])
    out = {"id": d["id"], "kind": d["kind"], "hard": bool(d.get("hard"))}
    for k in ("bytes", "used_pct"):
        if k in r:
            out[k] = r[k]
    if "expires" in r and r["expires"] is not None:
        days = (r["expires"] - now) / DAY
        out.update(expires=_iso(r["expires"]), days_left=int(days) if days >= 0 else int(days) - 1, source=r["source"],
                   status="lapsed" if days <= 0 else "short" if days < cfg["target_days"] else "ok")
    else:
        out.update(status=r.get("status", "unmeasured"), detail=r.get("detail", "the probe returned nothing"))
    return out


def reading(root=REPO, now=None, fetch=http, env=None, only=None) -> dict:
    root, cfg = Path(root), load(root)
    now = now or datetime.now(timezone.utc).timestamp()
    past = [r for r in ledger.rows(root, cfg["ledger"], branch=False) if r.get("kind") == "runway"]
    rows = []
    for d in cfg["deadlines"]:
        if only and d["id"] != only:
            continue
        hist = [{"t": _ts(p["at"]), "bytes": next((x.get("bytes") for x in p.get("deadlines", []) if x["id"] == d["id"]), None)} for p in past]
        rows.append(measure(d, cfg, now, fetch, env, hist))
    hard = [r["days_left"] for r in rows if r["hard"] and "days_left" in r]
    short = [r["id"] for r in rows if r["status"] in ("short", "lapsed")]
    unmeasured = [r["id"] for r in rows if r["status"] == "unmeasured"]
    return {"at": _iso(now), "kind": "runway", "target_days": cfg["target_days"], "runway_days": min(hard) if hard else None,
            "nearest": next((r["id"] for r in rows if r["hard"] and r.get("days_left") == min(hard)), None) if hard else None,
            "short": short, "unmeasured": unmeasured, "deadlines": rows}


def _item(root, cfg, d, r, title_tail, why) -> str | None:
    iid = f"{cfg['item_prefix']}-{re.sub(r'[^A-Za-z0-9_-]+', '-', d['id'])}"
    p = Path(root) / "docs/issues" / (iid + ".json")
    if p.exists():
        return None
    gate = "IDENTITY-BOUND: the remedy needs the owner's own account. The code-side mitigation in the remedy is the part the executor does.\n\n" if d.get("identity_bound") else ""
    body = (f"**Owner:** executor\n**Trigger:** {why}\n**Done check:** cmd:python3 -m foundation runway --probe {d['id']}\n**Status:** open\n\n"
            f"RUNWAY-1: the target is {cfg['target_days']} days unattended. If nothing changes: {d['if_lapsed']}\n\n{gate}Remedy: {d['remedy']}\n\nsize: M\n\n"
            f"**Closing probe:** `python3 -m foundation runway --probe {d['id']}` reports ok or unbounded.\n")
    p.parent.mkdir(parents=True, exist_ok=True)
    labels = ["p0" if d.get("hard") and r.get("days_left", 999) < 90 else "p1", "agent-ready"]
    p.write_text(json.dumps({"id": iid, "title": f"{iid}: {title_tail}", "body": body, "labels": labels, "milestone": "Now", "workstream": "Resilience"}, indent=2) + "\n", encoding="utf-8")
    return iid


def run(root=REPO, apply=False, now=None, fetch=http, env=None) -> dict:
    """One daily pass: measure, file what is short, append the reading. `changed` is true when the verdicts differ from the previous reading or an item was filed."""
    root, cfg = Path(root), load(root)
    out = reading(root, now, fetch, env)
    past = [r for r in ledger.rows(root, cfg["ledger"], branch=False) if r.get("kind") == "runway"]
    by, filed = {d["id"]: d for d in cfg["deadlines"]}, []
    for r in out["deadlines"]:
        d = by[r["id"]]
        if r["status"] in ("short", "lapsed"):
            tail = f"{d['id']} {'has lapsed' if r['status'] == 'lapsed' else 'ends in ' + str(r['days_left']) + ' days'} ({r['expires'][:10]}), inside the {cfg['target_days']}-day target"
            why = f"`{d['id']}` reads {r['status']}: {r['expires'][:10]} from {r['source']}"
        elif r["status"] == "unmeasured":
            n = cfg["file_unmeasured_after_runs"] - 1
            streak = [next((x["status"] for x in p.get("deadlines", []) if x["id"] == r["id"]), None) for p in past[-n:]] if n else []
            if len(streak) < n or any(s != "unmeasured" for s in streak):
                continue  # one unreadable source is noise; the same deadline unreadable run after run is a defect in the probe or its credential
            tail, why = f"{d['id']} cannot be measured, so its end date is unknown", f"`{d['id']}` was unmeasured for {n + 1} runs in a row: {r['detail']}"
        else:
            continue
        if apply:
            iid = _item(root, cfg, d, r, tail, why)
            if iid:
                filed.append(iid)
    out["filed"] = filed
    prev = past[-1] if past else None
    verdicts = lambda x: sorted((r["id"], r["status"]) for r in x["deadlines"])  # noqa: E731
    out["changed"] = bool(filed) or prev is None or verdicts(prev) != verdicts(out) or prev["at"][:10] != out["at"][:10]
    if apply and out["changed"]:
        ledger.append(root, cfg["ledger"], [{k: v for k, v in out.items() if k not in ("filed", "changed")}])
    return out


def check(root=REPO) -> list[str]:
    try:
        cfg = load(root)
    except (OSError, ValueError) as e:
        return [f"{PATH}: unreadable ({e})"]
    errs, seen = [], set()
    if cfg.get("marker") != "RUNWAY-1":
        errs.append(f"{PATH}: marker must be RUNWAY-1")
    if not isinstance(cfg.get("target_days"), int) or cfg["target_days"] < 365:
        errs.append(f"{PATH}: target_days must be an integer of at least 365 (the owner's target; never lowered to pass)")
    for d in cfg.get("deadlines", []):
        i = d.get("id", "?")
        if i in seen:
            errs.append(f"{PATH}: duplicate deadline id {i}")
        seen.add(i)
        if d.get("kind") not in KINDS:
            errs.append(f"{PATH}: {i} has no known kind (one of {', '.join(sorted(KINDS))})")
            continue
        errs += [f"{PATH}: {i} ({d['kind']}) lacks `{k}`" for k in KINDS[d["kind"]] if k not in d]
        errs += [f"{PATH}: {i} lacks `{k}`" for k in ("if_lapsed", "remedy") if not str(d.get(k, "")).strip()]
        if not isinstance(d.get("hard"), bool):
            errs.append(f"{PATH}: {i} must say `hard` true or false")
        if "declared_expires" in d and not (parse_date(d["declared_expires"]) and d.get("declared_source")):
            errs.append(f"{PATH}: {i} declares a date without a readable value and its source")
    if not cfg.get("deadlines"):
        errs.append(f"{PATH}: no deadlines declared")
    for k in ("rdap", "endoflife", "github", "cloudflare_user", "cloudflare_account", "d1"):
        if not str(cfg.get("sources", {}).get(k, "")).startswith("https://"):
            errs.append(f"{PATH}: sources.{k} must be an https URL")
    return errs


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check()
        print("\n".join(e) or "runway ok: every deadline has a live probe, a consequence and a remedy")
        return 1 if e else 0
    if "--probe" in a:
        i = a.index("--probe")
        only = a[i + 1] if len(a) > i + 1 and not a[i + 1].startswith("--") else None
        r = reading(only=only)
        print(json.dumps(r, indent=1))
        return 0 if all(x["status"] in ("ok", "unbounded") for x in r["deadlines"]) and r["deadlines"] else 1
    if "--run" in a:
        print(json.dumps(run(apply="--apply" in a), indent=1))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
