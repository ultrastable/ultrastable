// Sender Worker template. Deploy to your own Cloudflare account; no secrets live here.
// Bindings: SEND_EMAIL (send_email, restricted by allowed_sender_addresses in wrangler config),
//           MAIL_SEND_TOKEN (secret). POST /send {from,to,subject,text} with "authorization: Bearer <token>".
// The sender must be one of ALLOWED_FROM (comma list var). Cloudflare also enforces the binding's allowlist.
// VERIFY against current Cloudflare Email Service docs when you deploy: the binding API can change.
export function check(request, env, body) {
  if (request.headers.get('authorization') !== `Bearer ${env.MAIL_SEND_TOKEN}` || !env.MAIL_SEND_TOKEN) return [401, 'unauthorized'];
  const allowed = String(env.ALLOWED_FROM || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(body.from)) return [403, 'sender not allowed'];
  if (typeof body.to !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(body.to)) return [400, 'bad recipient'];
  if (!body.subject || !body.text) return [400, 'subject and text required'];
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/send') return new Response('not found', { status: 404 });
    const body = await request.json().catch(() => ({}));
    const bad = check(request, env, body);
    if (bad) return new Response(bad[1], { status: bad[0] });
    await env.SEND_EMAIL.send({ from: body.from, to: body.to, subject: body.subject, text: body.text });
    return Response.json({ ok: true });
  },
};
