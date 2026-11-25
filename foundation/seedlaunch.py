# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Seed launch: every seed is built, deployed, gated on a year unattended and probed live by the system itself (SEED-LAUNCH-1, Rowan 2026-11-21).

"For any seed based on the ultrastable platform, the system actually has to build and deploy it and make it fully autonomous with a design goal
of being completely unsupervised and unattended for a minimum of 1 year."

A seed is the idea in a repository made from ultrastable/seed (or the seed/ folder here). The person writes IDEA.md and nothing else: no secret,
no command, no Cloudflare sign-in. This launcher runs server-side (workflow seed-launch.yml, on Ultrastable's own Cloudflare account and
GitHub Actions) and carries each seed from repository to a live, ticking Worker:

  bootstrap.py --apply   read, qualify, plan, D1 created + migrated + seeded, Worker deployed with its cron
  year_gate              the seed's own drills against its real recovery code; horizon p10 >= 365 days or the boot is not accepted
  verify_live            /health on the deployed Worker answers 200

  coldstart              every live path of doctrine/coldstart.json answers on the fresh seed (COLDSTART-1)

  python3 -m foundation seedlaunch --e2e [--keep]     a fresh seed from seed/, launched, verified, then torn down (the reproducible proof)
  python3 -m foundation seedlaunch --fleet            every org repository created from the ultrastable/seed template
  python3 -m foundation seedlaunch --check            the latest e2e record passed and is newer than max_age_days (the required gate)

Every run appends one row to ops/seed-launches.jsonl. A failed stage is a blocked boot-log stage, and --check fails on it, which files the
failure-audit item (doctrine/detectors.json `seed-launch`) that the executor takes.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = "ops/seed-launches.jsonl"
REQUIRED = ("read", "qualify", "write", "provision", "year_gate", "verify_live")
MAX_AGE_DAYS = 8
TEMPLATE = "ultrastable/seed"


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def set_front(idea: str, **kv) -> str:
    """Set front-matter keys in IDEA.md text (added when absent)."""
    m = re.match(r"---\n(.*?)\n---\n", idea, re.S)
    if not m:
        return "---\n" + "".join(f"{k}: {v}\n" for k, v in kv.items()) + "---\n" + idea
    body = m.group(1)
    for k, v in kv.items():
        if re.search(rf"^{k}:.*$", body, re.M):
            body = re.sub(rf"^{k}:.*$", f"{k}: {v}", body, flags=re.M)
        else:
            body += f"\n{k}: {v}"
    return f"---\n{body}\n---\n" + idea[m.end():]


def verdict(boot_log: dict) -> dict:
    st = {s["stage"]: s for s in boot_log.get("stages", [])}
    missing = [n for n in REQUIRED if st.get(n, {}).get("status") != "ok"]
    return {"passed": not missing, "failed_stages": {n: (st.get(n) or {}).get("detail", "not run") for n in missing},
            "year": boot_log.get("year"), "live_url": boot_log.get("live_url")}


def _run(argv, cwd, timeout=900):
    exe = shutil.which(argv[0]) or argv[0]
    p = subprocess.run([exe] + argv[1:], cwd=cwd, capture_output=True, text=True, timeout=timeout)
    return p.returncode, (p.stdout + p.stderr).strip()


def _account_guard() -> str | None:
    """SINGLE-ACCOUNT-1: a seed is launched only into the ultrastable account (doctrine/single-account.json), never a retired one."""
    want = json.loads((ROOT / "doctrine" / "single-account.json").read_text())["required_account"]["id"]
    got = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    return None if got == want else f"CLOUDFLARE_ACCOUNT_ID is not the required account {want}; refusing to deploy"


def launch(seed_root: Path, label: str) -> dict:
    """Boot one seed checkout with --apply and judge it."""
    bad = _account_guard()
    if bad:
        return {"at": _now(), "kind": label, "exit": 2, "passed": False, "failed_stages": {"account": bad}}
    code, out = _run([sys.executable, "bootstrap/bootstrap.py", "--apply"], seed_root)
    log_p = seed_root / "org" / "boot-log.json"
    log = json.loads(log_p.read_text()) if log_p.exists() else {"stages": []}
    v = verdict(log)
    return {"at": _now(), "kind": label, "exit": code, **v, "report": out.splitlines()[-4:]}


def teardown(seed_root: Path) -> list[str]:
    """Remove what an e2e proof created (its Worker and D1); the record stays in the ledger. Each failure is recorded, never swallowed."""
    wr = json.loads(re.sub(r"^\s*//.*$", "", (seed_root / "worker" / "wrangler.jsonc").read_text(), flags=re.M))
    notes = []
    for argv in (["npx", "wrangler", "delete", "--name", wr["name"], "--force"],
                 ["npx", "wrangler", "d1", "delete", wr["d1_databases"][0]["database_name"], "-y"]):
        code, out = _run(argv, seed_root / "worker", timeout=300)
        notes.append(f"{' '.join(argv[1:4])}: {'ok' if code == 0 else 'exit ' + str(code) + ' ' + out[-200:]}")
    return notes


def e2e_oidc(root=ROOT, wait_s=660, run=None, sleep=None, coldstart_live=None) -> dict:
    """SEED-DEPLOY-2: the credential-free route. deploy/deploy-seed.mjs generates and admits each seed in doctrine/seed-deploys.json from the kernel
    (a fresh build every run), creates its D1 and deploys its Worker into the Ultrastable account through the site worker's OIDC endpoint; no stored
    Cloudflare token is read. /health answers 503 until the first complete tick, so the verify pass runs after one cron interval."""
    import time
    run = run or (lambda argv: _run(argv, root, timeout=900))
    sleep = sleep or time.sleep
    code, out = run(["node", "deploy/deploy-seed.mjs"])
    rows = [json.loads(x) for x in (Path(root) / "ops" / "deploys.jsonl").read_text().splitlines() if '"kind":"seed"' in x or '"kind": "seed"' in x]
    up = rows[-1] if rows else {}
    rec = {"at": _now(), "kind": "e2e", "route": "oidc", "slug": up.get("slug"), "year": {"p10": up.get("year_p10")}, "deploy_exit": code}
    if not up.get("uploaded") and up.get("error"):
        return {**rec, "passed": False, "failed_stages": {"provision": up["error"]}}
    if not up.get("live_ok"):
        sleep(wait_s)
        code, out = run(["node", "deploy/deploy-seed.mjs", "--verify"])
    ok = code == 0
    url = (up.get("url") or "") + "/health"
    failed = {} if ok else {"verify_live": out[-300:]}
    contract = []
    if ok and up.get("url"):  # COLDSTART-1: the proof is the whole cold-start contract (front end, discovery, graph, progress, content), not /health alone
        from . import coldstart
        contract = (coldstart_live or coldstart.live)(up["url"])
        miss = [f"{r['path']}: {r['why']}" for r in contract if not r["ok"]]
        if miss:
            failed["coldstart"] = "; ".join(miss)[:600]
    return {**rec, "passed": not failed and bool(up.get("year_p10")) and up["year_p10"] >= 365, "live_url": url,
            "coldstart": {r["capability"]: r["ok"] for r in contract}, "failed_stages": failed, "report": out.splitlines()[-3:]}


def e2e_scratch(root=ROOT, wait_s=660, run=None, sleep=None, stamp=None) -> dict:
    """BOOTPROOF-1: a slug no earlier run used, built from the kernel and deployed with a D1 created from zero through the OIDC route, then probed
    on /health. The standing seeds prove upkeep; this proves a new system comes up from code alone, every day."""
    import time
    stamp = stamp or dt.datetime.now(dt.timezone.utc).strftime("%m%d%H%M")
    slug = f"bootproof-{stamp}"
    work = Path(tempfile.mkdtemp(prefix="bootproof-"))
    inst = work / "instance.json"
    inst.write_text((Path(root) / "instances" / "second-tenant" / "instance.json").read_text())
    res = work / "result.json"
    res.write_text("[]")
    env = {**os.environ, "SEED_EXTRA": json.dumps([{"slug": slug, "instance": str(inst)}]), "SEED_ONLY_EXTRA": "1", "SEED_RESULT": str(res), "SEED_DEPLOY_OUT": str(work / "out")}
    run = run or (lambda argv: _run_env(argv, root, env))
    sleep = sleep or time.sleep
    code, out = run(["node", "deploy/deploy-seed.mjs"])
    rows = json.loads(res.read_text() or "[]")
    up = rows[-1] if rows else {}
    rec = {"at": _now(), "kind": "e2e", "route": "oidc-scratch", "slug": slug, "year": {"p10": up.get("year_p10")}, "deploy_exit": code}
    if not up.get("uploaded"):
        return {**rec, "passed": False, "failed_stages": {"provision": (up.get("error") or out[-300:])}}
    if not up.get("live_ok"):
        sleep(wait_s)
        url = up.get("url", "") + "/health"
        try:
            ok = urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "ultrastable-bootproof"}), timeout=30).status == 200
        except urllib.error.HTTPError as e:
            ok = False if e.code != 503 else None  # 503 with a JSON org body is the seed saying it has not completed a tick yet
        except OSError:
            ok = False
        up["live_ok"] = bool(ok)
    return {**rec, "passed": bool(up.get("live_ok")) and (up.get("year_p10") or 0) >= 365, "live_url": up.get("url", "") + "/health",
            "failed_stages": {} if up.get("live_ok") else {"verify_live": "scratch seed did not answer /health"}}


def _run_env(argv, cwd, env, timeout=900):
    r = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    return r.returncode, (r.stdout + r.stderr)


def e2e(keep=False, root=ROOT) -> dict:
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%m%d%H%M")
    work = Path(tempfile.mkdtemp(prefix="seed-e2e-"))
    seed = work / "seed"
    shutil.copytree(root / "seed", seed, ignore=shutil.ignore_patterns("__pycache__", "node_modules", "org"))
    idea = seed / "IDEA.md"
    idea.write_text(set_front(idea.read_text(), org_name=f"Seed E2E {stamp}", slug=f"seed-e2e-{stamp}", workers_dev="true", public_health_only="1"))
    rec = launch(seed, "e2e")
    rec["slug"] = f"seed-e2e-{stamp}"
    if "account" in (rec.get("failed_stages") or {}):
        return rec
    if not keep and (seed / "worker" / "wrangler.jsonc").exists():
        rec["teardown"] = teardown(seed)
    return rec


def _gh(path, token):
    req = urllib.request.Request("https://api.github.com" + path, headers={"authorization": "Bearer " + token, "accept": "application/vnd.github+json",
                                                                         "user-agent": "ultrastable-seed-launch"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def seeded_repos(org: str, token: str) -> list[str]:
    """Org repositories created from the seed template (each repo is read for template_repository)."""
    out, page = [], 1
    while True:
        batch = _gh(f"/orgs/{org}/repos?per_page=100&page={page}", token)
        for r in batch:
            if r.get("archived") or r["full_name"] == TEMPLATE:
                continue
            full = _gh(f"/repos/{r['full_name']}", token)
            if (full.get("template_repository") or {}).get("full_name") == TEMPLATE:
                out.append(r["full_name"])
        if len(batch) < 100:
            return out
        page += 1


def fleet(org="ultrastable", token=None) -> list[dict]:
    token = token or os.environ.get("GH_TOKEN", "")
    recs = []
    for repo in seeded_repos(org, token):
        work = Path(tempfile.mkdtemp(prefix="seed-fleet-"))
        code, out = _run(["git", "clone", "-q", "--depth", "1", f"https://x-access-token:{token}@github.com/{repo}.git", "s"], work, timeout=300)
        if code != 0:
            recs.append({"at": _now(), "kind": "fleet", "repo": repo, "passed": False, "failed_stages": {"clone": out[-200:].replace(token, "***")}})
            continue
        rec = launch(work / "s", "fleet")
        rec["repo"] = repo
        recs.append(rec)
    return recs


def append(recs, root=ROOT):
    p = Path(root) / LEDGER
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, sort_keys=True) + "\n")


def check(root=ROOT, now=None, max_age_days=MAX_AGE_DAYS) -> list[str]:
    p = Path(root) / LEDGER
    rows = [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
    e2es = [r for r in rows if r.get("kind") == "e2e"]
    if not e2es:
        return ["no e2e seed launch recorded (run seed-launch.yml)"]
    last = e2es[-1]
    errs = []
    if not last.get("passed"):
        errs.append(f"latest e2e seed launch failed: {last.get('failed_stages')}")
    age = ((now or dt.datetime.now(dt.timezone.utc)) - dt.datetime.strptime(last["at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)).days
    if age > max_age_days:
        errs.append(f"latest e2e seed launch is {age} days old (> {max_age_days})")
    for r in rows[-50:]:
        if r.get("kind") == "fleet" and not r.get("passed"):
            errs.append(f"seed {r.get('repo')} failed: {list((r.get('failed_stages') or {}).keys())}")
    return errs


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        e = check()
        print("seedlaunch ok" if not e else "\n".join(e))
        return 1 if e else 0
    recs = []
    if "--e2e-scratch" in a:
        recs.append(e2e_scratch())
    if "--e2e-oidc" in a:
        recs.append(e2e_oidc())
    elif "--e2e" in a:
        recs.append(e2e(keep="--keep" in a))
    if "--fleet" in a:
        recs += fleet()
    append(recs)
    for r in recs:
        print(json.dumps({k: r.get(k) for k in ("kind", "repo", "slug", "passed", "failed_stages", "year", "live_url", "teardown")}))
    return 0 if all(r.get("passed") for r in recs) else 1


if __name__ == "__main__":
    sys.exit(main())
