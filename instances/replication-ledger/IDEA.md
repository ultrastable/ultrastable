---
# Level 1: a tenant system bootstrapped on Ultrastable. Reports to its parent (tenant 0).
org_name: Replication Ledger
slug: replication-ledger
owner: Rowan
owner_contact: set-in-secret-store
owner_contact_backup: set-in-secret-store
parent: ultrastable
parent_health_url: https://ultrastable-tick.ultrastable.workers.dev/health
level: 1
---

# Idea

The Replication Ledger is an encyclopedic record, across many fields, of which landmark findings held up when others tried to repeat them and which did not. Each finding names one claim, its original study and every replication attempt on record (a many-lab replication, a direct replication, a randomized trial testing an observational claim, a meta-analysis, a reanalysis of the original data, a conceptual replication), each with its outcome and a DOI. The standing of a finding (holds, weakened, contested, failed, too few replications, not yet replicated) is computed by one rubric from the kinds and outcomes of its attempts, never typed by hand, and every move of a standing is logged with the paper that moved it. It starts with psychology, medicine, economics, physics and biology, and the large replication projects of each field. Readers guess whether a famous finding survived before the record is shown.

# System test

- Loop: every week the beat searches OpenAlex and Crossref for new replications, reanalyses and retractions of each finding, files candidates under a verbatim-quote guard, recomputes every standing and logs each move with the paper that moved it, with no person in the middle
- Measure: share of findings whose replication search ran within 30 days, target 1.0; every change of standing logged with a reason; share of citations that resolve at Crossref, target 1.0
- Upkeep: replications, reanalyses and retractions publish every week, DOIs and links rot, standings must move when the evidence moves, and new findings and fields keep being added
- Run cost: 15 USD a month for the back end

# Hook

- Guess whether a textbook finding survived replication, then see the record. The surprise, either way, is the hook.

# Public good

- Stops shaky findings from steering teaching, journalism and policy, and shows which findings earned their place.

# Who it is for

- Students, teachers and textbook authors checking whether a classic still stands
- Journalists and policy staff who cite research
- Researchers choosing which findings to build on

# First outcomes

- At least 25 landmark findings in five fields, each with every replication attempt cited by DOI and a computed standing
- Every finding's replication search run within 30 days, measured at /api/freshness
- Every change of standing logged with the paper that moved it, published at /changes

# Constraints

- Budget per month: 15
- No accounts, cookies or trackers; guesses are counted per finding with nothing that identifies the reader
- Citations come from the registry by DOI; a model may only label a candidate's kind and outcome, each with a verbatim quote from its abstract, and never adds a number, a name or a claim
- Summaries carry no typed numbers; a number enters only from the source itself
