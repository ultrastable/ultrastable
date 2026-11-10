# Governance (DRAFT)

- **Maintainer of record:** the owner (Rowan) until an entity exists; then the entity. Virtual managers propose and review; the owner is the only identity that publishes, signs or accepts a licence change.
- **How changes land:** through pull requests on an `agent/<item>-<slug>` branch. The agent lane merges when checks pass and a different agent has reviewed. Nobody reviews their own work.
- **Interrupt gate:** a step that is both irreversible and identity-bound (money, signing, filing, deleting unbacked data, sending as the owner) is never taken by an agent; it becomes a gate card with its default in effect and a closing probe.
- **Rule changes:** `agents/AGENTS.md`, role files and `autonomy/policy.json` change only by a reviewed pull request, tested against recent ticks, with a version bump.
- **Disputes:** the maintainer decides and records the decision as an issue.
- **Community members:** may propose changes through issues and pull requests under CONTRIBUTING.md; they gain review rights only by a recorded maintainer decision.
