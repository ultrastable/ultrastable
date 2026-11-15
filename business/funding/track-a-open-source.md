# Track A: open source and foundation routes

*Voice: funding manager. Verified 2026-11-10 unless a row says otherwise. Source of truth for status: [registry.json](registry.json).*

## The honest summary

Almost every open-source funder wants **an existing, released project with users, a clear licence and governance**. Ultrastable is public now but has no outside users yet, so Track A is mostly a **2027 track**: release an open core, collect adoption, then apply. The few things that work earlier are fiscal hosting, small credits and a neutral-home decision.

## Programs

| ID | Program | Size | Eligibility (from source) | Deadline | Fit now | Fit after release |
|---|---|---|---|---|---|---|
| A-STF | [Sovereign Tech Fund](https://www.sovereign.tech/programs/fund) (verified) | Project cost over EUR 50,000; no maximum stated | Open digital **base technology**; OSI/FSF licence; no prototypes; user-facing apps not currently sought; no other public funder for the same work; about 6 months from submission to contract | None listed; apply via apply.sovereign.tech | Low | Medium only if other software depends on the core (prevalence is a criterion) |
| A-GHSOSF | [GitHub Secure Open Source Fund](https://github.com/open-source/github-secure-open-source-fund) (verified) | USD 10,000 per project in three payments | Current maintainer, at most 2 applicants, licence, demonstrated traction and adoption, governance before kickoff, 15 h programme | Rolling | None | Medium: security hardening of an agent runtime is on topic |
| A-NLNET | [NLnet NGI Zero Commons](https://nlnet.nl/news/2026/20260601-call.html) (secondary: page inconsistent) | Not on page; typically small five-figure euro (unverified) | Open licence; European public-interest framing | 2027-01-03 per site banner; themed calls (Taler, Fediversity) closed 2026-08-01 | Low | Low to medium; themes do not match agent management |
| A-AAIF | [Agentic AI Foundation, Linux Foundation](https://aaif.io/blog/how-to-submit-your-project-to-the-aaif) (verified) | No cash stated; GitHub Enterprise, Cloudflare features, events | Proposal through `aaif/project-proposals`; adoption, community, governance, 6 to 12 month roadmap | Rolling | None | High as a **neutral-home option** if the core becomes an interoperability layer |
| A-MOZ | Mozilla Foundation (secondary) | About USD 50,000 (2026 Democracy x AI cohort, closed 2026-03-16) | Civic and democratic AI framing | Next call unknown | Low | Low unless a public-interest use case is built |
| A-HUMAI | Humanity AI pooled fund (secondary) | USD 18M pooled across ten foundations | Public-interest AI | Summer 2026 call; next round unknown | Low | Watch |
| A-OTF | [Open Technology Fund](https://www.opentech.fund/funds/foss-sustainability/) (verified) | Not listed | Internet-freedom scope | Not listed | None | None unless censorship-resistance is a real use case |
| A-NSFPOSE | NSF POSE (unverified; nsf.gov unreachable) | Unknown | US organization; open-source ecosystem building | Unknown | Unknown | Possible; verify first |
| A-SLOAN, A-FORDMELLON | Sloan, Ford, Mellon digital-infrastructure funders (unverified) | Unknown | Believed mostly invitation or research grants | Unknown | Not an application route | Relationship-building only |
| A-ASF | [Apache Incubator](https://incubator.apache.org/) (unverified) | No money | Community-led project; foundation takes code and trademark stewardship | n/a | None | Only if Rowan wants to give up control of the name; conflicts with a commercial layer under the brand |
| A-OSC | [Open Source Collective](https://opencollective.com/opensource/apply) (unverified) | Takes a fee (not stated on page) | Fiscal hosting for open-source projects, donations and sponsors | Rolling | Possible once public | Useful early: lets sponsors pay without Rowan forming an entity first |

Cloud OSS credit programs (Google Cloud, Cloudflare Project Alexandria, AWS Open Source Credits) exist; terms were **not** verified in this pass and are tracked as a maintenance item (issue filed, see MAINTENANCE.md).

## ultrastable.org as the "Apache-style" home

What it can mean, in increasing commitment:

1. **Project site and namespace only.** `ultrastable.org` hosts docs and the open core; the company keeps the `.io` / `.app` domains for the commercial layer. No cost. Do this first.
2. **Fiscal host.** Open Source Collective or similar holds donations and sponsor money. Cheap, reversible.
3. **Own foundation (nonprofit).** Real neutrality, but needs a legal entity, board, bylaws, trademark assignment (the programme's own requirement). Not worth it before there are outside contributors.
4. **Donate to an existing foundation** (Linux Foundation / AAIF, Apache). Gives credibility and neutrality; costs control of the trademark and roadmap. Decide only after traction.

Recommendation: do (1) now, (2) at first public release, defer (3) and (4). Keep the **trademark** owned by the company until a deliberate transfer.

## Track A sequence

1. Publish the open core under `ultrastable.org` with licence, governance file, security policy, contribution guide.
2. Apply to GitHub Secure Open Source Fund and a fiscal host once there are outside users.
4. Draft one Sovereign Tech Fund and one NSF POSE (if eligible) proposal around a **base component** (for example the portable core and its adapters), not the whole product.
5. Revisit AAIF submission at the point where another project depends on the core.

## Failure notes from this research (also in docs/BOOTSTRAP-GAPS.md)

nsf.gov and sloan.org could not be fetched; the NLnet page contradicted itself; the search tool returns links only, so several rows are `secondary`. Each is a registry status, not a guess.
