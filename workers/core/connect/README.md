<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/connect: the connection engine (CONNECT-1)

A knowledge graph records what is already linked. A vector space records what is alike. This module looks for places where the two disagree: two things that mean nearly the same but that nobody has linked. Each one is a lead for a new connection. Every Ultrastable system that holds problems and solutions, ideas or findings gets this from the core. It is tenant-agnostic: the item kinds, the relation to extend, the wording and the evidence weights are the tenant's data.

## Pipeline

1. **Items.** `{ id, kind, label, text, group?, weight? }`. `group` is a domain. `weight` is the strength of the evidence behind the item, from 0 to 1.
2. **Embed.** `embedAll` tries the routes in order and uses one route for the whole run, so every vector is in the same space:
   - `githubModelsEmbedder`: a CI run's own `GITHUB_TOKEN`.
   - `httpEmbedder`: `core/modelservice` `{ embed: [...] }` on Workers AI `@cf/baai/bge-base-en-v1.5`, authenticated with a GitHub OIDC token.
   - `workersAiEmbedder`: the AI binding inside a Worker.
   - `lexicalEmbedder`: TF-IDF with feature hashing. It needs no network and no credential, so a run always completes.

   Vectors are stored as int8 (`pack`/`unpack`, about 4x smaller than float32) and cached by text hash, so a run only pays to embed texts that changed.
3. **Generate.** Three generators read the graph and the vectors together:

   | Generator | Finds | Signal |
   |---|---|---|
   | `transfer` | S addresses P. Q means nearly what P means. S is not linked to Q. | meaning (P is like Q), checked by how well S fits Q |
   | `bridge` | A and B mean nearly the same but are far apart in the graph or in different domains | meaning across a structural gap |
   | `closure` | Swanson ABC: S shares problems with S2, and S2 addresses Q | structure (Adamic-Adar over shared neighbours), vetoed only when the meaning is clearly unrelated |

4. **Score.** `relevance × novelty × support × value × learned kind weight × agreement`.
   - Novelty comes from graph distance: a pair one hop apart is already linked and scores 0; a pair the graph cannot reach scores 1.
   - Agreement: when meaning and structure both reach the same pair, they form one corroborated entry (`found_by`) and its score is raised.
   - The similarity cutoff is not a fixed number. It is the run's own background, `mean + z × sd` over unrelated pairs, so it holds for any embedding model.
5. **Shortlist.** Pairs already explored (`known`) are dropped. The list is capped per item (`perItem`) so one hub cannot fill it.
6. **Hand on.** `toProposals` turns candidates into *proposed* kgraph edges. These are leads: a lead never fills a gap until a check confirms it with provenance. `questions` words each candidate as a question for the downstream loop (a model drafts, a red team challenges, sources are verified).
7. **Learn.** `calibrate(outcomes)` reads back what happened to each candidate it handed on (accepted or rejected downstream) and re-weights the generators. It starts from a Beta(1,1) prior, keeps each weight between 0.5 and 1.5, and changes nothing until a generator has at least 3 outcomes.

`nearest` is the vector-database query: semantic search over the same vectors.

## What it adopts from earlier research pipelines, and what it avoids

- **Adopted:** the same model (bge-base, 768 dimensions), int8 vectors compared all-pairs in memory, Adamic-Adar link candidates, and a cutoff set from the measured background.
- **Avoided:**
  - A graph-to-research handoff that failed silently. Here the consumer reads the candidate ledger directly, and a test covers that.
  - Admitting far more than the pipeline can process. Here a ranked shortlist is capped at what the next step can take.
  - Connections that nothing ever scored. Here `calibrate` scores them against downstream outcomes.

## Not covered

- Vectorize as the store. Brute force is exact up to a few thousand items, and past that the tenant moves to a Vectorize namespace through `tenantstore`'s VectorPort.
- Any use of a model to judge a candidate. That belongs to the tenant's downstream loop.

Owner role: knowledge. Trigger: a tenant's connect run (CI or Worker cron). Closing probe: `connect.test.js`. Status: BUILT.
