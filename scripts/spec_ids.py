#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SPEC-IDS-1: "Requirement IDs are stable: a requirement is never renumbered or reused" (specs/README.md) as a check.

  python3 scripts/spec_ids.py [--check | --record]
  python3 scripts/spec_ids.py --reuse ROOT_A ROOT_B

A requirement is defined where its ID leads one of three forms in specs/US-SPEC-<nn>-*.md:
  a list item        - **US-<nn>-R<mm> [L<n>]** text
  a table row        | US-<nn>-R<mm> | text |       in a table whose header's first cell is ID
  a bold paragraph   **US-<nn>-R<mm>.** text       the period sits inside the bold
Anywhere else an ID is a cross-reference: a status table (its header does not start with ID), a first cell that names more than one ID or
adds words to it, a bold ID without its period, an ID in a later cell or inside a sentence. Conformance tests (US-<nn>-T<mm>) are read in
the same three forms when asked for (kinds="RT"); the ledger holds requirement IDs only.

The ledger doctrine/spec-ids.json holds every requirement ID ever defined. --check fails when an ID is defined in two files, or twice in
one file either in the same form or with texts that share too little to be one requirement restated (a summary table that restates a
paragraph is one requirement);
when an ID sits in the wrong specification; when a recorded ID is no longer defined (a withdrawn requirement keeps its line); or when a
defined ID is not yet recorded. --record only adds IDs; it never removes one, so a removed or renumbered requirement stays a failure until
its line is restored.

--reuse ROOT_A ROOT_B compares two specification trees (each a repository root or its specs/ directory): ROOT_A is the recorded text,
ROOT_B a newer one. It reports every requirement or test ID both define whose definitions share too little to be the same requirement (an
ID reused for another one, or an ID ROOT_A withdrew that ROOT_B uses again), and every ID ROOT_A defines that ROOT_B no longer does; it
exits 1 when it finds either. An ID whose ROOT_B definition begins "Withdrawn in <version>" keeps its line and is not a reuse. The report names files, lines and scores and never prints definition
text, so it can be pasted into an item or a pull request without disclosing a private specification (DISCLOSE-1).
Consumers: tests/foundation/test_spec_ids.py and tests/foundation/test_spec_00_ids.py (foundation tests step of checks), doctrine/claims.json.
"""
import json, math, re, sys
from collections import namedtuple
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LEDGER = "doctrine/spec-ids.json"
_ID = r"(US-(\d{2})-([RT])\d{2,3})"
_TAG = r"(?:\s*\[L\d\])?"
LIST_ITEM = re.compile(r"^- \*\*" + _ID + r"\b")
BOLD_PARAGRAPH = re.compile(r"^\*\*" + _ID + _TAG + r"\.\*\*")
TABLE_ROW = re.compile(r"^\|\s*\**" + _ID + r"\**" + _TAG + r"\s*\|")
ID_HEADER = re.compile(r"^\|\s*ID\s*\|", re.I)
WITHDRAWN = re.compile(r"^[\s*.:|]*(?:\[L\d\][\s*.:|]*)?Withdrawn in\b")  # the definition itself begins so; a mention elsewhere does not

# REUSE_MIN_OVERLAP: two definitions of one requirement ID that share less than this are two requirements. The score is the overlap
# coefficient (shared words over the smaller text's words), not Jaccard or a difflib ratio, because SPEC-IDS-1 lets a newer text extend a
# requirement in place and both of those count every added word against the pair. Measured 2026-11-27 by
# `python3 scripts/spec_ids.py --reuse . <private specification root>` from this repository: of the 477 requirement IDs both texts
# define, the lowest overlap was 0.62 and the lowest Jaccard 0.06, below the 99th percentile of Jaccard between different requirements of
# one specification (0.15 over 13,347 pairs), so Jaccard cannot tell a requirement extended in place from a reused ID. The overlap of those
# unrelated pairs had a 99th percentile of 0.40 and a maximum of 0.83: a reuse whose new text happens to share most of the old text's words
# is not caught, and the run prints that maximum so the limit stays visible.
# The threshold lies between the unrelated pairs' 99th percentile and the lowest same-ID overlap; every --reuse run prints those figures
# again, so the margin is re-measured whenever the specifications change.
REUSE_MIN_OVERLAP = 0.5
# REUSE_MIN_OVERLAP_TEST: the same for conformance tests (US-<nn>-T<mm>). Tests follow one template (an action, then Pass and Fail), so
# unrelated tests share more words than unrelated requirements; measured the same way: of the 137 test IDs both texts define
# the lowest overlap was 0.96; unrelated tests of one specification had a 99th percentile of 0.57 and a maximum of 0.75 (1,250 pairs).
REUSE_MIN_OVERLAP_TEST = 0.85
THRESHOLDS = {"R": REUSE_MIN_OVERLAP, "T": REUSE_MIN_OVERLAP_TEST}
_NAMES = {"R": "REUSE_MIN_OVERLAP", "T": "REUSE_MIN_OVERLAP_TEST"}
# STOP: words nearly every definition carries (function words and the RFC 2119 keywords); they would raise unrelated pairs' scores.
STOP = frozenset("a an and are as at be been by can do does for from has have if in into is it its may must no nor not of on or shall should "
                 "so than that the their them then there these this those to was were when where which while who will with without".split())

Definition = namedtuple("Definition", "id file line form text")


def _specs(root):
    root = Path(root)
    return root / "specs" if (root / "specs").is_dir() else root


def definitions(root=REPO, kinds="R"):
    """-> {id: [Definition, ...]} for every definition of a requirement (kinds "R"), a conformance test ("T") or both ("RT")."""
    out = {}
    for f in sorted(_specs(root).glob("US-SPEC-*.md")):
        lines = f.read_text("utf-8").split("\n")
        header = None  # the line number of the current table's header row
        for n, line in enumerate(lines):
            if not line.startswith("|"):
                header = None
            elif header is None:
                header = n
            m, form = LIST_ITEM.match(line), "list"
            if not m:
                m, form = BOLD_PARAGRAPH.match(line), "bold"
            if not m and header is not None and header < n and ID_HEADER.match(lines[header]):
                m, form = TABLE_ROW.match(line), "table"
            if not m or m.group(3) not in kinds:
                continue
            text = [line[m.end():]]
            if form != "table":  # a list item runs on through its indented lines, a bold paragraph to the blank line that ends it
                for nxt in lines[n + 1:]:
                    if not nxt.strip() or (form == "list" and not nxt[:1].isspace()) or LIST_ITEM.match(nxt) or BOLD_PARAGRAPH.match(nxt):
                        break
                    text.append(nxt)
            out.setdefault(m.group(1), []).append(Definition(m.group(1), f.name, n + 1, form, " ".join(text)))
    return out


def defined(root=REPO):
    """-> {id: [spec file, ...]} for every requirement definition (one entry per definition, in file order)."""
    return {i: [d.file for d in ds] for i, ds in definitions(root).items()}


def words(text):
    """The content words of a definition: lower case, level tags and markup dropped, without STOP words or single characters."""
    text = re.sub(r"\[l\d\]", " ", str(text).lower())
    return frozenset(w for w in re.findall(r"[a-z0-9_]+", text) if len(w) > 1 and w not in STOP)


def overlap(a, b):
    """Overlap coefficient of two word sets: shared words over the smaller set's size; 0.0 when either is empty."""
    return len(a & b) / min(len(a), len(b)) if a and b else 0.0


def jaccard(a, b):
    """Shared words over all words of the two sets; 0.0 when either is empty. Reported beside the overlap, never gated on."""
    return len(a & b) / len(a | b) if a and b else 0.0


def _withdrawn(d):
    return bool(WITHDRAWN.search(d.text))


def _restated(ds):
    """-> lowest overlap among pairs of definitions in one file (the same requirement restated scores at or above REUSE_MIN_OVERLAP).
    A withdrawn line is compared like any other: a live definition beside it under the same ID is a second requirement."""
    low = 1.0
    for k, x in enumerate(ds):
        for y in ds[k + 1:]:
            if x.file == y.file:
                low = min(low, overlap(words(x.text), words(y.text)))
    return low


def check(root=REPO, ledger=None):
    root = Path(root)
    if ledger is None:
        ledger = json.loads((root / LEDGER).read_text("utf-8"))["ids"]
    defs = definitions(root)
    bad = []
    for i, ds in sorted(defs.items()):
        if len(ds) < 2:
            continue
        where = ", ".join(f"{d.file}:{d.line}" for d in ds)
        if len({d.file for d in ds}) > 1:
            bad.append(f"{i}: defined {len(ds)} times ({where}); an ID is never reused")
        elif len({d.form for d in ds}) < len(ds):
            # only a restatement in another form (a summary table row beside its list item or bold paragraph) is one requirement;
            # two definitions of the same form in one file are a reused ID, whatever words they share
            bad.append(f"{i}: defined {len(ds)} times ({where}); two definitions of one form in one file are two requirements; "
                       f"an ID is never reused")
        elif (low := _restated(ds)) < REUSE_MIN_OVERLAP:
            bad.append(f"{i}: defined {len(ds)} times ({where}); in one file the texts share {low:.2f} of their words, below "
                       f"REUSE_MIN_OVERLAP {REUSE_MIN_OVERLAP}, so they are two requirements; an ID is never reused")
    for i, ds in sorted(defs.items()):
        for f in dict.fromkeys(d.file for d in ds):
            if not f.startswith(f"US-SPEC-{i[3:5]}-"):
                bad.append(f"{i}: defined in {f}, which is not specification {i[3:5]}")
    bad += [f"{i}: recorded but no longer defined; a removed requirement keeps its ID with the text 'Withdrawn in <version>'" for i in sorted(ledger) if i not in defs]
    bad += [f"{i}: defined but not recorded; run python3 scripts/spec_ids.py --record" for i in sorted(defs) if i not in ledger]
    return bad


def record(root=REPO):
    """Add every defined requirement ID to the ledger under root; never removes one."""
    p = Path(root) / LEDGER
    cur = json.loads(p.read_text("utf-8")) if p.is_file() else {"_doc": "SPEC-IDS-1: every requirement ID ever defined in specs/. Append-only: scripts/spec_ids.py --record adds, nothing removes. Checked by scripts/spec_ids.py --check (tests/foundation/test_spec_ids.py).", "ids": []}
    cur["ids"] = sorted(set(cur["ids"]) | set(defined(root)))
    p.write_text(json.dumps(cur, indent=1) + "\n", encoding="utf-8")


def _p99(values):
    """Nearest-rank 99th percentile, or None for no values."""
    v = sorted(values)
    return v[max(0, math.ceil(0.99 * len(v)) - 1)] if v else None


def compare(root_a, root_b, kinds="RT", thresholds=None):
    """Compare the definitions of two specification trees; root_a is the recorded text. -> {
       reused:    [{id, overlap, jaccard, a: "file:line (form)", b: "file:line (form)"}] for IDs both define with too few shared words,
       dropped:   IDs root_a defines that root_b does not, withdrawn: IDs root_b marks "Withdrawn in", shared: {kind: count},
       lowest:    {kind: (overlap, id)} and lowest_jaccard: {kind: (jaccard, id)} over the IDs both define,
       baseline:  {kind: {p99, max, p99_jaccard, pairs}} of the scores between different IDs of one specification (unrelated ones)}
    thresholds: {kind: minimum overlap}, THRESHOLDS by default."""
    thresholds = {**THRESHOLDS, **(thresholds or {})}
    a, b = definitions(root_a, kinds), definitions(root_b, kinds)
    where = lambda d: f"{d.file}:{d.line} ({d.form})"
    out = {"reused": [], "dropped": sorted(set(a) - set(b)), "withdrawn": [], "shared": {}, "lowest": {}, "lowest_jaccard": {}, "baseline": {}}
    for i in sorted(set(a) & set(b)):
        kind = i[6]
        out["shared"][kind] = out["shared"].get(kind, 0) + 1
        if any(map(_withdrawn, b[i])):  # the newer text withdrew it and kept its line
            out["withdrawn"].append(i)
            continue
        if any(map(_withdrawn, a[i])):  # the recorded text withdrew it; any live text under the ID now is another requirement
            out["reused"].append({"id": i, "kind": kind, "overlap": 0.0, "jaccard": 0.0, "a": where(a[i][0]), "b": where(b[i][0]), "revived": True})
            continue
        score, x, y = max(((overlap(words(x.text), words(y.text)), x, y) for x in a[i] for y in b[i]), key=lambda t: t[0])
        jac = max(jaccard(words(x.text), words(y.text)) for x in a[i] for y in b[i])
        if kind not in out["lowest"] or score < out["lowest"][kind][0]:
            out["lowest"][kind] = (score, i)
        if kind not in out["lowest_jaccard"] or jac < out["lowest_jaccard"][kind][0]:
            out["lowest_jaccard"][kind] = (jac, i)
        if score < thresholds[kind]:
            out["reused"].append({"id": i, "kind": kind, "overlap": round(score, 3), "jaccard": round(jac, 3), "a": where(x), "b": where(y)})
    for kind in sorted({i[6] for i in a}):
        wa = {i: words(ds[0].text) for i, ds in a.items() if i[6] == kind}
        wb = {i: words(ds[0].text) for i, ds in b.items() if i[6] == kind}
        pairs = [(x, wb[j]) for i, x in wa.items() for j in wb if j != i and j[3:5] == i[3:5]]
        ov = [overlap(x, y) for x, y in pairs]
        out["baseline"][kind] = {"p99": _p99(ov), "max": max(ov, default=None), "p99_jaccard": _p99(jaccard(x, y) for x, y in pairs), "pairs": len(pairs)}
    return out


def reuse_report(r, thresholds=None):
    """-> report lines for compare(): one per finding, then one summary line."""
    thresholds = {**THRESHOLDS, **(thresholds or {})}
    lines = [f"{x['id']}: reused; ROOT_A withdrew it and ROOT_B defines it again: A {x['a']}, B {x['b']}" if x.get("revived") else
             f"{x['id']}: reused for another requirement? its definitions share {x['overlap']:.2f} of their words (overlap; jaccard "
             f"{x['jaccard']:.2f}), below {_NAMES[x['kind']]} {thresholds[x['kind']]}: A {x['a']}, B {x['b']}" for x in r["reused"]]
    lines += [f"{i}: dropped; ROOT_A defines it and ROOT_B does not (an ID is never removed: a withdrawn one keeps its line)" for i in r["dropped"]]
    fmt = lambda t: f"{t[0]:.2f} ({t[1]})" if t else "none"
    num = lambda v: "none" if v is None else f"{v:.2f}"
    parts = []
    for kind in sorted(set(r["shared"]) | set(r["baseline"])):
        base = r["baseline"].get(kind, {"p99": None, "max": None, "p99_jaccard": None, "pairs": 0})
        parts.append(f"{kind}: {r['shared'].get(kind, 0)} ids in both, lowest overlap {fmt(r['lowest'].get(kind))}, lowest jaccard "
                     f"{fmt(r['lowest_jaccard'].get(kind))}; unrelated pairs of one specification: overlap p99 {num(base['p99'])} max "
                     f"{num(base['max'])}, jaccard p99 {num(base['p99_jaccard'])} ({base['pairs']} pairs); threshold {thresholds.get(kind)}")
    lines.append(f"reuse: {'; '.join(parts) or 'no ids'}; {len(r['withdrawn'])} withdrawn; {len(r['reused'])} reused, {len(r['dropped'])} dropped")
    return lines


def main(argv):
    if "--reuse" in argv:
        k = argv.index("--reuse")
        if len(argv) < k + 3:
            print("usage: python3 scripts/spec_ids.py --reuse ROOT_A ROOT_B", file=sys.stderr)
            return 2
        r = compare(argv[k + 1], argv[k + 2])
        print("\n".join(reuse_report(r)))
        return 1 if r["reused"] or r["dropped"] else 0
    if "--record" in argv:
        record()
    bad = check()
    print("\n".join(bad) or f"spec ids ok: {len(defined())} requirements")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
