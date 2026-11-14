// Executor dispatch: the Worker's tick hands the work step to a host that can run code (GitHub Actions `executor.yml`).
// Provider interface: a provider is { id, available(env), dispatch(env, fetchImpl) } -> { ok, detail }. The first available
// provider wins; every result is returned so the tick records it as an outcome (never silent). Add providers (a hosted model
// Worker, a queue a cloud-hosted agent drains) without touching the tick.
import { probe } from './codeagent.js';
import { ensureItem } from './tick.js';
import { nativeProvider } from './nativeexec.js';
export const PROVIDERS = [
  nativeProvider,  // ZERO-MINUTES-1: first choice, no Actions minutes; the Actions dispatch below is the fallback when this one is unavailable or fails
  {
    id: 'github-actions',
    available: env => Boolean(env.GITHUB_DISPATCH_TOKEN && env.GITHUB_REPO),
    async dispatch(env, fetchImpl = fetch) {
      const r = await fetchImpl(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-tick', 'content-type': 'application/json' },
        body: JSON.stringify({ event_type: 'ultrastable-tick', client_payload: { host: 'cloudflare-worker' } }),
      });
      return { ok: r.status === 204, detail: `github dispatch HTTP ${r.status}` };
    },
  },
  {
    // The code agent inside Cloudflare: proves the Workers AI route every tick and records which adapters answered. Edits are applied by the
    // Actions executor (foundation/executor.py, same adapter registry); this provider is the in-Worker half and needs no token.
    id: 'workers-ai-agent', observer: true,
    available: env => Boolean(env.AI),
    async dispatch(env) { const r = await probe(env); return { ok: r.ok, detail: 'code agents answering: ' + r.adapters.filter(a => a.ok).map(a => a.adapter).join(',') }; },
  },
];

export async function runExecutor(env, { providers = PROVIDERS, fetchImpl } = {}) {
  const results = [];
  for (const [i, p] of providers.entries()) {
    if (!p.available(env)) { results.push({ provider: p.id, ok: false, detail: 'not configured (binding missing)' }); continue; }
    try {
      const r = await p.dispatch(env, fetchImpl);
      results.push({ provider: p.id, ...r });
      if (r.ok && !p.observer && !providers.slice(i + 1).some(q => q.observer)) break;  // observers (the in-Worker code-agent probe) always run
    } catch (e) { results.push({ provider: p.id, ok: false, detail: String(e && e.message) }); }
  }
  return results;
}

// EXEC-SPARK-2: a result nobody reads is a silent failure. When no dispatching provider (a non-observer) is ok, the tick files one
// item for operations that carries the refusal text and a probe; when one is ok again the item is not reopened here (the probe closes it).
export async function noteExecutor(db, results) {
  const dispatchers = results.filter(r => r.provider !== 'workers-ai-agent');
  if (dispatchers.some(r => r.ok)) return { filed: false };
  const why = dispatchers.map(r => r.provider + ': ' + r.detail).join('; ').slice(0, 300);
  const filed = await ensureItem(db, {
    id: 'EXEC-SPARK-UNREACHABLE', kind: 'fix', owner_role: 'operations', priority: 5,
    title: 'The tick cannot wake the executor (' + why + ')',
    done_check: 'a tick dispatches the executor: provider github-actions answers HTTP 204, or the executor workflow starts from its own triggers',
    closing_probe: 'GET /health shows executor.ok = true; gh run list --workflow executor shows a run with event repository_dispatch',
  });
  return { filed, why };
}
