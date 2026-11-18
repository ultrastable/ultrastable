# core/airouter

AI-ROUTER-1. Free Workers AI first, cache and dedupe, quality gate, paid escalation only inside a hard monthly cap (default 0), every call recorded and fed back into routing. See the header of `index.js`. Tenants pass `db`, `ai`, `models` and `config`; a paid model is a `run()` function the tenant binds, so the router never holds a key.
