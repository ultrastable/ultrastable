# Ultrastable: investor one-pager (CONFIDENTIAL, NDA only until the provisional patent is filed)

Draft 2026-11-10. Planning figures are ESTIMATES. Contains no revenue, customer or user numbers because there are none.

**One line:** Ultrastable is the manager for your AI workers: a self-governing control loop around the coding agents a team already uses.

## Problem
Coding agents are cheap and capable; managing them is the new bottleneck. The person who assigns, checks and decides is the founder or lead, all day. Agent tools mostly assume a human directing each task, or are governance gateways (cost, access, audit).

## Solution
Virtual managers (portfolio, project, product, operations, independent reviewer) keep the backlog, assign work to the agent that fits, verify every claimed result independently, and interrupt a person only for steps that are irreversible and tied to an identity. Independence grows with a proven record; a share of capacity is reserved for improvement; nothing leaves the backlog without a recorded outcome. (Mechanics: AFTER FILING / NDA.)

## Why now
Agent adoption is mainstream and governance is a standard buying criterion for coding agents (market-read.md, vendor-blog sources, indicative). One analyst brief puts agent governance at roughly USD 1.0-1.5B in 2026 with cross-vendor governance immature (meticulousresearch.com, via research/market-read.md; not independently verified). The repo's searches found no product offering automatic revert of agent changes or a system that chooses its own work: a claimed gap, not proof.

## Product: what exists today vs roadmap

| Exists today (inspected 2026-11-10 in `us-platform`) | Roadmap (not built) |
|---|---|
| Control loop of 11 steps per tick (reconcile, claims, gate probes, prediction scoring, audit, trust, portfolio, product, execute, amend, plus share), guarded so one failing step does not stop the loop | Postgres / Cloud SQL store (SQLite today) |
| CLI: init, tick, status, backlog, trust, gates, resolve, add, demo, serve | Cloudflare deployment adapter (`deploy/cloudflare/` is empty) |
| Dashboard + JSON API (stdlib HTTP, bearer-token writes) | Multi-tenant, auth/SSO, billing |
| Owner gate cards that block irreversible, identity-bound actions; blocked actions recorded | Production proof of real-agent adapters |
| Agent adapters: Simulated, Command (any CLI agent, independent check command), Anthropic API; Vertex/Gemini planned | Default policy pack extraction from QNFO overlays (core-manifest P1-P4) |
| Google Cloud deploy script (Cloud Run, Scheduler, Secret Manager); 12 unit tests pass | Packaged installer; second tenant outside QNFO |

**Honest limits:** the shipped demo uses SIMULATED agents. Command and Anthropic adapters exist but are not yet proven in production. QNFO's fleet is the earlier, larger, Cloudflare-based system the design came from; product-design claims about it are self-measured and entangled with QNFO's applications (positioning doc, section 4). One installation, one internal user, no external customers.

## Business model
Priced per project managed, plus model usage at cost (pitch-kit hypothesis, plan/04; unvalidated). Pricing is a Rowan decision. `[FOUNDER CONFIRM]`

## Market
Segments ranked: solo founders/indie builders with 3+ projects (beachhead), agencies, small engineering teams (plan/02). Sizing: no bottom-up model exists yet; the only figure is the indicative USD 1.0-1.5B governance estimate above. Competitors named in plan/03: coding agents (complements), "run a company with agents" products incl. Paperclip (open source), frameworks, enterprise suites. Devin/Cursor valuations in that file are from one blog and unconfirmed.

## Traction (truthful)
Working platform with passing tests; public site live (ultrastable.io); QNFO runs on the earlier system as customer zero (figures NDA ONLY); design-partner pilot offer open. No revenue, no external users, no pilots started.

## Ask
**$1.25M pre-seed on a post-money SAFE (planning figure, ESTIMATE; range $1.0-1.5M).** Valuation cap and terms: `[LAWYER]` and advisors. 18-month runway target.

## Use of funds (plan/05, planning)
People (founder + founding engineer + part-time commercial lead) 60%; model/cloud beyond credits 15%; legal/IP 10%; go-to-market 10%; reserve 5%.

## Risks (stated plainly)
1. **IP and ownership:** the QNFO/qnfo-workers repo is public with no licence file (checked 2026-11-10) and holds the product design doc in history. No entity exists yet to own the IP; written assignment/licence from the author to the company is needed. `[LAWYER]`
2. **Provisional patent not yet filed**; public-disclosure clock from 2026-08-10 (file well before 2027-08-10). Drafts are working drafts, not legal advice.
3. **Solo founder**; execution depends on the platform's own agents plus planned hires.
4. **Demo is simulated**; real-adapter proof pending; the 73% self-scored prediction rate cited in repo docs has no external audit.
5. **Crowded narrative** and risk that agent vendors add management layers.
6. **Unvalidated willingness to pay**; no pilots yet.
7. Funding programs: top credit tiers need an institutional round.

## Contact
Rowan `[FOUNDER CONFIRM name, email on ultrastable.io]`
