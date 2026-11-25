// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The standing rubric, as code. Every standing the ledger shows is computed here from a finding's replication attempts; nothing is typed by
// hand, and any page that explains the rubric renders these same constants (WORDS-MATCH-CODE-1).
//
// 1. Each attempt weighs by its kind: many-lab and meta-analytic evidence most, a single conceptual replication least. A preregistered
//    attempt weighs RUBRIC.PREREG times more. An attempt the discovery loop filed from a new abstract (machine: true, discover.js) counts at
//    RUBRIC.MACHINE of its weight.
// 2. Each outcome scores how far the original claim held: held 1, smaller 0.5 (the effect is there but much weaker), mixed 0.5 (held under
//    some conditions, not others), failed 0.
// 3. Standing, in order: untested with no attempts; thin when the total weight is under RUBRIC.MIN_WEIGHT; holds when the weighted score is
//    RUBRIC.HOLDS or more; fails when it is under RUBRIC.FAILS; weakened when "smaller" carries half the weight or more; otherwise contested.

export const KINDS = {
  multisite: { name: "Many-lab or multisite replication", weight: 3 },
  "meta-analysis": { name: "Meta-analysis or pooled trials", weight: 3 },
  rct: { name: "Randomized trial testing the claim", weight: 3 },
  direct: { name: "Direct replication (same method, new data)", weight: 2 },
  reanalysis: { name: "Reanalysis (original or matched data, re-examined)", weight: 2 },
  conceptual: { name: "Conceptual replication (same claim, different method)", weight: 1.5 }
};

export const OUTCOMES = {
  held: { name: "Held", score: 1 },
  smaller: { name: "Held, but much smaller", score: 0.5 },
  mixed: { name: "Mixed: held under some conditions only", score: 0.5 },
  failed: { name: "Failed to replicate", score: 0 }
};

export const STANDINGS = {
  holds: { name: "Holds", say: "Replications support the original claim.", rank: 5 },
  weakened: { name: "Weakened", say: "The effect shows up again, but much smaller than first reported.", rank: 4 },
  contested: { name: "Contested", say: "Serious replications disagree, or the claim holds only under some conditions.", rank: 3 },
  fails: { name: "Failed", say: "Replications did not find the original claim.", rank: 1 },
  thin: { name: "Too few replications", say: "Only a small replication attempt so far; not enough to call.", rank: 2 },
  untested: { name: "Not yet replicated", say: "No replication attempt is on record yet.", rank: 0 }
};

export const RUBRIC = { PREREG: 1.25, MACHINE: 0.5, MIN_WEIGHT: 1.5, HOLDS: 0.8, FAILS: 0.25, SMALLER_SHARE: 0.5 };

export function attemptWeight(a) {
  const k = KINDS[a.kind];
  if (!k || !OUTCOMES[a.outcome]) return 0;
  return k.weight * (a.preregistered ? RUBRIC.PREREG : 1) * (a.machine ? RUBRIC.MACHINE : 1);
}

const round = x => Math.round(x * 100) / 100;

// standing(attempts) -> { standing, score, weight, attempts, counts, basis }
export function standing(attempts) {
  const valid = (attempts || []).filter(a => attemptWeight(a) > 0);
  const counts = Object.fromEntries(Object.keys(OUTCOMES).map(k => [k, valid.filter(a => a.outcome === k).length]));
  if (!valid.length) return { standing: "untested", score: null, weight: 0, attempts: 0, counts, basis: "No replication attempt is on record yet." };
  let W = 0, S = 0, smallerW = 0;
  for (const a of valid) { const w = attemptWeight(a); W += w; S += w * OUTCOMES[a.outcome].score; if (a.outcome === "smaller") smallerW += w; }
  const score = S / W;
  let st;
  if (W < RUBRIC.MIN_WEIGHT) st = "thin";
  else if (score >= RUBRIC.HOLDS) st = "holds";
  else if (score < RUBRIC.FAILS) st = "fails";
  else if (smallerW / W >= RUBRIC.SMALLER_SHARE) st = "weakened";
  else st = "contested";
  return { standing: st, score: round(score), weight: round(W), attempts: valid.length, counts, basis: basis(valid, counts, score, W) };
}

// One generated sentence saying why: the page shows it under the standing.
export function basis(valid, counts, score, W) {
  const parts = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${OUTCOMES[k].name.toLowerCase()}`);
  const prereg = valid.filter(a => a.preregistered).length;
  return `${valid.length} replication ${valid.length === 1 ? "attempt" : "attempts"} (${parts.join(", ")})` +
    (prereg ? `, ${prereg} preregistered` : "") + `; weighted support ${Math.round(score * 100)}% of evidence weight ${round(W)}.`;
}

// Did the standing move? Logged with the attempt that moved it; a score change inside the same standing is not a move.
export function moved(prev, next) {
  if (!prev) return { moved: true, kind: "first" };
  if (prev.standing === next.standing) return { moved: false };
  return { moved: true, kind: STANDINGS[next.standing].rank > STANDINGS[prev.standing].rank ? "up" : "down" };
}
