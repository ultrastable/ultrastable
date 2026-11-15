# ultrastable/site

Landing page for the Ultrastable domains.

- `public/` is served as static assets by a Cloudflare Worker (`wrangler.jsonc`).
- Local preview: `npx wrangler dev`. Deploy: `npx wrangler deploy`.
- Attach the domains in the Cloudflare dashboard (Workers > ultrastable-site > Domains & Routes) or add `routes` to `wrangler.jsonc`.

The project is open, so the public domains can be attached as soon as the page is ready.
