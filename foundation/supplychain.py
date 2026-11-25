# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OPEN-STANDARDS-1 supply-chain loop. Inputs are two standard documents: the OpenSSF Scorecard JSON result and the SPDX 2.3 SBOM
that GitHub's dependency graph exports. `--ingest SCORECARD SBOM [--apply]` writes ops/supply-chain.json and files one
Q-STD-SC-* item per Scorecard check under the floor and per package whose licence is outside doctrine/dependency-licences.json;
`--probe ID` is each item's closing probe (exit 0 when the latest reading passes); `--check` validates the settings and the age
of the last reading. Settings: doctrine/open-standards.json. Ultrastable is the foundation for any autonomous system."""
from __future__ import annotations
import datetime as dt, json, re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CFG, OUT = "doctrine/open-standards.json", "ops/supply-chain.json"


def _load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def summarise(scorecard: dict, sbom: dict, cfg: dict, policy: dict, today: str) -> dict:
    checks = {c["name"]: c.get("score", -1) for c in scorecard.get("checks", [])}
    doc = sbom.get("sbom", sbom)
    allowed = set(policy.get("shipped", [])) | set(policy.get("tool", []))
    lic, outside = {}, []
    for p in doc.get("packages", []):
        name = p.get("name", "")
        if name.startswith("com.github.") and p.get("SPDXID") == doc.get("documentDescribes", [None])[0]:
            continue  # the repository itself
        l = p.get("licenseConcluded") or p.get("licenseDeclared") or "NOASSERTION"
        lic[l] = lic.get(l, 0) + 1
        if l != "NOASSERTION" and not all(t in allowed for t in re.findall(r"[A-Za-z0-9.+-]+", l) if t not in ("AND", "OR", "WITH")):
            outside.append({"package": name, "version": p.get("versionInfo"), "licence": l})
    return {"at": today, "scorecard": {"score": scorecard.get("score"), "version": (scorecard.get("scorecard") or {}).get("version"),
                                       "checks": checks},
            "sbom": {"spdxVersion": doc.get("spdxVersion"), "packages": len(doc.get("packages", [])),
                     "licences": dict(sorted(lic.items())), "outside_policy": outside},
            "floor": cfg["scorecard_floor"]}


def failing(rep: dict, cfg: dict) -> list[tuple[str, str]]:
    out = [(f"Q-STD-SC-{n}", f"OpenSSF Scorecard check {n} scores {s}/10, under the floor {cfg['scorecard_floor']}")
           for n, s in sorted(rep["scorecard"]["checks"].items()) if 0 <= s < cfg["scorecard_floor"] and n not in cfg["ignore_checks"]]
    out += [(f"Q-STD-SC-LIC-{re.sub(r'[^A-Za-z0-9-]+', '-', o['package'])[:60]}",
             f"package {o['package']} {o.get('version') or ''} is licensed {o['licence']}, outside the licence policy") for o in rep["sbom"]["outside_policy"]]
    return out


def file_items(root: Path, rep: dict, cfg: dict) -> list[str]:
    made = []
    for iid, why in failing(rep, cfg)[: cfg.get("max_items_per_run", 5)]:
        p = root / "docs/issues" / f"{iid}.json"
        if p.exists():
            continue
        body = (f"**Owner:** staff\n**Trigger:** supply-chain reading {rep['at']}: {why}\n"
                f"**Done check:** cmd:python3 -m foundation supplychain --probe {iid}\n**Status:** open\n\n"
                f"{why}. Source: the weekly OpenSSF Scorecard and SPDX SBOM reading in `{OUT}` (OPEN-STANDARDS-1). Fix the cause in code "
                "(workflow permissions, pinned actions, dependency update or replacement); the item closes when the next reading passes. "
                f"A check that cannot be met by code is added to `ignore_checks` in `{CFG}` with its reason.\n\n**Out of scope:** lowering the floor.")
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: {why}", "body": body, "labels": ["role:staff", "ws:platform", "standards"],
                                 "milestone": "Next", "workstream": "Platform"}, indent=2) + "\n", encoding="utf-8")
        made.append(p.relative_to(root).as_posix())
    return made


def probe(root: Path, iid: str) -> bool:
    p = root / OUT
    if not p.exists():
        return False
    rep, cfg = _load(p), _load(root / CFG)
    return iid not in {i for i, _ in failing(rep, cfg)}


def check(root: Path = REPO, today: dt.date | None = None) -> list[str]:
    bad, cfg = [], _load(root / CFG)
    if not isinstance(cfg.get("scorecard_floor"), int) or not 0 <= cfg["scorecard_floor"] <= 10:
        bad.append(f"{CFG}: scorecard_floor must be an integer 0..10")
    for k, why in cfg.get("ignore_checks", {}).items():
        if not why:
            bad.append(f"{CFG}: ignored check {k} needs a reason")
    p = root / OUT
    if p.exists():
        age = ((today or dt.date.today()) - dt.date.fromisoformat(_load(p)["at"][:10])).days
        if age > cfg.get("max_age_days", 14):
            bad.append(f"{OUT}: last supply-chain reading is {age} days old (limit {cfg['max_age_days']}); the weekly supply-chain workflow is not running")
    return bad


def main(argv: list[str]) -> int:
    root = REPO
    if "--probe" in argv:
        ok = probe(root, argv[argv.index("--probe") + 1]); print("pass" if ok else "fail"); return 0 if ok else 1
    if "--ingest" in argv:
        i = argv.index("--ingest")
        cfg = _load(root / CFG)
        rep = summarise(_load(argv[i + 1]), _load(argv[i + 2]), cfg, _load(root / cfg["licence_policy"])["policy"], dt.date.today().isoformat())
        print(json.dumps({"score": rep["scorecard"]["score"], "packages": rep["sbom"]["packages"], "failing": failing(rep, cfg)}, indent=1))
        if "--apply" in argv:
            (root / OUT).parent.mkdir(parents=True, exist_ok=True)
            (root / OUT).write_text(json.dumps(rep, indent=1) + "\n", encoding="utf-8")
            print("queue items filed:", ", ".join(file_items(root, rep, cfg)) or "none")
        return 0
    bad = check(root)
    print("\n".join(bad) or "supply chain settings ok"); return 1 if bad else 0
