"""The code loops. Each role's tick: read state, propose, act through the runtime, verify from the
ledger, log a prediction and an outcome. One call to run_tick runs all four and returns the four-line
report. Nothing here runs unless a plugin is enabled, and dry-run is the default."""
import json
from pathlib import Path
from .api import Runtime
from .selfdescribe import plugin as selfd
from .social import plugin as social
from .email import plugin as email


def _append(rt, name, rec):
    with open(rt.dir / name, "a") as f: f.write(json.dumps(rec) + "\n")


def _predict(rt, metric, op, n, hours): _append(rt, "predictions.jsonl", {"at": int(rt.now()), "p": f"{metric} {op} {n} within {hours} h"})
def _outcome(rt, role, cls, ok): _append(rt, "outcomes.jsonl", {"at": int(rt.now()), "surface": "plugin:" + role, "action_class": cls, "result": "verified" if ok else "failed"})


def branding_tick(rt, root):
    """Regenerate the self-description; a changed file is the only action."""
    before = selfd.check(root)
    selfd.write(root)
    _predict(rt, "self_description_drift", "=", 0, 24); _outcome(rt, "branding", "describe_self", True)
    return {"role": "branding", "did": "self-description regenerated" + (" (it had drifted)" if before else " (no drift)"), "refused": 0}


def marketing_tick(rt, root, adapters=None):
    """Post the next approved public sentence not yet posted, to each configured adapter, at most the cadence allows."""
    approved = selfd.approved_text(root)
    rt.guard_sources = approved
    ledger = rt.dir / "ledger.jsonl"
    posted = {json.loads(l)["text"] for l in ledger.read_text().splitlines() if '"publish_public"' in l and '"sent"' in l} if ledger.exists() else set()
    nxt = next((t for t in approved if t[:280] not in posted), None)
    did, refused = [], 0
    if nxt and len(nxt) <= 280:
        for ad in adapters or [a for a in social.ADAPTERS if rt.pcfg("social")["adapter_config"].get("adapter") == a]:
            r = social.publish(rt, ad, nxt)
            did.append(f"{ad}: {r.status}"); refused += r.status == "refused"; _outcome(rt, "marketing", "publish_public", r.ok)
    _predict(rt, "social_posts_refused_24h", "=", 0, 24)
    return {"role": "marketing", "did": "; ".join(did) or "nothing due (no enabled adapter or no unposted approved text)", "refused": refused}


def outreach_tick(rt, root):
    from .mailing_list import plugin as ml
    sent = refused = 0
    for q in sorted((Path(root) / "comms/campaigns").glob("*.json")) if (Path(root) / "comms/campaigns").exists() else []:
        c = json.loads(q.read_text())
        if c.get("status") != "queued": continue
        for _, r in ml.campaign(rt, c["list"], c["subject"], c["body"]):
            sent += r.ok; refused += r.status == "refused"
        c["status"] = "done"; q.write_text(json.dumps(c, indent=1))
        _outcome(rt, "outreach", "send_to_person", refused == 0)
    _predict(rt, "outreach_refused_24h", "=", 0, 24)
    return {"role": "outreach", "did": f"{sent} message(s) handled (dry-run or sent)", "refused": refused}


def communications_tick(rt, root, report=None):
    """Deliver the four-line report to the owner's configured address, if the email plugin is enabled."""
    to = rt.pcfg("email")["adapter_config"].get("report_to")
    if not (to and report): return {"role": "communications", "did": "no report address configured", "refused": 0}
    r = email.send(rt, to, "Four-line report", report)
    _outcome(rt, "communications", "send_to_person", r.ok)
    return {"role": "communications", "did": f"report to configured address: {r.status}", "refused": r.status == "refused"}


def run_tick(rt, root):
    parts = [branding_tick(rt, root), marketing_tick(rt, root), outreach_tick(rt, root)]
    report = "\n".join([
        "what happened: " + "; ".join(f"{p['role']}: {p['did']}" for p in parts),
        "what I decided: every external action went through the scope gate; dry-run unless a reviewed PR set live",
        "what is next: the next tick; enabled plugins act within their caps",
        f"what is open: {sum(p['refused'] for p in parts)} refused action(s), see plugin-state/ledger.jsonl",
    ])
    parts.append(communications_tick(rt, root, report))
    return {"parts": parts, "report": report}
