// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// OWNER-LINKS-3: every link the owner is handed is walked in a real headless Chromium against PRODUCTION, signed out: it must land on a working sign-in
// that carries the destination forward, and no page may offer to register a GitHub App. Run from GitHub Actions (owner-links-audit.yml); exit 1 on any failure.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");  // honors NODE_PATH, which ESM imports do not
const BASE = process.env.AUDIT_BASE || "https://ultrastable.io";
const fails = [], seen = [];
const bad = (what) => { fails.push(what); console.log("FAIL", what); };
const ok = (what) => { seen.push(what); console.log("ok  ", what); };
const browser = await chromium.launch();
const ctx = await browser.newContext();
ctx.on("response", r => { if (r.url().startsWith(BASE) && r.status() >= 500) bad(`HTTP ${r.status()} ${r.url()}`); });
async function visit(path, check) {
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 });
    const text = await page.content();
    if (/settings\/apps\/new|app-manifests/i.test(text)) bad(`${path}: offers to register a GitHub App`);
    const res = await check(page, resp, text);
    if (res === true) ok(path); else if (res) bad(`${path}: ${res}`);
  } catch (e) { bad(`${path}: ${String(e.message || e).slice(0, 160)}`); }
  await page.close();
}
const signsIn = nx => async (page, resp, text) => {
  const u = new URL(page.url());
  if (u.pathname !== "/auth/signin") return `landed on ${u.pathname}, not the sign-in page`;
  if (u.searchParams.get("next") !== nx) return `next was ${u.searchParams.get("next")}, wanted ${nx}`;
  return (await page.getByRole("button", { name: "Email me a sign-in link" }).count()) === 1 || "no emailed-link button";
};
for (const nx of ["/connect/buffer", "/connect/mastodon/start?instance=mstdn.science", "/connections"]) await visit(nx, signsIn(nx));
await visit("/auth/signin?next=/connect/buffer/start", async (page) => (await page.getByRole("button", { name: "Email me a sign-in link" }).count()) === 1 || "no emailed-link button");
await visit("/connect/github-signin", async (page) => new URL(page.url()).pathname === "/owner" || `landed on ${new URL(page.url()).pathname}`);
await visit("/owner?next=/connect/buffer/start", async (page) => { await page.waitForSelector("#send", { timeout: 15000 }); return (await page.locator("#send").isVisible()) || "email button hidden"; });
await visit("/api/owner/signin-options", async (page, resp) => resp.status() === 200 || `HTTP ${resp.status()}`);
await visit("/auth/passkey/add", async (page) => new URL(page.url()).pathname === "/owner" || `landed on ${new URL(page.url()).pathname}`);
await browser.close();
console.log(`${seen.length} links ok, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
