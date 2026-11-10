# ultrastable/platform

The core Ultrastable platform: the tick, the virtual-staff roles, the trust ledger, the prediction scorer and the plussing queue, generalized from the QNFO fleet so any organization can run it.

Status: the working system runs today inside QNFO on Cloudflare. Extracting and packaging it into this repo is a later step. See [docs/architecture.md](docs/architecture.md) for the target shape.

The boot path (idea to running org) lives in the `seed` repo; this repo is where the tick and roles are generalized for multiple tenants. The seed's `worker/src/tick.js` and `worker/migrations/0001_init.sql` are the first working slice.
