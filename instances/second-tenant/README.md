# Instance: Second Tenant

**Ultrastable is the foundation for any autonomous system.** Second Tenant is the second system on the foundation, after tenant 0. It has its own manifest (`instance.json`, kind `other`, 5 USD/month) and its own deploy loop (`ops/second-tenant/deploy-loop.sh`, evidence `ops/second-tenant/latest.json`).

A system is autonomous if it has self-referential loops and the ability to close them (`python3 -m foundation loops --verify`).

Ultrastable runs on itself (`python3 -m foundation selfhost`).

Probe: `python3 -m foundation validate --manifest instances/second-tenant/instance.json` prints `manifest ok`; `python3 -m unittest tests.foundation.test_second_tenant`.
