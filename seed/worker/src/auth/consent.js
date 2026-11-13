// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// POINT-AND-CLICK-1: the one reusable consent screen. Whenever an authorization is needed, the product serves this screen: what is about to happen, why, and one Authorize button that goes
// to the provider's own screen. Everything after the click (callback, token exchange, storage, refresh, verification) is the system's. No screen asks for a token, a secret or a setting.
import { html } from '../ui.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// spec: { provider, title, will: [what the system will do], why, action: { url, method, fields }, button }
export function consentScreen(spec) {
  const fields = Object.entries(spec.action.fields || {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  const will = (spec.will || []).map(w => `<li>${esc(w)}</li>`).join('');
  return html(spec.title, `<h1>${esc(spec.title)}</h1><div class="card"><b>What happens next</b><ul>${will}</ul><p class="mut">${esc(spec.why)}</p></div>
<form method="${esc(spec.action.method || 'GET')}" action="${esc(spec.action.url)}">${fields}<button type="submit">${esc(spec.button || 'Authorize')}</button></form>
<p class="mut">You authorize on ${esc(spec.provider)}'s own page. Nothing to copy, paste or configure.</p>`);
}
export const doneScreen = (title, line) => html(title, `<h1>${esc(title)}</h1><div class="card">${esc(line)}</div><a class="btn" href="/">Continue</a>`);
export const failScreen = (title, line, retryUrl) => html(title, `<h1>${esc(title)}</h1><div class="card">${esc(line)}</div><a class="btn" href="${esc(retryUrl)}">Try again</a>`, 502);
