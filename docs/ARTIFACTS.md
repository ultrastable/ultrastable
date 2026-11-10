# Live systems and artifacts (2026-11-10)
| Artifact | Detail |
|---|---|
| Website | Cloudflare Worker `ultrastable-site` v0.1.0, source `site/worker.js`; canonical https://ultrastable.io ; www, ultrastable.app (-> /pilot), ultrastable.net (-> /proof) redirect |
| Domains | ultrastable.io zone 18a7463a4e79b98d04aa22eb96b0127b ; ultrastable.app zone 29a8a782765682441aafd3f64a186ea6 ; ultrastable.net zone e23fd6a6078d557c08462aaa80614402 (Cloudflare account edb167b78c9fb901ea5bca3ce58ccc4b, the QNFO account) |
| Mail | Cloudflare Email Routing on ultrastable.io: pilot@ultrastable.io forwards to the owner |
| Private storage | Cloudflare KV `ultrastable-private` (f41303a09abc473faf41f9685ebb1a72): older short copies of the positioning, extraction plan, issues and roadmap; this repo is the up-to-date copy |
| Live proof source | https://qnfo.org/api/platform-claims (7 of 7 claims passing on 2026-11-10); to be replaced by a product-side feed |
| Closed PR | QNFO/qnfo-workers#10183 (site in the public repo; closed unmerged) |
| Not created | GitHub Projects board; second and further repos (only ultrastable/ultrastable exists) |
