<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# core/modelservice: keyless model route (MODELSERVICE-1)

`createModelService({ audience, repository, allow, defaultModel, path })` returns a Worker entry. A CI run of `repository` posts `{ prompt, model, max_tokens }` with its own GitHub OIDC token (audience `audience`); the Worker verifies it (`core/auth/actions-oidc.js`) and runs its Workers AI binding `AI` with `model` if it is in `allow`, else `defaultModel`. Tenants pass configuration only. Deploy it through `core/deploygate` with a rule that sets `ai: true`. Status: BUILT, tests `modelservice.test.js`.

| Piece | Status |
|---|---|
| OIDC-gated route, allow-listed models, `/health` reports the binding | BUILT |
| `textOf` reads every Workers AI answer shape (`response`, `result`, OpenAI `choices`, `output[].content[]`) | BUILT |
| A reasoning model that ran out of budget is retried once with the full budget | BUILT |
| A model error returns JSON `{ error: 'model_error', detail }` with the platform's reason | BUILT |
