# Google for Startups Cloud Program: application draft (2026-11-10)

Status: DRAFT for Rowan. Every field marked `[FOUNDER CONFIRM]` must be checked by Rowan before pasting. Program tiers, amounts and eligibility change; the repo's funding notes say the large AI tier needs an institutional investor. Current amounts were NOT verified here: confirm on the program page before applying. The text below is outcome-only (no trust formulas, ladder rungs, scoring details or QNFO metrics) and every claim traces to the repository.

## Target tier

Start tier (earliest stage, no institutional investor) is the realistic target. The top/AI tier requires an institutional investor and excludes angel money per the funding notes; do not apply for it now. `[FOUNDER CONFIRM]` tier names and eligibility on the live page.

## Pre-submission checklist

- [ ] Company website live and public: https://ultrastable.io (live as of HANDOFF 2026-11-10, verified there; re-check it loads on the day).
- [ ] Domain email on ultrastable.io (e.g. founder@ultrastable.io). Today only an Email Routing forward pilot@ultrastable.io exists; a sending-capable domain address is needed. `[FOUNDER CONFIRM]`
- [ ] No paid Google Workspace subscription on the ultrastable domain within 31 days before applying (funding notes). Use Cloudflare Email Routing or another provider until after submission.
- [ ] Entity: legal entity formed, or confirm the program accepts the applicant's status. Entity not formed per repo records. `[ACCOUNTANT]`
- [ ] A Google Cloud billing account / organization ready to receive credits `[FOUNDER CONFIRM]`.
- [ ] Funding status answered honestly (below). No angel/institutional money claimed.
- [ ] Website claims match the repository; /proof feed reviewed.
- [ ] Rowan submits personally (identity-bound).

## Ready-to-paste answers

**Company name:** Ultrastable `[FOUNDER CONFIRM legal name]`
**Website:** https://ultrastable.io
**Country / location:** `[FOUNDER CONFIRM]`
**Founding date / incorporation:** `[FOUNDER CONFIRM]`
**Founders and roles:** Rowan `[FOUNDER CONFIRM full name]`, founder and inventor (product, direction).
**Number of full-time employees:** 1 (founder) `[FOUNDER CONFIRM]`
**Industry / category:** Developer tools; AI agent management.

**Company description (short):**
Ultrastable is a self-governing development platform: a control loop of virtual managers around the coding agents a team already uses. It keeps the backlog, hands work to the agent that fits, has every result checked independently, and interrupts a person only for decisions that cannot be undone.

**Problem:**
AI coding agents are now cheap and capable, but someone still has to manage them: choose the work, check the results, and decide what is safe to let them do alone. For founders, agencies and small teams that manager is the human, and it becomes the bottleneck. Existing agent tools assume a person directing each task, or are governance gateways that only log and restrict.

**Solution:**
Ultrastable puts virtual managers (portfolio, project, product, operations, an independent reviewer) above the agents. Agents gain independence as they prove themselves on a kind of work; improvement work is planned alongside fixes; nothing leaves the backlog without a recorded outcome. The core is cloud-agnostic, with adapters for different clouds and for different agents (CLI agents and the Anthropic API).

**Product stage:** Working prototype, pre-revenue, pre-launch. A runnable platform exists with automated tests (12 unit tests pass, run 2026-11-10), a web dashboard, JSON API, and a Google Cloud deployment script (Cloud Run + Cloud Scheduler + Secret Manager). Its demo uses simulated agents; real-agent adapters (Command for CLI agents, Anthropic API) exist but are not yet proven in production. No paying customers. `[FOUNDER CONFIRM]`

**Traction (truthful only):**
- Working platform with passing tests and a dashboard.
- Founder's own multi-project work (QNFO) runs on the earlier version of this system; it is the first internal user ("customer zero"). Figures are self-measured and labelled as such.
- Public site live; design-partner pilot offer open (pilot@ultrastable.io). No pilots, revenue or users to report. `[FOUNDER CONFIRM]` nothing has changed.

**Tech stack:** Python 3.11+, standard library only (no runtime dependencies), SQLite store today, HTTP server (stdlib) in a Docker container; Cloud Run, Cloud Scheduler, Secret Manager for deployment; Anthropic Messages API adapter; Cloudflare Workers currently host the public site.

**Why Google Cloud:**
1. The deploy path is already written for Cloud Run: one container, a Cloud Scheduler heartbeat that triggers the control loop every 10 minutes, and the token held in Secret Manager. Credits would let us run it for the first design partners without charging them infrastructure costs.
2. Vertex AI / Gemini as an additional model adapter, so customers can choose the model family used by the doer and, separately, by the independent reviewer (reviewer independence is a product principle).
3. Cloud SQL for PostgreSQL is the planned production store to replace the single-instance SQLite store (roadmap, not built).
4. Platform-agnostic stance: Google is a first-class target alongside Cloudflare; being on both lets us pitch customers on either.

**Credit use plan (ESTIMATE; scale to the tier granted):**

| Month | Use | Share of credits |
|---|---|---|
| 1 | Cloud Run + Scheduler + Secret Manager for a demo instance and one design-partner instance; Artifact Registry/Build | 10% |
| 2 | Build Gemini/Vertex adapter; reviewer-vs-doer model-family tests | 20% |
| 3 | Cloud SQL for PostgreSQL store; migration tests | 15% |
| 4-5 | 3 design-partner instances; Vertex usage for real agent runs | 30% |
| 6 | Logging/monitoring, load and failure testing, security hardening | 15% |
| Reserve | Overage buffer | 10% |

`[FOUNDER CONFIRM]` plan matches the granted amount.

**Team:** Rowan, solo founder: ideas, direction, product vision, and the identity-bound steps (signing, spending). Development, marketing, funding preparation and operations are performed by the platform's virtual managers and AI coding agents, supervised by Rowan. Planned hires with funding: founding engineer, part-time commercial lead. Be prepared to state that this is a one-person company. `[FOUNDER CONFIRM]`

**Funding status:** Bootstrapped by the founder; no institutional round; no angel investment received `[FOUNDER CONFIRM]`. Planning a pre-seed round after the first design-partner pilots. Applying to the Start tier; we understand the top tier requires an institutional investor.

**How much funding raised:** $0 external `[FOUNDER CONFIRM]`.

**Ask / what credits unlock:** Run the first design-partner instances and the Vertex AI adapter without infrastructure spend.

**Anything else (optional):** Founder is applying with an open product governed by the Ultrastable License (free for non-commercial use; Commercial License with revenue share for commercial use).

## After submission

Record the application date and reference in the data room (data-room-index.md). If the 31-day Workspace rule matters, log the date of any Workspace purchase.
