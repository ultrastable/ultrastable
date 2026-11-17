// Event-driven triggers: GitHub webhook -> which role to wake. Pure and testable; the table is generated from doctrine/triggers.json
// by `python3 -m foundation triggers --sync` (never edit by hand). Time-driven triggers are the cron heartbeat in index.js.
export const EVENT_TABLE = [
  {
    "id": "issue-opened",
    "event": "issues",
    "actions": [
      "opened",
      "reopened"
    ],
    "role": "project-manager"
  },
  {
    "id": "issue-comment",
    "event": "issue_comment",
    "actions": [
      "created"
    ],
    "role": "project-manager"
  },
  {
    "id": "pr-needs-review",
    "event": "pull_request",
    "actions": [
      "opened",
      "synchronize",
      "ready_for_review"
    ],
    "role": "reviewer"
  },
  {
    "id": "pr-merged",
    "event": "pull_request",
    "actions": [
      "closed"
    ],
    "when": "merged",
    "role": "operations"
  },
  {
    "id": "push-main",
    "event": "push",
    "when": "default-branch",
    "role": "operations"
  },
  {
    "id": "ci-failed",
    "event": "workflow_run",
    "actions": [
      "completed"
    ],
    "when": "failed",
    "role": "operations"
  },
  {
    "id": "release-published",
    "event": "release",
    "actions": [
      "published"
    ],
    "role": "marketing-manager"
  },
  {
    "id": "research-queued",
    "event": "repository_dispatch",
    "actions": [
      "research-queued"
    ],
    "role": "research-publisher"
  },
  {
    "id": "disclosure-check",
    "event": "repository_dispatch",
    "actions": [
      "disclosure-check"
    ],
    "role": "legal-ip-manager"
  },
  {
    "id": "support-request",
    "event": "repository_dispatch",
    "actions": [
      "support-request"
    ],
    "role": "customer-success"
  },
  {
    "id": "manifest-changed",
    "event": "repository_dispatch",
    "actions": [
      "manifest-changed"
    ],
    "role": "org-designer"
  },
  {
    "id": "objective-changed",
    "event": "repository_dispatch",
    "actions": [
      "objective-changed"
    ],
    "role": "portfolio-manager"
  },
  {
    "id": "wake-customer-success",
    "event": "repository_dispatch",
    "actions": [
      "wake:customer-success"
    ],
    "role": "customer-success"
  },
  {
    "id": "wake-design-manager",
    "event": "repository_dispatch",
    "actions": [
      "wake:design-manager"
    ],
    "role": "design-manager"
  },
  {
    "id": "wake-funding-manager",
    "event": "repository_dispatch",
    "actions": [
      "wake:funding-manager"
    ],
    "role": "funding-manager"
  },
  {
    "id": "wake-infrastructure-manager",
    "event": "repository_dispatch",
    "actions": [
      "wake:infrastructure-manager"
    ],
    "role": "infrastructure-manager"
  },
  {
    "id": "wake-legal-ip-manager",
    "event": "repository_dispatch",
    "actions": [
      "wake:legal-ip-manager"
    ],
    "role": "legal-ip-manager"
  },
  {
    "id": "wake-marketing-manager",
    "event": "repository_dispatch",
    "actions": [
      "wake:marketing-manager"
    ],
    "role": "marketing-manager"
  },
  {
    "id": "wake-operations",
    "event": "repository_dispatch",
    "actions": [
      "wake:operations"
    ],
    "role": "operations"
  },
  {
    "id": "wake-org-designer",
    "event": "repository_dispatch",
    "actions": [
      "wake:org-designer"
    ],
    "role": "org-designer"
  },
  {
    "id": "wake-outreach-coordinator",
    "event": "repository_dispatch",
    "actions": [
      "wake:outreach-coordinator"
    ],
    "role": "outreach-coordinator"
  },
  {
    "id": "wake-outreach-manager",
    "event": "repository_dispatch",
    "actions": [
      "wake:outreach-manager"
    ],
    "role": "outreach-manager"
  },
  {
    "id": "wake-portfolio-manager",
    "event": "repository_dispatch",
    "actions": [
      "wake:portfolio-manager"
    ],
    "role": "portfolio-manager"
  },
  {
    "id": "wake-product-manager",
    "event": "repository_dispatch",
    "actions": [
      "wake:product-manager"
    ],
    "role": "product-manager"
  },
  {
    "id": "wake-program-manager",
    "event": "repository_dispatch",
    "actions": [
      "wake:program-manager"
    ],
    "role": "program-manager"
  },
  {
    "id": "wake-project-manager",
    "event": "repository_dispatch",
    "actions": [
      "wake:project-manager"
    ],
    "role": "project-manager"
  },
  {
    "id": "wake-research-publisher",
    "event": "repository_dispatch",
    "actions": [
      "wake:research-publisher"
    ],
    "role": "research-publisher"
  },
  {
    "id": "wake-reviewer",
    "event": "repository_dispatch",
    "actions": [
      "wake:reviewer"
    ],
    "role": "reviewer"
  },
  {
    "id": "wake-staff",
    "event": "repository_dispatch",
    "actions": [
      "wake:staff"
    ],
    "role": "staff"
  },
  {
    "id": "wake-uiux-manager",
    "event": "repository_dispatch",
    "actions": [
      "wake:uiux-manager"
    ],
    "role": "uiux-manager"
  }
];

export function routeEvent(name, payload, table = EVENT_TABLE) {
  const action = payload && payload.action;
  const merged = Boolean(payload && payload.pull_request && payload.pull_request.merged);
  const failed = Boolean(payload && payload.workflow_run && payload.workflow_run.conclusion === 'failure');
  const ref = payload && payload.ref;
  for (const t of table) {
    if (t.event !== name) continue;
    if (t.actions && t.actions.length && !t.actions.includes(action)) continue;
    if (t.when === 'merged' && !merged) continue;
    if (t.when === 'failed' && !failed) continue;
    if (t.when === 'default-branch' && ref !== 'refs/heads/main') continue;
    return { id: t.id, role: t.role };
  }
  return null;
}

export async function verifySignature(secret, body, header) {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const hex = Array.from(mac, b => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
