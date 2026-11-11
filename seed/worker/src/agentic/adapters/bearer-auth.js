// AuthPort: static bearer token held in a Worker secret binding (MCP_TOKEN). Fails closed: no token configured means no access.
// An OAuth 2.1 / JWT adapter (RFC 9728 metadata is already served) replaces this file; the port does not change.
export const bearerAuth = {
  async verify(request, env) {
    const want = env && env.MCP_TOKEN;
    if (!want) return { ok: false, reason: 'no_token_configured' };
    const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (got.length !== want.length) return { ok: false, reason: 'bad_token' };
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
    return diff === 0 ? { ok: true, subject: 'mcp-token', scopes: ['read'] } : { ok: false, reason: 'bad_token' };
  },
};
