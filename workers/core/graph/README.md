<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/graph: topology and blast radius

Edges from in-repo imports (JavaScript and TypeScript relative imports, `import type`, re-exports, `require` and `import()` with a literal; Python relative imports and absolute imports of the ingested top-level directories) plus declared edges; `blastRadius(ctx, changed)` returns everything that transitively depends on the change, cycle safe, bounded by `maxNodes`, with `truncated` set when the bound stopped it. `sources` is an ordered list of edge providers (tree API, local files, ...): a failing source is reported and the others still build the graph. A file a source no longer lists loses the edges that source gave it, after a listing that succeeded, and `ingest` names it under `pruned`. A specifier computed at run time is not seen, and an import named in a comment is read as an import. `tools/fleet_graph.mjs` runs it over a working tree.

Owner role: project-manager. Trigger: ingest on each merge; query before each change. Closing probe: `blastRadius` of a known leaf lists its known importers. Status: BUILT (`graph.test.js`, `fleet-graph.test.js`, US-SPEC-12 Part C: R22 to R24). Non-code nodes: `core/datagraph` and `core/kgraph` turn every table's rows into a graph, and `wiring.js` below discovers service and data-flow edges between workers; any other edge is declared with `declare()`.

## Wiring graph (`wiring.js`, US-SPEC-12 Part B)

`sweep` reads each worker's crons, routes, queue consumers and bindings from a deployment metadata port and stores the reading (`migrations/0002_wiring.sql`); `analyze` labels islands, sinks, sources and unresolved targets, computes directed density (over the swept workers and the registered workers an edge reaches, so it cannot pass 1) and the drift counts against a registry port, joins each table's writers with its readers and writes service and data-flow edges into the same edge table blast radius reads; `census` separates idle from unmeasured. Tests: `wiring.test.js`.

| ID | Status | Where |
|---|---|---|
| US-12-R09 graph read from deployment metadata | BUILT against a `metadata` port; `adapters/cloudflare/src/metadata.js` implements it over a fake fetch, the call with a real account is PLANNED | `sweep` |
| US-12-R10 errored worker listed under errors, excluded from counts | BUILT | `sweep` |
| US-12-R11 islands, sinks, sources, unresolved, three drift counts | BUILT | `analyzeGraph`, `analyze`; T05 |
| US-12-R12 producer-without-consumer tables | BUILT. Table access comes from the metadata port's declared lists and from SQL found in script text, comments excluded by a scanner that knows where strings are (a `/*` inside a string is text); SQL assembled at run time is not seen | `extractTableAccess`, `stripComments`, `producerConsumer`; T06 |
| US-12-R24 data-flow and service edges written to the topology graph | BUILT | `analyze` |
| US-12-R13 no retirement before the roster includes the member | BUILT | `census` |
| US-12-R14 probe and calibration traffic is not external usage | BUILT | `externalUsage`, `census` |

