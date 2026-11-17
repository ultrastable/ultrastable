// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// UIUX-1: serving A/B experiments on path steps. Pure: the arm is a function of the experiment id and a visitor key that is hashed per request and never stored
// (doctrine/design-experiments.json: "sha256(experiment|visitor) modulo arms: sticky, equal split, nothing stored"). The loop that decides them is foundation/uiux.py;
// the running experiments and promoted defaults come from site/uiux-data.js (generated). A browser that sends Do Not Track or Global Privacy Control, and any bot, is
// served the control and counted nowhere. Tests: site/uiux.test.mjs.
import UX from "./uiux-data.js";
import { isBot } from "../seed/analytics/analytics.js";
const enc = new TextEncoder();
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map(x => x.toString(16).padStart(2, "0")).join("");

// Same arithmetic as foundation/design.py assign(): int(sha256(id|visitor), 16) % len(arms).
export async function armFor(id, visitor, arms) { return arms[Number(BigInt("0x" + await sha(id + "|" + visitor)) % BigInt(arms.length))]; }

// The experiment running on this path, with the arm this request gets. null when none runs there. record is true only for a countable, consenting human request.
export async function experimentFor(request, env, path, data = UX) {
  const e = data.running.find(x => x.path === path);
  if (!e) return null;
  const control = e.arms[0], ua = request.headers.get("user-agent") || "";
  if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1" || isBot(ua)) return { id: e.id, slot: e.slot, arm: control.id, overrides: control.overrides || {}, record: false };
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const arm = await armFor(e.id, (env && env.ANALYTICS_SALT || "us") + ":" + ip + ":" + ua, e.arms);
  return { id: e.id, slot: e.slot, arm: arm.id, overrides: arm.overrides || {}, record: true };
}

// The text for a slot: a running experiment's arm, else the promoted default, else the page's own wording.
export function slotText(slot, field, fallback, x, data = UX) {
  if (x && x.slot === slot && x.overrides[field]) return x.overrides[field];
  const d = data.defaults[slot];
  return d && d[field] ? d[field] : fallback;
}

// The first-party event that marks the exposure (one per visitor-day through the existing counter; the loop reads it back as `exp:<id>:<arm>`).
export const exposureName = (x) => "exp:" + x.id + ":" + x.arm;
