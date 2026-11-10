# ultrastable/site

Landing page for the Ultrastable domains.

- `public/` is served as static assets by a Cloudflare Worker (`wrangler.jsonc`).
- Local preview: `npx wrangler dev`. Deploy: `npx wrangler deploy`.
- Attach the domains in the Cloudflare dashboard (Workers > ultrastable-site > Domains & Routes) or add `routes` to `wrangler.jsonc`.

Do not attach the public domains until the provisional patent application is filed (see the `ip` repo). Until then the page can stay on a preview URL behind Cloudflare Access.
