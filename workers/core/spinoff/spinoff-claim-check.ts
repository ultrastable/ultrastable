import type { BotContext, Env } from '../../types.js';

export const config: Config = {
  name: 'CLAIMS-LIVE-DAILY',
  owner: 'product-manager',
  schedule: '0 0 * * *', // Daily at UTC midnight
};

export default {
  async checkClaims(c: BotContext, env: Env): Promise<{ status: string; results: string[] }> {
    // 1. Load Claims (Ideally from doctrines/spinoff-claims.json, injected via env or fetch)
    // For this implementation, we embed the default list. In prod, inject from doctrine.
    const claims: Array<{ id: string; name: string; url: string; claim: string }> = c.env.CLAIMS_REGISTRY || [
      { id: 'ultrastable-site', name: 'Ultrastable Main Site', url: 'https://ultrastable.workers.dev', claim: 'Autonomous software organization providing autonomous software organization infrastructure.' },
    ];

    const results: string[] = [];

    for (const target of claims) {
      try {
        const validation = await verifyClaim(target.url, target.claim);
        if (validation.valid) {
          results.push(`PASS: ${target.name} claim validated.`);
        } else {
          results.push(`FAIL: ${target.name} claim mismatch (missing: ${validation.missing.join(', ')}).`);
        }
      } catch (error) {
        results.push(`ERROR: ${target.name} verification failed (${error.message}).`);
      }
    }

    return { status: 'closed', results };
  }
};

async function verifyClaim(url: string, claimText: string): Promise<{ valid: boolean; missing: string[] }> {
  // Fetch live content (word match against code/text)
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch');
  const content = await response.text();
  const words = new Set(claimText.toLowerCase().split(/\s+/).filter(w => w.length > 4)); // Match longer words for precision
  
  const found = new Set<string>();
  words.forEach(word => {
    if (content.toLowerCase().includes(word)) {
      found.add(word);
    }
  });

  const missing = Array.from(words).filter(w => !found.has(w));

  return {
    valid: missing.length === 0,
    missing
  };
}
