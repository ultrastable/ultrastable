# Security and trust overview, internal full version

Tag: NDA ONLY. External version: [../external/security-summary.md](../external/security-summary.md). Not a certification; no SOC 2 or pen test exists. Status words as in the architecture doc.

## Threat model in one paragraph
Ultrastable runs agents that can change code and spend money. The risks are an agent acting beyond its authority, a silent failure, leaked credentials, and an operator unable to see what happened. The design answers with: authority from computed trust, one narrow gate, and ledgers.

| Concern | Control | Status |
|---|---|---|
| Agent exceeds authority | Autonomy per (surface, action class) from verified outcomes; widening only by reviewed change; no rung reaches secrets, the gate or the alignment floor | BUILT in policy and ledger; RUNNING in QNFO |
| Irreversible actions | Interrupt gate: pause only for irreversible and identity-bound steps (money, signatures, legal, unbacked-up deletion); open card with default, preparer and closing probe | BUILT |
| Bad deploy | Declared probes; probe that passed before and fails after reverts the push; risky diffs read by two model families | RUNNING in QNFO; product port PLANNED |
| Silent failure | Reconcile step reopens any item with no disposition and records a silent drop against trust | BUILT, tested |
| Tick crash | Each step guarded; a failing step files its own high-priority item; other steps still run | BUILT, tested |
| Secrets | Tick sees only that a secret exists, never its value; no secrets in the repo; scheduler endpoint refuses all calls when no token is configured, token compared in constant time | BUILT, tested (GCP adapter) |
| Human override | Always wins, always recorded | BUILT in policy |
| Audit | Every decision, prediction, outcome and trust change is a row | BUILT |
| Data residency, tenancy | Per-tenant isolation not yet built; single org per deployment | PLANNED (platform P3) |
| Certifications, pen test, DPA | None yet | PLANNED, **[LAWYER]** for terms |

## Known weaknesses
SQLite on an object-store volume is single-writer (pinned to one instance). Dashboard and CLI authentication not built. No outside review of the policy or code. The trust numbers are self-scored.

## Disclosure
Report issues to the owner by private message until a security contact exists (`SECURITY.md` is PLANNED, to be added at launch).
