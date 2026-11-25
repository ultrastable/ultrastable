# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PROVENANCE-1: where every input and change came from, what it touched, what it did. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation provenance [--check | --record JSON | --settle ID kept|reverted|none [NOTE] | --ingest-git [--since REV] [--apply]
                                    | --timeline [--tenant T] [--origin C] | --changelog [--apply] | --lessons | --signal
                                    | --prov [--tenant T] | --cloudevents [--tenant T]]
STANDARDS  OPEN-STANDARDS-1: `--prov` exports the ledger as W3C PROV-JSON and `--cloudevents` as CloudEvents 1.0 JSON Lines, through the
        shared engine seed/scripts/openstd.py, so any PROV or CloudEvents consumer reads it without a custom parser.

SCHEMA  one JSON row per fact in ops/provenance.jsonl (append-only, event-sourced through foundation/ledger.py): id, at, tenant, origin {class, actor, channel},
        kind, summary, ref, affected[], effect {status, metric, note}, public, parent. A settlement row names its parent and carries the measured effect.
PUBLIC  `public_view` keeps only rows with public=true, redacts contact details, tokens and query strings, caps the summary, and drops everything else (ops/changelog.json).
LEARN   `lessons` is the kept/reverted rate per (origin class, actor, affected area); `signal` is the share of settled changes that were kept, read by
        doctrine/self-improvement.json (signal change-effect). A lever with min_settled settled rows and a rate under retire_below is retired; over reinforce_above is reinforced.
Doctrine: doctrine/provenance.json. Tests: tests/foundation/test_provenance.py. Dashboard: dashboard/worker.js (/changelog, owner panel). Tenants write the same schema.
"""
from __future__ import annotations
import hashlib, json, re, subprocess, sys, time
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/provenance.json"

_RED = [
    ("email", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")),
    ("token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}|[A-Fa-f0-9]{32,})\b")),
    ("ip", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    ("phone", re.compile(r"(?<!\w)\+?\d[\d\s().-]{8,}\d(?!\w)")),
    ("url_query", re.compile(r"(https?://[^\s?#]+)\?[^\s#]*")),
]


def load(root=REPO) -> dict:
    p = Path(root) / PATH
    return json.loads((p if p.is_file() else REPO / PATH).read_text(encoding="utf-8"))


def redact(text: str, cfg: dict | None = None) -> str:
    cfg = cfg or load()
    out = str(text or "")
    for name, rx in _RED:
        if name in cfg["redact"]:
            out = rx.sub(r"\1" if name == "url_query" else "[removed]", out)
    return re.sub(r"\s+", " ", out).strip()


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def make(origin: dict, kind: str, summary: str, *, tenant="ultrastable", ref="", affected=(), effect=None, public=False, parent="", at=None, cfg=None) -> dict:
    cfg = cfg or load()
    cls = origin.get("class")
    if cls not in cfg["origin_classes"]:
        raise ValueError(f"origin class {cls!r} not in {sorted(cfg['origin_classes'])}")
    if not origin.get("actor"):
        raise ValueError("origin needs an actor (loop id, 'owner', agent name or tenant surface)")
    if origin.get("channel") not in cfg["channels"]:
        raise ValueError(f"channel {origin.get('channel')!r} not in {cfg['channels']}")
    if kind not in cfg["kinds"]:
        raise ValueError(f"kind {kind!r} not in {cfg['kinds']}")
    eff = {"status": "pending", **(effect or {})}
    if eff["status"] not in cfg["effects"]:
        raise ValueError(f"effect {eff['status']!r} not in {cfg['effects']}")
    row = {"at": at or _now(), "tenant": tenant, "origin": {"class": cls, "actor": str(origin["actor"]), "channel": origin["channel"]}, "kind": kind,
           "summary": str(summary).strip(), "ref": str(ref), "affected": sorted({str(a) for a in affected}), "effect": eff, "public": bool(public), "parent": parent}
    if not row["summary"]:
        raise ValueError("a provenance row needs a summary")
    row["id"] = "pv-" + hashlib.sha256(json.dumps({k: row[k] for k in ("tenant", "origin", "kind", "summary", "ref", "parent", "at")}, sort_keys=True).encode()).hexdigest()[:12]
    return row


def record(root, row_or_origin, *a, **kw) -> dict:
    """Append one row (a dict from make(), or the make() arguments). Identical rows are not written twice."""
    row = row_or_origin if isinstance(row_or_origin, dict) and "id" in row_or_origin else make(row_or_origin, *a, **kw)
    led = Path(root) / load(root)["ledger"]
    led.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(row, sort_keys=True, ensure_ascii=False)
    if led.is_file() and any(l == line for l in led.read_text(encoding="utf-8").splitlines()):
        return row
    with led.open("a", encoding="utf-8", newline="\n") as f:
        f.write(line + "\n")
    return row


def settle(root, pid: str, status: str, note="", metric="") -> dict:
    parent = next((r for r in entries(root, raw=True) if r["id"] == pid), None)
    if not parent:
        raise ValueError(f"no provenance row {pid}")
    return record(root, make(parent["origin"], "settlement", f"{parent['summary'][:120]}: {status}", tenant=parent["tenant"], ref=parent["ref"], affected=parent["affected"],
                             effect={"status": status, "metric": metric, "note": note}, public=parent["public"], parent=pid))


def entries(root=REPO, raw=False) -> list:
    """Rows oldest first. By default a settlement is folded into its parent (the parent's effect becomes the settled one) and not listed twice."""
    from . import ledger
    rows = ledger.rows(root, load(root)["ledger"], branch=False)
    if raw:
        return rows
    by = {r["id"]: dict(r) for r in rows if r["kind"] != "settlement"}
    for r in rows:
        if r["kind"] == "settlement" and r["parent"] in by:
            by[r["parent"]]["effect"] = r["effect"]; by[r["parent"]]["settled_at"] = r["at"]
    return sorted(by.values(), key=lambda r: r["at"])


def timeline(root=REPO, tenant=None, origin=None, since=None) -> list:
    return [r for r in entries(root) if (not tenant or r["tenant"] == tenant) and (not origin or r["origin"]["class"] == origin) and (not since or r["at"] >= since)]


def public_view(rows: list, cfg: dict | None = None, limit=200) -> dict:
    cfg = cfg or load()
    cap = cfg["max_public_summary"]
    out = [{"id": r["id"], "at": r["at"], "tenant": r["tenant"], "origin": r["origin"]["class"], "channel": r["origin"]["channel"],
            "actor": r["origin"]["actor"] if r["origin"]["class"] in ("loop", "system", "agent") else r["origin"]["class"],
            "kind": r["kind"], "summary": redact(r["summary"], cfg)[:cap], "affected": [redact(a, cfg)[:80] for a in r["affected"]][:8], "effect": r["effect"]["status"]}
           for r in rows if r.get("public")]
    out = out[-limit:][::-1]
    by_origin = defaultdict(int)
    for r in out:
        by_origin[r["origin"]] += 1
    return {"schema": "ultrastable-changelog/v1", "origin_classes": cfg["origin_classes"], "counts_by_origin": dict(by_origin), "entries": out}


def changelog(root=REPO, tenant=None) -> dict:
    return public_view([r for r in entries(root) if not tenant or r["tenant"] == tenant])


def settle_due(root=REPO, now=None, window_days=7) -> list:
    """SELF-IMPROVE VERIFY for provenance: a pending change older than the window is kept unless a later git commit reverts it (subject 'Revert' naming its ref or title)."""
    now = now or time.time()
    try:
        reverts = subprocess.run(["git", "-C", str(root), "log", "--grep=^Revert", "-i", "--pretty=%s", "-n", "300"], capture_output=True, text=True, encoding="utf-8", timeout=60).stdout.lower()
    except (OSError, subprocess.SubprocessError):
        reverts = ""
    done = []
    for r in entries(root):
        if r["kind"] != "change" or r["effect"]["status"] != "pending":
            continue
        age = now - time.mktime(time.strptime(r["at"][:19], "%Y-%m-%dT%H:%M:%S"))
        if age < window_days * 86400:
            continue
        hit = (r["ref"] and r["ref"].lower() in reverts) or r["summary"].lower()[:60] in reverts
        done.append(settle(root, r["id"], "reverted" if hit else "kept", "settled after the window by git history", metric="git-revert"))
    return done


def lessons(root=REPO) -> list:
    cfg = load(root)["improve"]
    g = defaultdict(lambda: {"kept": 0, "reverted": 0, "none": 0, "pending": 0})
    for r in entries(root):
        key = (r["origin"]["class"], r["origin"]["actor"], (r["affected"] or ["-"])[0].split("/")[0])
        g[key][r["effect"]["status"]] += 1
    out = []
    for (cls, actor, area), c in sorted(g.items()):
        settled = c["kept"] + c["reverted"]
        rate = c["kept"] / settled if settled else None
        verdict = "learning" if settled < cfg["min_settled"] else "retire" if rate < cfg["retire_below"] else "reinforce" if rate > cfg["reinforce_above"] else "hold"
        out.append({"origin": cls, "actor": actor, "area": area, **c, "kept_rate": None if rate is None else round(rate, 3), "verdict": verdict})
    return out


def signal(root=REPO):
    """Share of settled changes that were kept; None until something is settled (no reading is not a pass)."""
    rs = [r for r in entries(root) if r["effect"]["status"] in ("kept", "reverted")]
    return round(sum(r["effect"]["status"] == "kept" for r in rs) / len(rs), 3) if rs else None


def classify(subject: str, body: str, branch: str, cfg: dict) -> tuple:
    text = subject + "\n" + body
    for rule in cfg["git_rules"]:
        if rule["match"].lower() in text.lower():
            return rule["class"], rule["channel"], ""
    return "agent", "commit", ""


# CHANGELOG-FRESH-1: record-keeping commits (data refreshes, anchors, probes) are not public changes.
_NOISE = re.compile(r"\[skip ci\]|^(host-sync|audit anchor|watchdog|auto: merge|loop-evidence)\b", re.I)


def ingest_new(root=REPO, apply=False) -> list:
    """Every daily pass: commits newer than the newest public change row become public change rows, so the changelog cannot fall silent."""
    pub = [r["at"] for r in entries(root) if r.get("public") and r["kind"] == "change"]
    since = max(pub) if pub else ""
    rows = [r for r in ingest_git(root, "", apply=False, after=since) if not _NOISE.search(r["summary"])]
    if apply:
        for r in rows:
            record(root, r)
    return rows


def ingest_git(root=REPO, since="", apply=False, after="") -> list:
    """Seed history: every commit becomes a change row (public, summary = subject). Class from trailers; unknown commits are agent work."""
    cfg = load(root)
    rng = [f"{since}..HEAD"] if since else []
    try:
        out = subprocess.run(["git", "-C", str(root), "log", *rng, "--pretty=%H%x1f%cI%x1f%s%x1f%b%x1e", "-n", "400", *(["--since=" + after] if after else [])], capture_output=True, text=True, encoding="utf-8", timeout=60, check=True).stdout
    except (OSError, subprocess.SubprocessError) as e:
        raise RuntimeError(f"git log failed: {e}") from e
    rows = []
    for rec in out.split("\x1e"):
        if not rec.strip():
            continue
        sha, at, subj, body = (rec.strip("\n").split("\x1f") + ["", "", "", ""])[:4]
        cls, ch, _ = classify(subj, body, "", cfg)
        m = re.search(r"\(#(\d+)\)", subj)
        paths = subprocess.run(["git", "-C", str(root), "show", "--name-only", "--pretty=", sha], capture_output=True, text=True, encoding="utf-8", timeout=30).stdout.split()
        areas = sorted({p.split("/")[0] for p in paths})[:6]
        actor = "owner" if cls == "owner" else "executor" if cls == "loop" else "claude-code" if cls == "agent" else "bootstrap"
        rows.append(make({"class": cls, "actor": actor, "channel": "pr" if m else ch}, "change", subj, ref=("PR#" + m.group(1)) if m else sha[:10], affected=areas, effect={"status": "kept"}, public=True, at=at.replace("+00:00", "Z"), cfg=cfg))
    if apply:
        for r in rows:
            record(root, r)
    return rows


def ingest_ledgers(root=REPO, apply=False) -> list:
    """Other append-only ledgers are sources: each row becomes a provenance row (origin loop, actor = its loop id). Missing ledgers are skipped, not errors.
    Sources are listed in doctrine/provenance.json `sources` (ops/unknowns/ledger.jsonl from the ignorance-audit loop first)."""
    from . import ledger
    cfg, out = load(root), []
    for src in cfg.get("sources", []):
        for r in ledger.rows(root, src["path"], branch=False):
            at = str(r.get("at") or r.get("ts") or r.get("time") or _now())
            summ = str(r.get(src.get("summary_field", "summary")) or r.get("title") or r.get("unknown") or r.get("id") or "").strip()
            if not summ:
                continue
            aff = r.get("affected") or r.get("paths") or [src["path"]]
            out.append(make({"class": src.get("class", "loop"), "actor": str(r.get("actor") or r.get("loop") or src["actor"]), "channel": "loop-run"}, src.get("kind", "input"), summ[:200],
                            ref=str(r.get("id") or ""), affected=aff if isinstance(aff, list) else [aff], effect={"status": r.get("effect") if r.get("effect") in cfg["effects"] else "pending"}, public=bool(src.get("public", False)), at=at, cfg=cfg))
    if apply:
        for r in out:
            record(root, r)
    return out


def push(root=REPO, url="https://ultrastable.io/api/fleet/provenance", token_env="FLEET_TOKEN", tenant=None) -> int:
    """Send every repo-ledger row to the dashboard's D1 table (idempotent: ids are content hashes). The token is read from the named environment variable, never printed."""
    import os, urllib.request
    tok = os.environ.get(token_env, "")
    if not tok:
        raise RuntimeError(f"{token_env} is not set in this environment; the server-side lane holds it")
    n = 0
    for r in timeline(root, tenant):
        body = {"class": r["origin"]["class"], "actor": r["origin"]["actor"], "channel": r["origin"]["channel"], "kind": r["kind"], "summary": r["summary"], "tenant": r["tenant"],
                "ref": r["ref"], "affected": r["affected"], "effect": r["effect"]["status"], "public": r["public"], "at": int(time.mktime(time.strptime(r["at"][:19], "%Y-%m-%dT%H:%M:%S")))*1000 if "T" in r["at"] else None}
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"authorization": "Bearer " + tok, "content-type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as resp:
            n += resp.status == 200
    return n


def check(root=REPO) -> list:
    root, bad = Path(root), []
    d = load(root)
    if d["marker"] not in d["axiom"]:
        bad.append("axiom lacks its marker")
    for c in ("system", "loop", "owner", "end_user", "agent", "external"):
        if c not in d["origin_classes"]:
            bad.append(f"origin class {c} missing")
    leaked = redact("mail a@b.example at 10.0.0.1 ghp_" + "a" * 24 + " https://x.example/p?k=v", d)
    for needle in ("a@b.example", "10.0.0.1", "ghp_", "k=v"):
        if needle in leaked:
            bad.append(f"redaction leaks {needle}")
    for f in ("dashboard/worker.js", "doctrine/self-improvement.json"):
        if "provenance" not in (root / f).read_text(encoding="utf-8").lower():
            bad.append(f"{f} does not consume provenance")
    return bad


def _openstd():
    import importlib.util
    spec = importlib.util.spec_from_file_location("seed_openstd", REPO / "seed/scripts/openstd.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


def to_cloudevent(row: dict) -> dict:
    """One provenance row as a CloudEvents 1.0 event: type io.ultrastable.provenance.<kind>, source /<tenant>/<origin class>/<actor>."""
    o = row.get("origin") or {}
    src = "/" + "/".join(re.sub(r"[^A-Za-z0-9._-]+", "-", str(x)) for x in (row.get("tenant") or "ultrastable", o.get("class") or "unknown", o.get("actor") or "unknown"))
    kind = re.sub(r"[^a-z0-9.]+", "-", str(row.get("kind") or "change").lower())
    return _openstd().cloudevent(f"io.ultrastable.provenance.{kind}", src, row, subject=str(row.get("ref") or "")[:200],
                                 id_=str(row.get("id") or ""), time=str(row.get("at") or ""),
                                 dataschema="https://ultrastable.io/schemas/provenance-row.schema.json")


def to_prov(rows: list) -> dict:
    """The ledger as a W3C PROV-JSON document (activities, agents, generated entities, informing activities)."""
    return _openstd().prov_document(rows)


def main(argv) -> int:
    a, root = list(argv), REPO
    flag = lambda f: f in a
    val = lambda f: a[a.index(f) + 1] if f in a and a.index(f) + 1 < len(a) else None
    if flag("--record"):
        print(json.dumps(record(root, json.loads(val("--record"))), indent=1)); return 0
    if flag("--settle"):
        i = a.index("--settle"); print(json.dumps(settle(root, a[i + 1], a[i + 2], " ".join(a[i + 3:])), indent=1)); return 0
    if flag("--ingest-git"):
        rows = ingest_git(root, val("--since") or "", apply=flag("--apply")); print(f"{len(rows)} rows" + (" written" if flag("--apply") else " (dry run)")); return 0
    if flag("--ingest-new"):
        rows = ingest_new(root, apply=flag("--apply")); print(f"{len(rows)} new public change rows" + (" written" if flag("--apply") else " (dry run)")); return 0
    if flag("--timeline"):
        print(json.dumps(timeline(root, val("--tenant"), val("--origin")), indent=1)); return 0
    if flag("--changelog"):
        if flag("--apply"):
            ingest_new(root, apply=True)  # CHANGELOG-FRESH-1: the workflow step that already builds the changelog also ingests new commits
        c = changelog(root); text = json.dumps(c, indent=1, ensure_ascii=False) + "\n"
        if flag("--apply"):
            (root / load(root)["public_view"]).write_text(text, encoding="utf-8", newline="\n")
        print(f"{len(c['entries'])} public entries"); return 0
    if flag("--ingest-ledgers"):
        print(len(ingest_ledgers(root, apply=flag("--apply"))), "rows"); return 0
    if flag("--push"):
        print(push(root, val("--push") if val("--push", ) and val("--push").startswith("http") else "https://ultrastable.io/api/fleet/provenance"), "rows pushed"); return 0
    if flag("--settle-due"):
        print(len(settle_due(root)), "settled"); return 0
    if flag("--prov") or flag("--cloudevents"):
        rows = [r for r in entries(root) if not val("--tenant") or r.get("tenant") == val("--tenant")]
        if flag("--prov"):
            print(json.dumps(to_prov(rows), indent=1)); return 0
        for r in rows:
            print(json.dumps(to_cloudevent(r), sort_keys=True))
        return 0
    if flag("--lessons"):
        print(json.dumps(lessons(root), indent=1)); return 0
    if flag("--signal"):
        print(signal(root)); return 0
    bad = check(root)
    print("\n".join(bad) if bad else "provenance ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
