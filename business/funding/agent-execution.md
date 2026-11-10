# Who runs the agents: local, server-side, or both

*Tag: NDA ONLY (design reasoning). The working system runs server-side on Cloudflare today. Platform-agnostic core with Cloudflare and Google Cloud adapters is the standing stance.*

## Comparison

| Question | Server-side (hosted) | Local (user's machine / own cloud) |
|---|---|---|
| Who pays for models | Operator, passed through to customer; credits help | User, with their own keys |
| Always on (ticks while the user is away) | Yes: the core promise | Only if the machine is on; needs a daemon |
| Data and code stay with the user | No, unless customer-dedicated tenant | Yes |
| Security surface | Operator holds many tenants' secrets: high responsibility | User holds their own; smaller blast radius |
| Setup friction for a non-technical founder | Lowest (sign up) | Highest (install, keys, updates) |
| Fit for enterprise | Needs tenancy, audit, compliance | Often required ("must run in our cloud") |
| Fit for open source | Hosted service is the commercial layer | The open core must run here for credibility |
| Reaching the user's private tools and devices | Needs connectors / remote control | Native |
| Cost to operator | Compute for every customer's ticks | Near zero |

## Recommendation

**Hybrid by design, server-side by default.**

1. The core is runtime-neutral (already the architecture): the same managers, staff and ledgers run anywhere through an adapter.
2. **Hosted** (Cloudflare adapter first) is the default product and the commercial layer: always-on, no setup, billed.
3. **Self-hosted / bring-your-own-cloud** is the open core path (Docker, Cloudflare deploy button, Google adapter second). This is what open-source funders and enterprises need to see.
4. **Local companion** only for the steps that must touch the owner's device or identity (signing, money, local files). Those remain owner steps behind the interrupt gate whichever runtime is used.
5. Keys: customers can bring their own model keys on either runtime. Secrets are referenced by binding name and never read by agents (standing rule).

## What this means for funding

- Server-side: credits from Cloudflare and Google pay the hosting; this is Track B's cost engine.
- Self-host: this is the artifact Track A reviewers inspect. Without it, "open source" is not credible.

## Open item

A measured cost per managed project tick (model plus infrastructure) is needed before pricing. Tracked as an issue; not estimated here.
