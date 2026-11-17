<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Scope: what Ultrastable is, and what it is not

Version 1.0, 2026-11-11. This file is the scope boundary for the project. A change to it is a reviewed change with a stated reason. Every other document, README, page and agent instruction must agree with it.

## One sentence

**Ultrastable turns a person who can only say what they want into a managed, self-correcting build of a working system, by writing and then following its own specifications, charters and plans.**

## Who it is for

A person who can state what they want, and who is **not** a coder or an engineer and does not know what they do not know. The product assumes ignorance as the normal case. It must know what it needs, ask for it in plain words, and fill the gaps it cannot get answered with stated, reversible defaults. See `US-SPEC-16` (ignorance and prompted recall).

## What it does by default (in scope)

1. **Bootstrap.** From one plain-language idea file, set up the runtime, the roles and the records (`US-SPEC-10`), with nothing else assumed.
2. **Elicit.** Find out what the person does not know that the system needs, through prompted recall, defaults and examples, never jargon (`US-SPEC-16`).
3. **Write the specifications.** Produce its own architectural specifications, charters, requirements, backlog, and decision records from those answers, in the same form as the `US-SPEC` series.
4. **Manage the work as a portfolio, program, product and project**, using the whole discipline in `US-SPEC-15`: initiating, planning, executing, monitoring and controlling, closing, in predictive, agile or hybrid form as the work needs. Charters, scope statement, work breakdown, schedule, risk and issue registers, change control, status reporting, reviews, retrospectives, lessons learned, closeout.
5. **Build the thing**: code, tests, deployment to the runtime, verification that it works, and repair when it does not.
6. **Govern itself**: earned autonomy, an interrupt gate for irreversible identity-bound steps, caps, claims, scoring of its own predictions (`US-SPEC-03` to `09`).

The outputs of 3 and 4 are files in a repository. If it is not in code or files, it does not exist.

## Where it sits between a site builder and a coding agent

Site and app builders are friendly but boxed in by what they can do. Coding agents can do anything but assume you work in a terminal. Ultrastable is for the person in between: it can build anything the specifications and scope allow, and it is operated by buttons first and a prompt second (`US-SPEC-18`). The person never has to write code or look under the hood. The front end is the back end: every button writes the same record an agent would. People who do code can use the same interface with their own agents; it is not privileged.

Integration is at the level of records, not lock-in: the console is a replaceable view, and everything the person owns is available as plain files and records.

## Ultrastable runs on itself

This is a rule, not a slogan. The `ultrastable` organization and its repositories are the first organization the product runs: its code and specifications change through the same items, claims, reviews, predictions and probes the product sells ([US-SPEC-20](specs/US-SPEC-20-self-hosting.md)). It holds for any tool: every repository carries the same contract in every file an AI tool reads, CI enforces it, and a tool that cannot do a step is told what to do instead. We state our current stage honestly (today: stage 1) and the project checks its own claims: a specification that says BUILT must name code that exists.

## Platform: built for Cloudflare Workers, and it says so

Ultrastable is built for **Cloudflare Workers**. It is the only supported platform. We chose it because a free account is a hard cap, a person can start with no account at all, and one account holds the code, database, timer, AI models and identity gate. We proved it runs there and we publish the limits we hit. A Google Cloud Run adapter exists to show the design is not welded to one vendor; it is a proof, not a promise. Self-hosted, AWS and Azure are not targets. The reasons, a comparison with the alternatives, and the limits of Workers are in [docs/why-cloudflare.md](docs/why-cloudflare.md).

## No terminal required

The first step is never "open a terminal". There are three doors ([US-SPEC-19](specs/US-SPEC-19-front-door.md)): a web page for anyone, one prompt pasted into an AI assistant for people who use one, and a developer path. All end at the same checks and the same three-screen console.

## What it does not do by default (out of scope)

Unless the person turns on a Capability Pack (below), Ultrastable does **not**:

| Out of scope | Why |
|---|---|
| Write a business plan, financial model, pitch or funding application | A business plan is a different product. The system manages the *delivery* of what was asked for. |
| File trademarks or other legal instruments | Needs an identity-bound signature. |
| Give legal, tax, investment or medical advice | Not designed or tested for it (`LICENSE` Section 15.3). |
| Run marketing, sales, outreach or social accounts | Outbound contact with other people needs consent and policy of its own. |
| Hire, pay, contract or move money | Irreversible and identity-bound; always a gate card to a person. |
| Do research or write papers for the person | Separate product. |

The system says so plainly when asked, names the reason, and offers the pack.

## Capability Packs: how far we are willing to push

Code can be pointed at almost anything. The first installation of this design posts to social networks, sends mail to a subscriber list, makes video, reads analytics and operates cloud accounts. Those capabilities matter, because a fully autonomous organization acts at its edges as well as in its middle. They are **not the product**, and they must not distort it. They are **packs**: optional sets of agents and code loops, off by default, each with its own manager, charter, caps and kill switch (`US-SPEC-21`).

| Tier | What | Default |
|---|---|---|
| **Core** | Elicitation, specifications, charters, management lifecycle, code loops, deploy, console, trust, caps, and self-description (`US-SPEC-22`) | On |
| **Pack, class A: internal** | Works only on the organization's own records (analytics reading, documentation) | Off; may earn full autonomy |
| **Pack, class B: outward reach** | Email and subscribers, social posting, video, site publishing | Off; every action passes the outbound guard (consent, suppression, caps, approval, kill switch) |
| **Pack, class C: professional drafts** | Business plan, trademark or technical-description drafts, legal or tax text | Off; **draft only**, marked for professional review, never filed or sent |
| **Pack, class D: platform operations** | Operating cloud or provider accounts | Off; only through the deploy module with probes and revert |
| **Out of bounds** | Moving money; signing or filing for a person; contacting people without consent; impersonation; disinformation; surveillance; circumventing platform controls or the guard | Never, as core or pack (`US-SPEC-21` Section 3) |

A pack:

- is a separate directory with a manifest, its own charter, scope statement and tests;
- is **off** until a person enables it through a recorded, reversible decision;
- reaches the core only through its published interfaces, and the core never imports a pack;
- has a manager and a primary and guard metrics like any program, and gets its share of plussing;
- cannot weaken the interrupt gate, the caps, the outbound guard or this scope.

None of the packs ships in the core. They live in the code repository under `packs/` and are enabled in `ultrastable.json`.

## The scope test (use before adding anything)

A proposed feature, document or agent behavior is in scope only if **all** are true:

1. It helps a non-expert go from a stated want to a working, managed, verified system.
2. It is a specification, a charter, a plan, a management record, code, a test, a deployment, or an elicitation of what those need.
3. It does not require professional licensure, a signature, or outbound contact with third parties to work.
4. It can be checked by a probe that a different agent can run.

If any answer is no, it is not core. It becomes a Capability Pack proposal, filed as an issue with an owner, never silent work.

## Scope-creep controls

- **Scope gate.** An agent that is asked for out-of-scope work, by a person or by another agent, does not do it. It files a scope-change item with the request, the reason it is out of scope, and the pack that would cover it, and tells the requester.
- **Backlog check.** Each tick, the reconciliation step (`US-SPEC-08`) tags items whose text matches an out-of-scope category and holds them for a decision.
- **Change control.** A change to this file, or enabling a pack, is a recorded decision with a revert path, like any change to governance (`US-SPEC-07`).
- **Branding.** Public text calls Ultrastable what it is: a system that bootstraps and manages the building of working systems from a stated want, with its own specifications. It does not describe itself as a business, legal or research service.

## Branding line

> Say what you want. Ultrastable works out what it needs to know, writes the specifications, and builds and runs it on Cloudflare Workers, managed to the standard of a professional project office. No code and no terminal.

## What QNFO is, for scope purposes

QNFO is the live demonstration and first customer. QNFO also runs outreach, research publishing and similar applications on the same fleet. Those are QNFO's applications, not Ultrastable's product, and they are what the Capability Pack boundary is for.
