# Pitch deck outline: 12 slides (working draft, 2026-11-10)

Deck: one story, open to anyone. Evidence paths are relative to the root of the workspace that holds the repositories side by side. Every number must come from the cited source; no invented metrics.

1. **Title: Ultrastable, the manager for your AI workers**
   - AI agents are cheap; managing them isn't.
   - Self-governing layer around the coding agents a team already uses.
   - Rowan, founder `[FOUNDER CONFIRM]`.
   - Evidence: `us-remote/org-repos/business/plan/04-pitch-kit.md` (one-liner).

2. **Problem: the human manager is the bottleneck**
   - Founders and leads spend the day assigning, checking and deciding for agents.
   - Agent products assume a person directs each task.
   - Gateways log and restrict but do not manage.
   - Evidence: `us-remote/docs/product-and-positioning.md` sections 2 and 8.

3. **Solution: virtual managers above the agents**
   - Portfolio, project, product, operations managers plus an independent reviewer.
   - Assigns work to the agent that fits; verifies each result independently.
   - Weekly four-line report: happened, decided, next, open.
   - Evidence: `us-platform/ultrastable/engine.py` (`state()` managers), `org-repos/business/plan/01-management-roster.md`.

4. **What makes it different**
   - Gets more independent as it proves itself.
   - Interrupts only for decisions that cannot be undone.
   - Plans improvement, not just fixes; nothing drops silently.
   - Evidence: `plan/03-competition.md` difference table.

5. **Product today: a working control loop**
   - 11-step tick, guarded per step; CLI, dashboard and JSON API; 12 tests pass.
   - Gate cards for irreversible, identity-bound steps; blocked actions recorded.
   - Demo uses simulated agents; Command and Anthropic adapters exist, unproven in production.
   - Evidence: `us-platform/ultrastable/{engine,cli,server,agents}.py`, `us-platform/tests/test_engine.py`.

6. **Demo (live, 5 min)**
   - `python -m ultrastable demo`, then `serve --seed-demo`.
   - Gate cards, trust table, amendments on the dashboard.
   - State clearly: simulated agents.
   - Evidence: `demo-script.md` in this folder; `us-platform/ultrastable/demo.py`.

7. **Origin and proof: QNFO as customer zero**
   - The founder's own multi-project fleet runs on the earlier system.
   - Case study with real numbers, figures are self-measured.
   - No external customer yet.
   - Evidence: `us-remote/docs/product-and-positioning.md` section 3-4; `us-remote/research/market-read.md`.

8. **Market and competition**
   - Coding agents are complements; "run a company with agents" tools are direct competitors (e.g. Paperclip, open source).
   - Governance spend: roughly USD 1.0-1.5B in 2026 per one analyst brief (indicative, unverified).
   - Claimed gap: automatic revert and self-chosen work.
   - Evidence: `us-remote/research/market-read.md`, `plan/03-competition.md`.

9. **Customers and go-to-market**
   - Beachhead solo founders with 3+ projects; then agencies; then small engineering teams.
   - Three design-partner pilots, one repo each.
   - Founder-led discovery calls, site, demo video, events.
   - Evidence: `plan/02-customers.md`, `plan/06-promotion.md`, `marketing-strategy.md`.

10. **Business model**
   - Per project managed, plus model usage at cost (hypothesis, unvalidated).
   - Open-core option under consideration `[FOUNDER CONFIRM]`.
   - Cloud-agnostic core; Google Cloud and Cloudflare adapters (Cloudflare adapter not yet built).
   - Evidence: `plan/04-pitch-kit.md` objection table; `us-platform/deploy/gcp/deploy.sh`.

11. **Team, IP and risks**
   - Solo founder; platform agents do build/ops work; hires planned.
   - The code is open and the Ultrastable License governs use. IP assignment to an entity pending.
   - Public QNFO repo without licence is the main investor risk.
   - Evidence: `us-remote/HANDOFF.md` (blocked section), `ultrastable/PROJECT-INSTRUCTIONS.md` rule 3.

12. **Ask: $1.25M pre-seed SAFE (planning figure)**
   - 18 months: founder, founding engineer, part-time commercial lead.
   - Use: people 60%, model/cloud 15%, licence and compliance 10%, GTM 10%, reserve 5%.
   - Milestones: entity, 3 pilots, first paid conversions, real-adapter proof.
   - Evidence: `us-remote/org-repos/business/plan/05-funding.md`, `org-repos/docs/funding/funding-options.md`.
