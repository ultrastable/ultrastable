# SPDX-License-Identifier: LicenseRef-Ultrastable
# KERNEL-LOCK-1 (ZHC-R8, R9): the kernel is written once, in seed/; each tenant pins the kernel it runs.
#   python3 -m foundation kernellock --check   every non-retired tenant has a row, one canary, pins are tree hashes of seed/ or null
#   python3 -m foundation kernellock --hash    the tree hash of seed/ at HEAD (what a pin names)
#   python3 -m foundation kernellock --bump [--apply]  the canary takes the current kernel first; the rest only when the canary is on it (R9)
#   python3 -m foundation kernellock --open-pr [--apply]  R9 pin-PR opener: the canary repo gets a kernel.lock PR for the current kernel; once its
#       main holds that pin, the row here is written (the PR merged, so the rest may follow). Run daily by tenant-sync.yml with LANE_PAT.
#   python3 -m foundation kernellock --status  per tenant: pinned to current, behind, or unpinned; the canary is listed first
import base64, json, os, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = "doctrine/kernel-lock.json"
HASH = re.compile(r"^[0-9a-f]{40}$")


def load(root=ROOT):
    return json.loads((Path(root) / LOCK).read_text())


def kernel_hash(root=ROOT, ref="HEAD"):
    r = subprocess.run(["git", "rev-parse", f"{ref}:seed"], cwd=root, capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError("cannot read the seed/ tree: " + r.stderr.strip()[:120])
    return r.stdout.strip()


def live_tenants(root=ROOT):
    t = json.loads((Path(root) / "doctrine" / "tenant-repos.json").read_text())["tenants"]
    return sorted(k for k, v in t.items() if v.get("state") != "retired")


def check(root=ROOT):
    lock, errs = load(root), []
    rows = lock.get("tenants", {})
    for t in live_tenants(root):
        if t not in rows: errs.append(f"tenant {t} has no row in {LOCK}")
    for t, v in rows.items():
        if v.get("pin") is not None and not HASH.match(str(v["pin"])): errs.append(f"{t}: pin {v['pin']!r} is not a tree hash or null")
    if lock.get("canary") not in rows: errs.append("canary must name a tenant row")
    return errs


def status(root=ROOT, current=None):
    lock, cur = load(root), current or kernel_hash(root)
    out = []
    for t, v in sorted(lock["tenants"].items(), key=lambda kv: (kv[0] != lock.get("canary"), kv[0])):
        p = v.get("pin")
        out.append({"tenant": t, "canary": t == lock.get("canary"), "state": "unpinned" if p is None else "current" if p == cur else "behind"})
    return out


def live_ok(root, tenant):
    """A tenant takes a pin only once it exists as a repository (state own-repo, moving or moved); planned ones wait."""
    t = json.loads((Path(root) / "doctrine" / "tenant-repos.json").read_text())["tenants"].get(tenant, {})
    return t.get("state") in ("own-repo", "moving", "moved")


def bump(root=ROOT, current=None):
    """The next pin changes: the canary first; the rest only once the canary is on the current kernel. Returns {tenant: new pin} (empty when nothing moves)."""
    lock, cur = load(root), current or kernel_hash(root)
    rows, canary = lock["tenants"], lock["canary"]
    if rows[canary].get("pin") != cur: return {canary: cur}
    return {t: cur for t, v in rows.items() if v.get("pin") != cur and live_ok(root, t)}


def apply_bump(root=ROOT, current=None):
    moves = bump(root, current)
    if moves:
        lock = load(root)
        for t, pin in moves.items(): lock["tenants"][t]["pin"] = pin
        (Path(root) / LOCK).write_text(json.dumps(lock, indent=2) + "\n")
    return moves


def _gh(args, token=None):
    env = {**os.environ, **({"GH_TOKEN": token} if token else {})}
    r = subprocess.run(["gh", "api", *args], capture_output=True, text=True, env=env)
    return r.returncode, r.stdout.strip()


def lock_body(pin, commit):
    return json.dumps({"_doc": "KERNEL-LOCK-1: the platform kernel this system runs. Opened by kernellock --open-pr in ultrastable/ultrastable.",
                       "platform": "ultrastable/ultrastable", "seed_tree": pin, "platform_commit": commit}, indent=2) + "\n"


def tenant_pin(repo, gh=_gh, ref="main"):
    rc, out = gh([f"repos/{repo}/contents/kernel.lock?ref={ref}", "--jq", ".content"])
    if rc != 0 or not out: return None
    try: return json.loads(base64.b64decode(out)).get("seed_tree")
    except ValueError: return None


def open_pr(root=ROOT, apply=False, gh=_gh, current=None, commit=None):
    """One step of the canary pin loop. Returns what it did: synced | opened | open | none."""
    lock, cur = load(root), current or kernel_hash(root)
    canary = lock["canary"]
    if lock["tenants"][canary].get("pin") == cur: return {"action": "none", "tenant": canary}
    repo = json.loads((Path(root) / "doctrine" / "tenant-repos.json").read_text())["tenants"][canary]["repo"]
    if tenant_pin(repo, gh) == cur:  # the pin PR merged in the canary: record it so the rest may follow
        if apply:
            lock["tenants"][canary]["pin"] = cur; (Path(root) / LOCK).write_text(json.dumps(lock, indent=2) + "\n")
        return {"action": "synced", "tenant": canary, "pin": cur}
    br = f"agent/kernel-lock-{cur[:12]}"
    if tenant_pin(repo, gh, ref=br) == cur: return {"action": "open", "tenant": canary, "branch": br}
    if not apply: return {"action": "would-open", "tenant": canary, "branch": br}
    commit = commit or subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True).stdout.strip()
    tok = os.environ.get("LANE_PAT") or None
    rc, base = gh([f"repos/{repo}/git/ref/heads/main", "--jq", ".object.sha"], tok)
    if rc != 0: return {"action": "failed", "tenant": canary, "why": "cannot read main"}
    gh([f"repos/{repo}/git/refs", "-f", f"ref=refs/heads/{br}", "-f", f"sha={base}"], tok)
    rc, sha = gh([f"repos/{repo}/contents/kernel.lock?ref={br}", "--jq", ".sha"], tok)
    put = [f"repos/{repo}/contents/kernel.lock", "-X", "PUT", "-f", f"message=kernel.lock: pin platform kernel {cur[:12]} (KERNEL-LOCK-1)",
           "-f", f"branch={br}", "-f", "content=" + base64.b64encode(lock_body(cur, commit).encode()).decode()] + (["-f", f"sha={sha}"] if rc == 0 and sha else [])
    if gh(put, tok)[0] != 0: return {"action": "failed", "tenant": canary, "why": "cannot write kernel.lock"}
    body = (f"## Handoff\nitem: ZHC-R9\nagent: kernellock --open-pr\nverify: kernel.lock seed_tree == {cur}\ndeploy: none\n\n"
            "Pins this system to the current platform kernel. The canary takes it first; the other tenants follow once this merges.")
    rc, n = gh([f"repos/{repo}/pulls", "-f", f"title=Pin platform kernel {cur[:12]}", "-f", f"head={br}", "-f", "base=main", "-f", f"body={body}", "--jq", ".number"], tok)
    if rc == 0: gh([f"repos/{repo}/issues/{n}/labels", "-f", "labels[]=handoff"], tok)
    return {"action": "opened" if rc == 0 else "failed", "tenant": canary, "branch": br, "pr": n if rc == 0 else None}


def main(argv=None):
    a = list(argv or [])
    if "--bump" in a:
        moves = apply_bump() if "--apply" in a else bump()
        for t, p in moves.items(): print(f"{t}: pin -> {p[:12]}")
        print(f"kernellock: {len(moves)} pin(s) {'written' if '--apply' in a else 'would move'}"); return 0
    if "--open-pr" in a:
        r = open_pr(apply="--apply" in a); print(json.dumps(r)); return 1 if r["action"] == "failed" else 0
    if "--hash" in a: print(kernel_hash()); return 0
    if "--status" in a:
        for r in status(): print(f"{r['tenant']}: {r['state']}{' (canary)' if r['canary'] else ''}")
        return 0
    errs = check(); print("\n".join(errs) if errs else "kernellock ok"); return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
