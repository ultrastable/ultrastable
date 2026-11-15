# Competition: the honest landscape

*Voice: research staff. Checked 2026-11-10. Rowan is right that this is not new: several products already sell "a company run by AI agents". Ultrastable wins only on how it manages them, so that is what the pitch has to be about.*

## The landscape in four layers

| Layer | Players | What they are | Relation to Ultrastable |
|---|---|---|---|
| **AI workers (coding agents)** | Devin by Cognition (raised over $1B at $26B post-money, May 2026; reported $492M annualized revenue), Cursor ($50B valuation, April 2026), Claude Code, OpenAI Codex, Google Jules ([source](https://letsdatascience.com/blog/cognition-1-billion-26-billion-devin-89-percent-code)); also GitHub Copilot coding agent, Factory, Replit Agent | Agents that do the work, with a person directing | **Complements.** Ultrastable manages them. Their growth is our market. Risk: they add a management layer themselves |
| **"Run a company with agents"** | [Paperclip](https://hn.jakechampion.name/reader/https://paperclip.ing) (MIT open source: org charts, budgets with auto-pause, heartbeats, approvals, audit log, multi-company); Cofounder.co (agent departments, approval before risky actions, from $120/month); Polsia (daily cycles, acts first and reports after); NanoCorp (from $30/month); SoGood (CEO agent plus eight specialists) ([source](https://pancake.ai/blog/best-autonomous-company-platform-2026)); [agent.ceo](https://agent.ceo/blog/introducing-cybernetic-organizations) ("cybernetic organizations", CEO/CTO/engineer agents, Feb 2026) | Closest in story | **Direct competitors.** Paperclip in particular already has hierarchy and heartbeats, so those cannot be our headline |
| **Multi-agent frameworks** | CrewAI, LangGraph, Microsoft Agent Framework (AutoGen), OpenAI Agents SDK, Claude Agent SDK, MetaGPT and ChatDev (research: software-company roles for LLM agents) | Toolkits for building agent teams | **Substrate and prior art.** Builders could assemble something like us; MetaGPT/ChatDev mean role names alone are not novel |
| **Enterprise agent platforms and workflow tools** | Salesforce Agentforce, ServiceNow AI agents, Google Gemini Enterprise, AWS Bedrock AgentCore, Microsoft Copilot Studio; Zapier, n8n, Lindy, Relevance AI | Agents inside a vendor's suite, or task automation | **Future channels or acquirers**, not first-year rivals |

Layer 3 and 4 entries are from general knowledge and were not re-checked on 2026-11-10.

## Where Ultrastable is actually different

| Difference | Others | Ultrastable | Say it |
|---|---|---|---|
| **Autonomy is earned, not configured** | Fixed approvals or a budget cap (Paperclip, Cofounder.co) or "act first, report after" (Polsia) | Each agent's freedom on each kind of work rises and falls with its verified record | In plain words: "it gets more independent as it proves itself". Mechanism: the trust ledger and ladder |
| **Interrupts only for what can't be undone** | Approve-many, or approve-nothing | One narrow gate: irreversible *and* tied to someone's identity, after trying to make the step reversible | In plain words: "it only interrupts you for decisions that can't be undone". Mechanism: the classification and reversible-path step |
| **Predict, then check** | Agents report success themselves | Every action has a checkable prediction beforehand and an independent check after | Scored predictions |
| **Improvement is planned (plussing)** | Agent teams drift into fixing whatever broke | Every finished item proposes a plus; a fixed share of capacity goes to them; drift into fix-only work is detected | In plain words: "it plans improvement, not just fixes". Mechanism: the capacity rule and drift detector |
| **Rules that improve themselves** | Static prompts | Repeated failures and human friction become versioned rule changes, tested against history | Versioned rule amendments |
| **Nothing drops silently** | Tasks can vanish | Every item leaves only with a recorded disposition | Accounting invariant |
| **Org kit** | Templates per company | The same roles, gates and rhythm reused for any new organization or project | Org kit |
| **Running in production** | Many are weeks old | QNFO has run this way on Cloudflare since 2026 | "We run our own work on it". Numbers come from the live dashboard |

## What this means for the pitch

- Never lead with "AI agents that run your company"; that sentence belongs to five other products.
- Lead with the manager problem: agents are cheap, managing them is the new bottleneck.
- Make the gate and earned autonomy the memorable part: "it asks less as it proves more".
- Paperclip is free and open. Our answer is the management quality, the hosted service, and an open core of our own (a Rowan decision, now made: open, under the Ultrastable License).
- Name overlap: agent.ceo uses "cybernetic organizations". Ultrastable's Ashby lineage is older and more precise; use it in the story, and include it in the trademark search.
