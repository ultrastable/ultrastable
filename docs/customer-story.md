# Customer story: QNFO (customer zero), internal full version

Tag: NDA ONLY. External version: [../external/customer-story.md](../external/customer-story.md).

**Read this first.** QNFO is the owner's own research fleet, so this is customer zero, not an independent customer. Every number below comes from QNFO's own records, measured 2026-11-10 by the system itself (source: `docs/product-and-positioning.md` section 3, `qnfo-platform-thread/`). **None of it has been audited by an outside party.** Use "self-reported" whenever a number leaves this repo (and see `external/` rules).

## Situation
One person ("ideas person, not the business person") needed a fleet of research and publishing services to keep running, improving and fixing themselves without a full-time operator.

## What it does there (self-scored, 2026-11-10)
- 6,604 issues passed through the work ledger; 563 open against a target of 0 (the 120-minute SLA is not met).
- 3,880 merged pull requests since 2026-08-10, 1,245 in the last seven days; 624 opened by the code loop itself, 416 by GitHub Copilot, the rest by interactive sessions.
- 39 live Cloudflare Workers; state in D1, R2, KV.
- 1,056 decisions scored against a prediction logged beforehand; 771 matched (73%), scored by the system itself.
- 2,176 logged decisions, 634 failure modes with detectors, 388 recorded red-teams of claimed blockers.

## What is not proven
One installation, one customer, no second tenant, no installer. Core entangled with QNFO applications. 73% match rate has no external benchmark. Heavy use of interactive AI sessions in the build, although the runtime does not depend on them.

## What a design-partner pilot must show
Three teams, one repository each, 30 days: their agents' work accounted for in ledgers, a measurable drop in hand-backs to a person, no unrecoverable change, and a scored prediction rate the partner can check. Success criteria are written before the pilot, not after.
