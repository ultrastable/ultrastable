# Repository map: code separate from documentation (2026-11-11)

| Repo | Holds | License |
|---|---|---|
| `seed` | The first code base: Cloudflare Workers runtime (tick, UI, D1), the bootstrapper and interview, policy, agent roles, tests. The thing a user copies. | UULA (see LICENSE) |
| `platform` | Portable core and adapters (Python reference today; Google Cloud adapter next). Generalizes seed's runtime once a second adapter exists. | Proprietary until relicensed under UULA |
| `docs` | All documentation: product scope, architecture specs, research, roadmap, strategy. No runnable code. | UULA |
| `ip` | Becoming `docs/architecture` specs; the patent drafts are archived, not filed. | private |
| `business`, `site` | Optional modules and the public site. Out of default scope. | separate terms |
| `ultrastable` | Canonical private monorepo and QNFO-derived history. | private |

Rule: code lives only in `seed` (and later `platform`); specs and decisions live only in `docs`. A spec change and its code change reference each other by path.

Note: until the separate repos are used, this monorepo is canonical: `seed/` is the code base, `docs/` the documentation, `ip/` the specs-to-be.
