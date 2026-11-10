<p align="center"><img src="brand/social/readme-banner.png" alt="Ultrastable" width="100%"></p>

# Ultrastable

**An autonomous development platform: an organization of virtual managers and staff that runs your projects, scores its own decisions, earns wider autonomy from its track record, and only interrupts a person for steps that cannot be undone.**

Private repository, system of record. If it is not here, it does not exist. **Nothing here leaves the repo except files in [external/](external/)** (the provisional patent is not yet filed; rules in [docs/CONFIDENTIALITY.md](docs/CONFIDENTIALITY.md)).

## The idea in six lines
1. **Virtual managers and staff:** portfolio, project and product managers, staff, reviewers, operations.
2. **Closed loops:** predict, execute, verify, score; nothing is dropped without a recorded disposition.
3. **Plussing:** improvement is planned, funded work.
4. **Earned trust:** a ledger widens autonomy from verified results; one interrupt gate for the irreversible.
5. **Bootstrap:** from one idea file to a running organization.
6. **Portable:** one core, Cloudflare and Google Cloud adapters.

Full story: [docs/overview.md](docs/overview.md). Architecture: [platform/docs/architecture.md](platform/docs/architecture.md).

## Status, honestly
| Piece | Status |
|---|---|
| QNFO fleet (customer zero, owner's own) | **Running**; numbers self-scored, unaudited ([customer story](docs/customer-story.md)) |
| Seed bootstrapper, 7-step tick, schema, policy | **Built**, 12 Python + 9 Worker tests pass; no real cloud `--apply` yet |
| Google Cloud adapter (Cloud Run, Scheduler) | **Skeleton built**, 2 tests pass, deploy script unrun |
| Dashboard | **In `dashboard/`**; status per its README, not verified here |
| Unified CLI, model executor, multi-tenancy | **Planned** |
| Outside customers, audit, entity, filed patent | **None yet** (owner steps) |

## Map
| Path | What |
|---|---|
| [docs/](docs/README.md) | Overview, concepts, bootstrapping, customer story, security, confidentiality |
| [platform/](platform/README.md) | Architecture and cloud adapters (`adapters/gcp`, `adapters/sqlite`) |
| [seed/](seed/README.md) | Idea-to-organization bootstrapper, tick, policy, roles |
| [business/](business/README.md) | Business plan, funding, [Google for Startups kit](business/google-startups/application-kit.md), [marketing strategy](business/marketing/strategy.md) |
| [external/](external/README.md) | **SAFE NOW** versions that may be sent out |
| [ip/](ip/README.md) | Provisional patent draft, evidence, prior art (NDA ONLY) |
| [site/](site/) | Site worker and starter |
| [dashboard/](dashboard/README.md) | Product dashboard (built in a sibling thread; see its README for status) |
| [brand/](brand/BRAND.md) | Brand guide, logos, social assets |
| [agents/](agents/) | Agent protocol, roles, autonomy policy |
| [ROADMAP.md](ROADMAP.md), [PROJECTS.md](PROJECTS.md), [INDEX.md](INDEX.md) | Backlog, projects, index of everything |
| artifacts/, core-manifest/, deploy/, github/, research/, qnfo-platform-thread/, HANDOFF.md | Records and earlier QNFO extraction material |

## Owner-only next steps
File the provisional (after attorney review); form the entity and assign IP (#1); send only `external/` files; set up domain email and a Google billing account; submit applications; run `platform/adapters/gcp/deploy.sh` with a GCP project.

Issues: https://github.com/ultrastable/ultrastable/issues
