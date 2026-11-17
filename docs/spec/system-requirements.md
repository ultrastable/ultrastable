<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# System and bootstrapping requirements

Plain version first, then the technical version. Honest status labels: BUILT (code with passing tests), PLANNED (designed, not built).

## What you need (the person)

| You need | Detail |
|---|---|
| A web browser | That is all for the first look |
| About 15 minutes | Most of it is answering a few questions in your own words |
| An email address | To create a Cloudflare account if you decide to keep what is built |
| Nothing else | No terminal, no code, no credit card for the free plan |

You do not need to know what a code agent, a Worker or a database is. You will be asked what you want, and asked to decide only things that are yours to decide.

## What it costs

| Item | Cost |
|---|---|
| Running Ultrastable on the Cloudflare Free plan | USD 0. When a daily limit is reached the service stops until the next day; it does not bill you |
| AI models, if you choose paid ones | Your chosen monthly limit (default 0). Set a limit at the model gateway so it blocks at the limit, and Ultrastable also caps itself |
| License | Free for non-commercial use. If you make money with it, a commercial license applies (see `LICENSE` and `COMMERCIAL-TERMS.md`) |

## The three ways in (front doors)

See [US-SPEC-19](../specs/US-SPEC-19-front-door.md).

| Door | Who | Needs | Status |
|---|---|---|---|
| A. Web page: answer questions in a browser, get a live preview | A person with no technical background | A browser | PLANNED |
| B. Paste one prompt into an AI assistant that can run tools | A person already using a coding agent | Such an assistant, Node 20+, Python 3.11+, Git | BUILT (skill, probe, tests); live trial 2026-11-11 partly failed, see [why-cloudflare](why-cloudflare.md) |
| C. Developer: clone and run the bootstrapper | A developer | Node, Python, Git, Wrangler | BUILT |

## What the system needs to run (technical)

| Requirement | Detail | Status |
|---|---|---|
| Platform | Cloudflare Workers; D1; a timer (cron trigger or Durable Object alarm); Workers secrets | Workers, D1, cron BUILT; alarm tick PLANNED |
| Identity of the deployment | One Worker and one D1 database per organization; names from the idea file | BUILT |
| Secrets | `CONSOLE_TOKEN` (console key), `TICK_TOKEN` where the scheduler endpoint is used, model keys if paid models are chosen; presence only is ever read by the tick | BUILT |
| Free-plan limits relied on | 5 cron triggers per account; 10 ms CPU per request; 50 outside requests per invocation; 100,000 requests a day; D1 5,000,000 reads and 100,000 writes a day | Verified 2026-11-11 |
| Model access | Workers AI free models for triage; one paid provider behind a gateway with a spend limit for stronger work | Router BUILT; gateway setup PLANNED |
| Work that does not fit a Worker | Builds, tests, long jobs run on a CI runner or container; the Worker records and coordinates | PLANNED |

## Bootstrapping requirements (technical)

Each stage of the bootstrapper, what it needs, and what happens when it is missing. A missing requirement never stops the boot: it becomes a decision card with a reason and a closing probe.

| Stage | Needs | If missing |
|---|---|---|
| read | The idea file | A card asks for the idea |
| detect | Which credentials and tools exist (presence only) | Cards for each missing credential |
| select | The monthly limit | Defaults to 0: free models only |
| plan | Nothing | Writes the charter, roles, backlog, cards |
| provision | A Cloudflare account and a token or login with the Workers and D1 permissions | A card; dry-run output only |
| start | A timer: cron on a normal account | On a temporary account the tick cannot start; claim and re-run |
| verify | The closing probe (`agent-setup/verify.mjs`) | The organization is not called verified until it passes |

## Documentation that ships inside the product

Documentation is part of the system, not a separate site you have to find.

| Requirement | Status |
|---|---|
| Every bootstrapped organization gets a plain-language `org/README` written for its owner: what is running, what it costs, what to decide, how to stop it | PLANNED |
| The console has a Help view generated from these documents, in the person's vocabulary | PLANNED |
| Every decision card carries a "What does this mean?" explanation | BUILT |
| The specifications and these documents are versioned with the code and checked by tests for broken links and stale status labels | PLANNED |
