# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""P2: memoize agent conclusions keyed to evidence hashes (Bazel action-cache for reasoning).

An answer is valid while every evidence file still has the sha recorded at derivation.
Evidence MUST list every file read; unrecorded reads make a cached answer unsound,
which is why audit() exists (P8 samples cached answers).
"""
import hashlib
import json
import os
import random
import time

from .repomodel import sha_file


def _key(question):
    return hashlib.sha256(" ".join(question.lower().split()).encode()).hexdigest()


class ConclusionCache:
    def __init__(self, store, root):
        self.s, self.root = store, os.path.realpath(root)

    def put(self, question, answer, evidence_files):
        ev = {}
        for rel in sorted(set(evidence_files)):
            full = os.path.realpath(os.path.join(self.root, rel))
            if os.path.commonpath([self.root, full]) != self.root:
                raise ValueError(f"evidence outside the repository: {rel}")  # a cached answer may not depend on files we cannot hash-check
            ev[rel] = sha_file(full)
        self.s.db.execute(
            "INSERT OR REPLACE INTO conclusion(key,question,answer,evidence,ts,hits,audited_ok,audited_bad)"
            " VALUES(?,?,?,?,?,0,0,0)",
            (_key(question), question, answer, json.dumps(ev), time.time()))
        self.s.db.commit()

    def get(self, question):
        r = self.s.db.execute("SELECT * FROM conclusion WHERE key=?", (_key(question),)).fetchone()
        if not r:
            return None
        for rel, sha in json.loads(r["evidence"]).items():
            p = os.path.join(self.root, rel)
            if not os.path.exists(p) or sha_file(p) != sha:
                return None  # stale: evidence changed -> re-derive
        self.s.db.execute("UPDATE conclusion SET hits=hits+1 WHERE key=?", (r["key"],))
        self.s.db.commit()
        return r["answer"]

    def sample_for_audit(self, rate=0.1, seed=None):
        rng = random.Random(seed)
        return [r["question"] for r in self.s.db.execute("SELECT question FROM conclusion")
                if rng.random() < rate]

    def record_audit(self, question, ok):
        col = "audited_ok" if ok else "audited_bad"
        self.s.db.execute(f"UPDATE conclusion SET {col}={col}+1 WHERE key=?", (_key(question),))
        if not ok:  # a bad cached answer is evicted immediately
            self.s.db.execute("DELETE FROM conclusion WHERE key=?", (_key(question),))
        self.s.db.commit()

    def stats(self):
        r = self.s.db.execute(
            "SELECT COUNT(*) n, SUM(hits) h, SUM(audited_ok) ok, SUM(audited_bad) bad FROM conclusion").fetchone()
        return {"entries": r["n"], "hits": r["h"] or 0, "audited_ok": r["ok"] or 0, "audited_bad": r["bad"] or 0}
