<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Why Ultrastable runs on Cloudflare Workers

Written 2026-11-11. Facts about Cloudflare were checked against its documentation on that date; facts about other clouds come from third-party summaries and official pages found by search, and are marked. Prices and limits change: check before you rely on a number.

## The short version

Ultrastable is built for **Cloudflare Workers**, on purpose, and says so. It is the one platform where a person who is not an engineer can go from nothing to a running system with the fewest steps, and where a free account stops at its limits instead of sending a surprise bill. We proved it runs there. We built the Google Cloud Run adapter to show the design is not welded to one vendor, but **Cloudflare Workers is the only supported platform.** Self-hosted, AWS and Azure are not targets, and nothing here promises they work.

## What a Worker is, in plain words

A Worker is a small program that Cloudflare runs for you, only when something asks it to, on its own network. You do not rent a server, install an operating system or keep anything patched. You hand Cloudflare the program and it runs it. Ultrastable has the shape this suits: a small program that wakes up on a timer, a small database, a web page for the person, and calls out to AI models.

## What Ultrastable uses, and why each piece

| Piece | What it is | What Ultrastable uses it for |
|---|---|---|
| Workers | Code that runs on demand with no server | The tick (the heartbeat), the console page, the APIs |
| D1 | A small SQL database | Every record: items, decisions, predictions, claims, the trust ledger |
| Cron Triggers (or Durable Object alarms) | A timer that wakes the Worker | The heartbeat. On a free account at most 5 cron triggers exist; a temporary account has none (see the trial below), so an alarm-driven tick is planned |
| Workers AI | Open models run by Cloudflare, with 10,000 free "neurons" a day | The cheap rung of the model ladder for triage and review |
| AI Gateway | A proxy in front of AI providers, with spend limits that block requests once a dollar budget is hit | The hard stop on model spend for paid models |
| Access | An identity gate in front of a web page | The outer lock on the console |
| Scoped account API tokens | Keys limited to chosen Workers and permissions | The most authority we ever ask an agent for |
| Temporary accounts | A free, no-signup account that lasts 60 minutes and can be claimed | Trying Ultrastable before signing up |

## Why Cloudflare, in order of weight

1. **The free plan is a hard cap.** On the Workers Free plan requests beyond 100,000 a day fail; D1 queries beyond 5 million row reads or 100,000 row writes a day fail (enforced since 2026-09-01); Workers AI stops at 10,000 free neurons a day. Paid plans do not stop: budget alerts only send an email and "do not cap your usage". For a person who cannot yet judge cloud bills, "it stops" beats "it warns".
2. **Fewest steps for a non-coder.** A Cloudflare account is free to create in a browser. AI agents can deploy with `wrangler deploy --temporary` with no account at all, and platforms can do the same through a REST API, with a claim link to keep the result. We found no equivalent at the other three clouds we checked; that is "not found", not "does not exist".
3. **One place for everything the system needs.** Code, a database, a timer, AI models, spend limits and an identity gate are all in one account with one bill and one login.
4. **Narrow permissions are possible.** Account-owned API tokens can be limited to specific Workers, so an agent can be given a key that cannot touch anything else.
5. **Nothing to operate.** There is no server for the person to patch, restart or secure.

## Matrix against the alternatives

Checked 2026-11-11. "Source" notes where the fact came from. Cells marked (unverified) are what we believe but did not confirm.

| | Cloudflare Workers | AWS Lambda | Google Cloud Run | Azure Functions (Consumption) |
|---|---|---|---|---|
| Free allowance | 100,000 requests a day (Free plan) | 1,000,000 requests and 400,000 GB-seconds a month, always free (AWS Lambda page) | 2,000,000 requests a month and a CPU and memory allowance, aggregated by billing account (Cloud Run pricing page and third-party guides) | 1,000,000 requests and 400,000 GB-seconds a month per subscription (Azure Functions pricing page) |
| What happens at the free limit | Requests fail (Error 1027); D1 and Workers AI fail closed | Billed beyond the allowance | Billed beyond the allowance; no hard cap | Billed beyond the allowance |
| A cap on total spend | Free plan is itself a cap. Paid: alerts only; AI Gateway spend limits block AI spend | AWS offers a newer Free plan with a hard cap for 6 months or until credits end (third-party summary); a cap on the standard account (unverified) | Budget alerts do not cap spend; per-project spend-cap budgets exist (third-party guides) | A spending limit exists only for free-account credits (USD 200, 30 days) and not for pay-as-you-go (Microsoft documentation) |
| Try before signing up | Temporary accounts: `wrangler deploy --temporary`, 60 minutes, claim to keep | Not found | Not found | Not found |
| Database, timer, AI, identity gate in one account | Yes (D1, cron or alarms, Workers AI, Access) | Separate services to assemble | Separate services to assemble | Separate services to assemble |
| Operational burden for a non-coder | None | Roles, regions and permissions to understand (unverified) | Billing setup and projects to understand | Subscriptions and resource groups to understand (unverified) |

**What the matrix does not say.** AWS Lambda and Azure Functions give a bigger free request allowance than Cloudflare's daily 100,000. Cloudflare's edge for Ultrastable is not raw free volume. It is the hard stop, the no-signup trial, the single account, and the least to understand.

Sources: [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [budget alerts](https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/), [temporary accounts](https://developers.cloudflare.com/workers/platform/claim-deployments/), [AWS Lambda](https://aws.amazon.com/pm/lambda/), [Cloud Run pricing](https://cloud.google.com/run/pricing), [Azure Functions pricing](https://azure.microsoft.com/en-us/pricing/details/functions/), [Azure spending limit](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit).

## Limits of Workers that shape the design

| Limit (Free plan unless stated) | Consequence for Ultrastable |
|---|---|
| 10 ms of CPU per request | The tick must be small: mostly database calls, no heavy computation |
| 50 outside requests per invocation | Model calls and GitHub calls are few per tick, or are handed to a queue |
| 5 cron triggers per account | At most five organizations per free account if each uses a cron |
| 0 cron triggers on a temporary account | The tick cannot run there; an alarm-driven tick is needed (planned) |
| Long builds and tests do not fit | They run elsewhere (a CI runner or a container); the Worker coordinates and records |

## When this will not be the right choice

- Work that needs hours of heavy computation, or large files, belongs on infrastructure built for it; Ultrastable then coordinates it rather than running it.
- If a person's organization requires AWS, Azure or its own servers, Ultrastable is not the product for them yet.
- If Cloudflare changes its free limits, parts of the cost story change. We test the limits we rely on, and the specifications state them.

## What we proved, and what we did not

| Proved | Evidence |
|---|---|
| The tick, schema, console and core modules run on Workers and pass their tests | Test suites in `ultrastable/workers` |
| A coding agent can follow the setup skill and put the Worker online on a temporary account | Live trial 2026-11-11 (below) |
| The same core runs behind a Cloud Run adapter against SQLite | Adapter tests; not deployed on Google Cloud |

| Not proved | Why it matters |
|---|---|
| A scheduled tick running on a temporary account | The trial showed temporary accounts allow no cron triggers |
| A fresh account, end to end, with no human help | The bootstrapper's apply step is unproven on a new account |
| Any other platform | We do not claim it |

## The live trial, 2026-11-11

An AI agent, given only the paste-in prompt and a made-up idea, ran in a sandbox with no credentials and used a temporary Cloudflare account. It put the Worker online and found real problems, now recorded as work: the rendered configuration kept a placeholder database id and had the public address switched off; a cron trigger is refused on a temporary account (so no tick can run); the migrations were not applied; the claim link is printed in plain output; and the temporary address sits behind a Cloudflare bot challenge until the account is claimed, which the first version of our probe wrongly read as "refused". The probe now treats a challenge page as "inconclusive". The honest result of the trial: **the Worker uploaded, the system was not verified.**
