"""PLATFORM-AUDIT-1: the platform's own settings are measured against their declaration, every run, and drift is fixed or filed.

  python3 -m foundation platformaudit --probe      compare live GitHub repo settings, security and branch protection (github/org-settings.json)
                                                   and the live Cloudflare accounts (deploy/cloudflare-accounts.json, doctrine/topology.json); exit 1 on fixable drift
  python3 -m foundation platformaudit --apply      PATCH only the keys that drifted (idempotent), then probe again
  python3 -m foundation platformaudit --check      offline: the declaration itself is well formed and covers every repository in the topology of repos

Finding classes: DRIFT (live differs, fixable by --apply), GATED (the plan withholds the feature: recorded, not red), UNMEASURED (the token cannot read it:
never reported as passed), INFO (a cross-account or declaration fact the loop files as an item). Nothing is swallowed: every failed call is a finding.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CFG, ACCOUNTS = "github/org-settings.json", "deploy/cloudflare-accounts.json"
GATED_RE = re.compile(r"Upgrade to GitHub (Pro|Team)|not available for this repository|make this repository public")
SETTING_KEYS = {"has_issues", "has_projects", "has_wiki", "has_discussions", "allow_squash_merge", "allow_merge_commit", "allow_rebase_merge",
                "allow_auto_merge", "allow_update_branch", "delete_branch_on_merge", "squash_merge_commit_title", "squash_merge_commit_message", "is_template", "private"}  # DISCOVER-1: visibility is declared per repo
PROTECT_KEYS = {"allow_force_pushes": "allow_force_pushes", "allow_deletions": "allow_deletions", "required_linear_history": "required_linear_history"}


def load(root=REPO) -> dict:
    return json.loads((Path(root) / CFG).read_text(encoding="utf-8"))


def gh(path: str, method="GET", body=None):
    """(status, json|text). status 0 = could not run gh at all."""
    cmd = ["gh", "api", "-X", method, path] + (["--input", "-"] if body is not None else [])
    try:
        p = subprocess.run(cmd, input=json.dumps(body) if body is not None else None, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 0, str(e)
    if p.returncode == 0:
        try:
            return 200, json.loads(p.stdout) if p.stdout.strip() else {}
        except ValueError:
            return 200, p.stdout
    m = re.search(r"HTTP (\d{3})", p.stderr + p.stdout)
    return (int(m.group(1)) if m else 1), (p.stderr + p.stdout).strip()


def check(root=REPO) -> list[str]:
    c, bad = load(root), []
    for r, d in c["repos"].items():
        for k in d.get("settings", {}):
            if k not in SETTING_KEYS:
                bad.append(f"{r}: unknown setting {k}")
        if d.get("settings", {}).get("allow_merge_commit") or d.get("settings", {}).get("allow_rebase_merge"):
            bad.append(f"{r}: the merge lane squashes; merge commits and rebase merges must stay off")
        if not d.get("settings", {}).get("delete_branch_on_merge"):
            bad.append(f"{r}: delete_branch_on_merge must be true (no zombie branches)")
        if not d.get("security", {}).get("vulnerability_alerts"):
            bad.append(f"{r}: vulnerability_alerts must be true")
        if d.get("branch_protection", {}).get("allow_force_pushes") is not False:
            bad.append(f"{r}: force pushes must be declared off")
    return bad


def probe_repo(r: str, d: dict, fetch=gh) -> list[tuple[str, str, str]]:
    """Findings as (class, subject, message) for one repository."""
    out = []
    st, live = fetch(f"repos/{r}")
    if st != 200:
        return [("UNMEASURED", r, f"repo read failed HTTP {st}: {str(live)[:120]}")]
    if live.get("archived"):
        return [("INFO", r, "archived: skipped")]
    for k, want in d.get("settings", {}).items():
        if live.get(k) != want:
            out.append(("DRIFT", f"{r} {k}", f"live {live.get(k)!r}, declared {want!r}"))
    sec = d.get("security", {})
    sa = live.get("security_and_analysis")
    for k in ("secret_scanning", "secret_scanning_push_protection"):
        if sa is None:
            out.append(("GATED", f"{r} {k}", "not exposed (private repo on a plan without code security)"))
        elif sa.get(k, {}).get("status") != sec.get(k):
            out.append(("DRIFT", f"{r} {k}", f"live {sa.get(k, {}).get('status')!r}, declared {sec.get(k)!r}"))
    if sec.get("vulnerability_alerts"):
        s, _ = fetch(f"repos/{r}/vulnerability-alerts")
        if s == 404:
            out.append(("DRIFT", f"{r} vulnerability_alerts", "disabled, declared on"))
        elif s not in (200, 204):
            out.append(("UNMEASURED", f"{r} vulnerability_alerts", f"HTTP {s}"))
    if sec.get("automated_security_fixes"):
        s, b = fetch(f"repos/{r}/automated-security-fixes")
        if s == 200 and not (b or {}).get("enabled"):
            out.append(("DRIFT", f"{r} automated_security_fixes", "disabled, declared on"))
        elif s not in (200, 204):
            out.append(("UNMEASURED", f"{r} automated_security_fixes", f"HTTP {s}"))
    bp = d.get("branch_protection")
    if bp:
        br = bp["branch"]
        s, b = fetch(f"repos/{r}/branches/{br}/protection")
        if s == 200:
            for k in PROTECT_KEYS:
                have = b.get(k, {}).get("enabled") if isinstance(b.get(k), dict) else None
                if have is not None and have != bp[k]:
                    out.append(("DRIFT", f"{r} protect {br} {k}", f"live {have!r}, declared {bp[k]!r}"))
        elif s == 404:
            out.append(("DRIFT", f"{r} protect {br}", "branch is not protected"))
        elif s in (403, 422) and GATED_RE.search(str(b)):
            out.append(("GATED", f"{r} protect {br}", "plan feature: the merge lane's required checks enforce the rule instead"))
        else:
            out.append(("UNMEASURED", f"{r} protect {br}", f"HTTP {s}: {str(b)[:100]}"))
    return out


def probe_cloudflare(root=REPO, fetch=None) -> list[tuple[str, str, str]]:
    """Cross-account facts: where the declaration says the system runs versus where workers exist. `fetch(account_id)` -> list of worker names, or None if unreadable."""
    accts = json.loads((Path(root) / ACCOUNTS).read_text(encoding="utf-8"))
    topo = json.loads((Path(root) / "doctrine/topology.json").read_text(encoding="utf-8"))
    declared = {w["id"] for w in topo["workers"] if w["state"] == "live"}
    out = []
    if topo["account_id"] != accts["current"]["id"]:
        out.append(("DRIFT", "topology account", f"topology.json names {topo['account_id']} but cloudflare-accounts.json current is {accts['current']['id']}"))
    if fetch is None:
        return out + [("UNMEASURED", "cloudflare", "no fetch route bound: use `topology --drift` with CLOUDFLARE_API_TOKEN or the platform connector")]
    for label in ("target", "current"):
        a = accts[label]
        names = fetch(a["id"])
        if names is None:
            out.append(("UNMEASURED", f"cloudflare {label} {a['id'][:8]}", "account unreadable from this route"))
            continue
        have = declared & set(names)
        out.append(("INFO", f"cloudflare {label} {a['id'][:8]}", f"{len(have)}/{len(declared)} declared live workers present; {len(names)} workers total"))
        if label == "target" and have and topo["account_id"] != a["id"]:
            out.append(("DRIFT", "cloudflare cutover", f"{len(have)} declared workers run in the target account but topology.json still names {topo['account_id'][:8]}: move topology and D1 ids together"))
        if label == "target" and have and "not yet running" in a.get("state", ""):
            out.append(("DRIFT", "cloudflare-accounts target.state", "record says 'not yet running' but declared workers exist there"))
    return out


def apply(findings, fetch=gh, cfg=None) -> list[str]:
    cfg, done = cfg or load(), []
    repos = {}
    for cls, subj, _ in findings:
        if cls == "DRIFT":
            r, _, key = subj.partition(" ")
            repos.setdefault(r, []).append(key)
    for r, keys in repos.items():
        d = cfg["repos"].get(r)
        if not d:
            continue
        patch = {k: d["settings"][k] for k in keys if k in d["settings"]}
        if patch:
            s, b = fetch(f"repos/{r}", "PATCH", patch)
            done.append(f"{'ok  ' if s == 200 else 'FAIL'} {r} settings {sorted(patch)}" + ("" if s == 200 else f" HTTP {s}: {str(b)[:100]}"))
        if "vulnerability_alerts" in keys:
            s, _ = fetch(f"repos/{r}/vulnerability-alerts", "PUT")
            done.append(f"{'ok  ' if s in (200, 204) else 'FAIL'} {r} vulnerability_alerts")
        if "automated_security_fixes" in keys:
            s, _ = fetch(f"repos/{r}/automated-security-fixes", "PUT")
            done.append(f"{'ok  ' if s in (200, 204) else 'FAIL'} {r} automated_security_fixes")
        sec = {k: {"status": d["security"][k]} for k in ("secret_scanning", "secret_scanning_push_protection") if k in keys}
        if sec:
            s, b = fetch(f"repos/{r}", "PATCH", {"security_and_analysis": sec})
            done.append(f"{'ok  ' if s == 200 else 'FAIL'} {r} {sorted(sec)}")
        bp = d.get("branch_protection")
        if bp and any(k.startswith("protect ") for k in keys):
            body = {"required_status_checks": None, "enforce_admins": False, "required_pull_request_reviews": None, "restrictions": None,
                    **{k: bp[k] for k in PROTECT_KEYS}}
            s, b = fetch(f"repos/{r}/branches/{bp['branch']}/protection", "PUT", body)
            done.append(f"{'ok  ' if s == 200 else 'FAIL'} {r} protect {bp['branch']}" + ("" if s == 200 else f" HTTP {s}: {str(b)[:100]}"))
    return done


def probe(cfg=None, fetch=gh, cf_fetch=None, root=REPO) -> list[tuple[str, str, str]]:
    cfg = cfg or load(root)
    f = []
    for r, d in cfg["repos"].items():
        f += probe_repo(r, d, fetch)
    return f + probe_cloudflare(root, cf_fetch)


def main(argv) -> int:
    a = list(argv)
    if "--check" in a or not a:
        bad = check()
        print("\n".join(bad) if bad else f"platformaudit ok: {len(load()['repos'])} repositories declared")
        return 1 if bad else 0
    f = probe()
    if "--apply" in a:
        print("\n".join(apply(f)))
        f = probe()
    for cls, subj, msg in f:
        print(f"{cls:10} {subj}: {msg}")
    drift = [x for x in f if x[0] == "DRIFT"]
    print(f"findings: {len(f)} drift: {len(drift)} gated: {sum(x[0] == 'GATED' for x in f)} unmeasured: {sum(x[0] == 'UNMEASURED' for x in f)}")
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
