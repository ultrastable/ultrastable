"""CRITICALITY-1: the system's mantra as a computed invariant, run every tick.

  python3 -m foundation criticality --tick [--apply]   compute k, log to ops/criticality.jsonl, escalate a stalled tick
  python3 -m foundation criticality --check            the declaration and the mantra are intact (CI)
  python3 -m foundation criticality --gate             print the queue the executor may take under the current k
  python3 -m foundation criticality --origin <sha>     print who originated a commit: executor, self-agent, outside or unknown
  python3 -m foundation criticality --deploy-origin <sha> [--json]   origin of what a deploy carried live (DEPLOY-ORIGIN-2)

MANTRA = "Ship. Verify. Spend less than it earns. Feed the next loop."  Each clause is a check, not a sentence:
  Ship                         at least one deploy recorded in the window (ops/deploys.jsonl)
  Verify                       every deploy in the window had live code equal to its commit
  Spend less than it earns     normalized cost <= 1 (ops/cost.jsonl against ops/cost-thresholds.json)
  Feed the next loop           every declared flow lies on a feedback cycle (foundation.flows.check)
k = verified deploys in window / (normalized cost + human touches). When k < k_floor the executor's queue is filtered to items that raise deploys or cut cost.
Control rods: when normalized cost exceeds 1 the queue narrows further, to items that cut cost, until the cost guard reads under budget. chain = share of declared flows on a feedback cycle.
A tick whose state (the clause results and the numbers behind them) equals the previous tick's is a failure: it is logged as stalled and files Q-CRIT-STALL.
Ignition (QNFO-PORT-1): open_ignition_gaps is the number of links that do not close on themselves (relapsed items, families with no doer, metrics with no
lever left, guard regressions, unusable probes), written by foundation/sauce.py to ops/ignition.json. self_sustaining = k at or above its floor AND 0 gaps.

SELF-REFERENCE-1 (Rowan, 2026-11-14): "Ultrastable runs on Ultrastable. That self-reference is key to bootstrapping and criticality."
  bootstrap   the fixed point: the bootstrap that boots any system boots Ultrastable from this repository (foundation.selfhost.verify is empty)
  k_self      verified deploys the system originated and executed on itself / the same denominator as k. A deploy an outside session drove
              is an external neutron source: it raises k, never k_self. Origin is read from the deployed commit (origin_of) or the row's `origin`.
  regime      self-sustaining (bootstrap and k_self >= k_floor), driven (k >= k_floor, k_self below it), subcritical (k < k_floor)
In the driven regime the gate keeps every item but moves the ones that raise k_self (raises-self label or id prefix) to the front.
"""
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MANTRA = "Ship. Verify. Spend less than it earns. Feed the next loop."
CLAUSES = ("ship", "verify", "spend", "feed")
LOG = "ops/criticality.jsonl"


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / "doctrine/criticality.json").read_text(encoding="utf-8"))


def _rows(root, rel) -> list[dict]:
    p = Path(root) / rel
    out = []
    if p.is_file():
        for ln in p.read_text(encoding="utf-8").splitlines():
            if ln.strip():
                out.append(json.loads(ln))
    return out


def _ts(s: str) -> datetime:
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def normalized_cost(root=REPO) -> float:
    """Latest cost reading over its budget (foundation.cost): 1.0 is at budget; 0 when no reading exists yet."""
    from . import cost
    return cost.normalized(root)


def human_touches(root=REPO) -> int:
    """Open queue items held for the owner (ROWAN or identity-bound): every one is attention the loop did not close itself."""
    from . import queue
    return sum(1 for it in queue.items(root) if it["status"] == "open" and re.search(r"ROWAN|identity-bound", it["owner"], re.I))


def ignition(root=REPO) -> dict:
    """The latest ignition-gap reading (foundation/sauce.py). None when no pass has written one: an unmeasured chain is not a closed chain."""
    p = Path(root) / "ops/ignition.json"
    try:
        j = json.loads(p.read_text(encoding="utf-8"))
        return {"open_ignition_gaps": int(j["open_ignition_gaps"]), "at": j.get("at")}
    except (OSError, ValueError, KeyError, TypeError):
        return {"open_ignition_gaps": None, "at": None}
def origin_of(text: str | None, c: dict | None = None) -> str:
    """Who originated a deployed commit, from its message: executor (the server-side executor took an item from its own queue), self-agent
    (a handoff by the system's own code agent), outside (a person or an outside code-agent session), unknown (no message to read)."""
    if not text:
        return "unknown"
    sr = (c or cfg()).get("self_reference", {})
    mk = sr.get("markers", {})
    if mk.get("executor_re"):  # ORIGIN-MARKER-1: the executor writes the marker at the start of a line with its run time; prose that mentions it is not a run
        if re.search(mk["executor_re"], text):
            return "executor"
    elif mk.get("executor") and mk["executor"] in text:
        return "executor"
    m = re.search(mk.get("handoff_agent", r"(?m)^agent:\s*(\S+)"), text)
    if m and m.group(1).lower().startswith(tuple(sr.get("self_agents_prefixes", []))):
        return "self-agent"
    return "outside"


def commit_message(root, sha: str) -> str | None:
    """The full message of a commit in this clone, or None when the commit is not here (a shallow clone): None reads as origin unknown."""
    if not sha or not re.fullmatch(r"[0-9a-f]{7,40}", sha):
        return None
    r = subprocess.run(["git", "log", "-1", "--format=%B", sha], cwd=root, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 and r.stdout.strip() else None


def deploy_origin(root, row: dict, c: dict, before: list | None = None) -> str:
    """A row written since DEPLOY-ORIGIN-2 carries its origin. An older row is judged by what it carried when its commit is in this clone,
    and is unknown otherwise (never guessed from HEAD)."""
    if row.get("origin"):
        return row["origin"]
    sha = row.get("sha", "")
    if before is not None and commit_message(root, sha) is not None:
        return carried_origin(root, sha, before, c)["origin"]
    return origin_of(commit_message(root, sha), c)


SELF_RANK = {"executor": 3, "self-agent": 2, "outside": 1, "unknown": 0}


def _git(root, *a) -> str | None:
    r = subprocess.run(["git", *a], cwd=root, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def carried_origin(root=REPO, sha: str = "", deploys: list | None = None, c: dict | None = None) -> dict:
    """DEPLOY-ORIGIN-2: who originated the change a deploy put live. A deploy runs on whatever commit is newest when it starts, which is usually
    a bookkeeping commit (regen-generated, a recorded deploy, a ledger), so reading only that commit's message called every executor change
    'outside' or 'unknown'. The deploy carries every substantive commit since the previous deployed commit; its origin is the most self-made
    of them (executor > self-agent > outside). A sha this clone does not have falls back to HEAD; no readable commit is unknown, never self."""
    c = c or cfg(root)
    root = Path(root)
    if not (sha and re.fullmatch(r"[0-9a-f]{7,40}", sha) and _git(root, "cat-file", "-e", sha + "^{commit}") is not None):
        sha = (_git(root, "rev-parse", "HEAD") or "").strip()
    if not sha:
        return {"origin": "unknown", "sha": "", "carried": []}
    rows = deploys if deploys is not None else _rows(root, "ops/deploys.jsonl")
    prev = None
    for r in reversed(rows):
        for k in ("main_sha", "sha"):
            s = r.get(k) or ""
            if s and s != sha and re.fullmatch(r"[0-9a-f]{7,40}", s) and _git(root, "merge-base", "--is-ancestor", s, sha) is not None:
                prev = s; break
        if prev:
            break
    log = _git(root, "log", "--format=%H%x1f%B%x1e", f"{prev}..{sha}" if prev else "-1", *([] if prev else [sha])) or ""
    carried = []
    for chunk in log.split("\x1e"):
        if "\x1f" not in chunk:
            continue
        h, msg = chunk.strip().split("\x1f", 1)
        first = msg.strip().splitlines()[0] if msg.strip() else ""
        if not first or "[skip ci]" in first:
            continue  # bookkeeping commits carry no change of their own
        carried.append({"sha": h[:12], "origin": origin_of(msg, c)})
    best = max((x["origin"] for x in carried), key=lambda o: SELF_RANK.get(o, 0), default="unknown")
    return {"origin": best, "sha": sha, "since": prev, "carried": carried[:50], "omitted": max(0, len(carried) - 50)}


def bootstrap_holds(root=REPO) -> bool | None:
    """The fixed point. None when the tree declares no self-hosting registry (a scratch or seed tree), so it is not judged."""
    if not (Path(root) / "instances/ultrastable/selfhost.json").is_file():
        return None
    from . import selfhost
    try:
        return not selfhost.verify(root)
    except (OSError, KeyError, ValueError):
        return False  # a broken registry is a broken fixed point


def compute(root=REPO, now: datetime | None = None, feed_ok: bool | None = None) -> dict:
    c, now = cfg(root), now or datetime.now(timezone.utc)
    since = now - timedelta(hours=c["window_hours"])
    allrows = _rows(root, "ops/deploys.jsonl")
    dep = [r for r in allrows if r.get("at") and _ts(r["at"]) >= since]
    verified = [r for r in dep if r.get("uploaded") and r.get("live_matches_commit")]
    cost, touches = normalized_cost(root), human_touches(root)
    if feed_ok is None:
        from . import flows
        feed_ok = not flows.check(root)
    sr = c.get("self_reference", {})
    origins = {}
    pos = {id(r): i for i, r in enumerate(allrows)}
    seen = {}
    for r in verified:
        key = (r.get("origin"), r.get("sha"))
        if key not in seen:  # one git walk per deployed commit, not per worker
            seen[key] = deploy_origin(root, r, c, allrows[:pos.get(id(r), 0)] if id(r) in pos else None)
        o = seen[key]; origins[o] = origins.get(o, 0) + 1
    # REDTEAM-1 (phantom touches): a deploy an outside session drove is a human touch, not a self-run; counting only owner-held items read 0
    # k keeps its held-item denominator (the regime gate steers the executor); the reported count is the honest one
    denom = max(cost, c["cost_floor"]) + touches
    touches += origins.get("outside", 0)
    k = round(len(verified) / denom, 3)
    self_n = sum(n for o, n in origins.items() if o in sr.get("self_origins", ()))
    k_self, boot = round(self_n / denom, 3), bootstrap_holds(root)
    regime = "subcritical" if k < c["k_floor"] else "self-sustaining" if k_self >= c["k_floor"] and boot is not False else "driven"
    clauses = {"ship": len(dep) >= 1, "verify": len(dep) == len(verified), "spend": cost <= 1.0, "feed": bool(feed_ok)}
    from . import flows as _fl
    try:
        g = _fl.graph(_fl.load(root)[0]); chain = round(len(g["closed"]) / max(len(_fl.load(root)[0]["flows"]), 1), 3)
    except (OSError, KeyError, ValueError):
        chain = 0.0  # no declared flow graph: the chain reaction cannot be shown
    ig = ignition(root)
    return {"chain": chain, "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "mantra": MANTRA, "deploys": len(dep), "verified_deploys": len(verified),
            "cost": cost, "human_touches": touches, "k": k, "clauses": clauses, "gate": "deploys-and-cost-only" if k < c["k_floor"] else "open",
            "open_ignition_gaps": ig["open_ignition_gaps"], "self_sustaining": k >= c["k_floor"] and ig["open_ignition_gaps"] == 0,
            "self_deploys": self_n, "origins": origins, "k_self": k_self, "self_share": round(self_n / len(verified), 3) if verified else 0.0,
            "bootstrap": boot, "regime": regime}


def state_hash(r: dict) -> str:
    keep = {k: r.get(k) for k in ("chain", "deploys", "verified_deploys", "cost", "human_touches", "k", "clauses", "open_ignition_gaps", "k_self", "bootstrap")}
    return hashlib.sha256(json.dumps(keep, sort_keys=True).encode()).hexdigest()[:16]


def tick(root=REPO, apply=False, now=None, feed_ok=None) -> dict:
    root = Path(root)
    r = compute(root, now, feed_ok)
    prev = _rows(root, LOG)
    r["state"] = state_hash(r)
    r["stalled"] = bool(prev) and prev[-1].get("state") == r["state"]
    if apply:
        with (root / LOG).open("a", encoding="utf-8") as f:
            f.write(json.dumps(r) + "\n")
        if r["stalled"]:
            c = cfg(root); p = root / "docs/issues" / (c["stall_item"] + ".json")
            if not p.exists():
                p.write_text(json.dumps({"id": c["stall_item"], "title": f"{c['stall_item']}: a tick changed no state; the mantra is not being fed",
                    "body": "**Owner:** executor\n**Trigger:** two consecutive criticality ticks with identical state\n**Done check:** cmd:python3 -m foundation criticality --check\n**Status:** open\n\nIdentify which clause has not moved (ops/criticality.jsonl) and ship a deploy or a cost cut that moves it.\n\nsize: S\n\n**Closing probe:** python3 -m foundation criticality --check",
                    "labels": ["p0", "agent-ready", "raises-deploys"], "milestone": "Now", "workstream": "deploys"}, indent=2) + "\n", encoding="utf-8")
    return r


def raises(item: dict, c: dict) -> bool:
    labels = {(l["name"] if isinstance(l, dict) else l) for l in item.get("labels", [])}
    return bool(labels & set(c["raises_labels"])) or str(item.get("number", "")).startswith(tuple(c["raises_id_prefixes"]))


def raises_self(item: dict, c: dict) -> bool:
    sr = c.get("self_reference", {})
    labels = {(l["name"] if isinstance(l, dict) else l) for l in item.get("labels", [])}
    return bool(labels & set(sr.get("raises_self_labels", []))) or str(item.get("number", "")).startswith(tuple(sr.get("raises_self_id_prefixes", [])))


def gate(items: list[dict], root=REPO, now: datetime | None = None) -> list[dict]:
    """The queue under the invariant: with k below the floor only items that raise deploys or cut cost may be taken (features are deferred).
    When none qualify the full list is returned so the queue cannot starve; that fallback is itself logged by the tick as a clause failure."""
    if not (Path(root) / "doctrine/criticality.json").is_file():
        return items  # a scratch or seed tree without the invariant declared is not gated
    c = cfg(root)
    r = compute(root, now=now, feed_ok=True)  # k does not depend on the feed clause
    if r["cost"] > 1.0:  # control rods: cost has run away, so only items that cut cost may be taken until the guard reads under budget
        rods = [i for i in items if "cuts-cost" in {(l["name"] if isinstance(l, dict) else l) for l in i.get("labels", [])} or str(i.get("number", "")).startswith("Q-COST")]
        return rods or items
    if r["k"] >= c["k_floor"]:
        if r["regime"] == "driven":  # critical only on an outside source: the work that lets the system ship on itself goes first, nothing is dropped
            return [i for i in items if raises_self(i, c)] + [i for i in items if not raises_self(i, c)]
        return items
    kept = [i for i in items if raises(i, c)]
    return kept or items


def check(root=REPO) -> list[str]:
    errs, c = [], cfg(root)
    if MANTRA != "Ship. Verify. Spend less than it earns. Feed the next loop.":
        errs.append("mantra changed")
    if len(MANTRA.rstrip(".").split(". ")) != len(CLAUSES):
        errs.append("mantra clauses and computed checks differ")
    for k in ("k_floor", "cost_floor", "raises_labels", "stall_item", "window_hours", "self_reference"):
        if k not in c:
            errs.append("missing " + k)
    sr = c.get("self_reference", {})
    for k in ("markers", "self_origins", "self_agents_prefixes", "raises_self_labels", "raises_self_id_prefixes"):
        if k not in sr:
            errs.append("self_reference missing " + k)
    if bootstrap_holds(root) is False:
        errs.append("bootstrap fixed point broken: python3 -m foundation selfhost --verify reports findings")
    r = compute(root, feed_ok=True)
    if set(r["clauses"]) != set(CLAUSES):
        errs.append("a clause has no check")
    return errs


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check(); print("\n".join(e) or "criticality ok: " + MANTRA); return 1 if e else 0
    if "--tick" in a:
        r = tick(apply="--apply" in a); print(json.dumps(r, indent=2)); return 1 if r["stalled"] and "--apply" not in a else 0  # applied: the stall is logged and filed as an item, which is the escalation
    if "--deploy-origin" in a:
        i = a.index("--deploy-origin"); r = carried_origin(REPO, a[i + 1] if i + 1 < len(a) else "")
        print(json.dumps(r) if "--json" in a else r["origin"]); return 0
    if "--origin" in a:
        i = a.index("--origin"); sha = a[i + 1] if i + 1 < len(a) else ""
        print(origin_of(commit_message(REPO, sha))); return 0
    if "--gate" in a:
        from . import queue
        print(json.dumps([i["number"] for i in gate(queue.takeable())])); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())
