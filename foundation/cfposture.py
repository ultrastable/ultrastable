# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CF-POSTURE-1: the Cloudflare account's settings are declared in code and measured against the live account, so a year unattended does not
depend on anyone looking at a dashboard. Measured on 2026-11-20: the live `ultrastable-site` Worker had logs off although its config turns them on,
because three direct-upload deploy paths sent metadata with no `observability` key and every upload replaced the setting; the account's only
notification policy mails a person; eight preview Workers sat idle. Each of those is a rule here with a probe, not a note.

  python3 -m foundation cfposture --check                 the policy is well formed and every deploy path that uploads a Worker sends `observability`
  python3 -m foundation cfposture --probe [--json]        read the live account (CLOUDFLARE_API_TOKEN); exit 1 on a measured failure; unreadable = unmeasured
  python3 -m foundation cfposture --probe --apply         also write ops/cf-posture.json and file or close one Q-CFP-<rule> item per rule
  python3 -m foundation cfposture --rule ID               closing probe of a Q-CFP item: exit 0 when the last recorded reading of that rule passed

Policy: doctrine/cf-posture.json. A rule the token cannot read is reported as unmeasured and never as passed. An identity-bound rule (a second
account member) is recorded with its default in effect and files no item.
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.error, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
POLICY, READING = "doctrine/cf-posture.json", "ops/cf-posture.json"
API = "https://api.cloudflare.com/client/v4"
META_RE = re.compile(r"""["']?main_module["']?\s*:""")  # the metadata object of a Worker upload, in JavaScript or Python


def _tracked(root) -> list[str]:
    try:
        p = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, timeout=60)
        if p.returncode == 0 and p.stdout:
            return [x for x in p.stdout.decode("utf-8", "replace").split("\0") if x]
    except (OSError, subprocess.SubprocessError):
        pass  # not a git checkout (a test's temporary tree): walk the files instead
    return sorted(q.relative_to(root).as_posix() for q in Path(root).rglob("*") if q.is_file() and ".git" not in q.parts and "node_modules" not in q.parts)


def policy(root=REPO) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def _when(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def api(token: str, path: str, opener=urllib.request.urlopen):
    """(result, None) or (None, reason). A refusal or an outage is a reason, never an empty result."""
    req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
    try:
        with opener(req, timeout=30) as r:
            j = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        return None, type(e).__name__
    if not j.get("success", True):
        return None, "api error"
    return j.get("result"), None


def static_check(root=REPO) -> list[str]:
    root, pol, fails = Path(root), policy(root), []
    for k in ("account_id", "horizon_days", "upload_paths", "required_alerts", "rules"):
        if k not in pol:
            fails.append(f"{POLICY}: missing {k}")
    for r in pol.get("rules", []):
        if not r.get("id") or not r.get("why") or r.get("kind") not in ("auto", "gate"):
            fails.append(f"rule {r.get('id')}: needs id, why and kind auto|gate")
        if r.get("kind") == "gate" and not r.get("default"):
            fails.append(f"rule {r.get('id')}: a gate needs its default in effect")
    for rel in pol.get("upload_paths", []):
        p = root / rel
        if not p.is_file():
            fails.append(f"upload path missing: {rel}")
            continue
        text = p.read_text(encoding="utf-8")
        if len(META_RE.findall(text)) > text.count("observability"):
            fails.append(f"{rel}: a Worker upload without `observability` turns logs off on every deploy")
    # every tracked file that builds upload metadata is declared, so a new deploy path anywhere in the repository cannot skip the rule
    # (2026-11-20: the deploy gateway and four more paths under workers/ and scripts/ were outside the first scan and turned logs off again)
    declared = set(pol.get("upload_paths", []))
    for rel in _tracked(root):
        if rel in declared or not rel.endswith((".js", ".mjs", ".py")) or ".test." in rel or "/test/" in rel or rel.startswith(tuple(pol.get("scan_exclude", []))):
            continue
        try:
            text = (root / rel).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if META_RE.search(text):
            fails.append(f"{rel}: uploads a Worker but is not in upload_paths of {POLICY}")
    return fails


def evaluate(pol: dict, live: dict, now: datetime) -> list[dict]:
    """Pure: one row per rule from the live reading. status: pass | fail | unmeasured."""
    horizon, out = now + timedelta(days=pol["horizon_days"]), []

    def row(rid, src, fn):
        rule = next(r for r in pol["rules"] if r["id"] == rid)
        if live.get(src) is None:
            out.append({"id": rid, "kind": rule["kind"], "status": "unmeasured", "detail": [live.get("_why", {}).get(src, "not read")]})
            return
        bad = fn(live[src])
        out.append({"id": rid, "kind": rule["kind"], "status": "fail" if bad else "pass", "detail": bad})

    ids = {r["id"] for r in pol["rules"]}
    if "worker-logs-on" in ids:
        row("worker-logs-on", "workers", lambda ws: sorted(w["id"] for w in ws if not w["id"].startswith(tuple(pol.get("preview_prefixes", []))) and not ((w.get("observability") or {}).get("enabled"))))
    if "no-idle-preview-workers" in ids:
        cut = now - timedelta(days=pol.get("preview_idle_days", 7))
        row("no-idle-preview-workers", "workers", lambda ws: sorted(w["id"] for w in ws if w["id"].startswith(tuple(pol.get("preview_prefixes", []))) and (_when(w.get("modified_on")) or now) < cut))
    if "alerts-reach-code" in ids:
        def alerts(ps):
            have = {p.get("alert_type") for p in ps if p.get("enabled") and (p.get("mechanisms") or {}).get("webhooks")}
            return sorted(t for t in pol["required_alerts"] if t not in have)
        row("alerts-reach-code", "alerts", alerts)
    if "tokens-outlive-horizon" in ids:
        row("tokens-outlive-horizon", "tokens", lambda ts: sorted(t.get("name", "?") for t in ts if t.get("status") == "active" and t.get("expires_on") and (_when(t["expires_on"]) or now) < horizon))
    if "zones-active" in ids:
        row("zones-active", "zones", lambda zs: sorted(f"{z['name']} ({z.get('status')})" for z in zs if z.get("status") != "active") or ([] if zs else ["no zone in the account"]))
    if "second-member" in ids:
        row("second-member", "members", lambda ms: [] if len([m for m in ms if m.get("status") == "accepted"]) >= 2 else ["one account member: its sign-in is the only way into billing and registrar"])
    return out


def read_live(pol: dict, token: str, opener=urllib.request.urlopen) -> dict:
    a, live, why = "/accounts/" + pol["account_id"], {}, {}
    for key, path in (("workers", a + "/workers/scripts"), ("alerts", a + "/alerting/v3/policies"), ("tokens", a + "/tokens"), ("members", a + "/members"), ("zones", "/zones?account.id=" + pol["account_id"])):
        live[key], err = api(token, path, opener)
        if err:
            why[key] = f"GET {path.split('?')[0]}: {err}"
    for w in live.get("workers") or []:
        s, err = api(token, f"{a}/workers/scripts/{w['id']}/settings", opener)
        w["observability"] = (s or {}).get("observability")
        if err:  # a Worker whose settings cannot be read makes the whole rule unmeasured
            live["workers"], why["workers"] = None, f"settings of {w['id']}: {err}"
            break
    live["_why"] = why
    return live


def item(rule: dict, row: dict) -> dict:
    iid = "Q-CFP-" + rule["id"]
    body = (f"**Owner:** staff\n**Trigger:** CF-POSTURE-1 daily probe, rule `{rule['id']}` failed on the live account\n**Done check:** cmd:python3 -m foundation cfposture --rule {rule['id']}\n**Status:** open\n\n"
            f"{rule['why']}\n\nRemedy: {rule.get('remedy', 'make the live account match the rule')}\n\nMeasured:\n" + "\n".join(f"- {d}" for d in row["detail"][:20]))
    return {"id": iid, "title": f"{iid}: {rule['title']}", "body": body, "labels": ["role:staff", "raises-self"], "milestone": "Now", "workstream": "Reliability"}


def apply(root, pol: dict, rows: list[dict], now: datetime) -> list[str]:
    root, done = Path(root), []
    (root / READING).write_text(json.dumps({"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "account_id": pol["account_id"], "rules": rows}, indent=1) + "\n", encoding="utf-8")
    for row in rows:
        rule, p = next(r for r in pol["rules"] if r["id"] == row["id"]), root / "docs/issues" / f"Q-CFP-{row['id']}.json"
        if row["status"] == "fail" and rule["kind"] == "auto":
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(item(rule, row), indent=2) + "\n", encoding="utf-8"); done.append("filed " + p.name)
        elif row["status"] == "pass" and p.is_file():
            j = json.loads(p.read_text(encoding="utf-8"))
            if "**Status:** open" in j.get("body", ""):
                j["body"] = j["body"].replace("**Status:** open", "**Status:** closed") + f"\n\n**Evidence:** rule passed on the live account at {now.strftime('%Y-%m-%dT%H:%MZ')}."
                p.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8"); done.append("closed " + p.name)
    return done


def rule_passed(root, rid: str) -> tuple[bool, str]:
    p = Path(root) / READING
    if not p.is_file():
        return False, "no reading recorded yet"
    row = next((r for r in json.loads(p.read_text(encoding="utf-8")).get("rules", []) if r["id"] == rid), None)
    return (bool(row) and row["status"] == "pass"), (f"{rid}: {row['status']}" if row else f"{rid}: not in the last reading")


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--rule" in argv:
        ok, why = rule_passed(REPO, argv[argv.index("--rule") + 1]); print("cfposture " + why)
        return 0 if ok else 1
    if "--probe" in argv:
        pol, token, now = policy(REPO), os.environ.get("CLOUDFLARE_API_TOKEN", ""), datetime.now(timezone.utc)
        if not token:
            print("cfposture: unmeasured (no CLOUDFLARE_API_TOKEN bound); nothing is reported as passed")
            return 0
        rows = evaluate(pol, read_live(pol, token), now)
        done = apply(REPO, pol, rows, now) if "--apply" in argv else []
        if "--json" in argv:
            print(json.dumps(rows, indent=1))
        else:
            for r in rows:
                print(f"cfposture {r['status']:<10} {r['id']} ({r['kind']})" + (": " + "; ".join(map(str, r["detail"][:6])) if r["detail"] else ""))
            for d in done:
                print("cfposture " + d)
        return 1 if any(r["status"] == "fail" and r["kind"] == "auto" for r in rows) and "--apply" not in argv else 0
    fails = static_check(REPO)
    for f in fails:
        print("cfposture: " + f, file=sys.stderr)
    print(f"cfposture: {len(fails)} failure(s)" if fails else "cfposture ok")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
